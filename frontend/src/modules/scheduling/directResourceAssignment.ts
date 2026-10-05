import type { Activity, Resource, ResourceAssignment } from './types'
import type { ResourceRecipeResource, ResourceRecipeAssignment } from '../fourD/scheduleGeneration'

// Deliberately conservative trade rules, not fuzzy matching on project-name words.
const trades: Record<string, RegExp> = {
  ground: /\b(excavat\w*|earthworks?|groundworks?|groundworkers?|site clearance|site strip|formation|capping)\b/,
  piling: /\b(pile(?! caps?\b)|piles|piling(?! platform\b)|cfa)\b/,
  concrete: /\b(concret\w*|formwork|rebar|reinforc\w*|pile caps?|ground beams?|slab pours?)\b/,
  steel: /\b(steel|metal deck\w*)\b/,
  facade: /\b(fa[cç]ade\w*|cladding|curtain wall\w*|glazing|glazed|rainscreen|sfs)\b/,
  roof: /\b(roof\w*|waterproof\w*|membrane)\b/,
  drylining: /\b(drylin\w*|partitions?|ceilings?|plasterboard)\b/,
  finishes: /\b(finishes|finishing|decorat\w*|paint\w*|flooring|floor finishes|tiling)\b/,
  mechanical: /\b(mechanical|duct\w*|ventilation|ahu\w*|heating|cooling|pipework|plumbing|medical gas\w*|domestic water)\b/,
  electrical: /\b(electrical|electrician\w*|lighting|cabling|switchboard|switchgear|fire alarm|ict|security|bms)\b/,
  commissioning: /\b(commission\w*|balancing|integrated testing)\b/,
}
const plant: Record<string, { resource: RegExp; task: RegExp }> = {
  excavator: { resource: /excavator/, task: /excavat|earthwork|site clearance|formation/ },
  dumper: { resource: /dumper/, task: /excavat|earthwork|site clearance/ },
  piling_rig: { resource: /piling rig|cfa.*rig/, task: /cfa|install.*piles|piling(?! platform)/ },
  crane: { resource: /crane/, task: /(?:erect.*steel|steel.*erect|lift.*plant|plant.*lift)/ },
}
const normal = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9ç]+/g, ' ').trim()
export function buildDirectAssignments(
  activities: Activity[], resources: Resource[], existing: ResourceAssignment[],
  recipe: { resources: ResourceRecipeResource[]; assignments: ResourceRecipeAssignment[] },
  links: { activity_id: string; source_kind: string; element_label: string }[] = [],
) {
  const assignments: { activity_id: string; resource_temp_id: string; utilisation_pct?: number; quantity?: number }[] = []
  const used = new Map<string, Resource>()
  const pairs = new Set(existing.map(a => `${a.activity_id}:${a.resource_id}`))
  const issues: string[] = []
  const recipeById = new Map(recipe.resources.map(r => [r.temp_id, r]))
  const recipesByActivity = new Map<string, ResourceRecipeAssignment[]>()
  for (const r of recipe.assignments) recipesByActivity.set(r.activity_id, [...(recipesByActivity.get(r.activity_id) ?? []), r])
  const labels = new Map<string, string[]>()
  for (const link of links) if (link.source_kind === 'ifc') {
    const list = labels.get(link.activity_id) ?? []
    if (list.length < 10) list.push(link.element_label)
    labels.set(link.activity_id, list)
  }
  const assigned = new Map<string, Resource[]>()
  const pool = new Map(resources.map(r => [r.id, r]))
  for (const a of existing) { const r = pool.get(a.resource_id); if (r) assigned.set(a.activity_id, [...(assigned.get(a.activity_id) ?? []), r]) }
  const add = (activity: Activity, resource: Resource, quantity?: number) => {
    const key = `${activity.id}:${resource.id}`
    if (pairs.has(key)) return
    pairs.add(key); used.set(resource.id, resource)
    assignments.push({ activity_id: activity.id, resource_temp_id: resource.id,
      ...(resource.resource_type === 'material' ? { quantity } : { utilisation_pct: 100 }) })
    assigned.set(activity.id, [...(assigned.get(activity.id) ?? []), resource])
  }
  const choose = (a: Activity, candidates: Resource[], slot: string, quantity?: number) => {
    if (candidates.length === 1) add(a, candidates[0], quantity)
    else if (candidates.length > 1) issues.push(`${a.task_name}: choose ${slot} (${candidates.map(r => r.name).join(', ')}).`)
  }
  for (const a of activities) {
    if (a.is_archived || a.activity_type !== 'task' || !(Number(a.duration_hours) > 0)) continue
    const text = normal(a.task_name)
    // Planning/ordering and tests should not acquire installation crews by noun alone.
    if (/\b(procure\w*|order\w*|design|approv\w*|manufactur\w*|curing|strength gain|inspection)\b/.test(text)) continue
    const before = assignments.length
    const exactSlots = new Set<string>()
    for (const r of recipesByActivity.get(a.id) ?? []) {
      const expected = recipeById.get(r.resource_temp_id)
      if (!expected) continue
      const candidates = resources.filter(p => normal(p.name) === normal(expected.name) && p.resource_type === expected.resource_type
        && (p.resource_type !== 'material' || (normal(p.unit) !== '' && normal(p.unit) === normal(expected.unit))))
      if (candidates.length) {
        if (expected.resource_type !== 'material' || (r.quantity != null && r.quantity > 0)) choose(a, candidates, expected.name, r.quantity)
        exactSlots.add(expected.resource_type)
      }
    }
    const evidence = Object.values(trades).some(rule => rule.test(text)) ? text
      : /\b(install|erect|construct)\b/.test(text) ? `${text} ${normal(a.schedule_category)} ${normal((labels.get(a.id) ?? []).join(' '))}` : text
    const commissioning = trades.commissioning.test(evidence)
    if (!exactSlots.has('crew')) {
      for (const [trade, rule] of Object.entries(trades)) {
        if (commissioning && trade !== 'commissioning') continue
        if (!rule.test(evidence)) continue
        const belongs = (r: Resource) => (r.resource_type === 'crew' || r.resource_type === 'labour') && rule.test(normal(`${r.name} ${r.role ?? ''} ${r.category ?? ''}`))
        if ((assigned.get(a.id) ?? []).some(belongs)) continue
        choose(a, resources.filter(belongs), `${trade} labour/crew`)
      }
    }
    if (!commissioning && !exactSlots.has('equipment')) for (const [name, rule] of Object.entries(plant)) {
      if (!rule.task.test(evidence)) continue
      const belongs = (r: Resource) => r.resource_type === 'equipment' && rule.resource.test(normal(r.name))
      if (!(assigned.get(a.id) ?? []).some(belongs)) choose(a, resources.filter(belongs), name)
    }
    if (!exactSlots.has('material') && a.schedule_material_name && Number(a.schedule_material_quantity) > 0) {
      choose(a, resources.filter(r => r.resource_type === 'material' && normal(r.name) === normal(a.schedule_material_name)
        && normal(r.unit) === normal(a.schedule_material_unit)), 'measured material', Number(a.schedule_material_quantity))
    }
    if (before === assignments.length && !(assigned.get(a.id)?.length)) issues.push(`${a.task_name}: no unambiguous resource match; review manually.`)
  }
  return { assignments, resources: [...used.values()].map(r => ({ temp_id: r.id, existing_id: r.id, name: r.name,
    resource_type: r.resource_type, unit: r.unit, rate: Number(r.rate), max_hours_per_day: Number(r.max_hours_per_day) })), issues: [...new Set(issues)] }
}
