import { api } from '@/lib/api'

// Frontend for camera.py's backend — a named, keyframeable cinematic
// camera (2026-08-03, per Maro: "thinking of a preview of the camera
// passepartout like in blender... add separate cameras and play the
// animation and see the transitions"). Distinct from CameraView
// (cameraViews.ts), which is a one-shot "jump to this pose" bookmark with
// no lens settings and no timeline binding.
//
// This type only ever holds a Camera's *base* pose/lens — see camera.py's
// own docstring on why position/target/lens over time are ElementKeyframe
// rows (source_kind="camera", element_ref=camera.id) instead of columns
// here.
export interface Camera {
  id: string
  project_id: string
  name: string
  base_position_x: number
  base_position_y: number
  base_position_z: number
  base_target_x: number
  base_target_y: number
  base_target_z: number
  base_focal_length: number
  base_clip_start: number
  base_clip_end: number
  created_at: string
  updated_at: string
}

export interface CameraPose {
  base_position_x: number
  base_position_y: number
  base_position_z: number
  base_target_x: number
  base_target_y: number
  base_target_z: number
  base_focal_length: number
  base_clip_start: number
  base_clip_end: number
}

export async function listCameras(projectId: string): Promise<Camera[]> {
  const res = await api.get<Camera[]>('/api/v1/cameras/', { params: { project_id: projectId } })
  return res.data
}

export async function createCamera(
  data: { project_id: string; name?: string } & CameraPose,
): Promise<Camera> {
  const res = await api.post<Camera>('/api/v1/cameras/', data)
  return res.data
}

export async function updateCamera(
  id: string,
  data: Partial<CameraPose> & { name?: string },
): Promise<Camera> {
  const res = await api.patch<Camera>(`/api/v1/cameras/${id}`, data)
  return res.data
}

export async function deleteCamera(id: string): Promise<void> {
  await api.delete(`/api/v1/cameras/${id}`)
}

// Blender's own default full-frame sensor width (mm) — see camera.py's
// docstring on why focal length (not raw fov) is the stored/edited unit:
// it's the recognisable Blender-style lens control from Maro's own
// reference screenshot, converted to whatever THREE.PerspectiveCamera.fov
// actually needs at render time.
const SENSOR_WIDTH_MM = 36

export function fovFromFocalLength(focalLengthMm: number, sensorWidthMm: number = SENSOR_WIDTH_MM): number {
  return 2 * Math.atan(sensorWidthMm / (2 * focalLengthMm)) * (180 / Math.PI)
}

// Inverse of fovFromFocalLength — used once, when creating a new Camera
// from the viewport's own current ViewerSettings.fieldOfView (degrees),
// to seed a starting focal length someone can then fine-tune in mm.
export function focalLengthFromFov(fovDeg: number, sensorWidthMm: number = SENSOR_WIDTH_MM): number {
  return sensorWidthMm / (2 * Math.tan((fovDeg * Math.PI) / 180 / 2))
}
