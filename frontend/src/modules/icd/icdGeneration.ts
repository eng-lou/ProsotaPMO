import type { Activity, ResourceAssignment } from '@/modules/scheduling/types'
import { CATEGORY_DISCIPLINE } from '@/modules/fourD/scheduleGeneration'

// "Generate ICD" (2026-07-20, per Maro) — the fifth stage of the schedule ->
// resources -> cost -> risk -> ICD pipeline: one Decision per discipline
// actually present, plus one Issue and one Change *watch-flag* per
// discipline (added after discussing why Issues/Changes have no real
// schedule trigger the way a Decision does).
//
// A Decision is the one ICD item type you can genuinely see coming from the
// schedule alone, same way a Risk is an uncertain future event — e.g.
// "confirm the facade system" tied to a long-lead package, due before that
// package's own work actually needs to start, so it carries a real
// required_by.
//
// An Issue/Change watch-flag is a different shape on purpose: there's no
// real trigger date for "a problem that hasn't happened yet," so these
// never get a required_by — they're an open placeholder tagged to a
// discipline for the PM to review/populate with real detail if that
// discipline's risk actually materialises, or dismiss if it doesn't. Never
// presented as a real occurred issue or requested change.
//
// Both shapes carry the real activity ids they relate to (reconciled into
// record_links by app/services/icd_bulk_generate.py on every generate/
// regenerate call), so a later rescan can tell whether that discipline's
// schedule has actually moved.
export interface DraftIcdItem {
  item_type: 'issue' | 'change' | 'decision'
  title: string
  description?: string
  required_by?: string
  linked_activity_ids: string[]
}

const DISCIPLINE_DECISION_TITLES: Record<string, string> = {
  Earthworks: 'Confirm Earthworks / Ground Improvement Strategy',
  Structures: 'Confirm Structural System',
  Architecture: 'Confirm Facade System',
  Electrical: 'Confirm Electrical Distribution Strategy',
  HVAC: 'Confirm HVAC Strategy',
  Plumbing: 'Confirm Plumbing Fixture Specification',
  Landscape: 'Confirm Landscape / Planting Scheme',
  Misc: 'Confirm FF&E Package',
  // Added 2026-07-25 alongside "full schedule generation" (see
  // riskGeneration.ts's own DISCIPLINE_RISK_TEMPLATES header for why) — same
  // "every discipline CATEGORY_DISCIPLINE actually produces gets one" rule.
  Preliminaries: 'Confirm Site Mobilisation & Enabling Works Plan',
  Procurement: 'Confirm Long-Lead Procurement Schedule',
  Commissioning: 'Confirm Testing & Commissioning Plan',
}

const WATCH_ISSUE_DESCRIPTION = 'Generated placeholder — review and populate with real detail if this discipline’s coordination/quality issues materialise, or dismiss if not applicable.'
const WATCH_CHANGE_DESCRIPTION = 'Generated placeholder — review and populate with real detail if this discipline sees an anticipated variation, or dismiss if not applicable.'

const LEAD_BUFFER_DAYS = 14

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function buildIcdDraft(activities: Activity[], resourceAssignments: ResourceAssignment[]): DraftIcdItem[] {
  const activityById = new Map(activities.map(a => [a.id, a]))

  // Same "disciplines actually present" detection riskGeneration.ts uses —
  // via resourced activities' own schedule_category, not every activity.
  const activityIdsByDiscipline = new Map<string, Set<string>>()
  for (const ra of resourceAssignments) {
    const activity = activityById.get(ra.activity_id)
    const category = activity?.schedule_category
    if (!category) continue
    const discipline = CATEGORY_DISCIPLINE[category] ?? 'Misc'
    if (!activityIdsByDiscipline.has(discipline)) activityIdsByDiscipline.set(discipline, new Set())
    activityIdsByDiscipline.get(discipline)!.add(ra.activity_id)
  }

  const today = new Date()
  const drafts: DraftIcdItem[] = []

  for (const [discipline, activityIdSet] of activityIdsByDiscipline) {
    const decisionTitle = DISCIPLINE_DECISION_TITLES[discipline]
    if (!decisionTitle) continue // no template for this discipline — contributes nothing, not an error
    const linked_activity_ids = [...activityIdSet]

    drafts.push({
      item_type: 'issue', title: `Watch: ${discipline} — Coordination Risk`,
      description: WATCH_ISSUE_DESCRIPTION, linked_activity_ids,
    })
    drafts.push({
      item_type: 'change', title: `Watch: ${discipline} — Anticipated Variation`,
      description: WATCH_CHANGE_DESCRIPTION, linked_activity_ids,
    })

    let earliestStart: Date | null = null
    for (const id of activityIdSet) {
      const start = activityById.get(id)?.start
      if (!start) continue
      const d = new Date(start)
      if (!earliestStart || d < earliestStart) earliestStart = d
    }
    if (!earliestStart) continue // nothing dated yet in this discipline — no real required_by to anchor a Decision to

    const requiredBy = new Date(earliestStart.getTime() - LEAD_BUFFER_DAYS * 86_400_000)
    if (requiredBy < today) requiredBy.setTime(today.getTime())

    drafts.push({
      item_type: 'decision', title: decisionTitle,
      required_by: toIsoDate(requiredBy), linked_activity_ids,
    })
  }

  return drafts
}
