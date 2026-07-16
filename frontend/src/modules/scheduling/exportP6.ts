import { api } from '@/lib/api'

// Frontend for app/services/p6_export_xml.py (2026-07-15, per Maro: "so I
// can directly export from prosota and p6 can import my file") — unlike
// exportResourcesExcel.ts (which builds the workbook entirely client-side
// with exceljs), this needs the real backend data (activities/
// relationships/resources/assignments/calendars/UDFs for a whole schedule
// period), so it's a server-generated file fetched as a blob — same
// `responseType: 'blob'` idiom model3dFiles.ts's own downloadModel3DFile
// already uses, then the same anchor-click download dance
// exportResourcesExcel.ts uses to actually save it.
//
// XML/PMXML only — an XER exporter existed alongside this briefly but was
// removed 2026-07-16 (per Maro: "stick to xml. remove the xer functionality
// completely") once XML alone was confirmed working end-to-end against a
// real P6 install; see app/services/p6_export.py's own header.
async function downloadBlob(url: string, filename: string): Promise<void> {
  const res = await api.get<Blob>(url, { responseType: 'blob' })
  const blobUrl = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(blobUrl)
}

function safeFilename(name: string): string {
  return name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'schedule'
}

export async function downloadP6Xml(schedulePeriodId: string, projectName: string): Promise<void> {
  await downloadBlob(
    `/api/v1/p6-export/xml?schedule_period_id=${schedulePeriodId}`,
    `${safeFilename(projectName)}.xml`,
  )
}
