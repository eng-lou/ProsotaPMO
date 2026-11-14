import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import type { Project } from '@/lib/ProjectContext'
import { api } from '@/lib/api'
import { chooseProjectDestination, exportProject, importProject, inspectProjectPackage, readProjectFolder, verifyProjectFiles,
  type ImportSession, type ProjectPackage } from './projectTransfer'

export function ProjectTransferPanel({ project, onClose, onImported }: {
  project?: Project; onClose(): void; onImported(): void
}) {
  const [folder, setFolder] = useState<{ manifest: File; byPath: Map<string, File>; data: ProjectPackage }>()
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const operation = useRef<AbortController>()
  const session = useRef<ImportSession>({ uploaded: new Set() })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => operation.current?.abort(), [])

  async function choose(files: File[]) {
    if (session.current.id) {
      try { await api.delete(`/api/v1/project-transfers/imports/${session.current.id}`, { timeout: 120000 }) }
      catch { setError('Could not discard the previous incomplete transfer. Retry before choosing another folder.'); return }
    }
    setError(''); setFolder(undefined); session.current = { uploaded: new Set() }
    try {
      const selected = readProjectFolder(files)
      const data = inspectProjectPackage(JSON.parse(await selected.manifest.text()))
      verifyProjectFiles(data, selected.byPath)
      setFolder({ ...selected, data }); setName(`${data.records.projects[0].name} (Imported)`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the project folder.') }
  }

  async function close() {
    if (session.current.id && !complete) {
      setBusy(true)
      try { await api.delete(`/api/v1/project-transfers/imports/${session.current.id}`, { timeout: 120000 }) }
      catch { setError('Could not remove the incomplete uploads. Retry Close, or resume the transfer.'); setBusy(false); return }
      setBusy(false)
    }
    onClose()
  }

  async function run() {
    const controller = new AbortController()
    operation.current = controller
    setBusy(true); setError('')
    try {
      if (project) {
        // Request folder access during the button gesture, before the first API call.
        const target = await chooseProjectDestination()
        const folderName = await exportProject(project.id, target, controller.signal, setStatus)
        setStatus(`Saved ${folderName}. In the other workspace, choose Switch project → Import project and select this folder.`)
      } else if (folder) {
        const result = await importProject(folder.manifest, folder.data, folder.byPath, name, session.current, controller.signal, setStatus)
        setStatus(`Imported ${result.name}. Close this panel to open it from your project list.${result.warning ? ' ' + result.warning : ''}`)
        onImported()
      }
      setComplete(true)
    } catch (e) {
      if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) setStatus('Transfer stopped. The source project is unchanged.')
      else setError(axios.isAxiosError(e) && typeof e.response?.data?.detail === 'string' ? e.response.data.detail : e instanceof Error ? e.message : 'Transfer failed.')
    } finally { setBusy(false) }
  }

  return <section aria-label="Project transfer" className="my-4 rounded-lg border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel p-4 space-y-3 text-sm">
    <h2 className="font-semibold">{project ? `Export project: ${project.name}` : 'Import project'}</h2>
    <p>Move a saved project between Preview, Desktop and Stable Web. Includes schedules, model assignments, site objects, saved views, materials and project files. Imports create a separate project.</p>
    <p className="text-xs text-gray-500 dark:text-prosota-muted">Save your edits first. Account settings, browser preferences and cached map tiles are not transferred. Export a project folder to keep large models out of memory; keep the whole folder together.</p>
    {!project && !complete && <>
      <input ref={input} type="file" multiple {...{ webkitdirectory: '' }} className="hidden" onChange={e => void choose(Array.from(e.target.files ?? []))} />
      <button disabled={busy} className="border rounded px-3 py-1.5 disabled:opacity-50" onClick={() => input.current?.click()}>Choose project folder</button>
      {folder && <>
        <p>{folder.data.records.activities?.length ?? 0} activities · {folder.data.records.model_element_links?.length ?? 0} model assignments · {folder.data.files.length} files · {(folder.data.files.reduce((sum, f) => sum + f.size, 0) / 1024**3).toFixed(2)} GB</p>
        <label className="block">New project name<input value={name} maxLength={255} disabled={busy} onChange={e => setName(e.target.value)} className="block w-full mt-1 border rounded px-3 py-2 dark:bg-prosota-panel2 dark:border-prosota-line" /></label>
      </>}
    </>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
    <div className="flex gap-3">
      {!complete && <button disabled={busy || (!project && (!folder || !name.trim()))} onClick={() => void run()} className="bg-blue-600 text-white rounded px-3 py-1.5 disabled:opacity-50">{busy ? 'Transferring…' : error ? 'Retry transfer' : project ? 'Save project folder' : 'Import as new project'}</button>}
      {busy ? <button onClick={() => operation.current?.abort()}>Stop</button> : <button onClick={() => void close()}>Close</button>}
    </div>
  </section>
}
