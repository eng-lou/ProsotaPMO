import type { Activity, Resource } from './types'

// Shared by pool generation and assignment: a generated suggestion must be
// recognisable by the assignment shortcut, even after its rate is edited.
export const normaliseResourceText = (s: string | null | undefined) =>
  (s ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9ç]+/g, ' ').trim()

export const trades: Record<string, { name: string; pattern: RegExp }> = {
  ground: { name: 'Groundworks crew', pattern: /\b(excavat\w*|earthworks?|groundworks?|groundworkers?|site clearance|site strip|strip topsoil|cut fill|backfill|subbase|formation|capping)\b/ },
  piling: { name: 'Piling crew', pattern: /\b(pile(?! caps?\b)|piles|piling(?! platform\b)|cfa)\b/ },
  concrete: { name: 'Concrete crew', pattern: /\b(concret\w*|formwork|rebar|reinforc\w*|footings?|pile caps?|grade beams?|ground beams?|slab pours?)\b/ },
  steel: { name: 'Steel erection crew', pattern: /\b(steel|metal deck\w*|roof trusses)\b/ },
  facade: { name: 'Facade crew', pattern: /\b(fa[cç]ade\w*|cladding|curtain wall\w*|glazing|glazed|rainscreen|sfs|wall panels)\b/ },
  roof: { name: 'Roofing crew', pattern: /\b(roofing|roof deck|roof installation|waterproof\w*|membrane|weatherproof\w*)\b/ },
  drylining: { name: 'Drylining crew', pattern: /\b(drylin\w*|partitions?|ceilings?|plasterboard)\b/ },
  finishes: { name: 'Finishes crew', pattern: /\b(finishes|finishing|decorat\w*|paint\w*|flooring|floor finishes|raised floor|tiling)\b/ },
  drainage: { name: 'Drainage crew', pattern: /\b(drainage|sewer\w*|fire water mains)\b/ },
  landscape: { name: 'Landscaping crew', pattern: /\b(landscap\w*|turf|planting|soft landscape)\b/ },
  mechanical: { name: 'Mechanical crew', pattern: /\b(mechanical|ducts?|ductwork|ventilation|ahu\w*|hvac|heating|cooling|chilled water|chw|chillers?|pumps?|pipework|plumbing|medical gas\w*|domestic water|crah|cdu)\b/ },
  electrical: { name: 'Electrical crew', pattern: /\b(electrical|electrician\w*|lighting|cabling|switchboard|switchgear|transformers?|generators?|ups|batteries|busway|fiber|telecom|fire alarm|ict|security|bms)\b/ },
  commissioning: { name: 'Commissioning crew', pattern: /\b(commission\w*|balancing|integrated testing|functional tests?|system tests?|pressure test|flush|energization|startup|failures? scenarios?|loadbanks?)\b/ },
}

export const plant: Record<string, { name: string; resource: RegExp; task: RegExp }> = {
  excavator: { name: 'Excavator', resource: /excavator/, task: /excavat|earthwork|site clearance|formation|cut fill/ },
  dumper: { name: 'Dumper', resource: /dumper/, task: /excavat|earthwork|site clearance|cut fill/ },
  piling_rig: { name: 'Piling rig', resource: /piling rig|cfa.*rig/, task: /cfa|install.*piles|piling(?! platform)/ },
  crane: { name: 'Crane', resource: /crane/, task: /(?:erect.*steel|steel.*erect|lift.*plant|plant.*lift|(?:set|lift) (?:primary )?(?:transformers?|chillers?|pumps?))/ },
}

export function isResourceTask(a: Activity) {
  return !a.is_archived && a.activity_type === 'task' && Number(a.duration_hours) > 0
}

export function needsManualResourcePlanning(a: Activity) {
  const text = normaliseResourceText(a.task_name)
  if (/\b(procure\w*|order\w*|design|approv\w*|manufactur\w*|curing|cure|strength gain|factory acceptance)\b/.test(text)) return true
  // An inspection alone is different from "Formwork, rebar and inspection".
  return /\b(inspections?|handover|acceptance)\b/.test(text)
    && !/\b(install\w*|cast|formwork|rebar|construct\w*|pour\w*)\b/.test(text)
}

export function resourceEvidence(a: Activity, labels: string[] = []) {
  const text = normaliseResourceText(a.task_name)
  return Object.values(trades).some(rule => rule.pattern.test(text)) ? text
    : /\b(install|erect|construct)\b/.test(text)
      ? `${text} ${normaliseResourceText(a.schedule_category)} ${normaliseResourceText(labels.join(' '))}` : text
}

export function suggestedTrades(evidence: string) {
  if (trades.commissioning.pattern.test(evidence)) return ['commissioning']
  // The work being done matters more than the system it will eventually support.
  // "Electrical yard foundations" is concrete work, not electrical installation.
  if (/\b(foundations?|equipment pads?)\b/.test(evidence)) {
    if (trades.ground.pattern.test(evidence)) return ['ground']
    if (trades.piling.pattern.test(evidence)) return ['piling']
    return ['concrete']
  }
  return Object.entries(trades).filter(([, rule]) => rule.pattern.test(evidence)).map(([key]) => key)
}

export function matchesTrade(r: Resource, trade: string) {
  return (r.resource_type === 'crew' || r.resource_type === 'labour')
    && trades[trade].pattern.test(normaliseResourceText(`${r.name} ${r.role ?? ''} ${r.category ?? ''}`))
}
