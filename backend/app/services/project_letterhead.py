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
        timescale_start_mode=row.timescale_start_mode,  # type: ignore[arg-type]
        timescale_finish_mode=row.timescale_finish_mode,  # type: ignore[arg-type]
        timescale_start_custom_date=row.timescale_start_custom_date,
        timescale_finish_custom_date=row.timescale_finish_custom_date,
        print_column_widths=row.print_column_widths,
        print_udf_column_width=row.print_udf_column_width,
        print_font_size=row.print_font_size,
        header_print_font_size=row.header_print_font_size,
        gantt_print_font_size=row.gantt_print_font_size,
        gantt_legend_font_size=row.gantt_legend_font_size,
        print_font_family=row.print_font_family,  # type: ignore[arg-type]
        gantt_print_font_family=row.gantt_print_font_family,  # type: ignore[arg-type]
        header_print_font_family=row.header_print_font_family,  # type: ignore[arg-type]
        gantt_legend_font_family=row.gantt_legend_font_family,  # type: ignore[arg-type]
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
        timescale_start_mode="auto",
        timescale_finish_mode="auto",
        timescale_start_custom_date=None,
        timescale_finish_custom_date=None,
        print_column_widths={},
        print_udf_column_width=None,
        print_font_size=9,
        header_print_font_size=9,
        gantt_print_font_size=8,
        gantt_legend_font_size=9,
        print_font_family="sans",
        gantt_print_font_family="sans",
        header_print_font_family="sans",
        gantt_legend_font_family="sans",
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
    row.timescale_start_mode = data.timescale_start_mode
    row.timescale_finish_mode = data.timescale_finish_mode
    row.timescale_start_custom_date = data.timescale_start_custom_date
    row.timescale_finish_custom_date = data.timescale_finish_custom_date
    row.print_column_widths = data.print_column_widths
    row.print_udf_column_width = data.print_udf_column_width
    row.print_font_size = data.print_font_size
    row.header_print_font_size = data.header_print_font_size
    row.gantt_print_font_size = data.gantt_print_font_size
    row.gantt_legend_font_size = data.gantt_legend_font_size
    row.print_font_family = data.print_font_family
    row.gantt_print_font_family = data.gantt_print_font_family
    row.header_print_font_family = data.header_print_font_family
    row.gantt_legend_font_family = data.gantt_legend_font_family
    await db.commit()
    await db.refresh(row)
    return _to_response(row)
