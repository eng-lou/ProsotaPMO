from __future__ import annotations

import uuid
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig

from app.core.config import settings

# Cloudflare R2 client (2026-08-23) — see config.py's own r2_* header for
# the full "why" (Vercel Functions' hard 4.5MB request body cap). R2 is
# plain S3-compatible, so boto3 (already the standard, well-tested AWS SDK)
# talks to it directly via its own S3 API surface — just a different
# endpoint_url and region_name="auto" (R2 has no real AWS regions),
# signature_version="s3v4" explicit since boto3's own default has drifted
# across versions and R2 only accepts v4. A fresh client per call, not a
# module-level singleton — boto3 clients are cheap to construct and this
# avoids any question of thread/event-loop safety from a shared client
# reused across concurrent async request handlers.
def _client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=BotoConfig(signature_version="s3v4"),
        region_name="auto",
    )


# Handed to the browser so it can PUT the file's own bytes straight to R2 —
# never through this backend's request body, which is the entire point (see
# config.py's own header). 1 hour is comfortably longer than any real
# upload should take even on a slow connection for a large IFC/point-cloud
# file, short enough that a leaked/logged URL isn't a standing risk.
def presigned_put_url(key: str, content_type: str, expires_in: int = 3600) -> str:
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": key, "ContentType": content_type},
        ExpiresIn=expires_in,
    )


# Handed to the browser for a direct-from-R2 download (Model3DFile/
# SiteCapture/FourDVideo restore-on-mount, "Download" actions) — same
# reasoning in reverse: a large file's bytes streaming back through this
# backend's own function would just hit Vercel's matching *response* body
# cap instead.
def presigned_get_url(key: str, expires_in: int = 3600) -> str:
    return _client().generate_presigned_url(
        "get_object", Params={"Bucket": settings.r2_bucket_name, "Key": key}, ExpiresIn=expires_in,
    )


# Authoritative size, read back from R2 itself after the browser's own
# direct PUT completes — used instead of trusting whatever size the client
# claims when it calls this resource's own create endpoint afterward (a
# stale/lied-about value would otherwise corrupt size_bytes with no way to
# catch it server-side).
def head_object_size(key: str) -> int:
    return _client().head_object(Bucket=settings.r2_bucket_name, Key=key)["ContentLength"]


# Used only by the two site_capture.py pipelines that need the file's real
# bytes on local disk to process it at all (pye57's C++ bindings for E57->
# XYZ conversion, Cloud2BIM's own subprocess-based pipeline) — everything
# else only ever needs a presigned URL, never the bytes themselves.
def download_to_path(key: str, dest: Path) -> None:
    _client().download_file(settings.r2_bucket_name, key, str(dest))


def upload_from_path(key: str, src: Path, content_type: str | None = None) -> None:
    extra_args = {"ContentType": content_type} if content_type else {}
    _client().upload_file(str(src), settings.r2_bucket_name, key, ExtraArgs=extra_args)


# Used by material_preset.py — textures arrive as a browser multipart upload
# already buffered in memory (small PBR maps, not full IFC models, so no
# presigned-PUT step for these), so this uploads the bytes directly rather
# than needing a local temp file first like upload_from_path does.
def upload_bytes(key: str, data: bytes, content_type: str | None = None) -> None:
    extra_args = {"ContentType": content_type} if content_type else {}
    _client().put_object(Bucket=settings.r2_bucket_name, Key=key, Body=data, **extra_args)


def delete_object(key: str) -> None:
    _client().delete_object(Bucket=settings.r2_bucket_name, Key=key)


# UUID-based key, never the user's own filename — same path-traversal/
# collision reasoning generate_storage_filename already documented in each
# of the three local-disk storage modules this replaces.
def generate_storage_key(prefix: str, original_name: str) -> str:
    ext = Path(original_name).suffix
    return f"{prefix}/{uuid.uuid4()}{ext}"
