import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { IntegratedIfcData } from './integratedIfcData'
import { downloadModel3DFile, listModel3DFiles, type Model3DFile } from './model3dFiles'

export function IntegratedIfcExportDialog({ project, schedulePeriodId, costPeriodId, onClose }: {
  project: { id: string; name: string }; schedulePeriodId: string; costPeriodId: string; onClose: () => void
}) {
  const [files, setFiles] = useState<Model3DFile[] | null>(null)
  const [currency, setCurrency] = useState('GBP')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ url: string; warnings: string[] } | null>(null)
  const worker = useRef<Worker | null>(null)
  const alive = useRef(true)
  const downloadUrl = useRef<string | null>(null)
  useEffect(() => {
    alive.current = true
    listModel3DFiles(project.id).then(f => { if (alive.current) setFiles(f.filter(m => m.kind === 'ifc')) })
      .catch(() => { if (alive.current) setError('Could not load saved models. Close and retry.') })
    return () => {
      alive.current = false
      worker.current?.terminate()
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    }
  }, [project.id])
  const run = async () => {
    if (!files?.length) return
    setBusy(true); setError(''); setStatus('Reading saved project data…')
    try {
      const get = async <T,>(path: string, params: object) => (await api.get<T>(`/api/v1/${path}/`, { params })).data
      const p = { project_id: project.id }, s = { schedule_period_id: schedulePeriodId }
      const [activities, relationships, resources, assignments, calendars, costs, links] = await Promise.all([
        get<IntegratedIfcData['activities']>('activities', { ...p, ...s }),
        get<IntegratedIfcData['relationships']>('activity-relationships', s),
        get<IntegratedIfcData['resources']>('resources', p),
        get<IntegratedIfcData['assignments']>('resource-assignments', s),
        get<IntegratedIfcData['calendars']>('calendars', p),
        get<IntegratedIfcData['costs']>('cost-elements', { ...p, period_id: costPeriodId }),
        get<IntegratedIfcData['links']>('model-element-links', p),
      ])
      const breaks: IntegratedIfcData['breaks'] = [], exceptions: IntegratedIfcData['exceptions'] = []
      // Bounded calendar fetches avoid a burst of hundreds of requests.
      for (const c of calendars) {
        const [b, e] = await Promise.all([
          get<IntegratedIfcData['breaks']>('calendar-breaks', { calendar_id: c.id }),
          get<IntegratedIfcData['exceptions']>('calendar-exceptions', { calendar_id: c.id }),
        ])
        breaks.push(...b); exceptions.push(...e)
        if (!alive.current) return
      }
      const sources: { name: string; bytes: Uint8Array }[] = []
      for (const [i, file] of files.entries()) {
        if (!alive.current) return
        setStatus(`Reading model ${i + 1} of ${files.length}: ${file.name}`)
        sources.push({ name: file.name, bytes: new Uint8Array(await (await downloadModel3DFile(file)).arrayBuffer()) })
      }
      if (!alive.current) return
      const data: IntegratedIfcData = { project, schedulePeriodId, costPeriodId, currency, exportedAt: new Date().toISOString(),
        activities, relationships, resources, assignments, calendars, breaks, exceptions, costs, links }
      const w = new Worker(new URL('./integratedIfc.worker.ts', import.meta.url), { type: 'module' })
      worker.current = w
      const fail = (message: string) => { setError(message); setBusy(false); setStatus(''); w.terminate(); worker.current = null }
      w.onerror = () => fail('The IFC export worker stopped. Large combined models may exceed browser memory; retry with smaller source models.')
      w.onmessage = event => {
        if (!alive.current) return
        if (event.data.type === 'progress') setStatus(event.data.message)
        else if (event.data.type === 'error') fail(event.data.message)
        else {
          const url = URL.createObjectURL(new Blob([event.data.bytes], { type: 'application/x-step' }))
          if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
          downloadUrl.current = url
          setResult({ url, warnings: event.data.warnings }); setBusy(false); setStatus('Export ready.')
          w.terminate(); worker.current = null
        }
      }
      w.postMessage({ sources, data, wasmPath: new URL('/wasm-ifc/', location.origin).href }, sources.map(s => s.bytes.buffer))
    } catch (e) {
      if (alive.current) { setError(e instanceof Error ? e.message : 'Could not read project data.'); setBusy(false); setStatus('') }
    }
  }
  const filename = `${project.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}-integrated.ifc`
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="integrated-ifc-title">
    <div className="bg-white dark:bg-prosota-panel text-gray-800 dark:text-prosota-text rounded-lg shadow-xl p-5 w-full max-w-xl max-h-[85vh] overflow-auto text-sm">
      <h2 id="integrated-ifc-title" className="font-semibold text-base mb-3">Export integrated IFC</h2>
      <p>Combine all saved IFC models with the active schedule, dependencies, resource assignments and current cost plan.</p>
      <p className="mt-2 text-xs text-gray-500">Uses original geometry, placements and materials, including hidden/unloaded elements. Viewport transforms, material overrides, split geometry and animation are not baked. Mesh and point-cloud files are excluded. Supports IFC2X3 and IFC4, preserving the source schema. Combined sources must use the same schema and matching units.</p>
      <ul className="my-3 text-xs list-disc pl-5">{files?.map(f => <li key={f.id}>{f.name}</li>)}</ul>
      {files?.length === 0 && <p>No saved IFC models in this project.</p>}
      <label className="block my-3">Currency of the Prosota costs
        <input aria-label="Export currency" value={currency} disabled={busy || !!result} maxLength={3} onChange={e => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} className="ml-3 border rounded px-2 py-1 w-20 bg-transparent" />
      </label>
      <p className="text-xs text-gray-500">No currency conversion is performed. Native IFC data is supplemented by Prosota properties for custom fields. Other applications may display only the IFC features they support.</p>
      {status && <p role="status" className="mt-3">{status}</p>}
      {error && <p role="alert" className="mt-3 text-red-600">{error}</p>}
      {!!result?.warnings.length && <div className="mt-3 text-amber-700"><p>Review before sharing:</p><ul className="list-disc pl-5 text-xs">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="border rounded px-3 py-1.5">{busy ? 'Cancel export' : 'Close'}</button>
        {result ? <a download={filename} href={result.url} className="bg-indigo-600 text-white rounded px-3 py-1.5">Download IFC</a>
          : <button disabled={busy || !files?.length || currency.length !== 3} onClick={run} className="bg-indigo-600 text-white rounded px-3 py-1.5 disabled:opacity-50">Build integrated IFC</button>}
      </div>
    </div>
  </div>
}
