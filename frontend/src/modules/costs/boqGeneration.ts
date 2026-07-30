import type { Activity, ResourceAssignment } from '@/modules/scheduling/types'
import { resolvePhases } from '@/modules/fourD/scheduleGeneration'
import type { CostRateLine } from './types'

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
//
// Material gets its OWN line, not blended into the row above (2026-07-27,
// per Maro: "is the boq generation logic updated to reflect all this?" —
// real catch: it wasn't. resourceAssignments already denormalizes
// resource_type per row (ResourceAssignment.resource_type), so a Columns
// activity's Structural Steel assignment was silently being summed into
// the SAME budgetByActivityId total as its crew/equipment cost, inflating
// the "$/each column" rate above with a blended labour+material figure
// instead of surfacing "8.45 tonnes @ $2,200/tonne" as its own real,
// separately-quantified BOQ item — the entire point of a Bill of
// Quantities, and exactly what a real one always splits out). Split by
// resource_type below so the labour/equipment line's own rate goes back to
// being pure labour+equipment cost, with material's own real qty/unit/rate
// (Activity.schedule_material_*, the same real numbers
// scheduleGeneration.ts's own material take-off already computed and
// persisted — not reverse-engineered from resourceAssignments at all,
// unlike the labour rate above) as a second, separate line directly below
// it. Same "0 if nothing's been resourced yet" fallback as the labour line
// (not the original default cost_per_unit) — an unassigned material line
// shouldn't show a rate that doesn't tie back to anything real yet either.
const HOURS_PER_DAY = 8

// Programme logic, not measured works (2026-07-27, per Maro's QS review:
// "Submittal / Approval / Place PO / Procure & Deliver is programme
// logic... don't belong in a cost document") — these four phases stay in
// the schedule for real sequencing/float, but never generate a BOQ line.
// Their coordination cost still reaches the Cost Plan as a real figure,
// just at the Preliminaries discipline rollup (see scheduleGeneration.ts's
// CATEGORY_DISCIPLINE — Procurement now maps there), not as four fake
// priced-per-package lines here.
const PROCUREMENT_ADMIN_PHASE_KEYS: ReadonlySet<string> = new Set(['submittal', 'approval', 'purchase_order', 'delivery'])

