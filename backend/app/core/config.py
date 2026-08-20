from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # psycopg3 handles both sync (Alembic) and async (app) with the same URL scheme
    database_url: str = "postgresql+psycopg://postgres:password@localhost:5432/prosotapmo"
    secret_key: str = "change-me-in-production"
    environment: str = "development"
    auth0_domain: str = ""
    auth0_audience: str = ""
    # Where imported IFC/GLTF/OBJ/FBX files persist across a hard refresh
    # (2026-07-09, per Maro: "keep the models... similar to the persistent
    # data in Schedule") — this app's first real binary-file upload, so
    # there's no established S3/blob-storage precedent to follow yet (the
    # only prior file-ish thing, project_letterhead.py's logo, is a small
    # base64 string in a DB column — nowhere near workable for a
    # multi-hundred-MB IFC file). Local disk on the backend server is the
    # deliberate, explicitly-scoped-for-now choice (per Maro, choosing this
    # over cloud object storage) — relative to the backend process's own
    # working directory unless overridden, mirroring database_url's own
    # env-var-overridable-with-a-sane-default pattern above.
    model3d_storage_dir: str = "uploads/model3d"
    # Where 4D timeline exports (Viewport3D.tsx's own captureStream+MediaRecorder
    # .webm recordings) persist server-side (2026-07-20, per Maro: a dashboard
    # widget to "open one of the videos 4d sequence vids we've captured" needs
    # them stored somewhere retrievable — today Export Video only downloads
    # locally, nothing survives past the browser). Same local-disk choice as
    # model3d_storage_dir, same reasoning — a real object-storage integration
    # is still explicitly out of scope for now, see that setting's own comment.
    fourd_video_storage_dir: str = "uploads/fourd_videos"
    # Google Maps Platform key for the 4D "Site Context" layer (Google
    # Photorealistic 3D Tiles, 2026-08-19) — one app-level key, same
    # env-var-overridable pattern as auth0_domain/auth0_audience above,
    # not per-project (see site_context.py's own docstring on why the
    # geo-anchor itself IS per-project but the billing key isn't). Empty
    # by default so a fresh checkout doesn't silently ship a real key.
    google_tiles_api_key: str = ""


settings = Settings()
