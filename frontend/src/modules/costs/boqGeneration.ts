import type { Activity, ResourceAssignment } from '@/modules/scheduling/types'
import { resolvePhases } from '@/modules/fourD/scheduleGeneration'

// "Generate BOQ" (2026-07-18, per Maro: "populated from our schedule, ifc
// quantities and relevant project data" — a classic Bill of Quantities view
// alongside the Cost Plan's own Prelims/Overhead-style percentage lines).
// One row per IFC-generated leaf activity (its schedule_category/
// schedule_phase_key), matching a real BOQ's own granularity ("Excavation in
// Foundation," "Cement Concrete in Foundation," ...) — this project's own
// generated activity task_names already read exactly this way
// ("Storey — Category — Phase").
//
// Quantity reads Activity.schedule_quantity directly (2026-07-18, per
// Maro's own QA: isolating L2's beams in the 4D viewer showed 193 real
// IfcBeam elements, but this generator used to show 200 — because until
// that column existed, nothing persisted the true measured count at all,
// only the resulting duration_hours; this reverse-derived quantity from
// duration_hours instead, ≈ (duration_hours / 8) x productivityPerCrewDay,
// which recovers computeDurationHours' own Math.ceil()-rounded day count
// (200), not the true 193 that produced it). Falls back to that same
// reverse-engineered estimate only for an activity generated before
// schedule_quantity existed (schedule_quantity null) — every activity
// generated from here on has the real number.
//
// Rate is deliberately NOT a separately-invented $/unit market price —
// it's this activity's own already-resourced budget (real crew/equipment
// day rates x duration, already computed by the Resources tab) divided by
// the same derived quantity, so quantity x rate reproduces that real
// resourced budget exactly. A BOQ built this way ties out to the Cost
// Plan's own resource-loaded total by construction, not a second,
// independently-guessed number.
const HOURS_PER_DAY = 8

export interface DraftBoqLine {
  description: string
  qty: number
  unit: string
  rate: number
}

export function buildBoqDraft(activities: Activity[], resourceAssignments: ResourceAssignment[]): DraftBoqLine[] {
  const budgetByActivityId = new Map<string, number>()
  for (const ra of resourceAssignments) {
    budgetByActivityId.set(ra.activity_id, (budgetByActivityId.get(ra.activity_id) ?? 0) + (Number(ra.budget) || 0))
  }

  const lines: DraftBoqLine[] = []
  for (const activity of activities) {
    if (!activity.schedule_category || !activity.duration_hours) continue
    const phases = resolvePhases(activity.schedule_category)
    const phase = phases.find(p => p.key === activity.schedule_phase_key) ?? phases[0]
    if (!phase || phase.rate.productivityPerCrewDay <= 0) continue

    const qty = activity.schedule_quantity !== null
      ? Number(activity.schedule_quantity)
      : Math.round((activity.duration_hours / HOURS_PER_DAY) * phase.rate.productivityPerCrewDay * 100) / 100
    if (qty <= 0) continue
    const budget = budgetByActivityId.get(activity.id) ?? 0
    const rate = budget > 0 ? Math.round((budget / qty) * 100) / 100 : 0

    lines.push({ description: activity.task_name, qty, unit: phase.rate.unit, rate })
  }
  return lines
}
