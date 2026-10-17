"""Bounded synthetic scenarios using Prosota's production CPM and cost formulas.

No database writes or imported project identifiers. Baseline and scenario use
independent records. Delays mean additional working duration, not idle suspension.
"""
from datetime import datetime, time, timedelta
from decimal import Decimal
from uuid import NAMESPACE_URL, uuid5

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar, CalendarBreak
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.schedule_period import SchedulePeriod
from app.schemas.maritime import DeliveryScenario, OperationsScenario
from app.services.resource_costing import compute_assignment_budget_raw
from app.services.scheduling_cpm import _CalendarLookup, calculate_schedule


def uid(key):
    return uuid5(NAMESPACE_URL, 'prosota-maritime-demo/' + key)


TASKS = [
    ('foundation', 'Crane foundation', 12, []),
    ('deck', 'Berth deck', 12, ['foundation']),
    ('procurement', 'Crane procurement', 20, []),
    ('installation', 'Crane installation', 8, ['deck', 'procurement']),
    ('commission', 'Commissioning', 4, ['installation']),
    ('ready', 'Operational readiness', 0, ['commission']),
]
RESOURCES = [
    ('civil-crew', 'Marine civil crew', 'crew', 1500),
    ('piling-plant', 'Piling plant', 'equipment', 2500),
    ('concrete', 'Concrete', 'material', 120),
    ('deck-material', 'Deck materials', 'material', 150),
    ('crane-supply', 'New crane supply', 'subcontractor', 180000),
    ('install-crew', 'Installation crew', 'crew', 2200),
    ('mobile-crane', 'Installation crane', 'equipment', 3200),
    ('test-crew', 'Commissioning team', 'crew', 1200),
]
ASSIGNMENTS = {
    'foundation': [('civil-crew', None), ('piling-plant', None), ('concrete', 300)],
    'deck': [('civil-crew', None), ('deck-material', 500)],
    'procurement': [('crane-supply', None)],
    'installation': [('install-crew', None), ('mobile-crane', None)],
    'commission': [('test-crew', None)],
    'ready': [],
}


def calendar_lookup():
    calendar = Calendar(
        id=uid('calendar'), name='Maritime Mon–Fri', is_project_default=True,
        day_start_time=time(8), day_end_time=time(17), whole_day_scheduling=True,
        works_monday=True, works_tuesday=True, works_wednesday=True,
        works_thursday=True, works_friday=True, works_saturday=False, works_sunday=False,
    )
    lunch = CalendarBreak(calendar_id=calendar.id, start_time=time(12), end_time=time(13))
    return calendar, _CalendarLookup([calendar], [], [lunch])


def money(value):
    return float(Decimal(value).quantize(Decimal('0.01')))


