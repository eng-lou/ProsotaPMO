"""Separate composition root: never imported by Prosota Web."""
import asyncio
import hmac
import os
import secrets
import sys
from pathlib import Path

import local_storage
import ifc_workers


def create_app(config):
    # Supply EVERY setting explicitly so a developer's inherited cloud environment
    # or backend/.env can never connect this edition to production data/services.
    import app.core.config as web_config
    defaults = {name: field.default for name, field in web_config.Settings.model_fields.items()}
    defaults.update(
        database_url=config["databaseUrl"], environment="desktop",
        secret_key=config["token"], super_user_emails="", public_app_url=config["origin"],
    )
    web_config.settings = web_config.Settings(_env_file=None, **defaults)
    local_storage.configure(Path(config["dataDir"]) / "files", config["token"], config["origin"])
    sys.modules["app.services.object_storage"] = local_storage
    sys.modules["app.services.ifc_worker_runtime"] = ifc_workers

    from fastapi import Depends, HTTPException, Request
    from fastapi.responses import FileResponse, JSONResponse
    from fastapi.staticfiles import StaticFiles
    from starlette.exceptions import HTTPException as StarletteHTTPException
    from sqlalchemy import select
    from app.core import auth
    from app.database import get_db
    from app.models.user import User
    from app.main import app

    async def local_identity():
        return auth.TokenPayload(sub="desktop|owner", email="owner@desktop.local")

    async def local_user(db=Depends(get_db)):
        return (await db.execute(select(User).where(User.auth0_sub == "desktop|owner"))).scalar_one()

    app.dependency_overrides[auth.get_current_user] = local_identity
    app.dependency_overrides[auth.get_db_user] = local_user
    app.dependency_overrides[auth.require_ai_quota] = local_user
    render_provider = "off"

    @app.middleware("http")
    async def desktop_guard(request: Request, call_next):
        if request.headers.get("host") != config["origin"].split("//", 1)[1]:
            return JSONResponse({"detail": "Invalid host"}, status_code=403)
        if request.url.path.startswith(("/api/", "/desktop-", "/health")):
            if not hmac.compare_digest(request.headers.get("x-prosota-desktop", ""), config["token"]):
                return JSONResponse({"detail": "Desktop session required"}, status_code=401)
        supplied_origin = request.headers.get("origin")
        if supplied_origin and supplied_origin != config["origin"]:
            return JSONResponse({"detail": "Invalid origin"}, status_code=403)
        if request.method == "POST" and request.url.path.rstrip("/") == "/api/v1/ai/concept-render" and render_provider == "off":
            return JSONResponse({"detail": "Enable an image provider in Settings to use concept renders."}, status_code=409)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; "
            "font-src 'self' data:; connect-src 'self' blob: https:; "
            "worker-src 'self' blob:; media-src 'self' blob: data:; "
            "object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
        )
        return response

    def set_ai(value):
        nonlocal render_provider
        from app.ai import client
        settings = web_config.settings
        provider = value.get("provider", "off")
        if provider not in ("off", "openai", "anthropic"):
            raise HTTPException(400, "Invalid provider")
        render_provider = value.get("renderProvider", "off")
        if render_provider not in ("off", "openai", "gemini"):
            raise HTTPException(400, "Invalid image provider")
        settings.openai_api_key = value.get("openaiKey", "") if provider == "openai" or render_provider == "openai" else ""
        settings.anthropic_api_key = value.get("anthropicKey", "") if provider == "anthropic" else ""
        # Explicit Anthropic with no key disables Poe even if image generation
        # has an OpenAI key; auto would silently enable paid Poe calls.
        settings.ai_provider = provider if provider != "off" else "anthropic"
        settings.google_tiles_api_key = value.get("googleMapsKey", "")
        settings.gemini_api_key = value.get("geminiKey", "") if render_provider == "gemini" else ""
        settings.ai_concept_render_provider = render_provider if render_provider != "off" else "auto"
        if value.get("imageModel"):
            settings.openai_image_model = value["imageModel"]
        if value.get("model"):
            settings.openai_chat_model = value["model"]
            client.MODEL = value["model"]
        client._get_client.cache_clear()

    set_ai(config.get("ai", {}))

    # Desktop credentials have one encrypted source, never a database copy.
    # Replace these desktop routes only; the web composition is unchanged.
    app.router.routes[:] = [
        route for route in app.router.routes
        if getattr(route, "path", "") != "/api/v1/site-context/tiles-key"
    ]

    @app.get("/api/v1/site-context/tiles-key")
    async def desktop_tiles_key():
        return {"api_key": web_config.settings.google_tiles_api_key}

    @app.put("/api/v1/site-context/tiles-key")
    async def desktop_tiles_key_edit():
        raise HTTPException(409, "Use Settings → Google Maps Platform API key.")

    @app.post("/desktop-config")
    async def update_ai(request: Request):
        set_ai(await request.json())
        return {"ok": True}

    @app.api_route("/desktop-storage/{key:path}", methods=["PUT", "GET"])
    async def storage(request: Request, key: str, expires: int, sig: str):
        try:
            valid = local_storage.verify(key, request.method, expires, sig)
            target = local_storage.path_for(key)
        except ValueError:
            raise HTTPException(400, "Invalid storage key")
        if not valid:
            raise HTTPException(403, "Expired or invalid file URL")
        if request.method == "GET":
            if not target.is_file():
                raise HTTPException(404, "File not found")
            return FileResponse(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + "." + secrets.token_hex(6) + ".part")
        try:
            with temporary.open("wb") as stream:
                async for chunk in request.stream():
                    await asyncio.to_thread(stream.write, chunk)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        return {"ok": True}

    class SPA(StaticFiles):
        async def get_response(self, path, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code != 404 or Path(path).suffix or path.startswith("api/"):
                    raise
                return await super().get_response("index.html", scope)

    app.mount("/", SPA(directory=config["uiDir"], html=True), name="desktop-ui")
    return app


async def initialise(identity=None):
    from app.database import engine, AsyncSessionLocal
    from app.models.organisation import Organisation
    from app.models.user import User
    from sqlalchemy import select
    from alembic.config import Config
    from alembic import command
    from app.core.config import settings

    def migrate():
        from sqlalchemy import create_engine
        migration_root = (Path(sys._MEIPASS) / "migrations") if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[2] / "backend/alembic"
        cfg = Config()
        cfg.set_main_option("script_location", str(migration_root))
        sync_engine = create_engine(settings.database_url)
        try:
            with sync_engine.begin() as connection:
                cfg.attributes["connection"] = connection
                command.upgrade(cfg, "head")
        finally:
            sync_engine.dispose()
    await asyncio.to_thread(migrate)
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.auth0_sub == "desktop|owner"))).scalar_one_or_none()
        if user is None:
            org = Organisation(name="Local workspace", plan_tier="starter")
            db.add(org)
            await db.flush()
            user = User(org_id=org.id, email="owner@desktop.local", auth0_sub="desktop|owner",
                        display_name="Local user", role="admin", status="approved", is_super_user=False)
            db.add(user)
        # Identity comes from the main process's freshly verified cloud session,
        # never from renderer input or editable connection settings. Refresh on
        # every startup to repair existing workspaces and respect role changes.
        from entitlements import desktop_entitlement
        user.is_super_user = desktop_entitlement(identity)
        if identity and identity.get("email"):
            user.email = identity["email"]
            user.display_name = identity.get("name") or identity["email"]
        await db.commit()
