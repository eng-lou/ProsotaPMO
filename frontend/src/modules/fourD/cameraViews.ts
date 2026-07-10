import { api } from '@/lib/api'

// Frontend for camera_view.py's backend — a saved camera viewpoint
// (2026-07-10, per Maro: "add camera too so i can capture the model at
// different angles like blender"). Project-scoped, persisted server-side
// like everything else built this session — see camera_view.py's own
// docstring for why (not a per-browser localStorage convenience).
export interface CameraView {
  id: string
  project_id: string
  name: string
  position_x: number
  position_y: number
  position_z: number
  target_x: number
  target_y: number
  target_z: number
  created_at: string
  updated_at: string
}

export interface CameraViewPose {
  position_x: number
  position_y: number
  position_z: number
  target_x: number
  target_y: number
  target_z: number
}

export async function listCameraViews(projectId: string): Promise<CameraView[]> {
  const res = await api.get<CameraView[]>('/api/v1/camera-views/', { params: { project_id: projectId } })
  return res.data
}

export async function createCameraView(data: { project_id: string; name?: string } & CameraViewPose): Promise<CameraView> {
  const res = await api.post<CameraView>('/api/v1/camera-views/', data)
  return res.data
}

export async function updateCameraView(id: string, data: Partial<CameraViewPose> & { name?: string }): Promise<CameraView> {
  const res = await api.patch<CameraView>(`/api/v1/camera-views/${id}`, data)
  return res.data
}

export async function deleteCameraView(id: string): Promise<void> {
  await api.delete(`/api/v1/camera-views/${id}`)
}
