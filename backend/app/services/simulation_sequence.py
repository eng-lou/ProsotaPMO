"""Fit a reviewed visual run to the existing parent activity windows."""
from copy import deepcopy
from fastapi import HTTPException
from app.services.operation_simulation import stamp, iso


def fit_to_activities(scenario, activities):
    fitted = deepcopy(scenario)
    result = fitted['result']
    parents = {str(a.id): a for a in activities}
    windows = {}
    for activity in result['activities']:
        aid = activity['activity_id']
        events = [e for e in result['events'] if e['activity_id'] == aid]
        if not events:
            continue
        parent = parents.get(aid)
        if not parent or not parent.start or not parent.finish or parent.finish <= parent.start:
            raise HTTPException(409, f"{activity['name']}: set a non-zero parent activity start and finish before promoting.")
        start = min(stamp(e['start']) for e in events)
        end = max(stamp(e['end']) for e in events)
        if end <= start:
            raise HTTPException(409, f"{activity['name']}: sequence has no duration.")
        windows[aid] = (start, end, stamp(parent.start), stamp(parent.finish))
        activity['start'], activity['finish'] = iso(stamp(parent.start)), iso(stamp(parent.finish))

    def mapped(value, aid):
        if not value or aid not in windows:
            return value
        start, end, dest_start, dest_end = windows[aid]
        fraction = max(0, min(1, (stamp(value)-start)/(end-start)))
        return iso(dest_start + (dest_end-dest_start)*fraction)

    steps = {s['id']: s for s in result['steps']}
    for group in ('events', 'steps', 'waiting'):
        for entry in result[group]:
            aid = entry.get('activity_id') or steps.get(entry.get('step_id'), {}).get('activity_id')
            for key in ('start', 'end', 'finish'):
                if key in entry:
                    entry[key] = mapped(entry[key], aid)
    for entry in result.get('production', []):
        entry['time'] = mapped(entry['time'], steps[entry['step_id']]['activity_id'])

    # One visible worker/tool cannot be in two places after independently
    # fitting different parents. Keep the saved run; reject only promotion.
    assigned = {}
    for step in fitted['config']['steps']:
        method = step.get('worker_method')
        row = steps.get(step['id'])
        if not row or not row.get('start') or not row.get('finish'):
            continue
        if method:
            for role in ('worker_id', 'tool_id'):
                assigned.setdefault(method[role], []).append(row)
        for dep in step.get('dependencies', []):
            predecessor = steps.get(dep['step_id'])
            if not predecessor or predecessor['activity_id'] == row['activity_id']:
                continue
            # Partial-release/lag semantics stay with the solver. The fitted
            # sequence must at least respect its calculated cross-activity order.
            original_prev = next(s for s in scenario['result']['steps'] if s['id']==predecessor['id'])
            original_row = next(s for s in scenario['result']['steps'] if s['id']==row['id'])
            if original_prev.get('finish') and original_row.get('start') and stamp(original_prev['finish']) <= stamp(original_row['start']) and stamp(predecessor['finish']) > stamp(row['start']):
                raise HTTPException(409, f"{row['name']}: parent activity windows conflict with its predecessor. Adjust the programme before promoting.")
    for rows in assigned.values():
        rows.sort(key=lambda s: s['start'])
        if any(stamp(a['finish']) > stamp(b['start']) for a,b in zip(rows, rows[1:])):
            raise HTTPException(409, 'Fitting to parent activities would overlap the same worker or tool. Adjust the parent activity windows or assign separate objects.')
    handled = {}
    for event in result['events']:
        for state in event.get('object_states', []):
            handled.setdefault(state['model_ref'], []).append((state.get('element_id'), event))
    for entries in handled.values():
        entries.sort(key=lambda x: x[1]['start'])
        active = []
        for element, event in entries:
            active = [(part, other) for part, other in active if stamp(other['end']) > stamp(event['start'])]
            if any(other.get('task_id', other['step_id']) != event.get('task_id', event['step_id']) and (not element or not part or element == part) for part, other in active):
                raise HTTPException(409, 'Fitting to parent activities would give the same model or element overlapping handling instructions. Adjust the parent activity windows before promoting.')
            active.append((element, event))
    if not result['events']:
        raise HTTPException(409, 'No sequence events to promote.')
    result['start'] = min(e['start'] for e in result['events'])
    result['finish'] = max(e['end'] for e in result['events'])
    fitted['timing'] = {'mode': 'parent_activity', 'original_start': scenario['result']['start'], 'original_finish': scenario['result']['finish'], 'activities': [dict(activity_id=aid, source_start=iso(a), source_finish=iso(b), start=iso(c), finish=iso(d)) for aid,(a,b,c,d) in windows.items()]}
    fitted.pop('source', None)
    return fitted
