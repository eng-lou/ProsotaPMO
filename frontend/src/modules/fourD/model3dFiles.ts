import { api } from '@/lib/api'
import type { UpAxis } from './upAxis'

export type Model3DKind = 'ifc' | 'mesh'

export interface Model3DFile {
  id: string
  project_id: string
  name: string
  kind: Model3DKind
  source_up_axis: UpAxis
  size_bytes: number
  created_at: string
  updated_at: string
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

export async function uploadModel3DFile(
  projectId: string, name: string, kind: Model3DKind, sourceUpAxis: UpAxis, file: Blob,
): Promise<Model3DFile> {
  const form = new FormData()
  form.append('project_id', projectId)
  form.append('name', name)
  form.append('kind', kind)
  form.append('source_up_axis', sourceUpAxis)
  form.append('file', file, name)
  const res = await api.post<Model3DFile>('/api/v1/model3d-files/', form)
  return res.data
}

export async function downloadModel3DFile(fileId: string): Promise<Blob> {
  const res = await api.get<Blob>(`/api/v1/model3d-files/${fileId}/download`, { responseType: 'blob' })
  return res.data
}

export async function deleteModel3DFile(fileId: string): Promise<void> {
  await api.delete(`/api/v1/model3d-files/${fileId}`)
}
