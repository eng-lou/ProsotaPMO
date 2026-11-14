import { api } from '@/lib/api'

export interface ProjectPackage {
  format: 'prosota-project'
  version: 1
  records: Record<string, Record<string, unknown>[]>
  files: { key: string; path: string; size: number }[]
  appearance?: Record<string, unknown>
}

export function inspectProjectPackage(value: unknown): ProjectPackage {
  const data = value as ProjectPackage
  if (data?.format !== 'prosota-project' || data.version !== 1 || data.records?.projects?.length !== 1 || !Array.isArray(data.files)) {
    throw new Error('Choose a Prosota project folder. IFC files and desktop workspace backups use different import options.')
  }
  if (typeof data.records.projects[0].name !== 'string' || data.files.length > 10000) throw new Error('Invalid project package.')
  const paths = new Set<string>()
  for (const file of data.files) {
    if (!/^files\/\d{5}$/.test(file.path) || paths.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Invalid project file inventory.')
    paths.add(file.path)
  }
  return data
}

export function readProjectFolder(files: File[]) {
  const manifests = files.filter(f => f.name === 'project.prosota.json')
  if (manifests.length > 1) throw new Error('Choose one exported project folder, not a directory containing several projects.')
  const manifest = manifests[0]
  if (!manifest || manifest.size > 128 * 1024 * 1024) throw new Error('Select the exported project folder containing project.prosota.json.')
  const prefix = manifest.webkitRelativePath.slice(0, -manifest.name.length)
  const byPath = new Map(files.filter(f => f.webkitRelativePath.startsWith(prefix)).map(f => [f.webkitRelativePath.slice(prefix.length), f]))
  return { manifest, byPath }
}

export function verifyProjectFiles(data: ProjectPackage, byPath: Map<string, Pick<File, 'size'>>) {
  for (const entry of data.files) {
    if (byPath.get(entry.path)?.size !== entry.size) throw new Error(`The project folder is incomplete: ${entry.path} is missing or has changed. Export it again.`)
  }
}

// Limited local interface: browser types do not yet expose showDirectoryPicker everywhere.
interface Directory {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<Directory>
  getFileHandle(name: string, options?: { create: boolean }): Promise<{ createWritable(): Promise<FileSystemWritableFileStream> }>
}
export async function chooseProjectDestination(): Promise<Directory> {
  const picker = (window as unknown as { showDirectoryPicker?: (options: unknown) => Promise<Directory> }).showDirectoryPicker
  if (!picker) throw new Error('Use Microsoft Edge or Google Chrome to export a project folder. Folder import is also available in other supported browsers.')
  return picker({ mode: 'readwrite' })
}

export async function exportProject(projectId: string, root: Directory, signal: AbortSignal, progress: (s: string) => void) {
  progress('Collecting saved project data…')
  const { data: prepared } = await api.post(`/api/v1/project-transfers/export/${projectId}`, {}, { signal, timeout: 240000 })
  const response = await fetch(prepared.manifest_url, { signal })
  if (!response.ok) throw new Error('Could not download the project manifest.')
  const snapshot = inspectProjectPackage(await response.json())
  const appearance = localStorage.getItem('prosota_4d_realistic_material_map_' + projectId)
  if (appearance) snapshot.appearance = JSON.parse(appearance)
  const manifestBytes = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
  const folderName = `${String(prepared.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80)}-${prepared.id}`
  const folder = await root.getDirectoryHandle(folderName, { create: true })
  const assets = await folder.getDirectoryHandle('files', { create: true })
  let downloads: { path: string; download_url: string }[] = []
  for (let i = 0; i < snapshot.files.length; i++) {
    const entry = snapshot.files[i]
    progress(`Saving project file ${i + 1} of ${snapshot.files.length}…`)
    if (i % 50 === 0) {
      const { data } = await api.get(`/api/v1/project-transfers/exports/${prepared.id}/files`, { params: { offset: i }, signal, timeout: 120000 })
      downloads = data.files
    }
    const fileResponse = await fetch(downloads[i % 50].download_url, { signal })
    if (!fileResponse.ok || !fileResponse.body) throw new Error(`Could not download ${entry.path}. The export is incomplete.`)
    const handle = await assets.getFileHandle(entry.path.split('/')[1], { create: true })
    const writable = await handle.createWritable()
    let bytes = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { bytes += chunk.byteLength; controller.enqueue(chunk) } })
    await fileResponse.body.pipeThrough(counter).pipeTo(writable, { signal })
    if (bytes !== entry.size) throw new Error(`The download of ${entry.path} was incomplete. Export the project again.`)
  }
  // Publish the manifest last. An interrupted export cannot be mistaken for a complete one.
  const manifestHandle = await folder.getFileHandle('project.prosota.json', { create: true })
  const writable = await manifestHandle.createWritable()
  await writable.write(manifestBytes)
  await writable.close()
  return folderName
}

export interface ImportSession { id?: string; uploaded: Set<string> }

export async function importProject(manifest: File, snapshot: ProjectPackage, files: Map<string, File>, name: string,
  session: ImportSession, signal: AbortSignal, progress: (s: string) => void) {
  verifyProjectFiles(snapshot, files)
  if (!session.id) {
    progress('Preparing a new project…')
    const { data } = await api.post('/api/v1/project-transfers/imports', {}, { signal })
    const upload = await fetch(data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: manifest, signal })
    if (!upload.ok) throw new Error('Could not upload the project manifest.')
    session.id = data.id
  }
  for (let offset = 0; offset < snapshot.files.length; offset += 50) {
    const { data } = await api.get(`/api/v1/project-transfers/imports/${session.id}/files`, { params: { offset }, signal, timeout: 120000 })
    for (const entry of data.files) {
      if (session.uploaded.has(entry.path)) continue
      progress(`Uploading file ${session.uploaded.size + 1} of ${snapshot.files.length}…`)
      // File objects upload directly; no base64, zip allocation, or serverless body-size limit.
      const result = await fetch(entry.upload_url, { method: 'PUT', headers: { 'Content-Type': entry.content_type }, body: files.get(entry.path), signal })
      if (!result.ok) throw new Error('A project file could not be uploaded. Retry to continue from the completed files.')
      session.uploaded.add(entry.path)
    }
  }
  progress('Restoring project records and assignments…')
  const { data } = await api.post(`/api/v1/project-transfers/imports/${session.id}/commit`, { name }, { signal, timeout: 240000 })
  if (data.appearance) {
    try { localStorage.setItem('prosota_4d_realistic_material_map_' + data.id, JSON.stringify(data.appearance)) }
    catch { data.warning = 'The project was imported, but this browser could not save its material mapping. Keep the export folder to restore it later.' }
  }
  return data as { id: string; name: string; warning?: string }
}
