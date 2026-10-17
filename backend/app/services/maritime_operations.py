"""Bounded, deterministic terminal flow model. Quantities are moves, not TEU.

One-minute fluid steps, FIFO vessel calls, exclusive berths/cranes, shared truck
capacity, finite yard buffer, outbound gate drain. No physical collision or
stochastic arrival claims. Report incomplete runs explicitly.
"""
from app.schemas.maritime_workspace import WorkspaceDefinition, Scenario

ENGINE_VERSION = 'terminal-flow-1'


def simulate(plan: WorkspaceDefinition, scenario: Scenario | None = None):
    assets = {a.id: a for a in plan.assets}
    calls = sorted(plan.calls, key=lambda c: (c.arrival_hour, str(c.id)))
    outages = list(scenario.downtime) if scenario else []
    intervals = [(d.asset_id, d.start_hour, d.start_hour + d.duration_hours) for d in outages]
    intervals += [(w.asset_id, w.start_hour, w.start_hour + w.duration_hours)
                  for w in plan.work_orders if w.status == 'scheduled']
    yards = [a for a in plan.assets if a.kind == 'yard']
    trucks = [a for a in plan.assets if a.kind == 'truck']
    gates = [a for a in plan.assets if a.kind == 'gate']
    if not calls or not yards or not trucks or not gates:
        raise ValueError('Add a vessel call, yard, truck capacity and outbound gate before running')
    stock = sum(a.initial_stock for a in yards)
    capacity = sum(a.capacity for a in yards)
    initial_stock = stock
    remaining = {c.id: float(c.cargo_moves) for c in calls}
    started, finished = {}, {}
    productive = {a.id: 0.0 for a in plan.assets}
    moves = {a.id: 0.0 for a in plan.assets}
    cost = 0.0
    samples = [{'hour': 0, 'handled': 0, 'yard_moves': stock, 'gate_cleared': 0,
                'waiting_vessels': 0, 'operating_cost': 0}]
    cleared = 0.0
    dt = 1 / 60
    unavailable = set()
    def available(id, hour):
        return id not in unavailable

    for minute in range(plan.horizon_hours * 60):
        hour = minute / 60
        unavailable = {a for a, start, end in intervals if start <= hour < end}
        open_gates = [a for a in gates if available(a.id, hour)]
        gate_rate = sum(a.rate for a in open_gates)
        discharge = min(stock, gate_rate * dt)
        stock -= discharge
        cleared += discharge
        for a in open_gates:
            allocated = discharge * a.rate / gate_rate if gate_rate else 0
            productive[a.id] += allocated / a.rate if a.rate else 0
            moves[a.id] += allocated
            cost += allocated / a.rate * a.hourly_cost if a.rate else 0
        open_trucks = [a for a in trucks if available(a.id, hour)]
        truck_rate = sum(a.rate for a in open_trucks)
        transport_left = truck_rate * dt
        occupied_berths, used_cranes, occupied_vessels = set(), set(), set()
        queue = 0
        for c in calls:
            if remaining[c.id] <= 1e-7 or c.arrival_hour > hour + 1e-9:
                continue
            if c.berth_id in occupied_berths or c.vessel_id in occupied_vessels or not available(c.berth_id, hour):
                queue += 1
                continue
            occupied_berths.add(c.berth_id)
            occupied_vessels.add(c.vessel_id)
            started.setdefault(c.id, hour)
            cranes = [assets[id] for id in c.crane_ids if id not in used_cranes and available(id, hour)]
            used_cranes.update(a.id for a in cranes)
            crane_rate = sum(a.rate for a in cranes)
            amount = max(0, min(remaining[c.id], crane_rate * dt, transport_left, capacity - stock))
            remaining[c.id] -= amount
            stock += amount
            transport_left -= amount
            cost += assets[c.berth_id].hourly_cost * dt
            productive[c.berth_id] += dt
            for a in cranes:
                allocated = amount * a.rate / crane_rate if crane_rate else 0
                productive[a.id] += allocated / a.rate if a.rate else 0
                moves[a.id] += allocated
                cost += allocated / a.rate * a.hourly_cost if a.rate else 0
            for a in open_trucks:
                allocated = amount * a.rate / truck_rate if truck_rate else 0
                productive[a.id] += allocated / a.rate if a.rate else 0
                moves[a.id] += allocated
                cost += allocated / a.rate * a.hourly_cost if a.rate else 0
            if remaining[c.id] < 1e-7:
                remaining[c.id] = 0
                finished[c.id] = (minute + 1) / 60
        complete = all(v == 0 for v in remaining.values())
        if minute % 15 == 0 or (complete and stock < 1e-7):
            samples.append({'hour': round((minute + 1) / 60, 4),
                            'handled': round(sum(c.cargo_moves - remaining[c.id] for c in calls), 3),
                            'yard_moves': round(stock, 3), 'gate_cleared': round(cleared, 3),
                            'waiting_vessels': queue, 'operating_cost': round(cost, 2)})
        if complete and stock < 1e-7:
            break
    elapsed = (minute + 1) / 60
    maintenance_cost = sum(w.cost for w in plan.work_orders if w.status == 'scheduled' and w.start_hour < elapsed)
    last = {'hour': round(elapsed, 4), 'handled': round(sum(c.cargo_moves - remaining[c.id] for c in calls), 3),
            'yard_moves': round(stock, 3), 'gate_cleared': round(cleared, 3),
            'waiting_vessels': queue, 'operating_cost': round(cost, 2)}
    if samples[-1] != last:
        samples.append(last)
    return {
        'engine': ENGINE_VERSION, 'currency': plan.currency,
        'status': 'complete' if complete and stock < 1e-7 else 'horizon_reached',
        'vessel_completion_hour': round(max(finished.values()), 4) if len(finished) == len(calls) else None,
        'terminal_completion_hour': round(elapsed, 4) if complete and stock < 1e-7 else None,
        'cargo_moves': sum(c.cargo_moves for c in calls), 'handled_moves': last['handled'],
        'initial_yard_moves': initial_stock, 'yard_moves': last['yard_moves'], 'gate_cleared': last['gate_cleared'],
        'operating_cost': round(cost, 2), 'maintenance_cost': round(maintenance_cost, 2),
        'total_cost': round(cost + maintenance_cost, 2), 'elapsed_hours': round(elapsed, 4),
        'calls': [{'id': str(c.id), 'name': c.name, 'arrival_hour': c.arrival_hour,
                   'start_hour': started.get(c.id), 'finish_hour': finished.get(c.id),
                   'remaining_moves': round(remaining[c.id], 3)} for c in calls],
        'equipment': [{'id': str(a.id), 'name': a.name, 'kind': a.kind,
                       'productive_hours': round(productive[a.id], 4), 'moves': round(moves[a.id], 3),
                       'utilisation_elapsed_percent': round(100 * productive[a.id] / elapsed, 2)}
                      for a in plan.assets if a.kind in ('crane', 'truck', 'gate', 'berth')],
        'samples': samples,
        'assumptions': [
            'One-minute fluid approximation; all cargo is unloaded to a pooled yard then leaves through outbound gates.',
            'Calls use FIFO arrival order; a berth serves one vessel and a crane serves one call at a time. A vessel cannot occupy two berths at once.',
            'Truck rate is aggregate moves/hour including travel. Yard capacity is pooled cargo moves, not TEU.',
            'Operating costs charge productive crane/truck/gate hours and occupied berth hours. No idle, fuel or demurrage cost is implied.',
            'Scheduled maintenance affects both working-plan and scenario runs. Draft work orders have no availability impact.',
            'No tide, collision, shift-calendar, inbound gate or physical route solver is included in this flow calculation.',
        ],
    }


