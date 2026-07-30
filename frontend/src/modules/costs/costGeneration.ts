// "Generate Cost Plan" (2026-07-17/18, per Maro: "full costing in costing" —
// stage 3 of the schedule -> resources -> cost -> risk pipeline). The
// resource-loaded fixed CostElements already flow in live, automatically,
// the moment an activity gets a resource assignment (cost_sync.py, backend)
// — Auto Assign Resources already triggers that, nothing to generate there.
// This is only the non-resource-loaded on-cost lines nothing auto-creates:
// typical-industry percentage rates, same "editable defaults, not a
// certified takeoff" contract the crew rate table (scheduleGeneration.ts's
// own DEFAULT_CATEGORY_PHASES) already uses — reviewed and freely edited in
// Cost Plan before anything's relied on. Contingency is deliberately NOT
// here: it's generated separately, by risk_bulk_generate.py itself, once
// there's a real EMV total to base a % on — a contingency rate invented
// ahead of any actual risk assessment would be exactly the kind of
// unsupported number the PM Domain Accuracy rule exists to avoid.
export interface DefaultCostLine {
  element_type: 'percentage'
  rate: number
  element_group: string
  description: string
}

// No top-level "Prelims" percentage line (2026-07-27, per Maro's QS review)
// — Preliminaries is now a real, measured discipline bucket under
// Construction (schedule-generated site-mobilisation activities plus the
// reclassified Procurement coordination overhead, see
// scheduleGeneration.ts's CATEGORY_DISCIPLINE), not a guessed top-level %.
// A separate 12% on-cost on top of that would double-count the same
// preliminaries spend twice.
export const DEFAULT_COST_LINES: DefaultCostLine[] = [
  { element_type: 'percentage', rate: 0.05, element_group: 'On-Costs', description: 'Overhead' },
  { element_type: 'percentage', rate: 0.08, element_group: 'On-Costs', description: 'Design Fees' },
  { element_type: 'percentage', rate: 0.03, element_group: 'On-Costs', description: 'Inflation' },
]
