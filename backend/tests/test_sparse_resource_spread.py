from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace as NS
import uuid
import pytest
from app.services.resource_assignment_spread import assignment_cells

class Lookup:
    def is_working_day(self, calendar, day):
        return day.weekday() < 5 and day != date(2026, 1, 5)

@pytest.mark.parametrize("activity", [None, NS(start=None, finish=None), NS(start=datetime(2026,1,2), finish=datetime(2026,1,12))])
def test_sparse_matches_dense_including_overrides(activity):
    assignment = NS(id=uuid.uuid4(), utilisation_pct=Decimal('62.5'))
    resource = NS(max_hours_per_day=Decimal('8'))
    overrides = {date(2025,12,25): Decimal('3'), date(2026,1,3): Decimal('0'), date(2026,1,6): Decimal('9')}
    args = (Lookup(), None, resource, assignment, activity, date(2025,1,1), date(2027,1,1), overrides)
    dense = list(assignment_cells(*args))
    sparse = list(assignment_cells(*args, sparse=True))
    indexed = {c['date']: c for c in sparse}
    assert len(indexed) == len(sparse)
    for cell in dense:
        assert indexed.get(cell['date'], {'hours': Decimal(0)})['hours'] == cell['hours']
        if cell['is_override']: assert indexed[cell['date']] == cell
    assert len(sparse) < 15

def test_sparse_work_is_limited_to_activity_span():
    class Counting(Lookup):
        calls = 0
        def is_working_day(self, calendar, day):
            self.calls += 1
            return super().is_working_day(calendar, day)
    lookup=Counting()
    activity=NS(start=datetime(2026,1,2),finish=datetime(2026,1,12))
    cells=list(assignment_cells(lookup,None,NS(max_hours_per_day=8),NS(id=uuid.uuid4(),utilisation_pct=Decimal(100)),activity,date(2020,1,1),date(2030,1,1),{},sparse=True))
    assert lookup.calls == 11
    assert len(cells) == 6
