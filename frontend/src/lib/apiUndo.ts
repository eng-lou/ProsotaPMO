import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import fields from './undoFields.json'
import { undoHistory, undoRefresh } from './undoHistory'

type Row = Record<string, any>
type Source = { url: string; params?: any }
type Cached = { row: Row; source: Source }
type TrackedConfig = InternalAxiosRequestConfig & { undoBefore?: Cached; undoScope?: string; undoResource?: string; undoPending?: boolean }
const schemas = fields as Record<string, { method: string; fields: string[] }>
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function reversibleChanges(resource: string, before: Row, after: Row) {
  const keys = (schemas[resource]?.fields ?? []).filter(k => k !== 'version' && k in before && k in after && !sameValue(before[k], after[k]))
  return { before: Object.fromEntries(keys.map(k => [k, before[k]])), after: Object.fromEntries(keys.map(k => [k, after[k]])) }
}
// The response cache supplies the authoritative list/detail URL, including its
// project/period filters. Only declared update fields are ever sent back.
export function installApiUndo(api: AxiosInstance) {
  const rows = new Map<string, Cached>()
  const sources = new Map<string, Source>()
  const compact = (resource: string, row: Row) => Object.fromEntries(['id', 'version', ...(schemas[resource]?.fields ?? [])].filter(k => k in row).map(k => [k, row[k]]))
  let scope = undoHistory.scope
  const syncScope = () => { if (scope !== undoHistory.scope) { rows.clear(); sources.clear(); scope = undoHistory.scope } }
  const path = (url = '') => url.split('?')[0].replace(/\/$/, '')
  const resourceOf = (url: string) => path(url).split('/')[3]
  const find = (data: any, id: string): Row | undefined => Array.isArray(data) ? data.find(r => r?.id === id) : data?.id === id ? data : undefined
  const remember = (url: string, data: any, source: Source) => {
    const resource = resourceOf(url)
    if (!schemas[resource]) return
    const list = Array.isArray(data) ? data : data?.id ? [data] : []
    if (Array.isArray(data)) sources.set(resource, source)
    for (const row of list) if (row?.id) {
      const key = `/api/v1/${resource}/${row.id}`
      rows.delete(key); rows.set(key, { row: structuredClone(compact(resource, row)), source })
      if (rows.size > 1000) rows.delete(rows.keys().next().value!)
    }
  }
  api.interceptors.request.use(async config => {
    syncScope()
    const c = config as TrackedConfig
    c.undoScope = scope
    if (undoHistory.busy || !scope) return c
    const resource = resourceOf(c.url ?? '')
    if (schemas[resource]?.method !== c.method || !/^\/api\/v1\/[^/]+\/[^/]+$/.test(path(c.url))) return c
    let cached = rows.get(path(c.url))
    if (!cached && sources.has(resource)) {
      const source = sources.get(resource)!
      // Large lists retain a bounded cache; fetch an evicted row only when edited.
      try {
        const result = await api.get(source.url, { params: source.params })
        const row = find(result.data, path(c.url).split('/').pop()!)
        if (row) cached = { row: compact(resource, row), source }
      } catch { /* A history lookup must not prevent the user's normal save. */ }
    }
    const payload = typeof c.data === 'string' ? JSON.parse(c.data) : c.data
    // These operations also rewrite relationships/hierarchy, not just this row.
    if (resource === 'activities' && (payload?.amend_relationships || (payload?.parent_id !== undefined && payload.parent_id !== cached?.row.parent_id) || (payload?.activity_type !== undefined && payload.activity_type !== cached?.row.activity_type))) return c
    if (cached) { c.undoBefore = structuredClone(cached); c.undoResource = resource; c.undoPending = true; undoHistory.pending++; undoHistory.emit() }
    return c
  })
  const settled = (c?: TrackedConfig) => { if (c?.undoPending) { c.undoPending = false; undoHistory.pending--; undoHistory.emit() } }
  api.interceptors.response.use(response => {
    const c = response.config as TrackedConfig
    settled(c); syncScope()
    if (c.undoScope !== scope) return response
    if (!undoHistory.busy && ['post', 'put', 'patch', 'delete'].includes(c.method ?? '') && undoHistory.future.length) {
      undoHistory.future = []; undoHistory.emit()
    }
    const url = c.url ?? ''
    if (c.method === 'get') remember(url, response.data, { url, params: c.params })
    else {
      const old = rows.get(path(url))
      if (old && response.data?.id) remember(url, response.data, old.source)
    }
    if (!undoHistory.busy && c.undoBefore && c.undoResource && response.data?.id) {
      const resource = c.undoResource, before = c.undoBefore.row, after = response.data as Row
      const changes = reversibleChanges(resource, before, after)
      if (!Object.keys(changes.before).length) return response
      const source = c.undoBefore.source, actionScope = scope
      let expected = structuredClone(compact(resource, after))
      const apply = async (values: Row) => {
        if (undoHistory.scope !== actionScope) throw new Error('Switch back to the original project before undoing this edit.')
        const result = await api.get(source.url, { params: source.params })
        const current = find(result.data, before.id)
        if (!current) throw new Error('This record is no longer available. Refresh and check it before editing.')
        // Compare editable values, not timestamps/computed roll-ups. Never
        // overwrite a newer edit detected on the server.
        const conflict = schemas[resource].fields.some(k => k !== 'version' && k in expected && k in current && !sameValue(expected[k], current[k]))
        if (conflict) throw new Error('This record has changed since your edit. Refresh it before continuing.')
        const base = c.method === 'put' ? Object.fromEntries(schemas[resource].fields.filter(k => k in current).map(k => [k, current[k]])) : {}
        const payload = { ...base, ...values, ...('version' in current ? { version: current.version } : {}) }
        const restored = await api.request({ url, method: c.method, data: payload })
        expected = structuredClone(compact(resource, restored.data))
        undoRefresh()
      }
      undoHistory.record({ label: `${resource.replace(/-/g, ' ')}: ${before.task_name ?? before.title ?? before.name ?? before.description ?? 'edit'}`, undo: () => apply(changes.before), redo: () => apply(changes.after) })
    }
    return response
  }, error => { settled(error.config); return Promise.reject(error) })
}
