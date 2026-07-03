from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_letterhead import ProjectLetterhead
from app.schemas.project_letterhead import LetterheadZone, ProjectLetterheadResponse, ProjectLetterheadUpsert

# Matches the print views' original hardcoded header exactly, so a project
# that's never customized its letterhead sees no visible change — "keep it as
# it is" (Maro's own words) is the implicit default, not an empty banner.
_DEFAULT_HEADER_LEFT = LetterheadZone(text="{project} — {module}", bold=True, font_size=20, align="left")
_DEFAULT_HEADER_RIGHT = LetterheadZone(text="Printed {printed_at}", font_size=11, align="right")


def _to_response(row: ProjectLetterhead) -> ProjectLetterheadResponse:
    return ProjectLetterheadResponse(
        id=row.id,
        project_id=row.project_id,
        logo_data_url=row.logo_data_url,
        logo_position=row.logo_position,  # type: ignore[arg-type]
        header_left=LetterheadZone(**row.header_zones["left"]),
        header_center=LetterheadZone(**row.header_zones["center"]),
        header_right=LetterheadZone(**row.header_zones["right"]),
        footer_left=LetterheadZone(**row.footer_zones["left"]),
        footer_center=LetterheadZone(**row.footer_zones["center"]),
        footer_right=LetterheadZone(**row.footer_zones["right"]),
        show_gantt_legend=row.show_gantt_legend,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def get_or_default(db: AsyncSession, project_id: uuid.UUID) -> ProjectLetterheadResponse:
    row = (await db.execute(select(ProjectLetterhead).where(ProjectLetterhead.project_id == project_id))).scalar_one_or_none()
    if row is not None:
        return _to_response(row)
    return ProjectLetterheadResponse(
        id=None,
        project_id=project_id,
        logo_data_url=None,
        logo_position="left",
        header_left=_DEFAULT_HEADER_LEFT,
        header_center=LetterheadZone(),
        header_right=_DEFAULT_HEADER_RIGHT,
        footer_left=LetterheadZone(),
        footer_center=LetterheadZone(),
        footer_right=LetterheadZone(),
        show_gantt_legend=False,
    )


async def upsert(db: AsyncSession, data: ProjectLetterheadUpsert) -> ProjectLetterheadResponse:
    row = (await db.execute(select(ProjectLetterhead).where(ProjectLetterhead.project_id == data.project_id))).scalar_one_or_none()
    if row is None:
        row = ProjectLetterhead(project_id=data.project_id)
        db.add(row)

    row.logo_data_url = data.logo_data_url
    row.logo_position = data.logo_position
    row.header_zones = {
        "left": data.header_left.model_dump(), "center": data.header_center.model_dump(), "right": data.header_right.model_dump(),
    }
    row.footer_zones = {
        "left": data.footer_left.model_dump(), "center": data.footer_center.model_dump(), "right": data.footer_right.model_dump(),
    }
    row.show_gantt_legend = data.show_gantt_legend
    await db.commit()
    await db.refresh(row)
    return _to_response(row)
