import type { BatchedMesh, Mesh } from 'three'

// A paused animation and a manual Hide both have a say in the rendered result.
// Keep the animation verdict apart from the last value written to the mesh.
const hiddenBySchedule = new WeakSet<Mesh>()
const scheduledInstances = new WeakMap<BatchedMesh, Set<number>>()

export function updateMeshVisibility(mesh: Mesh, scheduleVisible?: boolean) {
  if (scheduleVisible === false) hiddenBySchedule.add(mesh)
  else if (scheduleVisible === true) hiddenBySchedule.delete(mesh)
  mesh.visible = mesh.userData.baseVisible !== false && !hiddenBySchedule.has(mesh)
}

export function updateInstanceVisibility(mesh: BatchedMesh, id: number, scheduleVisible?: boolean) {
  let hidden = scheduledInstances.get(mesh)
  if (scheduleVisible === false) {
    if (!hidden) scheduledInstances.set(mesh, hidden = new Set())
    hidden.add(id)
  } else if (scheduleVisible === true) hidden?.delete(id)
  const shown = mesh.userData.batchBaseVisibleByInstanceId?.get(id) !== false
    && !hidden?.has(id) && !mesh.userData.movingHidden?.has(id)
  if (mesh.getVisibleAt(id) !== shown) mesh.setVisibleAt(id, shown)
}
