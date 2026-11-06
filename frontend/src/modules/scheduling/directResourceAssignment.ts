import type { Activity, Resource, ResourceAssignment } from './types'
import type { ResourceRecipeResource, ResourceRecipeAssignment } from '../fourD/scheduleGeneration'

import { normaliseResourceText as normal, plant, isResourceTask, needsManualResourcePlanning, resourceEvidence, suggestedTrades, matchesTrade } from './scheduleResourceRules'

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
    if (!isResourceTask(a) || needsManualResourcePlanning(a)) continue
    const before = assignments.length
    const exactSlots = new Set<string>()
    for (const r of recipesByActivity.get(a.id) ?? []) {
      const expected = recipeById.get(r.resource_temp_id)
      if (!expected) continue
      const candidates = resources.filter(p => normal(p.name) === normal(expected.name) && p.resource_type === expected.resource_type
        && (p.resource_type !== 'material' || (normal(p.unit) !== '' && normal(p.unit) === normal(expected.unit))))
      if (candidates.length) {
        if (expected.resource_type !== 'material' || (r.quantity != null && r.quantity > 0)) choose(a, candidates, expected.name, r.quantity)
        exactSlots.add(expected.resource_type === 'labour' ? 'crew' : expected.resource_type)
      }
    }
    const evidence = resourceEvidence(a, labels.get(a.id))
    const matchedTrades = suggestedTrades(evidence)
    const commissioning = matchedTrades.includes('commissioning')
    if (!exactSlots.has('crew')) {
      for (const trade of matchedTrades) {
        const belongs = (r: Resource) => matchesTrade(r, trade)
        if ((assigned.get(a.id) ?? []).some(belongs)) continue
        choose(a, resources.filter(belongs), `${trade} labour/crew`)
      }
    }
    if (!commissioning && !exactSlots.has('equipment')) for (const [name, rule] of Object.entries(plant)) {
      if (!rule.task.test(evidence)) continue
      const belongs = (r: Resource) => r.resource_type === 'equipment' && rule.resource.test(normal(r.name))
      if (!(assigned.get(a.id) ?? []).some(belongs)) choose(a, resources.filter(belongs), name)
    }
    if (!exactSlots.has('material') && a.schedule_material_name && normal(a.schedule_material_unit) && Number(a.schedule_material_quantity) > 0) {
      choose(a, resources.filter(r => r.resource_type === 'material' && normal(r.name) === normal(a.schedule_material_name)
        && normal(r.unit) === normal(a.schedule_material_unit)), 'measured material', Number(a.schedule_material_quantity))
    }
    if (before === assignments.length && !(assigned.get(a.id)?.length)) issues.push(`${a.task_name}: no unambiguous resource match; review manually.`)
  }
  return { assignments, resources: [...used.values()].map(r => ({ temp_id: r.id, existing_id: r.id, name: r.name,
    resource_type: r.resource_type, unit: r.unit, rate: Number(r.rate), max_hours_per_day: Number(r.max_hours_per_day) })), issues: [...new Set(issues)] }
}
