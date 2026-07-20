import type { Activity, ResourceAssignment } from '@/modules/scheduling/types'
import { CATEGORY_DISCIPLINE } from '@/modules/fourD/scheduleGeneration'

// "Generate Risk Register" (2026-07-18, per Maro: "generate the risks from
// [the schedule/resources/cost data]... cost risks and general ones.
// understand the scope and draft" — the fourth and final stage of the
// schedule -> resources -> cost -> risk pipeline). Same "frontend computes,
// backend just persists" split every other generation stage this session
// already follows (scheduleGeneration.ts, costGeneration.ts) — this module
// reads the already-committed schedule + resource assignments, derives real
// figures (per-discipline resourced cost, overall programme duration) off
// them, and drafts a real, PMBOK-consistent risk catalog: general risks
// every construction programme carries (weather, design change, key
// subcontractor default, regulatory, material escalation), plus one risk
// per discipline actually present in THIS project's own schedule — never a
// generic dump of every possible discipline regardless of scope. Every risk
// is a first draft for review, not a certified assessment: probability/
// impact are representative mid-"Medium" values (0.25-0.45), and
// cost/schedule impact figures are sized off this project's own real
// resourced totals, not invented flat numbers.
export interface DraftRisk {
  title: string
  category: string | null
  area: string | null
  risk_type: 'threat' | 'opportunity'
  cause?: string
  effect?: string
  rationale?: string
  probability: number
  impact: number
  cost_most_likely?: number
  schedule_most_likely_days?: number
}

interface DisciplineRiskTemplate {
  build: (disciplineBudget: number) => DraftRisk
}

// Keyed by CATEGORY_DISCIPLINE's own discipline names — only the disciplines
// with something meaningful and distinct to say about them get a template;
// a discipline present in the schedule with no template here (rare — every
// discipline CATEGORY_DISCIPLINE actually produces has one) simply
// contributes no discipline-specific risk, not an error.
const DISCIPLINE_RISK_TEMPLATES: Record<string, DisciplineRiskTemplate> = {
  Earthworks: {
    build: budget => ({
      title: 'Unforeseen Ground Conditions', category: 'Cost', area: 'Site', risk_type: 'threat',
      cause: 'Subsurface conditions not fully known until excavation begins',
      effect: 'Additional excavation, remediation, or foundation redesign cost and delay',
      rationale: 'Standard geotechnical risk for any excavation/foundation scope',
      probability: 0.3, impact: 0.4, schedule_most_likely_days: 8,
      cost_most_likely: budget > 0 ? Math.round(budget * 0.06) : undefined,
    }),
  },
  Structures: {
    build: budget => ({
      title: 'Structural Steel / Concrete Supply Delay', category: 'Schedule', area: 'Vendor', risk_type: 'threat',
      cause: 'Long-lead structural steel fabrication and ready-mix concrete supply capacity',
      effect: 'Delay to structural completion, cascading into every later trade this schedule gates behind it',
      rationale: 'Structure directly gates facade/architecture completion in this schedule (Structure Complete — All Levels milestone)',
      probability: 0.3, impact: 0.45, schedule_most_likely_days: 10,
      cost_most_likely: budget > 0 ? Math.round(budget * 0.03) : undefined,
    }),
  },
  Architecture: {
    build: budget => ({
      title: 'Facade / Curtain Wall Lead-Time Overrun', category: 'Schedule', area: 'Vendor', risk_type: 'threat',
      cause: 'Bespoke facade and curtain wall units require long fabrication/glazing lead times',
      effect: 'Delay to building envelope closure and every follow-on internal trade',
      rationale: 'Facade work is already sequenced behind full structural completion in this schedule',
      probability: 0.35, impact: 0.4, schedule_most_likely_days: 15,
      cost_most_likely: budget > 0 ? Math.round(budget * 0.04) : undefined,
    }),
  },
  Electrical: {
    build: budget => ({
      title: 'Long-Lead Electrical Switchgear Procurement', category: 'Schedule', area: 'Vendor', risk_type: 'threat',
      cause: 'Main switchgear and distribution equipment on extended manufacturer lead times',
      effect: 'Delay to electrical first-fix and building energisation',
      rationale: 'Global supply constraints on electrical distribution equipment remain a live market risk',
      probability: 0.3, impact: 0.35, schedule_most_likely_days: 20,
      cost_most_likely: budget > 0 ? Math.round(budget * 0.03) : undefined,
    }),
  },
  HVAC: {
    build: budget => ({
      title: 'HVAC Equipment Procurement Delay', category: 'Schedule', area: 'Vendor', risk_type: 'threat',
      cause: 'Air handling units and chillers on extended manufacturer lead times',
      effect: 'Delay to mechanical completion and building commissioning',
      rationale: 'Standard exposure for a multi-block mechanical services scope',
      probability: 0.3, impact: 0.35, schedule_most_likely_days: 15,
      cost_most_likely: budget > 0 ? Math.round(budget * 0.03) : undefined,
    }),
  },
  Plumbing: {
    build: budget => ({
      title: 'Plumbing Material Cost Volatility', category: 'Cost', area: 'Market', risk_type: 'threat',
      cause: 'Copper, PEX, and fixture pricing subject to commodity market fluctuation',
      effect: 'Cost overrun against the plumbing package budget',
      rationale: 'Commodity material pricing risk compounds over a multi-year programme',
      probability: 0.35, impact: 0.3,
      cost_most_likely: budget > 0 ? Math.round(budget * 0.04) : undefined,
    }),
  },
  Landscape: {
    build: () => ({
      title: 'Landscape Works Seasonal Planting Window Risk', category: 'Schedule', area: 'Site', risk_type: 'threat',
      cause: 'Soft landscaping and planting works are weather- and season-dependent',
      effect: 'Delay to final landscape completion if the seasonal planting window is missed',
      rationale: 'Landscape is deliberately the last-sequenced category in this schedule — any upstream slippage compresses its own window',
      probability: 0.3, impact: 0.25, schedule_most_likely_days: 10,
    }),
  },
  Misc: {
    build: budget => ({
      title: 'FF&E Procurement / Delivery Delay', category: 'Schedule', area: 'Vendor', risk_type: 'threat',
      cause: 'Furniture, fixtures and equipment procured from external suppliers late in the programme',
      effect: 'Delay to final fit-out completion and handover',
      rationale: 'Standard exposure for FF&E packages sequenced at the end of a construction programme',
      probability: 0.25, impact: 0.25, schedule_most_likely_days: 5,
      cost_most_likely: budget > 0 ? Math.round(budget * 0.02) : undefined,
    }),
  },
}

