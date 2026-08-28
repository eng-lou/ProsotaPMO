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
  // Activity table only — see gantt_font_family below for the Gantt
  // column's own independent font-type control.
  table_font_family: GanttFontFamily
  // Pixel font size for the on-screen activity table — 14 matches the
  // pre-existing hardcoded `text-sm` Tailwind class, so an unset/default
  // layout renders identically to before this field existed (2026-07-06, per
  // Maro: "in layout i want to be able to increase the font size").
  table_font_size: number
  // The activity table's own header row (Code/WBS/Type/... column labels),
  // screen only — print's own equivalent moved to ProjectLetterhead
  // (2026-07-07, per Maro: "move the font parameters relating to print from
  // the layout" — see frontend/src/lib/letterhead.ts's print_font_size/
  // header_print_font_size/gantt_print_font_size, previewed together with
  // Page Setup's other print-only controls instead of here).
  header_font_size: number
  header_font_family: GanttFontFamily
  // Gantt-column text, screen only (timeline header marks + the optional
  // name/resource/finish bar label trio) — independent of table_font_size
  // since this text sits inside the Gantt column, not the data columns
  // (2026-07-06, per Maro: "i want the option for the gantt fonts including
  // the gantt timeline header fonts").
  gantt_font_size: number
  // Font type for that same Gantt-column text, independent of
  // table_font_family (2026-07-07, per Maro: "font type parameters not just
  // the size... affecting gantt and activity table content") — until now
  // there was only one shared font family for both, even though size
  // already had this same table-vs-gantt split.
  gantt_font_family: GanttFontFamily
  wbs_level_colors: string[]
  activity_row_color: string
  milestone_row_color: string
  // Display-only toggle (2026-07-05, per Maro) — doesn't affect any stored
  // or computed value, just whether the activity table/print view shows a
  // date's time-of-day (e.g. "06 Jul 2026 09:00" vs "06 Jul 2026"). Duration
  // has no equivalent toggle — its decimal places never meant anything to
  // read, so it always rounds to a whole number of days (see
  // Scheduling.tsx:formatDuration).
  show_time_of_day: boolean
  // Gantt display toggles (2026-07-05, per Maro) — show_connectors hides the
  // predecessor/successor lines entirely (both on-screen and print); the
  // show_label_* trio each independently add a small text label to the
  // right of a bar/milestone (activity name / assigned resources / finish
  // date) — off by default, since this is new information appearing next
  // to every bar, not a toggle for something already always shown.
  show_connectors: boolean
  show_label_name: boolean
  show_label_resource: boolean
  show_label_finish: boolean
  // Sub-project float secondary indicator (2026-07-06, per Maro —
  // docs/SUBPROJECT_FLOAT_PLAN.md §G, private docs repo). Shown only when an
  // activity is critical within its own tagged sub-project's scoped pass
  // (sub_is_critical) but not on the master critical path (is_critical) —
  // the master critical path itself never changes. On by default.
  sub_critical_color: string
  show_sub_critical: boolean
  // Row tint for the activity-table Highlight widget (2026-07-06, per Maro
  // — "works exactly like the filter", "allow me to set the highlight
  // colour in the layout"). One shared colour for every enabled highlight
  // (built-in "Critical" + any saved custom rules) — see
  // SchedulingHighlightsWidget.tsx/Scheduling.tsx's highlightedActivityIds.
  highlight_color: string
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
  table_font_size: 14,
  header_font_size: 12,
  header_font_family: 'sans',
  gantt_font_size: 10,
  gantt_font_family: 'sans',
  wbs_level_colors: [...DEFAULT_WBS_LEVEL_COLORS],
  activity_row_color: '#ffffff',
  milestone_row_color: '#ffffff',
  show_time_of_day: false,
  show_connectors: true,
  show_label_name: false,
  show_label_resource: false,
  show_label_finish: false,
  sub_critical_color: '#f97316',
  show_sub_critical: true,
  highlight_color: '#ef4444',
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

// The same per-type row tint the main activity table uses (Scheduling.tsx),
// extracted so anywhere else showing a flat list of activities — the
// predecessor/successor picker (ActivityPicker.tsx), 2026-07-06 per Maro —
// can give the same visual cues (critical, WBS summary by nesting level,
// milestone, archived) instead of an undifferentiated list of names. Takes
// plain fields rather than a whole Activity object so this file doesn't need
// to depend on the scheduling module's own types.
//
// isHighlighted (2026-07-06, per Maro) takes priority over isCritical — it's
// the Highlight widget's own deliberate opt-in tint (SchedulingHighlightsWidget.tsx),
// and should win even over a row the picker is separately flagging as
// critical for its own, unrelated "which of these can I actually link"
// purpose. isCritical itself is kept exactly as before (still drives
// ActivityPicker's own critical cue) — only Scheduling.tsx's main table
// stopped passing it automatically, now that critical-row tinting there is
// opt-in via the "Critical" built-in highlight rather than always-on.
// Otherwise unchanged: WBS summary shaded per nesting level, then milestone,
// else the flat default — archived overrides all of it, same as before.
export function activityRowBackground(style: GanttStyle, opts: {
  isArchived: boolean
  isCritical: boolean
  isHighlighted?: boolean
  activityType: string
  depth: number
}): string | undefined {
  if (opts.isArchived) return '#f3f4f6'
  if (opts.isHighlighted) return withAlpha(style.highlight_color, 0.18)
  if (opts.isCritical) return withAlpha(style.critical_color, 0.12)
  if (opts.activityType === 'wbs_summary') return wbsRowBackground(style, opts.depth)
  // start_milestone/finish_milestone (2026-07-07, per Maro) — both still get
  // the same milestone row tint; this file deliberately takes a plain string
  // rather than importing the scheduling module's own ActivityType, so the
  // check stays inline instead of using types.ts's isMilestoneType helper.
  if (opts.activityType === 'start_milestone' || opts.activityType === 'finish_milestone') {
    return withAlpha(style.milestone_row_color, 0.15)
  }
  return style.activity_row_color === '#ffffff' ? undefined : withAlpha(style.activity_row_color, 1)
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
