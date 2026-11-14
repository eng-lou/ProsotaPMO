import type { AxiosInstance } from 'axios'

type Timing = { kind: 'request' | 'main-thread'; name: string; durationMs: number; atMs: number; serverMs?: number }
const recent: Timing[] = []
function record(item: Timing) {
  recent.push(item)
  if (recent.length > 100) recent.shift()
}

// Bounded, memory-only diagnostics. No bodies, query strings, tokens or uploads.
export function installPerformanceDiagnostics(api: AxiosInstance) {
  if (typeof window === 'undefined') return
  ;(window as unknown as { prosotaPerformance: unknown }).prosotaPerformance = {
    snapshot: () => recent.map(item => ({ ...item })),
    clear: () => { recent.length = 0 },
  }
  const started = new WeakMap<object, number>()
  api.interceptors.request.use(config => { started.set(config, performance.now()); return config })
  const finish = (config: object & { url?: string; method?: string } | undefined, serverTiming?: string) => {
    if (!config) return
    const start = started.get(config)
    if (start === undefined) return
    started.delete(config)
    const durationMs = performance.now() - start
    if (durationMs < 250) return
    const path = (config.url ?? '').split('?')[0].replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, ':id')
    const server = serverTiming?.match(/app;dur=([\d.]+)/)
    record({ kind: 'request', name: `${config.method?.toUpperCase()} ${path}`, durationMs: Math.round(durationMs), atMs: Math.round(start), ...(server ? {serverMs: Number(server[1])} : {}) })
  }
  api.interceptors.response.use(response => {
    finish(response.config, response.headers['server-timing']); return response
  }, error => { finish(error.config, error.response?.headers?.['server-timing']); return Promise.reject(error) })
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (entry.duration >= 100) {
        record({kind: 'main-thread', name: 'Long task', durationMs: Math.round(entry.duration), atMs: Math.round(entry.startTime)})
      }
    }).observe({type: 'longtask'})
  }
}
