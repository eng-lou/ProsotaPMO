import type { BatchedMesh, DataTexture } from 'three'

const revisions = new WeakMap<BatchedMesh, { visibility: number }>()

// Visibility has no public version in Three r169; _visibilityChanged is reset
// by rendering. Observe the public mutators on this mesh so dependent layers
// can skip unchanged frames, even after Three has consumed the change.
export function batchVisibilityRevision(mesh: BatchedMesh): number {
  let revision = revisions.get(mesh)
  if (!revision) {
    revision = { visibility: 0 }
    revisions.set(mesh, revision)
    const state = revision
    const setVisible = mesh.setVisibleAt
    mesh.setVisibleAt = function (id, visible) {
      const changed = this.getVisibleAt(id) !== visible
      const result = setVisible.call(this, id, visible)
      if (changed) state.visibility++
      return result
    }
    const add = mesh.addInstance
    mesh.addInstance = function (geometryId) {
      const result = add.call(this, geometryId)
      state.visibility++
      return result
    }
    const remove = mesh.deleteInstance
    mesh.deleteInstance = function (id) {
      const result = remove.call(this, id)
      state.visibility++
      return result
    }
  }
  return revision.visibility
}

type TextureBatch = BatchedMesh & { _matricesTexture: DataTexture; _colorsTexture: DataTexture | null }
export function batchContentKey(mesh: BatchedMesh): string {
  const batch = mesh as TextureBatch
  return `${batchVisibilityRevision(mesh)}:${batch._matricesTexture.id}:${batch._matricesTexture.version}:${batch._colorsTexture?.id}:${batch._colorsTexture?.version}`
}
