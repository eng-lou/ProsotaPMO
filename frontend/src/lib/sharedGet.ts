import { api } from './api'
import { sharePendingRead } from './pendingReads'

// Explicit opt-in for startup metadata and read-only dashboard series.
// Do not use for writes or requests with caller-owned abort signals.
export function sharedGet<T>(url: string, config: { params: Record<string, string> }) {
  const key = JSON.stringify([url, Object.entries(config.params).sort(([a], [b]) => a.localeCompare(b))])
  return sharePendingRead(key, () => api.get<T>(url, config))
}
