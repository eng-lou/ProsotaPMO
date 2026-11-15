import { IfcAPI } from 'web-ifc'
import { extractIfcGeometry } from './ifcGeometryData'
import { ifcGeometryCacheKey, readIfcGeometryCache, writeIfcGeometryCache } from './ifcGeometryCache'

const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(data: unknown, transfer?: Transferable[]): void }
scope.onmessage = async ({ data }: MessageEvent<{ file: File; wasmPath: string }>) => {
  let api: IfcAPI | undefined
  let model: number | undefined
  try {
    scope.postMessage({ phase: 'Checking saved geometry…' })
    let key: string | undefined
    try { key = await ifcGeometryCacheKey(data.file) } catch { /* Crypto unavailable: importing still works. */ }
    const cached = key ? await readIfcGeometryCache(key) : null
    if (cached) {
      scope.postMessage({ phase: 'Opening saved geometry…' })
      scope.postMessage({ result: cached }, cached.geometries.flatMap(g => [g.vertices.buffer, g.indices.buffer]) as ArrayBuffer[])
      return
    }
    api = new IfcAPI()
    api.SetWasmPath(data.wasmPath, true); await api.Init(undefined, true)
    scope.postMessage({ phase: 'Reading IFC records…' })
    model = api.OpenModel(new Uint8Array(await data.file.arrayBuffer()))
    scope.postMessage({ phase: 'Preparing model geometry…' })
    const result = extractIfcGeometry(api, model, count => scope.postMessage({ phase: `Preparing geometry: ${count.toLocaleString()} pieces…` }))
    if (key) { scope.postMessage({ phase: 'Saving reusable geometry…' }); await writeIfcGeometryCache(key, result) }
    // The UI owns transferred buffers. No second copy of the whole geometry.
    scope.postMessage({ result }, result.geometries.flatMap(g => [g.vertices.buffer, g.indices.buffer]) as ArrayBuffer[])
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
  finally { if (model !== undefined) api?.CloseModel(model); api?.Dispose() }
}
