import { api } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'

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

// Direct-to-R2 upload (2026-08-23) — same three-step presign/PUT/record
// flow as model3dFiles.ts's own uploadModel3DFile; see that function's own
// header for the full "why" (Vercel's hard 4.5MB Function body cap).
export async function uploadFourDVideo(projectId: string, name: string, durationSec: number, file: Blob): Promise<FourDVideo> {
  const contentType = file.type || 'video/webm'
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/fourd-videos/presign', { content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, file, contentType)
  const res = await api.post<FourDVideo>('/api/v1/fourd-videos/', {
    project_id: projectId, name, duration_sec: durationSec, storage_key: presigned.storage_key,
  })
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
