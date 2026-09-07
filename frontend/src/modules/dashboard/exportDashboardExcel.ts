import ExcelJS from 'exceljs'
import type { DashboardWidgetConfig } from '@/lib/dashboardLayouts'
import { WIDGET_REGISTRY, getWidgetRows, type WidgetProps } from './widgets'

// One worksheet per widget currently on the dashboard grid (2026-09-07, per
// Maro: "each dashboard needs to be able to be exported to xlsx" — scoped
// with Maro to "one sheet per widget" over "one sheet laid out like the
// grid," since real tabular data you can pivot/filter in Excel is more
// useful than a visual snapshot). exceljs, not the `xlsx`/SheetJS package —
// same CVE reasoning as exportResourcesExcel.ts's own header. A widget
// whose getWidgetRows returns null (a gallery, or a *_trend chart whose
// real data lives behind its own async fetch) is skipped entirely, not
// exported as a blank sheet.
export async function downloadDashboardExcel(widgets: DashboardWidgetConfig[], widgetProps: WidgetProps, projectName: string) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Prosota'
  workbook.created = new Date()

  const usedNames = new Set<string>()
  for (const w of widgets) {
    const def = WIDGET_REGISTRY[w.widget_type]
    if (!def) continue
    const perWidgetProps: WidgetProps = { ...widgetProps, filterConditions: w.filter, filterMatchMode: w.filter_match_mode }
    const table = getWidgetRows(w.widget_type, perWidgetProps)
    if (table === null || table.rows.length === 0) continue

    // Excel worksheet names: <=31 chars, no \ / ? * [ ] :, unique within
    // the workbook — two widgets of the same type on one grid would
    // otherwise collide on the same label.
    let name = def.label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || w.widget_type
    if (usedNames.has(name)) {
      let n = 2
      const base = name.slice(0, 28)
      while (usedNames.has(`${base} (${n})`)) n++
      name = `${base} (${n})`
    }
    usedNames.add(name)

    const sheet = workbook.addWorksheet(name)
    sheet.columns = table.headers.map(h => ({ header: h, key: h, width: Math.max(12, Math.min(40, h.length + 4)) }))
    sheet.getRow(1).font = { bold: true }
    for (const row of table.rows) sheet.addRow(row)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `${projectName.replace(/[^\w-]+/g, '_') || 'Dashboard'}_dashboard_${date}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
