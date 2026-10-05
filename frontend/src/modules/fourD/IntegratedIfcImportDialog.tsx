import { useEffect, useState } from 'react'
import axios from 'axios'
import { api } from '@/lib/api'
import { listModel3DFiles, type Model3DFile } from './model3dFiles'

export function IntegratedIfcImportDialog({projectId, schedulePeriodId, costPeriodId, onClose, onImported}: {
  projectId: string; schedulePeriodId: string; costPeriodId: string; onClose: () => void; onImported: () => Promise<void>
}) {
  const [files, setFiles] = useState<Model3DFile[]>([])
  const [fileId, setFileId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [preview, setPreview] = useState<{counts: Record<string, number>; warnings: string[]} | null>(null)
  useEffect(() => {
    let alive = true
    listModel3DFiles(projectId).then(rows => { if (alive) setFiles(rows.filter(r => r.kind === 'ifc')) })
      .catch(() => { if (alive) setError('Could not load saved IFC files.') })
    return () => { alive = false }
  }, [projectId])
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
      <h2 className="font-semibold text-base">Import IFC planning</h2>
      <p className="my-3">Restore a Prosota integrated IFC snapshot into the active schedule and cost period. Import the model first using Import Model, then select its saved file here.</p>
      <p className="my-3">Requires an empty schedule variant and cost period. Existing planning data is never replaced. Saved dates are retained without rescheduling.</p>
      <select aria-label="Saved IFC" value={fileId} disabled={busy || done} onChange={e => {setFileId(e.target.value); setPreview(null); setError('')}} className="w-full border rounded p-2 bg-transparent">
        <option value="">Select saved IFC…</option>
        {files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {preview && <div className="my-3"><ul>{Object.entries(preview.counts).map(([key, count]) => <li key={key}>{count} {key}</li>)}</ul><ul className="mt-2 text-xs text-amber-700">{preview.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
      {done && <p role="status" className="my-3">Planning data imported.</p>}
      {error && <p role="alert" className="my-3 text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-3">
        <button disabled={busy} onClick={onClose}>Close</button>
        {!done && <button disabled={busy || !fileId} onClick={() => run(!!preview)} className="rounded bg-indigo-600 text-white px-3 py-2 disabled:opacity-50">{busy ? 'Reading / importing…' : preview ? 'Import planning data' : 'Review planning data'}</button>}
      </div>
    </div>
  </div>
}
