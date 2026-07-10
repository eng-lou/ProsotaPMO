import ExcelJS from 'exceljs'
import type { PrintResourceGroup } from './ResourceTrackingPrintView'
import { RESOURCE_TYPE_LABELS, type Calendar, type Resource } from './types'
import type { ResourcesPrintTable } from './resourcesLayout'

// One workbook, up to three sheets — whichever of Pool/Tracking/Profile are
// checked (2026-07-08, per Maro: "the export excel will have three tabs
// with the three tables/graph each"). exceljs (not the popular `xlsx`/
// SheetJS npm package — that one ships known, currently-unpatched high-
// severity prototype-pollution/ReDoS advisories) builds the workbook
// entirely client-side; the resulting .xlsx is downloaded the same way
// every other export in this app triggers a Blob download.
export async function downloadResourcesExcel(opts: {
  tables: Set<ResourcesPrintTable>
  projectName: string
  resources: Resource[]
  calendars: Calendar[]
  printGroups: PrintResourceGroup[]
  bucketLabels: string[]
  profileBarValues: number[]
  profileLimit: number
  // Hours/Days/Cost (2026-07-10, per Maro) — printGroups/profileBarValues are
  // already converted to this unit by the caller; only affects column
  // labelling here.
  unit: 'hours' | 'days' | 'cost'
}) {
  const unitLabel = opts.unit === 'cost' ? 'Cost (£)' : opts.unit === 'days' ? 'Days' : 'Hours'
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Prosota'
  workbook.created = new Date()

  if (opts.tables.has('pool')) {
    const sheet = workbook.addWorksheet('Resource Pool')
    sheet.columns = [
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Role', key: 'role', width: 16 },
      { header: 'Unit', key: 'unit', width: 12 },
      { header: 'Rate (£)', key: 'rate', width: 12 },
      { header: 'Max h/day', key: 'maxHours', width: 12 },
      { header: 'Calendar', key: 'calendar', width: 18 },
    ]
    sheet.getRow(1).font = { bold: true }
    for (const r of opts.resources) {
      sheet.addRow({
        type: RESOURCE_TYPE_LABELS[r.resource_type], name: r.name, role: r.role ?? '', unit: r.unit,
        rate: Number(r.rate), maxHours: Number(r.max_hours_per_day),
        calendar: r.calendar_id ? (opts.calendars.find(c => c.id === r.calendar_id)?.name ?? '') : '',
      })
    }
  }

  if (opts.tables.has('tracking')) {
    const sheet = workbook.addWorksheet('Resource Tracking')
    sheet.columns = [
      { header: 'Resource', key: 'resource', width: 20 },
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Activity', key: 'activity', width: 30 },
      { header: 'Start', key: 'start', width: 14 },
      { header: 'Finish', key: 'finish', width: 14 },
      ...opts.bucketLabels.map((label, i) => ({ header: label, key: `p${i}`, width: 10 })),
    ]
    sheet.getRow(1).font = { bold: true }
    for (const group of opts.printGroups) {
      const rollupRow: Record<string, unknown> = { resource: group.resourceName, activity: '(all activities)' }
      group.bucketHours.forEach((h, i) => { rollupRow[`p${i}`] = h || null })
      const row = sheet.addRow(rollupRow)
      row.font = { bold: true }
      for (const r of group.rows) {
        const rowData: Record<string, unknown> = {
          resource: '', code: r.code, activity: r.name, start: r.start ?? '', finish: r.finish ?? '',
        }
        r.bucketHours.forEach((h, i) => { rowData[`p${i}`] = h || null })
        sheet.addRow(rowData)
      }
    }
  }

  if (opts.tables.has('profile')) {
    const sheet = workbook.addWorksheet('Resource Usage Profile')
    sheet.columns = [
      { header: 'Period', key: 'period', width: 14 },
      { header: `Budgeted ${unitLabel}`, key: 'value', width: 16 },
      { header: `Limit (${unitLabel})`, key: 'limit', width: 14 },
      { header: 'Overallocated', key: 'over', width: 14 },
    ]
    sheet.getRow(1).font = { bold: true }
    opts.bucketLabels.forEach((label, i) => {
      const value = opts.profileBarValues[i] ?? 0
      sheet.addRow({ period: label, value, limit: opts.profileLimit, over: value > opts.profileLimit && opts.profileLimit > 0 ? 'Yes' : '' })
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `${opts.projectName.replace(/[^\w-]+/g, '_')}_resources_${date}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
