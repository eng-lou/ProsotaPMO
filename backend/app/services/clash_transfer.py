"""Large clash evidence uses the existing R2 transport, not function bodies."""
import gzip
import json
import tempfile
import zlib
from pathlib import Path
from fastapi import HTTPException
from app.services import object_storage

MAX_RAW = 220_000_000
MAX_COMPRESSED = 80_000_000


def unpack(raw: bytes, limit: int = MAX_RAW) -> bytes:
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        value = decoder.decompress(raw, limit + 1)
        if len(value) > limit or not decoder.eof or decoder.unused_data:
            raise ValueError()
        return value
    except (ValueError, zlib.error) as error:
        raise HTTPException(422, "Invalid or oversized compressed clash data") from error


def read_upload(key: str) -> bytes:
    if object_storage.head_object_size(key) > MAX_COMPRESSED:
        raise HTTPException(413, "Clash upload exceeds the 80 MB compressed limit")
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'run.gz'
        object_storage.download_to_path(key, path)
        if path.stat().st_size > MAX_COMPRESSED:
            raise HTTPException(413, "Clash upload exceeds the 80 MB compressed limit")
        return unpack(path.read_bytes())


def response_payload(value: dict | list, key: str) -> dict | list:
    raw = json.dumps(value, separators=(',', ':'), default=str).encode()
    if len(raw) <= 2_800_000:
        return value
    # Server-written response object is separate from the writable upload key.
    object_storage.upload_bytes(key, gzip.compress(raw), 'application/gzip')
    return {"snapshot_url": object_storage.presigned_get_url(key, expires_in=60)}
