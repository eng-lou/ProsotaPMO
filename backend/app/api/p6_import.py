from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.p6_import import P6ImportPresign, P6ImportPresignRequest, P6ImportRequest, P6ImportSummaryResponse
from app.services import object_storage
from app.services.p6_import import import_pmxml
from app.services.p6_import_parse import parse_pmxml

router = APIRouter(prefix="/p6-import", tags=["p6-import"])

STORAGE_PREFIX = "p6-imports"


# Step 1 of the direct-to-R2 upload — see schemas/p6_import.py's own header
# for why this exists (a real PMXML export routinely exceeds Vercel's
# 4.5MB request-body cap). Same shape as ai_attachments.py's own /presign.
@router.post("/presign", response_model=P6ImportPresign)
async def presign_import(payload: P6ImportPresignRequest) -> P6ImportPresign:
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, payload.name)
    upload_url = object_storage.presigned_put_url(storage_key, "application/xml")
    return P6ImportPresign(storage_key=storage_key, upload_url=upload_url)


# Step 2: the browser has already PUT the file's own bytes straight to R2 —
# this only ever receives a small JSON body (project_id + storage_key), so
# it's never subject to the body-size cap regardless of how large the real
# PMXML export is. Downloads to a local temp file (parse_pmxml needs the
# real bytes, not just a URL — same "some pipelines genuinely need the
# bytes on disk" reasoning object_storage.py's own download_to_path header
# already documents for site_capture.py's E57/XYZ conversions), then
# deletes the R2 object once done — this is a one-time transient import
# file, not a standing project resource worth keeping around.
@router.post("/xml", response_model=P6ImportSummaryResponse, status_code=201)
async def import_xml(
    payload: P6ImportRequest,
    db: AsyncSession = Depends(get_db),
):
    with tempfile.TemporaryDirectory() as tmp_dir:
        xml_path = Path(tmp_dir) / "import.xml"
        try:
            await run_in_threadpool(object_storage.download_to_path, payload.storage_key, xml_path)
        except Exception:
            raise HTTPException(status_code=404, detail="Uploaded file is missing in storage — try uploading again.") from None
        data = xml_path.read_bytes()

    try:
        parsed = parse_pmxml(data)
        return await import_pmxml(db, payload.project_id, parsed)
    finally:
        # Best-effort cleanup on any outcome, not just success — a rejected
        # (malformed XML, unknown project) upload is just as transient as a
        # successful one, no reason to leave it in storage either way.
        try:
            await run_in_threadpool(object_storage.delete_object, payload.storage_key)
        except Exception:
            pass
