import { useEffect, useState } from 'react'
import { api } from './api'

export type GanttFontFamily = 'sans' | 'serif' | 'mono'

export const FONT_FAMILY_CSS: Record<GanttFontFamily, string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, "SF Mono", monospace',
}

// Six WBS nesting levels (0 = top-level summary) — mirrors backend
// app/schemas/gantt_layout.py:DEFAULT_WBS_LEVEL_COLORS. Depths beyond the
// array clamp to the last colour (see wbsLevelColor below).
export const DEFAULT_WBS_LEVEL_COLORS = ['#374151', '#4b5563', '#6b7280', '#9ca3af', '#94a3b8', '#cbd5e1']

// Mirrors backend app/schemas/gantt_layout.py:GanttStyle exactly. Colours are
// hex strings applied via inline style (not fixed Tailwind classes) so a
// project can actually override them — see GanttChart.tsx/GanttLegend.tsx/
// Scheduling.tsx. These are also the new hardcoded visual defaults Maro asked
// for (2026-07-03): WBS summary rendered as a dark-grey jagged bar rather than
// a filled bar (one colour per nesting level — wbs_level_colors — not just
// one flat colour), milestones match their bar's critical/non-critical colour
// instead of a fixed purple, baseline is yellow and thicker, and activity-
// table rows get a per-type background tint instead of a bold/uppercase
// treatment.
export interface GanttStyle {
  critical_color: string
  non_critical_color: string
  milestone_critical_color: string
  milestone_noncritical_color: string
  baseline_color: string
  baseline_thickness: number
  table_font_color: string
  table_font_family: GanttFontFamily
  wbs_level_colors: string[]
  activity_row_color: string
  milestone_row_color: string
}

export const DEFAULT_GANTT_STYLE: GanttStyle = {
  critical_color: '#ef4444',
  non_critical_color: '#3b82f6',
  milestone_critical_color: '#ef4444',
  milestone_noncritical_color: '#3b82f6',
  baseline_color: '#eab308',
  baseline_thickness: 7,
  table_font_color: '#111827',
  table_font_family: 'sans',
  wbs_level_colors: [...DEFAULT_WBS_LEVEL_COLORS],
  activity_row_color: '#ffffff',
  milestone_row_color: '#a855f7',
}

// Appends an alpha channel to a "#rrggbb" colour — used throughout for
// translucent tints (row backgrounds, bar fills) instead of separate
// light/dark colour pairs, so one saved hex covers both.
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')
  return `${hex}${a}`
}

// The colour for a given WBS nesting depth (0 = top-level summary) — clamps
// to the deepest configured level rather than repeating/defaulting, so an
// outline nested past the saved palette still reads as "as deep as it gets"
// rather than reverting to some unrelated colour.
export function wbsLevelColor(style: GanttStyle, depth: number): string {
  const colors = style.wbs_level_colors.length > 0 ? style.wbs_level_colors : DEFAULT_WBS_LEVEL_COLORS
  return colors[Math.min(depth, colors.length - 1)]
}

// Activity table row shade for a WBS summary row — same per-level colour as
// the Gantt's jagged line, at a flat translucency (the colour itself now
// carries the level distinction, not a compounding alpha fade).
export function wbsRowBackground(style: GanttStyle, depth: number): string {
  return withAlpha(wbsLevelColor(style, depth), 0.18)
}

export interface GanttLayout {
  id: string
  project_id: string
  name: string
  is_active: boolean
  style: GanttStyle
  created_at: string
  updated_at: string
}

// The currently-applied layout's style (or the built-in defaults if none is
// applied) — consumed by both the interactive Scheduling viewport and
// SchedulingPrintView, so a saved layout looks the same on screen and on paper.
export function useActiveGanttStyle(projectId: string | undefined) {
  const [style, setStyle] = useState<GanttStyle>(DEFAULT_GANTT_STYLE)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<GanttStyle>('/api/v1/gantt-layouts/active-style', { params: { project_id: projectId } })
      setStyle(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  return { style, loading, refetch: load }
}

// Manages the saved-layouts library for LayoutWidget — same
// create(don't apply)/apply/delete shape as useProjectLetterhead's sibling,
// schedule_baselines' BaselineWidget, plus update (edit an existing layout in
// place) and reset (back to the built-in look without deleting anything).
export function useGanttLayouts(projectId: string | undefined) {
  const [layouts, setLayouts] = useState<GanttLayout[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<GanttLayout[]>('/api/v1/gantt-layouts/', { params: { project_id: projectId } })
      setLayouts(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const create = async (name: string, style: GanttStyle) => {
    await api.post('/api/v1/gantt-layouts/', { project_id: projectId, name, style })
    await load()
  }

  const update = async (layoutId: string, name: string, style: GanttStyle) => {
    await api.patch(`/api/v1/gantt-layouts/${layoutId}`, { name, style })
    await load()
  }

  const apply = async (layoutId: string) => {
    await api.post(`/api/v1/gantt-layouts/${layoutId}/apply`)
    await load()
  }

  const remove = async (layoutId: string) => {
    await api.delete(`/api/v1/gantt-layouts/${layoutId}`)
    await load()
  }

  const reset = async () => {
    await api.post('/api/v1/gantt-layouts/reset', null, { params: { project_id: projectId } })
    await load()
  }

  return { layouts, loading, create, update, apply, remove, reset, refetch: load }
}
