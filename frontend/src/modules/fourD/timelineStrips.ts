import { api } from '@/lib/api'
import type { ScopeFilter } from './scheduleScope'

// Frontend for timeline_strip.py's backend — a horizontal year/month
// timeline HUD strip (2026-08-03, per Maro's own Synchro-style reference
// screenshot). Started as a per-project singleton; a list since 2026-10-03
// (per Maro: strips "per baseline views") — each strip has its own
// viewport_slot, scope and style, same list CRUD shape as radialCharts.ts.
export interface TimelineStrip extends ScopeFilter {
  id: string
  project_id: string
  title: string
  visible: boolean
  position_x_pct: number
  position_y_pct: number
  width_px: number
  height_px: number
  background_color: string
  band_border_color: string
  text_color: string
  playhead_color: string
  font_size: number
  // null = the main 4D viewport, 0..2 = that comparison view.
  viewport_slot: number | null
  created_at: string
  updated_at: string
}

export type TimelineStripPatch = Partial<Omit<TimelineStrip, 'id' | 'project_id' | 'created_at' | 'updated_at'>>

export async function listTimelineStrips(projectId: string): Promise<TimelineStrip[]> {
  const res = await api.get<TimelineStrip[]>('/api/v1/timeline-strips/', { params: { project_id: projectId } })
  return res.data
}

export async function createTimelineStrip(data: { project_id: string } & TimelineStripPatch): Promise<TimelineStrip> {
  const res = await api.post<TimelineStrip>('/api/v1/timeline-strips/', data)
  return res.data
}

export async function updateTimelineStrip(id: string, data: TimelineStripPatch): Promise<TimelineStrip> {
  const res = await api.patch<TimelineStrip>(`/api/v1/timeline-strips/${id}`, data)
  return res.data
}

export async function deleteTimelineStrip(id: string): Promise<void> {
  await api.delete(`/api/v1/timeline-strips/${id}`)
}
