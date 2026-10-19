import type { ExtractedElement } from './ifcScheduleExtraction'
import { CATEGORY_ORDER } from './scheduleCategoryOrder'
import type { CategoryGroup, StoreyGroup, StagedActivity, StagedRelationship } from './scheduleGeneration'

export interface TowerSequencing {
  coreLeadFloors: number
  facadeLagFloors: number
}

export function prepareTowerStoreys(
  storeys: StoreyGroup[], elements: ExtractedElement[], coreIds: Set<string>, levelMap: Record<string, string>,
): StoreyGroup[] {
  const names = new Set(storeys.map(s => s.storeyName))
  const byId = new Map(elements.map(e => [e.globalId, e]))
  const categoryById = new Map(storeys.flatMap(s => s.categories.flatMap(c => c.elementRefs.map(id => [id, c.name] as const))))
  if (!coreIds.size) throw new Error('Select the core walls before generating a tower sequence.')
  for (const id of coreIds) {
    if (!byId.get(id)?.ifcType.startsWith('IfcWall')) throw new Error('Core selections must be walls from this scan.')
    if (!['Walls', 'Non-Structural Walls'].includes(categoryById.get(id) ?? '')) throw new Error('Core walls must belong to a wall category. Review foundation/site classification before selecting them as core.')
  }
  const destination = (name: string) => {
    const visited = new Set<string>()
    while (levelMap[name] && levelMap[name] !== name) {
      if (visited.has(name)) throw new Error('Level mapping contains a loop. Map each intermediate level to a construction floor.')
      visited.add(name)
      name = levelMap[name]
      if (!names.has(name)) throw new Error('A mapped construction level is missing from this scan.')
    }
    return name
  }
  const grouped = new Map<string, CategoryGroup[]>()
  for (const storey of storeys) {
    const target = destination(storey.storeyName)
    const categories = grouped.get(target) ?? []
    grouped.set(target, categories)
    for (const category of storey.categories) {
      const selected = category.elementRefs.filter(id => coreIds.has(id))
      const remaining = category.elementRefs.filter(id => !coreIds.has(id))
      for (const [refs, core] of [[remaining, false], [selected, true]] as const) {
        if (!refs.length) continue
        const values = refs.map(id => byId.get(id)!)
        const item: CategoryGroup = {
          ...category, name: core ? 'Walls' : category.name, workstream: core ? 'core' : undefined,
          elementRefs: [...refs], elementLabels: refs.map(id => category.elementLabels[category.elementRefs.indexOf(id)]),
          // Only wall categories are split; all other quantity conventions stay unchanged.
          quantity: selected.length ? values.reduce((sum, el) => sum + el.quantity, 0) : category.quantity,
          materialVolumeM3: selected.length ? values.reduce((sum, el) => sum + (el.volumeM3 ?? 0), 0) : category.materialVolumeM3,
        }
        const existing = categories.find(c => c.name === item.name && c.workstream === item.workstream)
        if (existing) {
          existing.elementRefs.push(...item.elementRefs); existing.elementLabels.push(...item.elementLabels)
          existing.quantity += item.quantity; existing.materialVolumeM3 += item.materialVolumeM3
        } else categories.push(item)
      }
    }
  }
  const decomposed = new Set(elements.filter(e => e.facadeAssemblyId && e.globalId !== e.facadeAssemblyId).map(e => e.facadeAssemblyId))
  for (const categories of grouped.values()) for (const c of categories) {
    if (c.name !== 'Curtain Walls') continue
    const frameIds = c.elementRefs.filter(id => byId.get(id)?.ifcType === 'IfcMember')
    const glazingIds = c.elementRefs.filter(id => !frameIds.includes(id))
    const standalone = c.elementRefs.filter(id => byId.get(id)?.ifcType === 'IfcCurtainWall' && !decomposed.has(id)).length
    const labels = new Map(c.elementRefs.map((id, i) => [id, c.elementLabels[i]]))
    c.phaseWork = {
      frame: { quantity: frameIds.length + standalone, elementRefs: frameIds, elementLabels: frameIds.map(id => labels.get(id)!) },
      glaze: { quantity: glazingIds.filter(id => !decomposed.has(id)).length, elementRefs: glazingIds, elementLabels: glazingIds.map(id => labels.get(id)!) },
    }
    // Parent assemblies remain linked, but are not priced again as panels.
  }
  return storeys.filter(s => grouped.has(s.storeyName)).map(s => ({ storeyName: s.storeyName, categories: grouped.get(s.storeyName)!.sort((a, b) => CATEGORY_ORDER.indexOf(a.name as typeof CATEGORY_ORDER[number]) - CATEGORY_ORDER.indexOf(b.name as typeof CATEGORY_ORDER[number])) }))
}

const FRAME = new Set(['Piling', 'Foundation', 'Reinforcement', 'Columns', 'Beams', 'Slabs', 'Walls', 'Structural Members', 'Stairs', 'Ramps', 'Roofs'])
const FACADE = new Set(['Curtain Walls', 'Windows', 'Facade Ornamentation'])

/** Replace only the generated building-work links. Preserve procurement,
 * earthworks and commissioning, and never edit an existing saved schedule. */
