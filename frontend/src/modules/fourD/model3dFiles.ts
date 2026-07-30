import { api } from '@/lib/api'
import type { UpAxis } from './upAxis'

export type Model3DKind = 'ifc' | 'mesh'

// "Unload Selected"/"Reload IFC" (2026-07-26, per Maro: "if i refresh, i
// expect the elements i unloaded to stay unloaded... give me an option to
// reload ifc which can identify the elements unloaded") — guid is the
// GlobalId (matches ModelElementLink.element_ref's own convention: stable
// across a fresh re-parse of the same file, unlike expressID). name/
// type_name are captured once at unload time so the "Reload IFC" picker can
// show a real list without re-parsing the file.
export interface UnloadedElementInfo {
  guid: string
  name: string
  type_name: string
}

export interface Model3DFile {
  id: string
  project_id: string
  name: string
  kind: Model3DKind
  source_up_axis: UpAxis
  size_bytes: number
  created_at: string
  updated_at: string
  // Nullable at the backend (see model3d_file.py's own schema comment) — a
  // fresh import has never had anything unloaded yet.
  unloaded_elements: UnloadedElementInfo[] | null
}

// Frontend for model3d_file.py's backend (2026-07-09, per Maro: "keep the
// models and associated data similar to the persistent data in Schedule. so
// i dont have to repeat my actions import again") — unlike
// modelElementLinks.ts's element_ref (a bare filename/GlobalId, since that
// backend never stores the file itself), this one actually round-trips the
// raw bytes: upload on import, download on restore, delete on unload. See
// backend/app/models/model3d_file.py's own header for the local-disk
// storage design (Maro's explicit choice over cloud object storage).
export async function listModel3DFiles(projectId: string): Promise<Model3DFile[]> {
  const res = await api.get<Model3DFile[]>('/api/v1/model3d-files/', { params: { project_id: projectId } })
  return res.data
}

// onProgress (2026-07-28, per Maro: "show a percentage save") — axios' own
// onUploadProgress, a real byte-count-based percentage of this specific
// upload, not a guess. Optional so every other caller (there are none yet,
// but this mirrors downloadModel3DFile's own plain-Promise shape) doesn't
// need to pass one.
export async function uploadModel3DFile(
  projectId: string, name: string, kind: Model3DKind, sourceUpAxis: UpAxis, file: Blob,
  onProgress?: (percent: number) => void,
): Promise<Model3DFile> {
  const form = new FormData()
  form.append('project_id', projectId)
  form.append('name', name)
  form.append('kind', kind)
  form.append('source_up_axis', sourceUpAxis)
  form.append('file', file, name)
  const res = await api.post<Model3DFile>('/api/v1/model3d-files/', form, {
    onUploadProgress: onProgress
      ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)) }
      : undefined,
  })
  return res.data
}

export async function downloadModel3DFile(fileId: string): Promise<Blob> {
  const res = await api.get<Blob>(`/api/v1/model3d-files/${fileId}/download`, { responseType: 'blob' })
  return res.data
}

export async function deleteModel3DFile(fileId: string): Promise<void> {
  await api.delete(`/api/v1/model3d-files/${fileId}`)
}

// Full replacement, not append/remove-by-guid — see the backend's own
// update_unloaded_elements header for why: the caller always resolves the
// complete current set before calling this.
export async function updateUnloadedElements(fileId: string, unloadedElements: UnloadedElementInfo[]): Promise<Model3DFile> {
  const res = await api.patch<Model3DFile>(`/api/v1/model3d-files/${fileId}/unloaded-elements`, { unloaded_elements: unloadedElements })
  return res.data
}
