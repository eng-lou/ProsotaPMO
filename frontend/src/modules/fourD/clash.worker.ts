import { computeClashes } from './clashGeometry'
self.onmessage = ({ data }) => {
  try {
    const result = computeClashes(data.elements, data.aKeys, data.bKeys, data.kind, data.tolerance, data.metresPerUnit,
      (done, total) => self.postMessage({ progress: { done, total } }))
    self.postMessage({ result })
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Clash calculation failed' }) }
}
