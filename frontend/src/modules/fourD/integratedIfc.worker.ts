import { IfcAPI } from 'web-ifc'
import { exportIntegratedIfc, type IfcExportSource } from './integratedIfcExport'
import type { IntegratedIfcData } from './integratedIfcData'

self.onmessage = async (event: MessageEvent<{ sources: IfcExportSource[]; data: IntegratedIfcData; wasmPath: string }>) => {
  const api = new IfcAPI()
  try {
    api.SetWasmPath(event.data.wasmPath, true)
    await api.Init(undefined, true)
    const result = await exportIntegratedIfc(api, event.data.sources, event.data.data,
      message => self.postMessage({ type: 'progress', message }))
    self.postMessage({ type: 'done', ...result }, { transfer: [result.bytes.buffer] })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'IFC export failed.' })
  } finally { api.Dispose() }
}
