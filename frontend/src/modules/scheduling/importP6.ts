import { api } from '@/lib/api'

export interface P6ImportSummary {
  schedule_variant_id: string
  schedule_period_id: string
  variant_name: string
  calendar_count: number
  resource_count: number
  activity_count: number
  relationship_count: number
  assignment_count: number
  udf_value_count: number
  skipped: string[]
}

// Frontend for app/api/p6_import.py (2026-07-16, per Maro: "time for the
// import workflow") — multipart upload, same `FormData` shape
// model3dFiles.ts's own uploadModel3DFile already uses for "some metadata
// plus a file." Always lands in a brand new, non-master Schedule Variant
// (app/services/p6_import.py's own header) — never touches the project's
// existing master or any other variant.
export async function importP6Xml(projectId: string, file: File): Promise<P6ImportSummary> {
  const form = new FormData()
  form.append('project_id', projectId)
  form.append('file', file, file.name)
  const res = await api.post<P6ImportSummary>('/api/v1/p6-import/xml', form)
  return res.data
}
