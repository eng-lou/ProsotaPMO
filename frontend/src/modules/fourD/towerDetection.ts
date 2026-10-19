import type { ExtractedElement } from './ifcScheduleExtraction'
import type { StoreyGroup } from './scheduleGeneration'

export interface TowerSuggestion { id: string; reason: string }
export interface TowerDetection {
  coreIds: string[]; facadeIds: string[]; uncertain: TowerSuggestion[]
  levelMap: Record<string, string>; frameLevelMap: Record<string, string>; facadeLevels: Record<string, string>
}
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0
const valid = (e: ExtractedElement) => [...e.boxMinMetres, ...e.boxMaxMetres].every(Number.isFinite)

/** Conservative proposals: geometry alone never reclassifies exterior bracing. */
export function detectTowerGroups(elements: ExtractedElement[], storeys: StoreyGroup[]): TowerDetection {
  const result: TowerDetection = { coreIds: [], facadeIds: [], uncertain: [], levelMap: {}, frameLevelMap: {}, facadeLevels: {} }
  const geometry = elements.filter(valid)
  const samples = geometry.filter(e => e.storeyElevation !== null)
  let axis = 2, spread = Infinity, offset = 0
  for (let a = 0; a < 3; a++) {
    const deltas = samples.map(e => e.boxMinMetres[a] - e.storeyElevation!)
    const centre = median(deltas), deviation = median(deltas.map(d => Math.abs(d - centre)))
    if (deviation < spread) { axis = a; spread = deviation; offset = centre }
  }
  const planar = [0, 1, 2].filter(a => a !== axis)
  const anchors = geometry.filter(e => e.category === 'Stairs' || e.category === 'Elevators' || /lift.?shaft|elevator.?shaft|stair.?well/i.test(e.name))
  const walls = geometry.filter(e => e.ifcType.startsWith('IfcWall') && ['Walls', 'Non-Structural Walls'].includes(e.category))
  const nearPlan = (a: ExtractedElement, b: ExtractedElement, margin: number) => planar.every(d => a.boxMinMetres[d] <= b.boxMaxMetres[d] + margin && a.boxMaxMetres[d] >= b.boxMinMetres[d] - margin)
  const wallBins = new Map<string, ExtractedElement[]>()
  const centre = (e: ExtractedElement, d: number) => (e.boxMinMetres[d] + e.boxMaxMetres[d]) / 2
  for (const wall of walls) {
    const key = planar.map(d => Math.floor(centre(wall, d))).join(':')
    const bin = wallBins.get(key) ?? []; bin.push(wall); wallBins.set(key, bin)
  }
  for (const wall of walls) {
    const named = /\bcore\b|lift.?shaft|elevator.?shaft|stair.?well/i.test(wall.name)
    const nearStair = anchors.some(a => nearPlan(wall, a, 0.8) && wall.boxMinMetres[axis] <= a.boxMaxMetres[axis] + 1 && wall.boxMaxMetres[axis] >= a.boxMinMetres[axis] - 1)
    const neighbours: ExtractedElement[] = []
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      for (const w of wallBins.get(`${Math.floor(centre(wall, planar[0])) + x}:${Math.floor(centre(wall, planar[1])) + y}`) ?? []) neighbours.push(w)
    }
    const repeated = neighbours.some(w => w.globalId !== wall.globalId && Math.abs(w.boxMinMetres[axis] - wall.boxMinMetres[axis]) > 1.5 && nearPlan(w, wall, 0.25) && planar.every(d => Math.abs((w.boxMinMetres[d] + w.boxMaxMetres[d]) - (wall.boxMinMetres[d] + wall.boxMaxMetres[d])) < 1))
    if (named || (samples.length > 2 && spread < 2 && nearStair && repeated)) result.coreIds.push(wall.globalId)
    else if (nearStair) result.uncertain.push({ id: wall.globalId, reason: 'Near vertical circulation; core role needs review' })
  }
  const slabs = geometry.filter(e => e.category === 'Slabs')
  for (const e of elements) {
    if (['Curtain Walls', 'Windows', 'Facade Ornamentation'].includes(e.category)) { result.facadeIds.push(e.globalId); continue }
    if (!valid(e) || result.coreIds.includes(e.globalId) || !['Walls', 'Non-Structural Walls', 'Structural Members', 'Coverings'].includes(e.category)) continue
    const nearby = slabs.filter(s => s.boxMaxMetres[axis] >= e.boxMinMetres[axis] - 1 && s.boxMinMetres[axis] <= e.boxMaxMetres[axis] + 1)
    if (!nearby.length) continue
    const perimeter = planar.some(d => {
      const low = Math.min(...nearby.map(s => s.boxMinMetres[d])), high = Math.max(...nearby.map(s => s.boxMaxMetres[d]))
      const centre = (e.boxMinMetres[d] + e.boxMaxMetres[d]) / 2
      return Math.min(Math.abs(centre - low), Math.abs(centre - high)) < 1.5
    })
    if (perimeter || /diagrid|lattice|screen|brac|fa[cç]ade|cladding/i.test(e.name)) result.uncertain.push({ id: e.globalId, reason: 'Exterior element: confirm façade/screening or retain structural role' })
  }
  // Use actual floor/frame groups, not intermediate authoring-level names.
  const slabFloors = storeys.filter(s => s.categories.some(c => ['Slabs', 'Foundation', 'Piling', 'Roofs'].includes(c.name)))
  const floors = slabFloors.length > 1 ? slabFloors : storeys.filter(s => s.categories.some(c => ['Slabs', 'Foundation', 'Piling', 'Columns', 'Beams', 'Roofs'].includes(c.name)))
  if (floors.length) {
    let below = floors[0].storeyName
    for (const s of storeys) {
      if (floors.some(f => f.storeyName === s.storeyName)) below = s.storeyName
      else {
        result.levelMap[s.storeyName] = below
        const above = storeys.slice(storeys.indexOf(s) + 1).find(s => floors.some(f => f.storeyName === s.storeyName))
        if (above) result.frameLevelMap[s.storeyName] = above.storeyName
      }
    }
  }
  const byId = new Map(elements.map(e => [e.globalId, e]))
  const elevations = floors.map(s => ({ name: s.storeyName, elevation: median(s.categories.flatMap(c => c.elementRefs.map(id => byId.get(id)?.storeyElevation).filter((v): v is number => v != null))) }))
  if (spread < 2) for (const e of geometry) {
    // Whole multi-storey screens wait for their highest supporting floor.
    if (e.boxMaxMetres[axis] - e.boxMinMetres[axis] < 4.5) continue
    const support = elevations.filter(f => f.elevation <= e.boxMaxMetres[axis] - offset + 0.3).slice(-1)[0]
    if (support) result.facadeLevels[e.globalId] = support.name
  }
  result.uncertain = [...new Map(result.uncertain.map(s => [s.id, s])).values()]
  return result
}
