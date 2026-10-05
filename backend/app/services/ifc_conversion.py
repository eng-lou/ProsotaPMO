from __future__ import annotations

import gzip
from pathlib import Path
import tempfile

from fastapi import HTTPException
from botocore.exceptions import ClientError
from app.services import object_storage
from app.services import ifc_conversion_worker
from app.services.ifc_worker_runtime import run_worker

MAX_SOURCE_BYTES = 128 * 1024 * 1024


def converted_key(file_id) -> str:
    return f"ifc4-export/v1/{file_id}.ifc.gz"


def prepare_ifc4(file_id, storage_key: str) -> str:
    """Cache immutable source conversion in R2, avoiding function body limits."""
    key = converted_key(file_id)
    try:
        object_storage.head_object_size(key)
        return object_storage.presigned_get_url(key)
    except ClientError as exc:
        if str(exc.response.get("Error", {}).get("Code")) not in {"404", "NoSuchKey", "NotFound"}:
            raise
    if object_storage.head_object_size(storage_key) > MAX_SOURCE_BYTES:
        raise HTTPException(413, "This model exceeds the IFC4 conversion size limit. Use source-schema export.")
    with tempfile.TemporaryDirectory(prefix="prosota-ifc-") as folder:
        root = Path(folder)
        stored, source, output = root / "stored", root / "source.ifc", root / "converted.ifc"
        object_storage.download_to_path(storage_key, stored)
        with stored.open("rb") as stream:
            compressed = stream.read(2) == b"\x1f\x8b"
        opener = gzip.open if compressed else open
        with opener(stored, "rb") as incoming, source.open("wb") as outgoing:
            total = 0
            while chunk := incoming.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_SOURCE_BYTES:
                    raise HTTPException(413, "Uncompressed IFC exceeds the conversion size limit. Use source-schema export.")
                outgoing.write(chunk)
        run_worker(ifc_conversion_worker, source, output, timeout=180)
        packed = root / "converted.ifc.gz"
        with output.open("rb") as incoming, gzip.open(packed, "wb") as outgoing:
            while chunk := incoming.read(1024 * 1024):
                outgoing.write(chunk)
        object_storage.upload_from_path(key, packed, "application/gzip")
    return object_storage.presigned_get_url(key)
