import { api } from '@/lib/api'

// Frontend for fourd_video.py's backend (2026-07-20, per Maro: a dashboard
// widget to "open one of the videos 4d sequence vids we've captured") —
// Viewport3D.tsx's own Export Video still downloads locally exactly as
// before (unchanged); this additionally persists the recorded .webm
// server-side so it can be listed/played back later. Same upload/download
// shape as model3dFiles.ts's own client.
export interface FourDVideo {
  id: string
  project_id: string
  name: string
  duration_sec: number
  size_bytes: number
  created_at: string
  updated_at: string
}

export async function listFourDVideos(projectId: string): Promise<FourDVideo[]> {
  const res = await api.get<FourDVideo[]>('/api/v1/fourd-videos/', { params: { project_id: projectId } })
  return res.data
}

export async function uploadFourDVideo(projectId: string, name: string, durationSec: number, file: Blob): Promise<FourDVideo> {
  const form = new FormData()
  form.append('project_id', projectId)
  form.append('name', name)
  form.append('duration_sec', String(durationSec))
  form.append('file', file, name)
  const res = await api.post<FourDVideo>('/api/v1/fourd-videos/', form)
  return res.data
}

// Blob fetch, not a plain <video src="...">  URL — every API request in this
// app authenticates via a Bearer token attached by axios's own request
// interceptor (see AuthTokenProvider.tsx); a raw <video>/<img> tag pointed
// straight at the backend sends no such header and would just 401. Same
// reasoning downloadModel3DFile already follows for the same kind of
// endpoint — fetch as a Blob through `api`, then the caller turns it into
// an object URL for playback.
export async function downloadFourDVideo(videoId: string): Promise<Blob> {
  const res = await api.get<Blob>(`/api/v1/fourd-videos/${videoId}/download`, { responseType: 'blob' })
  return res.data
}

export async function deleteFourDVideo(videoId: string): Promise<void> {
  await api.delete(`/api/v1/fourd-videos/${videoId}`)
}
