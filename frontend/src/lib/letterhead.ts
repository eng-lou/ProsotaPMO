import { useEffect, useState } from 'react'
import { api } from './api'

export type LetterheadAlign = 'left' | 'center' | 'right' | 'justify'

export interface LetterheadZone {
  text: string
  bold: boolean
  italic: boolean
  font_size: number
  align: LetterheadAlign
}

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
}

export const EMPTY_ZONE: LetterheadZone = { text: '', bold: false, italic: false, font_size: 11, align: 'left' }

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
    header_left: { text: '{project} — {module}', bold: true, italic: false, font_size: 20, align: 'left' },
    header_center: { ...EMPTY_ZONE, align: 'center' },
    header_right: { text: 'Printed {printed_at}', bold: false, italic: false, font_size: 11, align: 'right' },
    footer_left: { ...EMPTY_ZONE },
    footer_center: { ...EMPTY_ZONE, align: 'center' },
    footer_right: { ...EMPTY_ZONE, align: 'right' },
    show_gantt_legend: false,
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
