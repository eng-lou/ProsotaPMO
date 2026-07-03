import type { CostElement } from './types'

const COLUMNS: { key: keyof CostElement; label: string }[] = [
  { key: 'code', label: 'Code' },
  { key: 'description', label: 'Description' },
  { key: 'element_group', label: 'Group' },
  { key: 'element_type', label: 'Type' },
  { key: 'rate', label: 'Rate' },
  { key: 'cost_owner', label: 'Owner' },
  { key: 'status', label: 'Status' },
  { key: 'budget', label: 'Budget (£)' },
  { key: 'forecast', label: 'Forecast (£)' },
  { key: 'actuals', label: 'Actuals (£)' },
  { key: 'rev_a_baseline', label: 'Rev A Baseline (£)' },
  { key: 'variance', label: 'Variance (£)' },
  { key: 'pct_complete', label: '% Complete' },
  { key: 'pv', label: 'PV (£)' },
  { key: 'ev', label: 'EV (£)' },
  { key: 'sv', label: 'SV (£)' },
  { key: 'spi', label: 'SPI' },
  { key: 'cv', label: 'CV (£)' },
  { key: 'cpi', label: 'CPI' },
  { key: 'eac', label: 'EAC (£)' },
  { key: 'etc', label: 'ETC (£)' },
  { key: 'vac', label: 'VAC (£)' },
  { key: 'tcpi', label: 'TCPI' },
  { key: 'cost_per_m2', label: '£/m²' },
  { key: 'scope_note', label: 'Scope Note' },
  { key: 'variance_commentary', label: 'Variance Commentary' },
  { key: 'qs_signoff_name', label: 'QS Sign-off' },
  { key: 'qs_signoff_date', label: 'Sign-off Date' },
]

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

export function costElementsToCsv(elements: CostElement[]): string {
  const header = COLUMNS.map(c => csvEscape(c.label)).join(',')
  const rows = elements.map(el => COLUMNS.map(c => csvEscape(el[c.key])).join(','))
  return [header, ...rows].join('\r\n')
}

export function downloadCostElementsCsv(elements: CostElement[], projectName: string) {
  const csv = costElementsToCsv(elements)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `${projectName.replace(/[^\w-]+/g, '_')}_cost_plan_${date}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
