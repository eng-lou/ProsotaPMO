import type { IfcGeometryData } from './ifcGeometryData'

const jobs = new Set<() => void>()
export function cancelIfcGeometryPreparations() {
  for (const cancel of jobs) cancel()
  jobs.clear()
}

export async function prepareIfcGeometry(file: File, progress?: (phase: string) => void): Promise<IfcGeometryData | undefined> {
  if (typeof Worker === 'undefined' || typeof location === 'undefined') return undefined
  progress?.('Checking saved geometry…')
  const worker = new Worker(new URL('./ifcGeometry.worker.ts', import.meta.url), { type: 'module' })
  let cancel = () => {}
  try {
    const data = await new Promise<IfcGeometryData>((resolve, reject) => {
      cancel = () => { worker.terminate(); reject(new DOMException('Model loading cancelled', 'AbortError')) }
      jobs.add(cancel)
      worker.onmessage = ({ data }) => {
        if (data.error) reject(new Error(data.error))
        else if (data.result) resolve(data.result)
        else if (data.phase) progress?.(data.phase)
      }
      worker.onerror = event => reject(new Error(event.message || 'The IFC geometry worker could not start. Reload and retry the import.'))
      worker.postMessage({ file, wasmPath: new URL('/wasm-ifc/', location.href).href })
    })
    return data
  } finally { jobs.delete(cancel); worker.terminate() }
}
