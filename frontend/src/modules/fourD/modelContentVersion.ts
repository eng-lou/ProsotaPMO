import axios from 'axios'
import { api } from '@/lib/api'

// Restore and cache pruning ask for the same version concurrently. Share only
// in-flight checks; never retain a revision across a later reload or replacement.
const pending = new Map<string, Promise<string>>()

export function getModelContentVersion(fileId: string): Promise<string> {
  const existing = pending.get(fileId)
  if (existing) return existing
  const request = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const { data } = await api.get<{ version: string }>(
          `/api/v1/model3d-files/${fileId}/content-version`, { timeout: 60_000 },
        )
        if (typeof data.version !== 'string' || !data.version) throw new Error('Missing model content version')
        return data.version
      } catch (error) {
        const retryable = axios.isAxiosError(error) && error.code !== 'ERR_CANCELED'
          && (!error.response || error.response.status >= 500)
        if (!retryable || attempt >= 2) throw error
        await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 2_000 : 5_000))
      }
    }
  })()
  pending.set(fileId, request)
  const cleanup = () => { if (pending.get(fileId) === request) pending.delete(fileId) }
  void request.then(cleanup, cleanup)
  return request
}
