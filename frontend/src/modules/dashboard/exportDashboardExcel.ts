import ExcelJS from 'exceljs'
import { getWidgetRows, type WidgetProps } from './widgets'

// One widget, one worksheet (2026-09-07, per Maro: "i meant print/xlsx
// export per widget not layout" — corrects an earlier whole-dashboard,
// one-sheet-per-every-widget version). Triggered from the Expand modal,
// which already isolates a single widget on screen — exports exactly what
// that widget currently shows (its own saved filter + any active
// cross-filter, via getWidgetRows). exceljs, not the `xlsx`/SheetJS
// package — same CVE reasoning as exportResourcesExcel.ts's own header.
export async function downloadWidgetExcel(widgetType: string, label: string, props: WidgetProps) {
  const table = getWidgetRows(widgetType, props)
  if (table === null || table.rows.length === 0) return

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Prosota'
  workbook.created = new Date()

  // Excel worksheet names: <=31 chars, no \ / ? * [ ] :
  const sheetName = label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || widgetType
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = table.headers.map(h => ({ header: h, key: h, width: Math.max(12, Math.min(40, h.length + 4)) }))
  sheet.getRow(1).font = { bold: true }
  for (const row of table.rows) sheet.addRow(row)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `${label.replace(/[^\w-]+/g, '_') || widgetType}_${date}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
