from datetime import date, datetime, time, timedelta
from decimal import Decimal
import random
import time as timer
import uuid
from unittest.mock import AsyncMock

from app.models.calendar import Calendar, CalendarBreak, CalendarException
from app.schemas.activity import ActivityCreate, ActivityUpdate
from app.services import activity as service
from app.services.scheduling_cpm import _CalendarLookup


def reference(lookup, calendar, a, b):
    sign = 1 if b >= a else -1
    lo, hi = sorted((a, b))
    total = 0
    d = lo.date()
    while d <= hi.date():
        left = lo if d == lo.date() else datetime.combine(d, time.min)
        right = hi if d == hi.date() else datetime.combine(d, time(23, 59))
        for s, e in lookup._windows(calendar, d):
            start, end = max(left, datetime.combine(d, s)), min(right, datetime.combine(d, e))
            if end > start:
                total += int((end-start).total_seconds() // 60)
        d += timedelta(days=1)
    return (sign * Decimal(total) / 60).quantize(Decimal('0.01'))


def test_calendar_prefix_matches_day_walk():
    calendar = Calendar(id=uuid.uuid4(), is_project_default=True, day_start_time=time(8), day_end_time=time(17),
        works_monday=True, works_tuesday=True, works_wednesday=True, works_thursday=True,
        works_friday=True, works_saturday=False, works_sunday=False)
    exceptions = [CalendarException(calendar_id=calendar.id, start_date=date(2028,2,28), end_date=date(2028,3,2), is_working=False),
        CalendarException(calendar_id=calendar.id, start_date=date(2029,1,6), end_date=date(2029,1,6), is_working=True, start_time=time(9), end_time=time(12))]
    breaks = [CalendarBreak(calendar_id=calendar.id, start_time=time(12), end_time=time(13))]
    old = _CalendarLookup([calendar], exceptions, breaks)
    new = _CalendarLookup([calendar], exceptions, breaks)
    rng = random.Random(42)
    pairs = [(datetime(2026,11,12,8) + timedelta(days=i, minutes=i%60), datetime(2032,6,10,17)) for i in range(600)]
    pairs += [(datetime(2028,1,1) + timedelta(minutes=rng.randrange(600000)), datetime(2028,1,1) + timedelta(minutes=rng.randrange(600000))) for _ in range(60)]
    pairs += [(datetime(2028,2,29,9,0,40), datetime(2028,2,29,15,0,20))]
    start=timer.perf_counter()
    expected=[reference(old,calendar,a,b) for a,b in pairs]
    previous=timer.perf_counter()-start
    start=timer.perf_counter()
    actual=[new.working_hours_between(calendar,a,b) for a,b in pairs]
    elapsed=timer.perf_counter()-start
    assert actual == expected
    print(f'661 working-time queries: day walk={previous:.3f}s, cumulative={elapsed:.3f}s')


async def test_metadata_edit_skips_network_but_duration_recalculates(db, project, live_schedule_period, monkeypatch):
    row = await service.create_activity(db, ActivityCreate(project_id=project.id,
        schedule_period_id=live_schedule_period.id, task_name='New Activity', duration_hours=8))
    original = (row.start, row.finish, row.duration_hours)
    hierarchy = AsyncMock(wraps=service._recompute_hierarchy)
    cpm = AsyncMock(wraps=service.scheduling_cpm.recompute_schedule)
    monkeypatch.setattr(service, '_recompute_hierarchy', hierarchy)
    monkeypatch.setattr(service.scheduling_cpm, 'recompute_schedule', cpm)
    result = await service.update_activity(db, row.id, ActivityUpdate(task_name='Core L1-L2',
        activity_type=row.activity_type, duration_hours=row.duration_hours, status=row.status))
    assert result.task_name == 'Core L1-L2'
    assert (result.start, result.finish, result.duration_hours) == original
    assert result.updated_at is not None
    hierarchy.assert_not_awaited()
    cpm.assert_not_awaited()
    await service.update_activity(db, row.id, ActivityUpdate(duration_hours=16))
    assert hierarchy.await_count == 2
    cpm.assert_awaited_once()
    assert row.finish > original[1]
