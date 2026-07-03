import type { QualityReport } from './types'

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

// "with the summary and optionally with the details of the relevant
// activities that failed" (Maro) — includeDetails appends one extra row per
// failing/warning check listing the activity codes that tripped it.
export function qualityReportToCsv(report: QualityReport, includeDetails: boolean): string {
  const lines: string[] = []
  lines.push(csvEscape('Logic Score'), `${report.logic_score ?? 'N/A'}`)
  lines.push('')
  lines.push(['Check', 'Standard', 'Threshold', 'Actual', 'Result'].map(csvEscape).join(','))
  for (const c of report.checks) {
    lines.push([
      c.name, c.standard, c.threshold_label,
      typeof c.actual === 'number' ? `${c.actual}%` : c.actual ?? '—',
      c.status.toUpperCase(),
    ].map(csvEscape).join(','))
    if (includeDetails && (c.status === 'fail' || c.status === 'warn') && c.failing_activity_codes.length > 0) {
      lines.push(['', '', '', '', `Failing activities: ${c.failing_activity_codes.join(', ')}`].map(csvEscape).join(','))
    }
  }
  return lines.join('\r\n')
}

export function downloadQualityReportCsv(report: QualityReport, includeDetails: boolean, runName?: string) {
  const csv = qualityReportToCsv(report, includeDetails)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  const suffix = runName ? runName.replace(/[^\w-]+/g, '_') : date
  link.href = url
  link.download = `schedule_quality_${suffix}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
