import { api } from '@/lib/api'
import type { ScopeFilter } from './scheduleScope'

// Frontend for timeline_strip.py's backend — a single, project-wide
// horizontal year/month timeline HUD strip (2026-08-03, per Maro's own
// Synchro-style reference screenshot). Unlike RadialChart, this is a real
// singleton: one row per project, GET/PUT only (no create/delete/list) —
// see that model's own docstring for the full "why" (mirrors
// ProjectLetterhead's own "one row per project, get-or-default, upsert"
// shape).
export interface TimelineStrip extends ScopeFilter {
  // null = nothing saved yet for this project — getTimelineStrip still
  // returns a full object with real defaults in that case (never a 404),
  // same convention as project_letterhead.ts's own response shape.
  id: string | null
  project_id: string
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
  created_at: string | null
  updated_at: string | null
}

export async function getTimelineStrip(projectId: string): Promise<TimelineStrip> {
  const res = await api.get<TimelineStrip>('/api/v1/timeline-strips/', { params: { project_id: projectId } })
  return res.data
}

// PUT upserts the *whole* row — unlike RadialChart/Zone's own PATCH, there's
// no partial-update endpoint (see timeline_strip.py's own service — a
// singleton's "update" is just "save the current full state again"), so
// callers always send every field, not a sparse patch.
export async function saveTimelineStrip(data: Omit<TimelineStrip, 'id' | 'created_at' | 'updated_at'>): Promise<TimelineStrip> {
  const res = await api.put<TimelineStrip>('/api/v1/timeline-strips/', data)
  return res.data
}