function slug(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export interface DraftBoqLine {
  description: string
  qty: number
  unit: string
  rate: number
  // location/system/activity, e.g. "W-0004/COLUMNS/T-0114" — see
  // CostRateLine.cost_code's own backend docstring. A resource/material
  // line's code is its parent activity's code plus a trailing "/MAT"
  // segment, so buildBoqTree can recover the parent-child relationship
  // from this string alone.
  cost_code: string
}

export function buildBoqDraft(activities: Activity[], resourceAssignments: ResourceAssignment[]): DraftBoqLine[] {
  const budgetByActivityId = new Map<string, number>()
  const materialBudgetByActivityId = new Map<string, number>()
  for (const ra of resourceAssignments) {
    const budget = Number(ra.budget) || 0
    const byActivityId = ra.resource_type === 'material' ? materialBudgetByActivityId : budgetByActivityId
    byActivityId.set(ra.activity_id, (byActivityId.get(ra.activity_id) ?? 0) + budget)
  }
  const activitiesById = new Map(activities.map(a => [a.id, a]))

  const lines: DraftBoqLine[] = []
  for (const activity of activities) {
    if (!activity.schedule_category || !activity.duration_hours) continue
    if (activity.schedule_phase_key && PROCUREMENT_ADMIN_PHASE_KEYS.has(activity.schedule_phase_key)) continue
    const phases = resolvePhases(activity.schedule_category)
    const phase = phases.find(p => p.key === activity.schedule_phase_key) ?? phases[0]
    if (!phase || phase.rate.productivityPerCrewDay <= 0) continue

    // location/system/activity (2026-07-27) — the real WBS storey parent
    // (schedule-generated phase activities are always a direct child of
    // their storey's own WBS SUMMARY row, see scheduleGeneration.ts's
    // storeys.forEach), the category, and the activity's own already-unique
    // schedule code — real, stable, and exactly what a 4D cost-loading
    // lookup needs, not an invented identifier with no path back.
    const locationCode = (activity.parent_id ? activitiesById.get(activity.parent_id)?.code : null) ?? 'NOLOC'
    const costCode = `${locationCode}/${slug(activity.schedule_category)}/${activity.code}`

    const qty = activity.schedule_quantity !== null
      ? Number(activity.schedule_quantity)
      : Math.round((activity.duration_hours / HOURS_PER_DAY) * phase.rate.productivityPerCrewDay * 100) / 100
    if (qty > 0) {
      const budget = budgetByActivityId.get(activity.id) ?? 0
      const rate = budget > 0 ? Math.round((budget / qty) * 100) / 100 : 0
      lines.push({ description: activity.task_name, qty, unit: phase.rate.unit, rate, cost_code: costCode })
    }

    if (activity.schedule_material_name && activity.schedule_material_quantity !== null && activity.schedule_material_unit) {
      const materialQty = Number(activity.schedule_material_quantity)
      if (materialQty > 0) {
        const materialBudget = materialBudgetByActivityId.get(activity.id) ?? 0
        const materialRate = materialBudget > 0 ? Math.round((materialBudget / materialQty) * 100) / 100 : 0
        lines.push({
          description: `${activity.task_name} — ${activity.schedule_material_name}`,
          qty: materialQty, unit: activity.schedule_material_unit, rate: materialRate,
          cost_code: `${costCode}/MAT`,
        })
      }
    }
  }
  return lines
}

// Renders the tree Boq.tsx/BoqPrintView.tsx both need (2026-07-27, per
// Maro's QS review: "no hierarchy — 474 peer-numbered lines... needs a
// proper tree: section -> element -> activity -> resource, with the
// resource lines as children, not entries in the same sequence"). Built
// purely from each persisted CostRateLine's own cost_code string at read
// time — cost_rate_lines stays the flat table it already was (see its own
// model docstring), no parent_id column, no schema rebuild: a resource
// line's code is recognised by its trailing "/MAT" segment, matched back
// to the activity line sharing the same first three segments. A line with
// no cost_code (hand-added via "+ Add line", or generated before this
// existed) has no known position in the tree and surfaces in `ungrouped`
// instead of being silently dropped.
export interface BoqTreeActivity {
  line: CostRateLine
  label: string
  resources: { line: CostRateLine; label: string }[]
}

export interface BoqTreeElement {
  key: string
  label: string
  activities: BoqTreeActivity[]
  subtotal: number
}

export interface BoqTreeSection {
  key: string
  label: string
  elements: BoqTreeElement[]
  subtotal: number
}

export interface BoqTree {
  sections: BoqTreeSection[]
  ungrouped: CostRateLine[]
}

function lineTotal(line: CostRateLine): number {
  return Number(line.qty) * Number(line.rate)
}

// Strips a leading "section — element — " from an activity's own task_name
// (storey-scoped categories format it that way — see the per-storey loop
// this module's own buildBoqDraft reads from), leaving just its real label
// (the phase). Categories generated once for the whole site rather than
// per storey (Preliminaries, Substructure Earthworks, Testing &
// Commissioning) never had that prefix in the first place — task_name IS
// already just the phase label there, so startsWith fails safely and the
// full task_name comes back unchanged, exactly what's wanted.
function stripLabelPrefix(taskName: string, section: string, element: string): string {
  const prefix = `${section} — ${element} — `
  return taskName.startsWith(prefix) ? taskName.slice(prefix.length) : taskName
}

// 2026-07-27 fix — the previous version derived section/element labels by
// splitting each line's own `description` text on " — ", assuming every
// line was storey-scoped ("Storey — Category — Phase"). Preliminaries/
// Substructure Earthworks/Testing & Commissioning are generated once for
// the whole site, not per storey, so their task_name has no such prefix at
// all — the split silently produced an EMPTY element label for all three,
// which then collapsed together into one unlabelled £197,500 row in the
// elemental rollup (Maro: "amount 197k missing an element name" — 63,500 +
// 54,000 + 80,000, exactly those three categories' real totals). Labels
// now come from the real source Activity instead of parsed text: the
// section is the real WBS parent's own task_name (looked up by the
// location code), the element is the activity's own real schedule_category
// field, and the activity/resource labels use schedule_material_name
// directly rather than guessing it out of a formatted string — none of
// which depend on any particular description format holding.
export function buildBoqTree(lines: CostRateLine[], activities: Activity[]): BoqTree {
  const activitiesByOwnCode = new Map(activities.filter(a => a.code).map(a => [a.code, a] as const))
  const sections = new Map<string, BoqTreeSection>()
  const activitiesByLineCode = new Map<string, BoqTreeActivity>()
  const materialLines: CostRateLine[] = []
  const ungrouped: CostRateLine[] = []

  // Pass 1 — every real activity-level line (a 3-segment code: location/
  // system/activity) becomes a tree node. Anything else either is a
  // material line (4 segments, handled in pass 2) or has no recognised
  // position (null cost_code, or a shape neither of the above — surfaced
  // in `ungrouped` rather than silently dropped).
  for (const line of lines) {
    const parts = line.cost_code?.split('/') ?? []
    if (parts.length === 4 && parts[3] === 'MAT') { materialLines.push(line); continue }
    if (parts.length !== 3) { ungrouped.push(line); continue }

    const [locationCode, systemSlug, activityCode] = parts
    const sourceActivity = activitiesByOwnCode.get(activityCode)
    const sectionLabel = activitiesByOwnCode.get(locationCode)?.task_name ?? locationCode
    const elementLabel = sourceActivity?.schedule_category ?? systemSlug
    const activityLabel = sourceActivity ? stripLabelPrefix(sourceActivity.task_name, sectionLabel, elementLabel) : line.description

    let section = sections.get(locationCode)
    if (!section) {
      section = { key: locationCode, label: sectionLabel, elements: [], subtotal: 0 }
      sections.set(locationCode, section)
    }
    const elementKey = `${locationCode}/${systemSlug}`
    let element = section.elements.find(e => e.key === elementKey)
    if (!element) {
      element = { key: elementKey, label: elementLabel, activities: [], subtotal: 0 }
      section.elements.push(element)
    }
    const activity: BoqTreeActivity = { line, label: activityLabel, resources: [] }
    element.activities.push(activity)
    activitiesByLineCode.set(line.cost_code!, activity)
  }

  // Pass 2 — attach each material line to the activity node sharing its
  // first three cost_code segments.
  for (const line of materialLines) {
    const codeParts = line.cost_code!.split('/')
    const parentCode = codeParts.slice(0, 3).join('/')
    const parent = activitiesByLineCode.get(parentCode)
    const sourceActivity = activitiesByOwnCode.get(codeParts[2])
    const label = sourceActivity?.schedule_material_name ?? line.description.split(' — ').pop() ?? line.description
    if (parent) {
      parent.resources.push({ line, label })
    } else {
      // Parent activity line doesn't exist (e.g. its own qty was 0 so
      // buildBoqDraft skipped it, but the material line still generated) —
      // surface it rather than silently dropping a real cost.
      ungrouped.push(line)
    }
  }

  for (const section of sections.values()) {
    for (const element of section.elements) {
      element.subtotal = element.activities.reduce(
        (sum, a) => sum + lineTotal(a.line) + a.resources.reduce((s, r) => s + lineTotal(r.line), 0), 0,
      )
    }
    section.subtotal = section.elements.reduce((sum, e) => sum + e.subtotal, 0)
  }

  // Locational Detail stays in natural WBS/schedule order, not sorted by
  // cost (2026-07-27, per Maro — "largest first" applies to the Elemental
  // Summary rollup only, which sorts independently in BoqPrintView.tsx;
  // reordering sections/elements here would scramble the locational
  // breakdown's own sequential, buildability-driven reading).
  return { sections: [...sections.values()], ungrouped }
}
