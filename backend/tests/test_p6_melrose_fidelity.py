from pathlib import Path
from decimal import Decimal
import pytest
from app.services.p6_import_parse import parse_pmxml
from app.services.p6_import import import_pmxml
from app.services.activity import list_activities, get_activity
from app.models.activity import Activity
from sqlalchemy import update

SOURCE = Path(r'C:/Users/Maro/Documents/EVM/Melrose.xml')

@pytest.mark.skipif(not SOURCE.exists(), reason='User supplied Melrose XML is not installed')
async def test_melrose_import_displays_durations_without_rescheduling(db, project):
    parsed = parse_pmxml(SOURCE.read_bytes())
    source = next(a for a in parsed.activities if a.code == 'MN1020')
    assert source.duration_hours == Decimal('120')
    result = await import_pmxml(db, project.id, parsed)
    rows = await list_activities(db, project.id, result.schedule_period_id)
    task = next(a for a in rows if (a.p6_data or {}).get('Id') == 'MN1020')
    assert task.duration_hours == Decimal('120')
    assert task.start == source.start
    assert task.finish == source.finish
    assert task.duration_days == Decimal('15')
    for row in rows:
        if row.activity_type != 'wbs_summary' and row.duration_hours is not None:
            assert row.duration_days is not None, row.task_name

    # Existing imports with a missing display cache are repaired on read too.
    await db.execute(update(Activity).where(Activity.id == task.id).values(duration_days=None))
    await db.commit()
    await db.refresh(task)
    assert task.duration_days is None
    loaded = await get_activity(db, task.id)
    assert loaded.duration_days == Decimal('15')
    assert loaded.duration_hours == Decimal('120')
    assert loaded.finish == source.finish
