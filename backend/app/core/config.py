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
    # Where Reality Captures' own uploaded scan files (2026-08-20) persist —
    # today just a MatterPak's plain-text `cloud.xyz` point cloud (see
    # frontend/src/modules/fourD/pointCloud.ts's own header on why .xyz,
    # not the already-supported-but-unpersisted textured OBJ+MTL, is what
    # actually gets stored: it's the precision data source the Progress
    # Variance engine needs, and the one thing worth keeping across a
    # refresh so a variance test can reference a specific dated capture
    # later). Same local-disk-per-kind convention as model3d_storage_dir/
    # fourd_video_storage_dir above, kept in its own directory rather than
    # reusing either — a capture is neither an importable 3D model nor an
    # exported video, and giving it a separate root avoids the two ever
    # colliding on a generated filename.
    site_capture_storage_dir: str = "uploads/site_captures"
    # Cloudflare R2 (2026-08-23, per Maro: first real Vercel deploy hit a
    # real IFC upload — "Snowdon Towers Sample Structural.ifc" — with a 413:
    # Vercel Functions hard-cap request bodies at 4.5MB, platform-enforced
    # (AWS Lambda underneath), not something app code can raise. The fix the
    # local-disk settings above were always going to need eventually: model3d_file.py/
    # site_capture.py/fourd_video_storage.py now generate a presigned R2 PUT
    # URL and the *browser* uploads directly to R2, never routing the file's
    # own bytes through this backend's own request body at all — the same
    # object storage also fixes local disk's other, separately-known problem
    # on Vercel (an ephemeral filesystem, not guaranteed to survive between
    # requests/instances). R2 specifically (not S3) because it's plain
    # S3-compatible — boto3 talks to it with zero new dependencies beyond
    # boto3 itself — and has no egress fees, unlike S3, for what's meant to
    # be routinely re-downloaded BIM data. No local-disk fallback kept: same
    # "one real code path, point it at whichever real backing store" choice
    # database_url already makes (local dev's own backend/.env needs these
    # three set too, same R2 bucket or a separate one, either works).
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "prosota-pmo"
    # Trial/beta access gate (2026-08-25, per Maro: Google sign-in via Auth0
    # is open to anyone, but only these emails should get real app access —
    # everyone else lands on the in-app access-request screen instead). Only
    # a bootstrap list: get_db_user self-heals status="approved"/
    # is_super_user=True for any of these emails on every login, but actual
    # day-to-day approvals happen via the DB (a super user clicking Approve
    # in the app), not by editing this env var.
    super_user_emails: str = "sotalouisx@gmail.com,lsota@prosota.com"
    # Project Controls Assistant (2026-08-31, per Maro: "cook up the AI
    # features") — Anthropic API key for app/ai/'s own client.py. Empty by
    # default, same "a fresh checkout doesn't silently ship a real key"
    # reasoning google_tiles_api_key already gives above; the assistant
    # endpoint fails clearly (see client.py) rather than silently degrading
    # when this isn't set.
    anthropic_api_key: str = ""
    # Per-user daily cap on the assistant (2026-08-31, per Maro: "add a user
    # cap, except for superuser" — the key is safe from ever reaching a
    # browser, but every approved user can trigger real Anthropic billing
    # against it with no ceiling otherwise). Counted per POST /ai/chat call
    # (one visible message from the user's own perspective, even though the
    # orchestrator's own server-tool loop may make more than one Messages
    # API call underneath it), reset daily — see User.ai_messages_today/
    # ai_messages_reset_date and require_ai_quota in app/core/auth.py.
    # Super users (is_super_user) bypass this entirely, per Maro's own ask.
    ai_daily_message_cap: int = 30


settings = Settings()
