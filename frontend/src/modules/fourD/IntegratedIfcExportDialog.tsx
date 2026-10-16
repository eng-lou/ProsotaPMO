import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { useTheme } from '@/lib/ThemeContext'
import { api, downloadLargeBlob } from '@/lib/api'
import { decompressIfGzip } from '@/lib/fileCache'
import type { IntegratedIfcData } from './integratedIfcData'
import { downloadModel3DFile, listModel3DFiles, type Model3DFile } from './model3dFiles'

export function IntegratedIfcExportDialog({ project, schedulePeriodId, costPeriodId, onClose }: {
  project: { id: string; name: string }; schedulePeriodId: string; costPeriodId: string; onClose: () => void
}) {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const foreground = dark ? '#E6EDF7' : '#1F2937'
  const muted = dark ? '#AABBD0' : '#6B7280'
  const fieldStyle = { color: foreground, backgroundColor: dark ? '#101F36' : '#FFFFFF', borderColor: dark ? '#496078' : '#D1D5DB', colorScheme: theme }
  const [files, setFiles] = useState<Model3DFile[] | null>(null)
  const [currency, setCurrency] = useState('GBP')
  const [targetSchema, setTargetSchema] = useState<'source' | 'IFC2X3' | 'IFC4'>('source')
  const synchro = targetSchema === 'IFC2X3'
  const [counts, setCounts] = useState<string>('')
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
    setBusy(true); setError(''); setCounts(''); setStatus('Reading saved project data…')
    let stage = 'Reading project data'
    try {
      const get = async <T,>(path: string, params: object) => (await api.get<T>(`/api/v1/${path}/`, { params })).data
      const p = { project_id: project.id }, s = { schedule_period_id: schedulePeriodId }
      const [activities, relationships, resources, assignments, calendars, costs, links, animationProfiles] = await Promise.all([
        get<IntegratedIfcData['activities']>('activities', { ...p, ...s }),
        get<IntegratedIfcData['relationships']>('activity-relationships', s),
        get<IntegratedIfcData['resources']>('resources', p),
        get<IntegratedIfcData['assignments']>('resource-assignments', s),
        get<IntegratedIfcData['calendars']>('calendars', p),
        get<IntegratedIfcData['costs']>('cost-elements', { ...p, period_id: costPeriodId }),
        get<IntegratedIfcData['links']>('model-element-links', p),
        get<IntegratedIfcData['animationProfiles']>('animation-profiles', p),
      ])
      const breaks: IntegratedIfcData['breaks'] = [], exceptions: IntegratedIfcData['exceptions'] = []
      setCounts(`${activities.length} activities · ${relationships.length} dependencies · ${resources.length} resources · ${assignments.length} resource assignments · ${costs.length} cost items`)
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
        stage = `Downloading source model: ${file.name}`
        let blob = await downloadModel3DFile(file)
        const header = await blob.slice(0, 65536).text()
        if (targetSchema === 'IFC4' && /FILE_SCHEMA\s*\(\s*\(\s*'IFC2X3'/i.test(header)) {
          setStatus(`Converting model ${i + 1} of ${files.length} to IFC4: ${file.name}`)
          stage = `Converting source model to IFC4: ${file.name}`
          const { data: converted } = await api.post<{ download_url: string }>(`/api/v1/model3d-files/${file.id}/ifc4-export-source`, undefined, { timeout: 240000 })
          if (!alive.current) return
          stage = `Downloading converted IFC4 model: ${file.name}`
          setStatus(stage)
          const packed = await downloadLargeBlob(converted.download_url, true)
          stage = `Unpacking converted IFC4 model: ${file.name}`
          blob = await decompressIfGzip(packed)
        }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (targetSchema === 'IFC4' && !/FILE_SCHEMA\s*\(\s*\(\s*'IFC4'/i.test(new TextDecoder().decode(bytes.slice(0, 65536)))) {
          throw new Error(`${file.name} could not be prepared as IFC4.`)
        }
        sources.push({ name: file.name, bytes })
      }
      if (!alive.current) return
      const data: IntegratedIfcData = { project, schedulePeriodId, costPeriodId, currency, exportedAt: new Date().toISOString(),
        activities, relationships, resources, assignments, calendars, breaks, exceptions, costs, links, animationProfiles,
        compatibility: synchro ? 'synchro' : undefined }
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
          const warnings = [...event.data.warnings]
          if (!resources.length) warnings.push('The selected project returned no resources. This export has no resource catalogue.')
          if (!assignments.length) warnings.push('The active schedule returned no resource assignments. No native assignment resources were exported.')
          if (!costs.length) warnings.push('The active cost period returned no cost items.')
          if (targetSchema === 'IFC4') warnings.push('IFC4 output selected. Converted sources should be checked in the receiving application; original saved models are unchanged.')
          setResult({ url, warnings }); setBusy(false); setStatus('Export ready.')
          w.terminate(); worker.current = null
        }
      }
      w.postMessage({ sources, data, wasmPath: new URL('/wasm-ifc/', location.origin).href }, sources.map(s => s.bytes.buffer))
    } catch (e) {
      if (alive.current) {
        const detail = axios.isAxiosError(e) ? e.response?.data?.detail : null
        const message = typeof detail === 'string' ? detail : e instanceof Error ? e.message : 'Request failed.'
        setError(`${stage} failed. ${message}${stage.startsWith('Downloading converted') ? ' The converted model is cached; retrying will reuse it. If this persists, check browser network errors for blocked storage access.' : ''}`)
        setBusy(false); setStatus('')
      }
    }
  }
  const filename = `${project.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}-integrated.ifc`
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="integrated-ifc-title">
    <div style={{ color: foreground, backgroundColor: dark ? '#0C1A2E' : '#FFFFFF' }} className="bg-white dark:bg-prosota-panel text-gray-800 dark:text-prosota-paper rounded-lg shadow-xl p-5 w-full max-w-xl max-h-[85vh] overflow-auto text-sm">
      <h2 style={{ color: foreground }} id="integrated-ifc-title" className="font-semibold text-base mb-3">Export integrated IFC</h2>
      <p style={{ color: muted }} className="text-gray-500 dark:text-prosota-muted">Export your saved models with schedule and cost data.</p>
      <label style={{ color: foreground }} className="block my-3">Output format
        <select style={fieldStyle} value={targetSchema} disabled={busy || !!result} onChange={e => setTargetSchema(e.target.value as 'source' | 'IFC2X3' | 'IFC4')} className="mt-2 block w-full border rounded px-3 py-2 bg-white dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line">
          <option value="source">Keep source</option>
          <option value="IFC2X3">IFC 2x3 (compatible)</option>
          <option value="IFC4">IFC 4</option>
        </select>
      </label>
      {synchro && <p className="text-xs text-gray-500 dark:text-prosota-muted">Requires IFC 2x3 source models.</p>}
      {files?.length === 0 && <p>No saved IFC models in this project.</p>}
      <label style={{ color: foreground }} className="block my-3">Currency
        <input style={fieldStyle} aria-label="Export currency" value={currency} disabled={busy || !!result} maxLength={3} onChange={e => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} className="ml-3 border rounded px-2 py-1 w-20 bg-white dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line" />
      </label>
      <details style={{ color: muted }} className="mt-3 text-xs text-gray-500 dark:text-prosota-muted">
        <summary className="cursor-pointer">Export details</summary>
        <ul className="my-2 list-disc pl-5">{files?.map(f => <li key={f.id}>{f.name}</li>)}</ul>
        <p>Uses saved geometry and materials, including hidden elements. Viewport edits and animation are not baked. Mesh and point-cloud files are excluded. Sources must have matching units; Keep source also requires matching schemas.</p>
        {synchro && <p className="mt-2">For appearance profiles in Synchro, enable “Use InPro profile for IFC integration” under Options → Synchronization → IFC. Labour and equipment assignments are retained as task properties, not native allocations.</p>}
        {targetSchema === 'IFC4' && <p className="mt-2">IFC 2x3 sources are converted to IFC 4. Conversion can take several minutes. Original models are preserved.</p>}
        <p className="mt-2">No currency conversion. Receiving applications may not support every exported feature.</p>
        <p className="mt-2">IFC 4 maps green/red profile start colours to Construction/Demolition. The default is green Construction. Bonsai uses its own colour scheme; exact profile settings are retained as properties.</p>
        {counts && <p className="mt-2">{counts}</p>}
      </details>
      {status && <p style={{ color: foreground }} role="status" className="mt-3">{status}</p>}
      {error && <p role="alert" className="mt-3 text-red-600 dark:text-red-400">{error}</p>}
      {!!result?.warnings.length && <details className="mt-3 text-xs text-amber-700 dark:text-amber-300"><summary className="cursor-pointer">Export notes ({result.warnings.length})</summary><ul className="mt-2 list-disc pl-5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
      <div className="flex justify-end gap-3 mt-4">
        <button style={{ color: foreground, borderColor: fieldStyle.borderColor }} onClick={onClose} className="border dark:border-prosota-line rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-prosota-panel2">{busy ? 'Cancel export' : 'Close'}</button>
        {result ? <a download={filename} href={result.url} className="bg-indigo-600 text-white rounded px-3 py-1.5">Download IFC</a>
          : <button disabled={busy || !files?.length || currency.length !== 3} onClick={run} className="bg-indigo-600 text-white rounded px-3 py-1.5 disabled:opacity-50">{busy ? 'Building…' : 'Build IFC'}</button>}
      </div>
    </div>
  </div>
}
