from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.p6_export import gather_p6_export_data
from app.services.p6_export_xml import build_pmxml

router = APIRouter(prefix="/p6-export", tags=["p6-export"])


def _safe_filename(name: str) -> str:
    return re.sub(r"[^\w-]+", "_", name).strip("_") or "schedule"


# XML/PMXML only (2026-07-16, per Maro: "stick to xml. remove the xer
# functionality completely" — XER's own real-world quirks (P6's blank
# import-wizard project grid until the PROJECT row carried its full real
# field set; a separate cp1252-vs-UTF-8 encoding mismatch corrupting
# non-ASCII task-name characters; RSRCRATE needing a day-rate-to-hourly
# conversion XML also needed but got right) made it enough extra surface
# area, for a format P6 itself treats as the legacy one, that it wasn't
# worth carrying two parallel exporters once XML alone was confirmed
# working end-to-end against a real P6 install).
@router.get("/xml")
async def export_xml(schedule_period_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    data = await gather_p6_export_data(db, schedule_period_id)
    body = build_pmxml(data)
    filename = f"{_safe_filename(data.project_name)}.xml"
    return Response(
        content=body.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
