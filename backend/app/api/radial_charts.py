from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.radial_chart import RadialChartCreate, RadialChartResponse, RadialChartUpdate
from app.services import radial_chart as svc

router = APIRouter(prefix="/radial-charts", tags=["radial-charts"])


@router.get("/", response_model=list[RadialChartResponse])
async def list_radial_charts(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_radial_charts(db, project_id)


@router.post("/", response_model=RadialChartResponse, status_code=201)
async def create_radial_chart(
    data: RadialChartCreate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.create_radial_chart(db, data)


@router.patch("/{chart_id}", response_model=RadialChartResponse)
async def update_radial_chart(
    chart_id: uuid.UUID,
    data: RadialChartUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await svc.update_radial_chart(db, chart_id, data)


@router.delete("/{chart_id}", status_code=204)
async def delete_radial_chart(
    chart_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_radial_chart(db, chart_id)
    return Response(status_code=204)


@router.post("/{chart_id}/icon", response_model=RadialChartResponse)
async def upload_icon(
    chart_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    return await svc.upload_icon(db, chart_id, file)


@router.get("/{chart_id}/icon")
async def download_icon(
    chart_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    return await svc.get_icon_download(db, chart_id)
