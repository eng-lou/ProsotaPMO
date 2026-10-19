import type { ExtractedElement } from './ifcScheduleExtraction'
import type { StagedActivity, StagedSchedule } from './scheduleGeneration'

export function modelInventory(elements: ExtractedElement[]) {
  const groups = new Map<string, { id: string; level: string; type: string; category: string; material: string; elements: ExtractedElement[] }>()
  for (const e of elements) {
    const key = JSON.stringify([e.sourceModelId, e.storeyName, e.ifcType, e.category, e.material])
    if (!groups.has(key)) groups.set(key, { id: `g${groups.size + 1}`, level: e.storeyName, type: e.ifcType, category: e.category, material: e.material, elements: [] })
    groups.get(key)!.elements.push(e)
  }
  return [...groups.values()]
}
export type Inventory = ReturnType<typeof modelInventory>

export function inventorySummary(groups: Inventory) {
  return groups.map(({ elements, ...group }) => ({
    ...group, model_id: elements[0].sourceModelId, count: elements.length,
    elevation_metres: elements[0].storeyElevation,
    samples: elements.slice(0, 4).map(e => ({ element_key: `${e.sourceModelId}:${e.expressID}`, name: e.name.slice(0, 150), min_metres: e.boxMinMetres, max_metres: e.boxMaxMetres })),
  }))
}

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid draft object.')
  return v as Record<string, unknown>
}
const string = (v: unknown, max = 500): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error('Missing or oversized draft text.')
  return v.trim()
}
const array = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw new Error('Invalid or oversized draft list.')
  return v
}
const hours = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 8000) throw new Error('Hours must be between 0 and 8,000.')
  return v
}
function acyclic(ids: Set<string>, edges: [string, string][]) {
  const incoming = new Map([...ids].map(id => [id, 0]))
  const next = new Map<string, string[]>()
  for (const [from, to] of edges) {
    if (!ids.has(from) || !ids.has(to)) throw new Error('Draft references an unknown activity.')
    incoming.set(to, incoming.get(to)! + 1)
    next.set(from, [...(next.get(from) ?? []), to])
  }
  const queue = [...ids].filter(id => !incoming.get(id))
  let visited = 0
  while (queue.length) {
    const id = queue.pop()!; visited++
    for (const to of next.get(id) ?? []) { incoming.set(to, incoming.get(to)! - 1); if (!incoming.get(to)) queue.push(to) }
  }
  if (visited !== ids.size) throw new Error('Draft contains a circular hierarchy or dependency. Ask Poe to revise it.')
}

// Resolve the AI's references against the captured scan, never trust supplied GUIDs.
// The returned payload uses the same transactional save endpoint as Standard/Tower.
export function validatePoeSchedule(raw: unknown, groups: Inventory, context: { projectId: string; schedulePeriodId: string; calendarId: string | null; rootName: string }) {
  const draft = object(raw)
  const rationale = string(draft.rationale, 8000)
  const assumptions = array(draft.assumptions, 50).map(v => string(v, 2000))
  const byGroup = new Map(groups.map(g => [g.id, g.elements]))
  const all = groups.flatMap(g => g.elements)
  const byKey = new Map(all.map(e => [`${e.sourceModelId}:${e.expressID}`, e]))
  if (new Set(all.map(e => e.globalId)).size !== all.length) throw new Error('The selected models contain duplicate IFC GlobalIds. Select a single model or resolve duplicates before AI generation.')
  const used = new Set<string>()
  const ids = new Set<string>(['poe-root'])
  const activities: StagedActivity[] = array(draft.activities, 400).map(value => {
    const a = object(value)
    const id = string(a.temp_id, 80)
    if (ids.has(id)) throw new Error('Duplicate activity identifier in draft.')
    ids.add(id)
    const linked = new Map<string, ExtractedElement>()
    for (const group of array(a.group_ids, groups.length)) {
      const members = byGroup.get(string(group, 80))
      if (!members) throw new Error('Draft references an unknown model group.')
      members.forEach(e => linked.set(e.globalId, e))
    }
    for (const key of array(a.element_keys ?? [], all.length)) {
      const e = byKey.get(string(key, 80))
      if (!e) throw new Error('Draft references an element outside the selected scan.')
      linked.set(e.globalId, e)
    }
    for (const guid of linked.keys()) {
      if (used.has(guid)) throw new Error('An IFC element is assigned to more than one completion activity.')
      used.add(guid)
    }
    const members = [...linked.values()]
    const categories = new Set(members.map(e => e.category))
    return { temp_id: id, task_name: string(a.task_name), parent_temp_id: a.parent_temp_id ? string(a.parent_temp_id, 80) : 'poe-root', duration_hours: hours(a.duration_hours), element_refs: [...linked.keys()], element_labels: members.map(e => e.name), category: categories.size === 1 ? members[0].category : null, phase_key: null, quantity: null, activity_type: 'task', discipline: null }
  })
  if (!activities.length) throw new Error('Poe returned no activities.')
  const parents = new Set(activities.map(a => a.parent_temp_id))
  for (const a of activities) if (parents.has(a.temp_id) && (a.element_refs.length || a.duration_hours)) throw new Error('Summary activities must have zero duration and no element links.')
  acyclic(ids, activities.map(a => [a.parent_temp_id!, a.temp_id]))
  const relationships = array(draft.relationships, 2000).map(value => {
    const r = object(value)
    const from = string(r.predecessor_temp_id, 80), to = string(r.successor_temp_id, 80)
    if (parents.has(from) || parents.has(to) || from === 'poe-root' || to === 'poe-root') throw new Error('Dependencies must connect work activities, not WBS summaries.')
    return { predecessor_temp_id: from, successor_temp_id: to, relationship_type: 'FS' as const, lag_hours: hours(r.lag_hours ?? 0) }
  })
  acyclic(ids, relationships.map(r => [r.predecessor_temp_id, r.successor_temp_id]))
  activities.unshift({ temp_id: 'poe-root', task_name: context.rootName, parent_temp_id: null, duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null })
  const staged: StagedSchedule = { project_id: context.projectId, schedule_period_id: context.schedulePeriodId, calendar_id: context.calendarId, activities, relationships, resources: [], assignments: [] }
  return { staged, rationale, assumptions, linked: used.size, unassigned: all.filter(e => !used.has(e.globalId)) }
}