def _schedule(inputs: DeliveryScenario, delayed: bool):
    calendar, lookup = calendar_lookup()
    activities, relationships = [], []
    for key, name, days, predecessors in TASKS:
        duration = days + (inputs.delay_days if delayed and key == inputs.delay_activity else 0)
        activities.append(Activity(
            id=uid(key), task_name=name, duration_hours=Decimal(duration * 8),
            activity_type='milestone' if key == 'ready' else 'task',
            is_archived=False, pct_complete=Decimal(0),
        ))
        relationships.extend(ActivityRelationship(
            predecessor_id=uid(pred), successor_id=uid(key), relationship_type='FS', lag_hours=Decimal(0),
        ) for pred in predecessors)
    period = SchedulePeriod(start_date=inputs.start_date, start_time=time(8))
    calculate_schedule(activities, relationships, lookup, period)
    start, finish = min(a.start for a in activities), max(a.finish for a in activities)
    working_days = lookup.working_hours_between(calendar, start, finish) / Decimal(8)
    resources = {key: Resource(id=uid(key), name=name, resource_type=kind, rate=Decimal(rate))
                 for key, name, kind, rate in RESOURCES}
    resource_totals = {key: {'id': key, 'name': r.name, 'type': r.resource_type, 'rate': float(r.rate),
                             'rate_unit': 'day' if r.resource_type in ('crew', 'equipment') else 'unit' if r.resource_type == 'material' else 'lump sum',
                             'hours': Decimal(0), 'cost': Decimal(0)} for key, r in resources.items()}
    rows, daily = [], {}
    def day_record(d):
        return daily.setdefault(d.isoformat(), {'date': d.isoformat(), 'resource_hours': Decimal(0), 'cost': Decimal(0)})
    direct = Decimal(0)
    for (key, name, _, predecessors), activity in zip(TASKS, activities):
        cost = Decimal(0)
        for resource_id, qty in ASSIGNMENTS[key]:
            resource = resources[resource_id]
            assignment = ResourceAssignment(quantity=qty, utilisation_pct=Decimal(100))
            amount = compute_assignment_budget_raw(resource, activity, assignment, Decimal(8))
            cost += amount
            total = resource_totals[resource_id]
            total['cost'] += amount
            if resource.resource_type in ('crew', 'equipment'):
                total['hours'] += activity.duration_hours
                current = activity.start.date()
                while current <= activity.finish.date():
                    h = lookup.working_hours_between(calendar, max(activity.start, datetime.combine(current, time.min)),
                                                    min(activity.finish, datetime.combine(current + timedelta(days=1), time.min)))
                    record = day_record(current)
                    record['resource_hours'] += h
                    record['cost'] += h / Decimal(8) * resource.rate
                    current += timedelta(days=1)
            else:
                # Illustrative accrual convention: materials/supply recognised at task finish.
                day_record(activity.finish.date())['cost'] += amount
        direct += cost
        rows.append({'id': key, 'name': name, 'asset_id': 'expansion-01', 'predecessors': predecessors,
                     'start': activity.start.isoformat(), 'finish': activity.finish.isoformat(),
                     'duration_days': float(activity.duration_days), 'critical': activity.is_critical,
                     'float_days': float(activity.total_float_hours / Decimal(8)), 'cost': money(cost)})
    overhead_rate = Decimal(str(inputs.overhead_day_rate))
    current = start.date()
    while current <= finish.date():
        h = lookup.working_hours_between(calendar, max(start, datetime.combine(current, time.min)),
                                        min(finish, datetime.combine(current + timedelta(days=1), time.min)))
        day_record(current)['cost'] += h / Decimal(8) * overhead_rate
        current += timedelta(days=1)
    cumulative, series = Decimal(0), []
    for key in sorted(daily):
        record = daily[key]
        cumulative += record['cost']
        series.append({**record, 'resource_hours': float(record['resource_hours']),
                       'cost': money(record['cost']), 'cumulative_cost': money(cumulative)})
    return {'start': start.isoformat(), 'finish': finish.isoformat(), 'working_days': float(working_days),
            'activities': rows, 'resources': [{**r, 'hours': float(r['hours']), 'cost': money(r['cost'])} for r in resource_totals.values()],
            'direct_cost': money(direct), 'overhead_cost': money(working_days * overhead_rate),
            'total_cost': money(direct + working_days * overhead_rate), 'daily': series}


def delivery_results(inputs: DeliveryScenario):
    baseline, scenario = _schedule(inputs, False), _schedule(inputs, True)
    calendar, lookup = calendar_lookup()
    slip = lookup.working_hours_between(calendar, datetime.fromisoformat(baseline['finish']), datetime.fromisoformat(scenario['finish'])) / Decimal(8)
    return {'inputs': inputs.model_dump(mode='json'), 'synthetic': True, 'currency': 'GBP',
            'engine': 'Prosota CPM + resource costing', 'baseline': baseline, 'scenario': scenario,
            'impact': {'working_days': float(slip), 'calendar_days': (datetime.fromisoformat(scenario['finish']) - datetime.fromisoformat(baseline['finish'])).days,
                       'cost': money(Decimal(str(scenario['total_cost'])) - Decimal(str(baseline['total_cost']))),
                       'resource_hours': sum(r['hours'] for r in scenario['resources']) - sum(r['hours'] for r in baseline['resources'])},
            'assumptions': ['Synthetic GBP rates; no actual expenditure or earned value.',
                            'Mon–Fri, 08:00–17:00, one-hour lunch; no holidays or resource levelling.',
                            'Delay extends working duration; assigned crews and equipment remain fully utilised. It is not idle standby.',
                            'Material quantities and lump sums stay fixed; site overhead accrues per project working day.',
                            'Materials and supply costs accrue at activity finish for the illustrative cost curve.']}


def operations_results(s: OperationsScenario):
    baseline = s.arrival + s.cargo / (2 * s.rate)
    remaining, at = float(s.cargo), s.arrival
    for end in sorted({s.arrival, s.outageStart, s.outageStart + s.outageHours}):
        if end <= at:
            continue
        rate = s.rate * (1 if s.breakdown and s.outageStart <= at < s.outageStart + s.outageHours else 2)
        if (end - at) * rate >= remaining:
            at += remaining / rate
            remaining = 0
            break
        remaining -= (end - at) * rate
        at = end
    finish = at + remaining / (2 * s.rate)
    return {'inputs': s.model_dump(), 'baseline_hours': baseline, 'scenario_hours': finish, 'delay_hours': finish - baseline}
