// Phase 10 (hour-level CPM): start/finish/actual_start/actual_finish/bl_start/
// bl_finish/constraint_date are all full datetimes now, not date-only strings —
// these helpers keep display/input formatting consistent across the module instead
// of every component re-deriving its own slice/format logic.

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  const timePart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${datePart} ${timePart}`
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" (no seconds/offset).
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 16)
}
