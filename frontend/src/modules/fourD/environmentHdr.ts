import { api, downloadLargeBlob } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'
import {
  decompressIfGzip, getOrDownloadFile, maybeCompress, pruneCachedFiles, putCachedFile, storedContentType,
} from '@/lib/fileCache'

import { readEnvironmentTexture } from './environmentTexture'

export interface SavedEnvironment {
  id: string
  project_id: string
  name: string
  size_bytes: number
}

export async function getSavedEnvironment(projectId: string): Promise<SavedEnvironment | null> {
  const { data } = await api.get<SavedEnvironment | null>('/api/v1/environment-maps/', { params: { project_id: projectId } })
  return data
}

export async function restoreEnvironmentTexture(saved: SavedEnvironment) {
  const projectId = saved.project_id
  const stored = await getOrDownloadFile(
    'environment', projectId, saved.id,
    () => downloadLargeBlob(`/api/v1/environment-maps/${saved.id}/download`), saved.size_bytes,
  )
  const file = new File([await decompressIfGzip(stored)], saved.name)
  return readEnvironmentTexture(file)
}

// Uploads straight to R2 (presign + PUT), replacing the project's previous
// environment server-side.
export async function saveEnvironment(projectId: string, file: File): Promise<SavedEnvironment> {
  const stored = await maybeCompress(file)
  const contentType = storedContentType(stored, file)
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/environment-maps/presign', { name: file.name, content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, stored, contentType)
  const { data: saved } = await api.post<SavedEnvironment>('/api/v1/environment-maps/', {
    project_id: projectId, name: file.name, storage_key: presigned.storage_key,
  })
  void putCachedFile('environment', projectId, saved.id, stored)
  void pruneCachedFiles('environment', projectId, [saved.id])
  return saved
}

export async function deleteSavedEnvironment(env: Pick<SavedEnvironment, 'id' | 'project_id'>): Promise<void> {
  await api.delete(`/api/v1/environment-maps/${env.id}`)
  void pruneCachedFiles('environment', env.project_id, [])
}