def compare(plan, scenario=None):
    baseline = simulate(plan)
    alternative = simulate(plan, scenario) if scenario else baseline
    a, b = baseline['vessel_completion_hour'], alternative['vessel_completion_hour']
    return {'baseline': baseline, 'scenario': alternative,
            'completion_delay_hours': round(b - a, 4) if a is not None and b is not None else None,
            'cost_change': round(alternative['total_cost'] - baseline['total_cost'], 2)}


def assess_attempt(exercise, actions):
    times = [a.seconds for a in actions]
    if times != sorted(times):
        raise ValueError('Actions must be in chronological order')
    if any(a.action not in exercise.required_actions for a in actions):
        raise ValueError('Action is not defined by this exercise')
    first = {}
    for action in actions:
        first.setdefault(action.action, action.seconds)
    observed = list(first)
    required = exercise.required_actions
    return {'exercise_id': str(exercise.id), 'hazard': exercise.hazard,
            'actions': [a.model_dump() for a in actions],
            'criteria': [{'action': action, 'completed': action in first, 'seconds': first.get(action),
                          'within_limit': action in first and first[action] <= exercise.response_limit_seconds}
                         for action in required],
            'required': len(required), 'completed': len(first), 'missed': [a for a in required if a not in first],
            'in_order': observed == [a for a in required if a in first],
            'first_response_seconds': times[0] if times else None,
            'timing_basis': 'Seconds since exercise start; actions are participant-reported interactions, not certified assessment.'}
