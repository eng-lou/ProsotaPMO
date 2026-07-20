import { api } from '@/lib/api'

// Frontend for measurement.py's backend (2026-07-19, per Maro: "add a
// measurement feature, length and areas"). Saved/listed/toggleable like
// Path/Annotation/SectionBox rather than an ephemeral ruler — see
// measurement.py's own docstring for the full "why".
export type MeasurementKind = 'length' | 'area'

export interface MeasurementPoint {
  x: number
  y: number
  z: number
}

export interface Measurement {
  id: string
  project_id: string
  name: string
  kind: MeasurementKind
  points: MeasurementPoint[]
  // Every other closed boundary loop found inside a face-clicked patch —
  // real openings cut into it, drawn but not counted (value below is
  // already net of them — see measurement.py's own docstring). Always
  // empty for kind="length" or a manually points-clicked kind="area".
  hole_loops: MeasurementPoint[][]
  // Real metres (length) or real square metres (area) — already
  // unit-converted client-side before being sent here; see
  // measurementGeometry.ts's own header.
  value: number
  visible: boolean
  created_at: string
  updated_at: string
}

export async function listMeasurements(projectId: string): Promise<Measurement[]> {
  const res = await api.get<Measurement[]>('/api/v1/measurements/', { params: { project_id: projectId } })
  return res.data
}

export async function createMeasurement(data: {
  project_id: string
  kind: MeasurementKind
  points: MeasurementPoint[]
  hole_loops?: MeasurementPoint[][]
  value: number
  name?: string
  visible?: boolean
}): Promise<Measurement> {
  const res = await api.post<Measurement>('/api/v1/measurements/', data)
  return res.data
}

// name/visible only — points/kind/value are fixed at creation, see
// measurement.py's MeasurementUpdate docstring for why.
export async function updateMeasurement(id: string, data: Partial<{
  name: string
  visible: boolean
}>): Promise<Measurement> {
  const res = await api.patch<Measurement>(`/api/v1/measurements/${id}`, data)
  return res.data
}

export async function deleteMeasurement(id: string): Promise<void> {
  await api.delete(`/api/v1/measurements/${id}`)
}