export function sequenceTower(
  activities: StagedActivity[], original: StagedRelationship[], storeys: StoreyGroup[], options: TowerSequencing,
): StagedRelationship[] {
  for (const [name, n, min] of [['Core lead', options.coreLeadFloors, 1], ['Façade lag', options.facadeLagFloors, 0]] as const) {
    if (!Number.isInteger(n) || n < min || n > 20) throw new Error(`${name} must be a whole number between ${min} and 20 floors.`)
  }
  const byId = new Map(activities.map(a => [a.temp_id, a]))
  const building = new Set(activities.filter(a => /^wbs-storey-\d+$/.test(a.parent_temp_id ?? '') && a.category).map(a => a.temp_id))
  const links = original.filter(r => !(building.has(r.predecessor_temp_id) && building.has(r.successor_temp_id))
    && !(r.predecessor_temp_id === 'act-structure-complete-all-levels' && building.has(r.successor_temp_id)))
  const add = (from?: string, to?: string) => {
    if (from && to && from !== to && byId.has(from) && byId.has(to)) links.push({ predecessor_temp_id: from, successor_temp_id: to, relationship_type: 'FS', lag_hours: 0 })
  }
  const levels = storeys.map((s, index) => {
    const lanes = { core: [] as string[], frame: [] as string[], facade: [] as string[], inside: [] as string[], buried: [] as string[], site: [] as string[] }
    const foundation = s.categories.some(c => c.name === 'Foundation')
    s.categories.forEach((c, ci) => {
      const lane = c.workstream === 'core' ? 'core' : FRAME.has(c.name) ? 'frame' : FACADE.has(c.name) ? 'facade' : c.name === 'Site & Landscaping' ? 'site' : foundation && ['Mechanical Equipment', 'Ductwork', 'Piping', 'Electrical Containment'].includes(c.name) ? 'buried' : 'inside'
      lanes[lane].push(...activities.filter(a => a.temp_id.startsWith(`act-${index}-${ci}-`)).map(a => a.temp_id))
    })
    for (const lane of Object.values(lanes)) for (let i = 1; i < lane.length; i++) add(lane[i - 1], lane[i])
    return lanes
  })
  const structuralLevels = levels.filter(l => l.frame.length || l.core.length)
  for (const [i, level] of levels.entries()) {
    if (level.core.length && !level.frame.length) throw new Error(`Map ${storeys[i].storeyName} to its supporting construction floor: it has core walls but no floor/frame work.`)
  }
  const first = (a: string[]) => a[0]
  const last = (a: string[]) => a[a.length - 1]
  let previousCore: string | undefined, previousFrame: string | undefined, previousFacade: string | undefined
  for (const [index, level] of structuralLevels.entries()) {
    add(previousCore, first(level.core))
    add(previousFrame, first(level.frame))
    // Walls are lifts rising FROM their mapped floor; the next floor's
    // frame/slab needs the preceding lift, not the lift above itself.
    add(previousCore, first(level.frame))
    const supporting = structuralLevels.slice(0, Math.max(0, index - options.coreLeadFloors + 1) + 1).reverse().find(l => l.frame.length)
    add(supporting ? last(supporting.frame) : 'act-construction-start', first(level.core))
    previousCore = last(level.core) ?? previousCore
    previousFrame = last(level.frame) ?? previousFrame
    add(last(level.core), 'act-structure-complete-all-levels')
    add(last(level.frame), 'act-structure-complete-all-levels')
  }
  for (const level of levels) {
    const index = structuralLevels.indexOf(level)
    // An unassigned façade-only level must be explicitly mapped, not guessed.
    if (index < 0 && (level.facade.length || level.inside.length)) throw new Error('Map façade/interior-only levels to a construction floor before using tower sequencing.')
    const ready = structuralLevels[Math.min(index + options.facadeLagFloors, structuralLevels.length - 1)]
    add(ready && (last(ready.frame) ?? last(ready.core)), first(level.facade))
    add(previousFacade, first(level.facade))
    previousFacade = last(level.facade) ?? previousFacade
    const above = structuralLevels[Math.min(index + 1, structuralLevels.length - 1)]
    add(above && (last(above.frame) ?? last(above.core)), first(level.inside))
    add(last(level.facade), first(level.inside))
    // Preserve the existing substructure rule: buried services precede
    // the slab above, whereas ordinary first fix follows its soffit.
    add(last(level.frame), first(level.buried))
    add(last(level.core), first(level.buried))
    const levelIndex = levels.indexOf(level)
    const nextSlab = activities.find(a => a.category === 'Slabs' && Number(a.parent_temp_id?.replace('wbs-storey-', '')) > levelIndex)
    add(last(level.buried), nextSlab?.temp_id)
    for (const lane of Object.values(level)) add(last(lane), 'act-substantial-completion')
    for (const lane of [level.core, level.frame, level.facade, level.inside, level.buried]) add(last(lane), 'act-all-building-work-complete')
  }
  // Fail closed rather than dropping a tower dependency to disguise a cycle.
  const unique = [...new Map(links.map(r => [`${r.predecessor_temp_id}:${r.successor_temp_id}`, r])).values()]
  const incoming = new Map(activities.map(a => [a.temp_id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const r of unique) {
    incoming.set(r.successor_temp_id, (incoming.get(r.successor_temp_id) ?? 0) + 1)
    outgoing.set(r.predecessor_temp_id, [...(outgoing.get(r.predecessor_temp_id) ?? []), r.successor_temp_id])
  }
  const queue = [...incoming].filter(([, n]) => n === 0).map(([id]) => id)
  for (let i = 0; i < queue.length; i++) for (const to of outgoing.get(queue[i]) ?? []) {
    incoming.set(to, incoming.get(to)! - 1)
    if (incoming.get(to) === 0) queue.push(to)
  }
  if (queue.length !== activities.length) throw new Error('Tower dependencies conflict with this level mapping. Review the core and construction floors; no schedule has been saved.')
  return unique
}