export function buildRiskDraft(activities: Activity[], resourceAssignments: ResourceAssignment[]): DraftRisk[] {
  const activityById = new Map(activities.map(a => [a.id, a]))
  const budgetByDiscipline = new Map<string, number>()
  let totalBudget = 0
  for (const ra of resourceAssignments) {
    const activity = activityById.get(ra.activity_id)
    const category = activity?.schedule_category
    if (!category) continue
    const discipline = CATEGORY_DISCIPLINE[category] ?? 'Misc'
    const budget = Number(ra.budget) || 0
    budgetByDiscipline.set(discipline, (budgetByDiscipline.get(discipline) ?? 0) + budget)
    totalBudget += budget
  }

  // Overall programme duration, earliest start to latest finish across every
  // dated activity — falls back to a representative 180-day default when
  // nothing's been CPM-scheduled yet, so schedule-impact figures are never
  // just missing outright for a genuinely un-dated draft schedule.
  let scheduleStart: Date | null = null
  let scheduleEnd: Date | null = null
  for (const a of activities) {
    if (!a.start || !a.finish) continue
    const s = new Date(a.start), f = new Date(a.finish)
    if (!scheduleStart || s < scheduleStart) scheduleStart = s
    if (!scheduleEnd || f > scheduleEnd) scheduleEnd = f
  }
  const totalDurationDays = scheduleStart && scheduleEnd
    ? Math.max(1, Math.round((scheduleEnd.getTime() - scheduleStart.getTime()) / 86_400_000))
    : 180

  const drafts: DraftRisk[] = [
    {
      title: 'Adverse Weather Delays Site Works', category: 'Schedule', area: 'Site', risk_type: 'threat',
      cause: 'Exposed groundworks and external trades throughout the programme',
      effect: 'Delay to critical-path activities during weather-exposed phases',
      rationale: 'Multi-season programme with significant external/exposed works',
      probability: 0.35, impact: 0.35, schedule_most_likely_days: Math.round(totalDurationDays * 0.03),
    },
    {
      title: 'Design Changes During Construction', category: 'Schedule', area: 'Design', risk_type: 'threat',
      cause: 'Design information incomplete or evolving past tender stage',
      effect: 'Rework and programme slippage on affected activities',
      rationale: 'Standard exposure on a fast-track or design-development programme',
      probability: 0.4, impact: 0.35, schedule_most_likely_days: Math.round(totalDurationDays * 0.025),
      cost_most_likely: totalBudget > 0 ? Math.round(totalBudget * 0.03) : undefined,
    },
    {
      title: 'Key Subcontractor Default or Insolvency', category: 'Cost', area: 'Vendor', risk_type: 'threat',
      cause: 'Reliance on a small number of specialist trade packages',
      effect: 'Re-procurement cost and delay while a replacement is mobilised',
      rationale: 'Market conditions for specialist construction trades remain volatile',
      probability: 0.2, impact: 0.5, schedule_most_likely_days: Math.round(totalDurationDays * 0.04),
      cost_most_likely: totalBudget > 0 ? Math.round(totalBudget * 0.02) : undefined,
    },
    {
      title: 'Regulatory / Permitting Delay', category: 'Regulatory', area: 'Stakeholders', risk_type: 'threat',
      cause: 'Statutory approvals dependent on external authorities',
      effect: 'Delay to the permitted start of affected works',
      rationale: 'Standard risk for a multi-block development requiring phased approvals',
      probability: 0.25, impact: 0.3, schedule_most_likely_days: Math.round(totalDurationDays * 0.02),
    },
  ]

  if (totalBudget > 0) {
    drafts.push({
      title: 'Material Price Escalation', category: 'Cost', area: 'Market', risk_type: 'threat',
      cause: 'Extended procurement and delivery lead times across a multi-year programme',
      effect: 'Cost overrun against the baseline resourced budget',
      rationale: 'Long programme duration increases exposure to market price movement',
      probability: 0.4, impact: 0.4, cost_most_likely: Math.round(totalBudget * 0.05),
    })
  }

  for (const [discipline, budget] of budgetByDiscipline) {
    const template = DISCIPLINE_RISK_TEMPLATES[discipline]
    if (template) drafts.push(template.build(budget))
  }

  return drafts
}
