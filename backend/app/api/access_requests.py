from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user, require_super_user
from app.database import get_db
from app.models.user import User
from app.schemas.user import AccessRequestSubmit, CurrentUserSummaryResponse, PendingUserResponse, UserResponse

router = APIRouter(prefix="/access-requests", tags=["access-requests"])


@router.post("/", response_model=UserResponse)
async def submit_access_request(
    data: AccessRequestSubmit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_db_user),
):
    """Deliberately not gated on approval status — this is how a pending
    user actually asks for access, so it has to stay reachable while
    status="pending"."""
    current_user.display_name = data.name
    current_user.requested_title = data.title
    current_user.requested_organisation = data.organisation
    current_user.requested_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.get("/", response_model=list[PendingUserResponse])
async def list_access_requests(
    db: AsyncSession = Depends(get_db),
    _super_user: User = Depends(require_super_user),
):
    result = await db.execute(
        select(User).where(User.status == "pending").order_by(User.requested_at.desc().nullslast())
    )
    return list(result.scalars().all())


@router.get("/users", response_model=list[CurrentUserSummaryResponse])
async def list_current_users(
    db: AsyncSession = Depends(get_db),
    _super_user: User = Depends(require_super_user),
):
    """Access Manager's roster of everyone already approved — separate from
    list_access_requests above (which is pending-only), so the panel can
    show "who's actually using this" alongside "who's waiting on me"."""
    result = await db.execute(
        select(User).where(User.status == "approved").order_by(User.last_active_at.desc().nullslast())
    )
    return list(result.scalars().all())


@router.post("/{user_id}/approve", response_model=PendingUserResponse)
async def approve_access_request(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _super_user: User = Depends(require_super_user),
):
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    target.status = "approved"
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{user_id}", status_code=204)
async def deny_access_request(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _super_user: User = Depends(require_super_user),
):
    """Denying isn't a status (nothing else in the app needs to distinguish
    "denied" from "never signed up") — it just removes the row. If they
    sign in again, `get_db_user`'s first-login branch re-provisions a fresh
    pending row from scratch, same as anyone else's first login."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending requests can be denied")
    await db.delete(target)
    await db.commit()
    return Response(status_code=204)
