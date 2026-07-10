function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

// One row per (resource, activity) — mirrors exportActivities.ts's shape,
// just with a variable tail of period columns instead of a fixed set
// (2026-07-07, per Maro).
export interface ResourceTrackingExportRow {
  resourceName: string
  activityCode: string
  activityName: string
  start: string | null
  finish: string | null
  periodHours: number[]
}

export function resourceTrackingToCsv(rows: ResourceTrackingExportRow[], periodLabels: string[]): string {
  const header = ['Resource', 'Code', 'Activity', 'Start', 'Finish', ...periodLabels].map(csvEscape).join(',')
  const body = rows.map(r => [
    r.resourceName, r.activityCode, r.activityName, r.start ?? '', r.finish ?? '',
    ...r.periodHours.map(h => h === 0 ? '' : h.toFixed(1)),
  ].map(csvEscape).join(','))
  return [header, ...body].join('\r\n')
}

export function downloadResourceTrackingCsv(rows: ResourceTrackingExportRow[], periodLabels: string[], projectName: string) {
  const csv = resourceTrackingToCsv(rows, periodLabels)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `${projectName.replace(/[^\w-]+/g, '_')}_resource_tracking_${date}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
