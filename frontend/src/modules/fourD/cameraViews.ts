import { api } from '@/lib/api'

// Frontend for camera_view.py's backend — a saved camera viewpoint
// (2026-07-10, per Maro: "add camera too so i can capture the model at
// different angles like blender"). Project-scoped, persisted server-side
// like everything else built this session — see camera_view.py's own
// docstring for why (not a per-browser localStorage convenience).
//
// viewport_state/thumbnail_data_url (2026-07-20, per Maro: "I want it to
// capture not just orbit angle but contextual visibility as well... I want
// it to go back to exactly what it was at the time") — see
// CameraViewportState's own docstring below.
export interface CameraViewportState {
  isolate_mode: boolean
  isolated_object_ids: string[]
  // `${objectId}::${expressID}` keys (2026-10-03). Views saved before that
  // only have isolated_express_ids — bare numbers scoped to
  // isolated_ifc_model_id — and are converted by isolatedKeysFromSavedView.
  isolated_element_keys?: string[]
  isolated_express_ids: number[]
  isolated_ifc_model_id: string | null
  hidden_ids: string[]
  hidden_express_ids: string[]
  show_clash_colors: boolean
}

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
  viewport_state: CameraViewportState | null
  thumbnail_data_url: string | null
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

export async function createCameraView(
  data: { project_id: string; name?: string; viewport_state?: CameraViewportState; thumbnail_data_url?: string } & CameraViewPose,
): Promise<CameraView> {
  const res = await api.post<CameraView>('/api/v1/camera-views/', data)
  return res.data
}

export async function updateCameraView(
  id: string,
  data: Partial<CameraViewPose> & { name?: string; viewport_state?: CameraViewportState; thumbnail_data_url?: string },
): Promise<CameraView> {
  const res = await api.patch<CameraView>(`/api/v1/camera-views/${id}`, data)
  return res.data
}

export async function deleteCameraView(id: string): Promise<void> {
  await api.delete(`/api/v1/camera-views/${id}`)
}

// The isolated element keys a saved view restores. Older views stored bare
// expressIDs belonging to the IFC model that was active when they were
// saved (isolated_ifc_model_id); with no recorded model, they're given to
// every isolated IFC model, which is what those views showed at the time.
export function isolatedKeysFromSavedView(vs: CameraViewportState): Set<string> {
  if (vs.isolated_element_keys && vs.isolated_element_keys.length > 0) return new Set(vs.isolated_element_keys)
  if (vs.isolated_express_ids.length === 0) return new Set()
  const owners = vs.isolated_ifc_model_id
    ? [vs.isolated_ifc_model_id]
    : vs.isolated_object_ids.filter(id => id.startsWith('ifc-'))
  const keys = new Set<string>()
  for (const owner of owners) for (const id of vs.isolated_express_ids) keys.add(`${owner}::${id}`)
  return keys
}
