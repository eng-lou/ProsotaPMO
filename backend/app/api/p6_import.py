from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.p6_import import P6ImportSummaryResponse
from app.services.p6_import import import_pmxml
from app.services.p6_import_parse import parse_pmxml

router = APIRouter(prefix="/p6-import", tags=["p6-import"])


# multipart/form-data (project_id as a plain form field alongside the file),
# same shape model3d_files.py's own create_file upload endpoint already
# established for "some metadata plus a file." XML/PMXML only — see
# app/services/p6_export.py's own header on why XER was dropped entirely
# 2026-07-16; import follows the same scope.
@router.post("/xml", response_model=P6ImportSummaryResponse, status_code=201)
async def import_xml(
    project_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    data = await file.read()
    parsed = parse_pmxml(data)
    return await import_pmxml(db, project_id, parsed)
