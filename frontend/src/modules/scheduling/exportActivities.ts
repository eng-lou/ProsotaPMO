import type { Activity } from './types'

const COLUMNS: { key: keyof Activity; label: string }[] = [
  { key: 'code', label: 'Code' },
  { key: 'wbs_path', label: 'WBS' },
  { key: 'task_name', label: 'Activity' },
  { key: 'activity_type', label: 'Type' },
  { key: 'duration_days', label: 'Duration (d)' },
  { key: 'start', label: 'Start' },
  { key: 'finish', label: 'Finish' },
  { key: 'bl_start', label: 'BL Start' },
  { key: 'bl_finish', label: 'BL Finish' },
  { key: 'variance_days', label: 'Variance (d)' },
  { key: 'total_float', label: 'Total Float (d)' },
  { key: 'is_critical', label: 'Critical' },
  { key: 'pct_complete', label: '% Complete' },
  { key: 'constraint_type', label: 'Constraint Type' },
  { key: 'constraint_date', label: 'Constraint Date' },
  { key: 'commentary', label: 'Commentary' },
]

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

export function activitiesToCsv(activities: Activity[]): string {
  const header = COLUMNS.map(c => csvEscape(c.label)).join(',')
  const rows = activities.map(a => COLUMNS.map(c => csvEscape(a[c.key])).join(','))
  return [header, ...rows].join('\r\n')
}

export function downloadActivitiesCsv(activities: Activity[], projectName: string) {
  const csv = activitiesToCsv(activities)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `${projectName.replace(/[^\w-]+/g, '_')}_schedule_${date}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
