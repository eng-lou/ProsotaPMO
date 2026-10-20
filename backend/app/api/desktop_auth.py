"""Browser-approved, PKCE-bound handoff. Desktop tokens cannot access cloud projects."""
import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import get_approved_user
from app.database import get_db
from app.models.desktop_session import DesktopSession
from app.models.user import User

router = APIRouter(prefix="/desktop-auth", tags=["desktop-auth"])


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


class Handoff(BaseModel):
    challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")


class Exchange(BaseModel):
    code: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    verifier: str = Field(pattern=r"^[A-Za-z0-9_-]{43,128}$")


class Credential(BaseModel):
    token: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")


def identity(user):
    return {"sub": user.auth0_sub, "name": user.display_name, "email": user.email}


def no_cache(response):
    response.headers["Cache-Control"] = "no-store"


@router.post("/handoff")
async def handoff(data: Handoff, response: Response, user=Depends(get_approved_user), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    # Bound storage per account and opportunistically remove expired credentials.
    await db.execute(delete(DesktopSession).where(DesktopSession.expires_at <= now))
    await db.execute(delete(DesktopSession).where(DesktopSession.user_id == user.id, DesktopSession.challenge.is_not(None)))
    code = secrets.token_urlsafe(32)
    db.add(DesktopSession(token_hash=digest(code), user_id=user.id, challenge=data.challenge, expires_at=now + timedelta(minutes=2)))
    await db.commit()
    no_cache(response)
    return {"code": code}


@router.post("/exchange")
async def exchange(data: Exchange, response: Response, db: AsyncSession = Depends(get_db)):
    row = await db.scalar(select(DesktopSession).where(DesktopSession.token_hash == digest(data.code)).with_for_update())
    challenge = base64.urlsafe_b64encode(hashlib.sha256(data.verifier.encode("ascii")).digest()).decode().rstrip("=")
    if not row or not row.challenge or row.expires_at <= datetime.now(timezone.utc) or not hmac.compare_digest(row.challenge, challenge):
        raise HTTPException(401, "Sign-in expired. Please try again from Prosota Desktop.")
    user = await db.get(User, row.user_id)
    if not user or user.status != "approved":
        raise HTTPException(403, "Your account is awaiting approval.")
    await db.delete(row)
    token = secrets.token_urlsafe(32)
    db.add(DesktopSession(token_hash=digest(token), user_id=user.id, challenge=None, expires_at=datetime.now(timezone.utc) + timedelta(days=30)))
    await db.commit()
    no_cache(response)
    return {"token": token, "user": identity(user)}


@router.post("/session")
async def session(data: Credential, response: Response, db: AsyncSession = Depends(get_db)):
    row = await db.get(DesktopSession, digest(data.token))
    if not row or row.challenge is not None or row.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(401, "Please sign in again.")
    user = await db.get(User, row.user_id)
    if not user or user.status != "approved":
        raise HTTPException(403, "Your access is no longer approved. Sign in on the web to request access.")
    no_cache(response)
    return {"user": identity(user)}


@router.post("/logout", status_code=204)
async def logout(data: Credential, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(DesktopSession).where(DesktopSession.token_hash == digest(data.token)))
    await db.commit()
