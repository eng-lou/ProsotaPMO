from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.database import get_db

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            f"https://{settings.auth0_domain}/.well-known/jwks.json",
            cache_keys=True,
        )
    return _jwks_client


def _decode_token(token: str) -> dict:
    client = _get_jwks_client()
    signing_key = client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.auth0_audience,
        issuer=f"https://{settings.auth0_domain}/",
    )


@dataclass
class TokenPayload:
    sub: str
    email: str | None = None
    access_token: str = ""


_bearer = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> TokenPayload:
    try:
        payload = _decode_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    return TokenPayload(
        sub=payload["sub"],
        email=payload.get("email"),
        access_token=credentials.credentials,
    )


def _is_super_user_email(email: str) -> bool:
    bootstrap = {e.strip().lower() for e in settings.super_user_emails.split(",") if e.strip()}
    return email.lower() in bootstrap


def _fetch_userinfo_email_sync(access_token: str) -> str | None:
    """Fallback for when the access token itself has no `email` claim (the
    2026-08-25 Auth0-quirk case documented below) — Auth0's own /userinfo
    endpoint still honours the `email` scope the SPA already requests
    (AuthTokenProvider.tsx) regardless of what the API-audience JWT
    carries. Only invoked as a fallback (first login with no token email,
    or healing an old synthetic-email row), not on every request, so the
    extra network hop stays rare."""
    req = urllib.request.Request(
        f"https://{settings.auth0_domain}/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        return data.get("email")
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None


async def _resolve_real_email(token: TokenPayload) -> str | None:
    if token.email:
        return token.email
    if token.access_token:
        return await asyncio.to_thread(_fetch_userinfo_email_sync, token.access_token)
    return None


async def get_db_user(
    token: TokenPayload = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the DB User for the authenticated token, auto-provisioning on first login."""
    from app.models.organisation import Organisation
    from app.models.user import User

    result = await db.execute(select(User).where(User.auth0_sub == token.sub))
    user = result.scalar_one_or_none()
    if user:
        dirty = False
        # Auth0 access tokens for a custom API audience don't always carry
        # an `email` claim (tenant/scope-dependent — confirmed 2026-08-25:
        # Maro's own first login got one without it, so his row was stuck
        # on the synthetic `user+<sub>@...local` placeholder from the
        # first-login branch below, and this claim turned out to be
        # *always* missing on this tenant, not just that one login — so a
        # plain "trust token.email when present" self-heal never actually
        # fired). Whenever a real email is resolvable — from the token
        # directly, or via the /userinfo fallback below when it isn't —
        # trust it over whatever's stored; nothing else in this app lets
        # email be edited, so this is always the source of truth once
        # available. Only bother resolving at all when there's a real
        # mismatch to fix, so this stays a rare network hop, not a
        # per-request one.
        if user.email.endswith("@prosotapmo.local") or (token.email and user.email != token.email):
            real_email = await _resolve_real_email(token)
            if real_email and real_email != user.email:
                user.email = real_email
                dirty = True
        # Self-heals bootstrap super-user status on every login (2026-08-25)
        # — so editing settings.super_user_emails takes effect without a
        # one-off DB backfill, without making that env var the live source
        # of truth for day-to-day approvals (those flip `status` in the DB
        # directly, via the Approve button).
        if _is_super_user_email(user.email) and (not user.is_super_user or user.status != "approved"):
            user.is_super_user = True
            user.status = "approved"
            dirty = True
        if dirty:
            await db.commit()
            await db.refresh(user)
        return user

    # First login — provision org (if none exists) and user
    org_result = await db.execute(select(Organisation).limit(1))
    org = org_result.scalar_one_or_none()
    if org is None:
        org = Organisation(name="Prosota Consulting Ltd", plan_tier="starter")
        db.add(org)
        await db.flush()

    email = await _resolve_real_email(token) or f"user+{token.sub.split('|')[-1]}@prosotapmo.local"
    is_super_user = _is_super_user_email(email)
    user = User(
        org_id=org.id,
        email=email,
        auth0_sub=token.sub,
        display_name=email,
        role="admin" if is_super_user else "member",
        status="approved" if is_super_user else "pending",
        is_super_user=is_super_user,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def get_approved_user(user=Depends(get_db_user)):
    """Global access gate (2026-08-25 trial/beta) — the DB user must exist
    AND be approved, not just hold a valid Auth0 token. Used as the
    app-wide dependency for every router except users.py's own /me and the
    access-requests router, both of which a pending user must still be able
    to reach (to see their own status and to submit a request)."""
    if user.status != "approved":
        raise HTTPException(status_code=403, detail={"code": "access_pending"})
    return user


async def require_super_user(user=Depends(get_db_user)):
    if not user.is_super_user:
        raise HTTPException(status_code=403, detail={"code": "forbidden"})
    return user
