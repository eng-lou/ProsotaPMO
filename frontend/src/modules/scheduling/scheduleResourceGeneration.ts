import type { Activity, Resource } from './types'
import { buildResourceRecipe, type ResourceRecipeResource, type ResourceRecipeAssignment } from '../fourD/scheduleGeneration'
import { isResourceTask, needsManualResourcePlanning, resourceEvidence, suggestedTrades, matchesTrade, trades, plant, normaliseResourceText as normal } from './scheduleResourceRules'

export type SuggestedResource = ResourceRecipeResource & { existing_id?: string; max_hours_per_day?: number }

/** Populate a reviewable pool without assigning it or inventing material quantities.
 * IFC recipes stay authoritative; ordinary schedules use conservative work descriptions.
 * Existing pool IDs/rates are retained, and ambiguous choices remain with the user. */
export function buildScheduleResourcePlan(activities: Activity[], pool: Resource[],
  links: { activity_id: string; source_kind: string; element_label: string }[] = []) {
  const eligible = activities.filter(isResourceTask)
  const recipe = buildResourceRecipe(eligible.map(a => ({
    ...a,
    schedule_material_quantity: a.schedule_material_quantity != null ? Number(a.schedule_material_quantity) : null,
    schedule_material_cost_per_unit: a.schedule_material_cost_per_unit != null ? Number(a.schedule_material_cost_per_unit) : null,
  })))
  const resources: SuggestedResource[] = []
  const assignments: ResourceRecipeAssignment[] = []
  const issues: string[] = []
  const resourceIds = new Map<string, string>()
  const add = (a: Activity, suggestion: ResourceRecipeResource, candidates: Resource[], quantity?: number) => {
    if (candidates.length > 1) {
      issues.push(`${a.task_name}: choose ${suggestion.name} (${candidates.map(r => r.name).join(', ')}).`)
      return
    }
    const existing = candidates[0]
    // The bulk endpoint deduplicates by name. Never silently reuse an incompatible type/unit.
    if (!existing && pool.some(r => normal(r.name) === normal(suggestion.name))) {
      issues.push(`${a.task_name}: ${suggestion.name} already exists with a different type or unit; review the pool.`)
      return
    }
    if (!existing && resources.some(r => normal(r.name) === normal(suggestion.name)
      && (r.resource_type !== suggestion.resource_type || normal(r.unit) !== normal(suggestion.unit)))) {
      issues.push(`${a.task_name}: ${suggestion.name} has conflicting types or units; review the pool.`)
      return
    }
    const key = existing ? `id:${existing.id}` : `${suggestion.resource_type}:${normal(suggestion.name)}:${normal(suggestion.unit)}`
    let id = resourceIds.get(key)
    if (!id) {
      id = `suggestion-${resources.length}`
      resourceIds.set(key, id)
      resources.push(existing ? { temp_id: id, existing_id: existing.id, name: existing.name,
        resource_type: existing.resource_type as ResourceRecipeResource['resource_type'], unit: existing.unit,
        rate: Number(existing.rate), max_hours_per_day: Number(existing.max_hours_per_day) } : { ...suggestion, temp_id: id })
    }
    if (!assignments.some(r => r.activity_id === a.id && r.resource_temp_id === id)) assignments.push({ activity_id: a.id, resource_temp_id: id,
      ...(suggestion.resource_type === 'material' ? { quantity } : { utilisation_pct: 100 }) })
  }
  const exactCandidates = (r: ResourceRecipeResource) => pool.filter(p => normal(p.name) === normal(r.name)
    && p.resource_type === r.resource_type && (p.resource_type !== 'material' || (normal(p.unit) && normal(p.unit) === normal(r.unit))))
  const recipeMap = new Map(recipe.resources.map(r => [r.temp_id, r]))
  const byActivity = new Map<string, ResourceRecipeAssignment[]>()
  for (const assignment of recipe.assignments) byActivity.set(assignment.activity_id, [...(byActivity.get(assignment.activity_id) ?? []), assignment])
  const labels = new Map<string, string[]>()
  for (const link of links) if (link.source_kind === 'ifc') {
    const list = labels.get(link.activity_id) ?? []
    if (list.length < 10) list.push(link.element_label)
    labels.set(link.activity_id, list)
  }
  for (const a of eligible) {
    if (needsManualResourcePlanning(a)) {
      issues.push(`${a.task_name}: planning, procurement or review work; add its resources manually.`)
      continue
    }
    const exact = byActivity.get(a.id) ?? []
    if (exact.length) {
      for (const assignment of exact) {
        const r = recipeMap.get(assignment.resource_temp_id)!
        if (r.resource_type === 'material' && !(Number(assignment.quantity) > 0)) continue
        add(a, r, exactCandidates(r), assignment.quantity)
      }
      continue
    }
    const evidence = resourceEvidence(a, labels.get(a.id))
    const matched = suggestedTrades(evidence)
    const before = assignments.length
    for (const trade of matched) {
      add(a, { temp_id: '', name: trades[trade].name, resource_type: 'crew', unit: 'day', rate: 0 }, pool.filter(r => matchesTrade(r, trade)))
    }
    if (!matched.includes('commissioning')) for (const rule of Object.values(plant)) {
      if (rule.task.test(evidence)) add(a, { temp_id: '', name: rule.name, resource_type: 'equipment', unit: 'day', rate: 0 },
        pool.filter(r => r.resource_type === 'equipment' && rule.resource.test(normal(r.name))))
    }
    if (a.schedule_material_name && normal(a.schedule_material_unit) && Number(a.schedule_material_quantity) > 0) {
      const material: ResourceRecipeResource = { temp_id: '', name: a.schedule_material_name, resource_type: 'material',
        unit: a.schedule_material_unit!, rate: Number(a.schedule_material_cost_per_unit) || 0 }
      add(a, material, exactCandidates(material), Number(a.schedule_material_quantity))
    }
    if (before === assignments.length) issues.push(`${a.task_name}: no clear suggestion; review its resources manually.`)
  }
  return { resources, assignments, issues: [...new Set(issues)] }
}
