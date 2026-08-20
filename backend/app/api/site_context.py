from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.database import get_db
from app.schemas.site_context import SiteContextResponse, SiteContextUpsert
from app.services import app_settings as app_settings_svc
from app.services import site_context as svc

router = APIRouter(prefix="/site-context", tags=["site-context"])


@router.get("/", response_model=SiteContextResponse)
async def get_site_context(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """The one, project-wide real-world anchor for the Site Context
    CesiumJS panel. Returns an in-memory default (never a 404) if nothing
    has been saved yet, same convention as GET /timeline-strips/."""
    return await svc.get_or_default(db, project_id)


@router.put("/", response_model=SiteContextResponse)
async def save_site_context(
    data: SiteContextUpsert,
    db: AsyncSession = Depends(get_db),
):
    return await svc.upsert(db, data)


@router.get("/tiles-key")
async def get_tiles_api_key(db: AsyncSession = Depends(get_db)):
    """The app-level Google Maps Platform key for CesiumJS's own
    createGooglePhotorealistic3DTileset() — one key for the whole app, not
    per-project, same as auth0_domain/auth0_audience. Handed to the
    authenticated frontend as-is (this is the normal way Maps Platform
    keys are used — restricted by HTTP referrer in Google Cloud Console,
    not meant to be hidden from your own logged-in users).

    The AppSettings DB row (2026-08-19, per Maro: editing backend/.env by
    hand "is not good" UX) wins if a key's been saved there; the .env-based
    Settings.google_tiles_api_key is only a fallback default for ops-
    managed deployments that would rather set it outside the product UI.
    Returns an empty string, not an error, if neither is configured, so
    the frontend can show "not configured" instead of a failed request."""
    row = await app_settings_svc.get(db)
    return {"api_key": row.google_tiles_api_key or settings.google_tiles_api_key or ""}


class TilesApiKeyUpdate(BaseModel):
    api_key: str = Field(max_length=500)


@router.put("/tiles-key")
async def save_tiles_api_key(data: TilesApiKeyUpdate, db: AsyncSession = Depends(get_db)):
    """Lets the Google Maps Platform key be set from inside the Site
    Context panel itself (2026-08-19) instead of requiring a server .env
    edit + backend restart."""
    row = await app_settings_svc.set_google_tiles_api_key(db, data.api_key)
    return {"api_key": row.google_tiles_api_key or ""}
