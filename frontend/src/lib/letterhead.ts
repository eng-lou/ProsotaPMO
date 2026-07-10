import { useEffect, useState } from 'react'
import type { GanttFontFamily } from './ganttLayout'
import { api } from './api'

export type LetterheadAlign = 'left' | 'center' | 'right' | 'justify'

export interface LetterheadZone {
  text: string
  bold: boolean
  italic: boolean
  font_size: number
  // 2026-07-07, per Maro: "also need font types for the headers/footers" —
  // same sans/serif/mono set as GanttStyle's own font-family fields.
  font_family: GanttFontFamily
  align: LetterheadAlign
}

// Printed Gantt timescale bounds (2026-07-06, per Maro — modelled on P6's own
// Print dialog's "Timescale Start/Finish" shorthand): ps/pf = the earliest/
// latest activity Start/Finish across the current schedule, dd = the live
// period's Data Date, cd = today, cw/cm = the start of the current calendar
// week/month, custom = an exact literal date (the matching
// timescale_*_custom_date field). "auto" keeps the existing activities-
// derived range computation (SchedulingPrintView.tsx's computeGanttRange) —
// the default, so no project's print output changes until someone opts in.
export type TimescaleAnchorMode = 'auto' | 'ps' | 'pf' | 'dd' | 'cd' | 'cw' | 'cm' | 'custom'

export interface ProjectLetterhead {
  id: string | null
  project_id: string
  logo_data_url: string | null
  logo_position: 'left' | 'center' | 'right'
  header_left: LetterheadZone
  header_center: LetterheadZone
  header_right: LetterheadZone
  footer_left: LetterheadZone
  footer_center: LetterheadZone
  footer_right: LetterheadZone
  // Preset "how to read the Gantt" key (colour/shape legend) — only
  // Scheduling's print view renders it (see GanttLegend.tsx); harmless
  // elsewhere, since Risk/ICD/Cost don't have a Gantt chart to explain.
  show_gantt_legend: boolean
  // See TimescaleAnchorMode above — only Scheduling's print view uses these,
  // harmless/ignored elsewhere, same as show_gantt_legend.
  timescale_start_mode: TimescaleAnchorMode
  timescale_finish_mode: TimescaleAnchorMode
  timescale_start_custom_date: string | null
  timescale_finish_custom_date: string | null
  // Printed Scheduling activity-table column widths (2026-07-07, per Maro —
  // "let that be inside the page setup, like the way print timescale is in
  // there"), independent of each browser's own on-screen resized widths. A
  // missing key means "use PRINT_COLUMN_DEFAULTS" (Scheduling.tsx) — only
  // Scheduling's print view uses these; harmless/ignored elsewhere, same as
  // show_gantt_legend/timescale_* above.
  print_column_widths: Record<string, number>
  print_udf_column_width: number | null
  // Moved from GanttStyle (2026-07-07, per Maro: "move the font parameters
  // relating to print from the layout") — a Layout is a named, switchable
  // *screen* theme; these are print-only, so they live here instead,
  // previewed together with Page Setup's other print-only controls. Same
  // defaults GanttStyle always had.
  print_font_size: number
  header_print_font_size: number
  gantt_print_font_size: number
  // The Gantt Legend is print-only (no on-screen equivalent), so its own
  // font size lives here alongside the other print-only font controls.
  gantt_legend_font_size: number
  // Print's own font *type*, independent of GanttStyle's screen-only
  // table_font_family/gantt_font_family — same table-vs-gantt split as the
  // print font sizes above.
  print_font_family: GanttFontFamily
  gantt_print_font_family: GanttFontFamily
  // Header row and Gantt Legend each get their own print font type too
  // (2026-07-07, per Maro) — mirrors header_font_family now on GanttStyle
  // for the screen side; gantt_legend_font_family has no screen equivalent,
  // same as gantt_legend_font_size.
  header_print_font_family: GanttFontFamily
  gantt_legend_font_family: GanttFontFamily
}

export const EMPTY_ZONE: LetterheadZone = { text: '', bold: false, italic: false, font_size: 11, font_family: 'sans', align: 'left' }

// Tokens a zone's text can contain — substituted per print so a saved header
// stays "live" (today's project name/date) instead of freezing whatever was
// true when it was last edited. Kept in sync with the backend's own
// {project}/{module}/{count}/{printed_at} substitution points (see
// app/services/project_letterhead.py's default zones).
export interface LetterheadTokens {
  project: string
  module: string
  count: string
  printed_at: string
}

export function applyLetterheadTokens(text: string, tokens: LetterheadTokens): string {
  return text
    .split('{project}').join(tokens.project)
    .split('{module}').join(tokens.module)
    .split('{count}').join(tokens.count)
    .split('{printed_at}').join(tokens.printed_at)
}

// Mirrors the backend's own in-memory default (app/services/project_letterhead.py)
// — used as the hook's initial state so a print triggered before the real fetch
// resolves still shows the original fixed header, not a blank one.
export function defaultLetterhead(projectId: string): ProjectLetterhead {
  return {
    id: null,
    project_id: projectId,
    logo_data_url: null,
    logo_position: 'left',
    header_left: { text: '{project} — {module}', bold: true, italic: false, font_size: 20, font_family: 'sans', align: 'left' },
    header_center: { ...EMPTY_ZONE, align: 'center' },
    header_right: { text: 'Printed {printed_at}', bold: false, italic: false, font_size: 11, font_family: 'sans', align: 'right' },
    footer_left: { ...EMPTY_ZONE },
    footer_center: { ...EMPTY_ZONE, align: 'center' },
    footer_right: { ...EMPTY_ZONE, align: 'right' },
    show_gantt_legend: false,
    timescale_start_mode: 'auto',
    timescale_finish_mode: 'auto',
    timescale_start_custom_date: null,
    timescale_finish_custom_date: null,
    print_column_widths: {},
    print_udf_column_width: null,
    print_font_size: 9,
    header_print_font_size: 9,
    gantt_print_font_size: 8,
    gantt_legend_font_size: 9,
    print_font_family: 'sans',
    gantt_print_font_family: 'sans',
    header_print_font_family: 'sans',
    gantt_legend_font_family: 'sans',
  }
}

// Shared by every module's print view (Risk/ICD/Cost/Scheduling) — one
// letterhead per project, not per module, per Maro (2026-07-03): a logo or
// custom header set once should show up consistently everywhere.
export function useProjectLetterhead(projectId: string | undefined) {
  const [letterhead, setLetterhead] = useState<ProjectLetterhead | null>(projectId ? defaultLetterhead(projectId) : null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<ProjectLetterhead>('/api/v1/letterhead/', { params: { project_id: projectId } })
      setLetterhead(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const save = async (data: Omit<ProjectLetterhead, 'id'>) => {
    const { data: saved } = await api.put<ProjectLetterhead>('/api/v1/letterhead/', data)
    setLetterhead(saved)
    return saved
  }

  return { letterhead, loading, save, refetch: load }
}
