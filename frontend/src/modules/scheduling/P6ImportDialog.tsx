import { useState } from 'react'
import { api } from '@/lib/api'
import type { ScheduleVariant } from './types'
import { importP6Xml, type P6ImportSummary } from './importP6'

interface Props {
  projectId: string
  onImported: (variant: ScheduleVariant) => void
  onClose: () => void
}

// "Import from P6" (2026-07-16, per Maro: "time for the import workflow")
// — file picker + confirm + result summary, modeled on
// frontend/src/modules/fourD/ImportModelDialog.tsx's own overlay/panel
// conventions (this app's established "pick a file, confirm, see what
// happened" shape). Always lands in a brand new Schedule Variant — never a
// silent merge into anything existing — so the summary step doubles as
// the confirmation that it's safe to review before touching the project's
// real master schedule.
export function P6ImportDialog({ projectId, onImported, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<P6ImportSummary | null>(null)

  const handleImport = async () => {
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const result = await importP6Xml(projectId, file)
      setSummary(result)
    } catch (err) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : undefined
      setError(message ?? 'Failed to import this file — check it\'s a real PMXML (.xml) export from P6.')
    } finally {
      setImporting(false)
    }
  }

  const handleSwitchToImported = async () => {
    if (!summary) return
    const { data } = await api.get<ScheduleVariant>(`/api/v1/schedule-variants/${summary.schedule_variant_id}`)
    onImported(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[440px] bg-white dark:bg-prosota-panel rounded-lg shadow-xl border border-gray-200 dark:border-prosota-line" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-prosota-line">
          <h3 className="text-sm font-bold text-gray-800 dark:text-prosota-paper">Import from P6</h3>
        </div>

        {!summary ? (
          <>
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs text-gray-500 dark:text-prosota-muted">
                Upload a PMXML (.xml) export from Primavera P6. This always creates a brand new Schedule
                Variant — it never overwrites or merges into an existing schedule, so it's safe to review
                (and discard, if it's not what you wanted) before touching the project's real master.
              </p>
              <input
                type="file"
                accept=".xml"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1.5"
              />
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-prosota-line flex justify-end gap-2">
              <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!file || importing}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs text-gray-600 dark:text-prosota-muted">
                Created <span className="font-medium text-gray-800 dark:text-prosota-paper">"{summary.variant_name}"</span> with:
              </p>
              <ul className="text-xs text-gray-600 dark:text-prosota-muted space-y-0.5 list-disc list-inside">
                <li>{summary.activity_count} activities</li>
                <li>{summary.relationship_count} relationships</li>
                <li>{summary.resource_count} resources, {summary.assignment_count} assignments</li>
                <li>{summary.calendar_count} calendars</li>
                {summary.udf_value_count > 0 && <li>{summary.udf_value_count} custom field values</li>}
              </ul>
              {summary.skipped.length > 0 && (
                <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded px-2 py-1.5 max-h-32 overflow-y-auto">
                  <div className="font-medium mb-1">{summary.skipped.length} item{summary.skipped.length === 1 ? '' : 's'} skipped or approximated:</div>
                  <ul className="space-y-0.5">
                    {summary.skipped.map((s, i) => <li key={i}>⚠ {s}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-prosota-line flex justify-end gap-2">
              <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
                Close
              </button>
              <button
                onClick={handleSwitchToImported}
                className="text-xs px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800"
              >
                Switch to Imported Schedule
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
