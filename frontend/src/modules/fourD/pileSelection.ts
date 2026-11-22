import { Box3, type Object3D } from 'three'
import { getExpressIdWorldBounds } from './elementBatching'

type SceneObject = {id: string; kind: string; object: Object3D}

export function selectedPileBounds(
  machineId: string,
  selected: ReadonlySet<string>,
  ifcElements: ReadonlyMap<string, ReadonlySet<number>>,
  objects: readonly SceneObject[],
): Box3 {
  const targets = [...selected].filter(id => id !== 'site:' + machineId)
  if (targets.length !== 1) throw Error('Ctrl/Cmd-click one pile or marker alongside the rig.')
  const target = objects.find(o => o.id === targets[0])
  if (!target) throw Error('Wait for the selected pile or marker to load.')
  target.object.updateWorldMatrix(true, false)
  let bounds: Box3 | null
  if (target.kind === 'ifc') {
    // The IFC model is also selected when a single element is picked in the viewport.
    const elements = ifcElements.get(target.id)
    if (elements?.size !== 1) throw Error('Choose exactly one IFC pile or marker in this model.')
    bounds = getExpressIdWorldBounds(target.object, [...elements][0])
  } else if (target.kind === 'mesh') {
    bounds = new Box3().setFromObject(target.object)
  } else {
    throw Error('Choose an IFC element, a mesh or a site marker.')
  }
  if (!bounds || bounds.isEmpty()) throw Error('The selected pile or marker has no geometry to measure.')
  return bounds
}
