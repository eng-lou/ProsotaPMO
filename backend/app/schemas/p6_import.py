from __future__ import annotations

import uuid

from pydantic import BaseModel


# Direct-to-R2 upload (2026-09-03, per Maro: a real production import of
# EC00630.xml failed outright with no useful error) — a real PMXML export
# for an actual project schedule can comfortably exceed Vercel's hard 4.5MB
# serverless request-body cap (see object_storage.py's own header), well
# past what most users would ever think to check for a plain XML file. The
# old /xml endpoint posted the raw file straight through this backend's own
# request body, so a large export was silently rejected by the platform
# before ever reaching parse_pmxml — no FastAPI HTTPException, hence no
# `.detail` for the frontend's own error handling to surface, just the
# generic "check it's a real PMXML" fallback. Same fix, same pattern, as
# every other large-file upload in this app (ai_attachments.py/
# model3d_files.py/site_capture.py/fourd_video.py): presign, the browser
# PUTs the file's own bytes straight to R2, then hands the backend a
# storage_key instead of the bytes themselves.
class P6ImportPresignRequest(BaseModel):
    name: str


class P6ImportPresign(BaseModel):
    storage_key: str
    upload_url: str


class P6ImportRequest(BaseModel):
    project_id: uuid.UUID
    storage_key: str


class P6ImportSummaryResponse(BaseModel):
    schedule_variant_id: uuid.UUID
    schedule_period_id: uuid.UUID
    variant_name: str
    calendar_count: int
    resource_count: int
    activity_count: int
    relationship_count: int
    assignment_count: int
    udf_value_count: int
    # Human-readable notes on anything skipped or approximated during
    # parsing/import — never silently dropped, see
    # app/services/p6_import.py's own P6ImportSummary docstring.
    skipped: list[str]
