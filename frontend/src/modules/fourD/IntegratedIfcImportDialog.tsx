import { useEffect, useState } from 'react'
import axios from 'axios'
import { api } from '@/lib/api'

export function IntegratedIfcImportDialog({fileId, filename, schedulePeriodId, costPeriodId, onClose, onImported}: {
  fileId: string; filename: string; schedulePeriodId: string; costPeriodId: string; onClose: () => void; onImported: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [preview, setPreview] = useState<{counts: Record<string, number>; warnings: string[]} | null>(null)
  useEffect(() => {
    let alive = true
    setBusy(true)
    api.post(`/api/v1/model3d-files/${fileId}/planning-import`, {schedule_period_id: schedulePeriodId, cost_period_id: costPeriodId, commit: false}, {timeout: 180000})
      .then(({data}) => { if (alive) setPreview(data) })
      .catch(e => { if (alive) setError(typeof e.response?.data?.detail === 'string' ? e.response.data.detail : 'Could not read the detected planning data. You can keep the model and retry.') })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [fileId, schedulePeriodId, costPeriodId])
  const run = async (commit: boolean) => {
    setBusy(true); setError('')
    try {
      const {data} = await api.post(`/api/v1/model3d-files/${fileId}/planning-import`, {schedule_period_id: schedulePeriodId, cost_period_id: costPeriodId, commit}, {timeout: 180000})
      setPreview(data)
      if (commit) {
        setDone(true)
        try { await onImported() } catch { setError('Planning data was saved, but the view could not refresh. Reload the page; do not import again.') }
      }
    } catch (e) {
      const detail = axios.isAxiosError(e) ? e.response?.data?.detail : null
      setError(typeof detail === 'string' ? detail : 'Could not import IFC planning. If the request timed out, refresh before retrying.')
    } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Import IFC planning">
    <div className="bg-white dark:bg-prosota-panel text-gray-800 dark:text-prosota-text rounded-lg p-5 w-full max-w-xl text-sm">
      <h2 className="font-semibold text-base">Planning data detected</h2>
      <p className="my-3">The model “{filename}” has been imported. Include its embedded schedule, resources and cost data too?</p>
      <p className="my-3">Requires an empty schedule variant and cost period. Existing planning data is never replaced. Saved dates are retained without rescheduling.</p>
      {preview && <div className="my-3"><ul>{Object.entries(preview.counts).map(([key, count]) => <li key={key}>{count} {key}</li>)}</ul><ul className="mt-2 text-xs text-amber-700">{preview.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
      {done && <p role="status" className="my-3">Planning data imported.</p>}
      {error && <p role="alert" className="my-3 text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-3">
        <button disabled={busy} onClick={onClose}>{done ? 'Done' : 'Keep model only'}</button>
        {!done && <button disabled={busy} onClick={() => run(!!preview)} className="rounded bg-indigo-600 text-white px-3 py-2 disabled:opacity-50">{busy ? 'Reading / importing…' : preview ? 'Include planning data' : 'Retry reading data'}</button>}
      </div>
    </div>
  </div>
}
