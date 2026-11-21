export interface UndoAction {
  label: string
  owner?: object
  group?: unknown
  savedId?: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}
export class UndoHistory {
  past: UndoAction[] = []
  future: UndoAction[] = []
  busy = false
  pending = 0
  message = ''
  revision = 0
  scope = ''
  private listeners = new Set<() => void>()
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  snapshot = () => this.revision
  emit() { this.revision++; this.listeners.forEach(fn => fn()) }
  setScope(scope: string) { if (scope !== this.scope) { this.scope = scope; this.clear() } }
  clear() { this.past = []; this.future = []; this.message = ''; this.emit() }
  remove(owner: object) { this.past = this.past.filter(x => x.owner !== owner); this.future = this.future.filter(x => x.owner !== owner); this.emit() }
  restore(owner: object, past: UndoAction[], future: UndoAction[]) {
    // Keep other tools' actions in place. Reuse live callbacks for mixed 3D edits.
    const merge = (current: UndoAction[], saved: UndoAction[]) => {
      const merged: UndoAction[] = []
      let next = 0
      for (const action of current) {
        if (action.owner !== owner) { merged.push(action); continue }
        const pos = saved.findIndex(entry => entry.savedId === action.savedId)
        if (pos < next) continue
        merged.push(...saved.slice(next, pos), action)
        next = pos + 1
      }
      return (next ? [...merged, ...saved.slice(next)] : [...saved, ...merged]).slice(-10)
    }
    this.past = merge(this.past, past)
    this.future = merge(this.future, future)
    this.emit()
  }
  record(action: UndoAction) {
    if (this.busy) return
    const last = this.past[this.past.length - 1]
    if (action.group !== undefined && last?.group === action.group && last.owner === action.owner) {
      last.redo = action.redo
    } else {
      this.past.push(action)
      if (this.past.length > 10) this.past.shift()
    }
    this.future = []; this.message = ''; this.emit()
  }
  async run(redo = false) {
    if (this.busy || this.pending) return
    const source = redo ? this.future : this.past
    const action = source[source.length - 1]
    if (!action) { this.message = redo ? 'Nothing to redo' : 'Nothing to undo'; this.emit(); return }
    const scope = this.scope
    this.busy = true; this.message = ''; this.emit()
    try {
      await (redo ? action.redo() : action.undo())
      if (scope === this.scope) {
        const current = redo ? this.future : this.past
        if (current[current.length - 1] !== action) return
        current.pop(); (redo ? this.past : this.future).push(action)
        this.message = `${redo ? 'Redid' : 'Undid'} ${action.label}`
      }
    } catch (e) {
      if (scope === this.scope) {
        const detail = (e as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail
        const validation = Array.isArray(detail) ? detail.flatMap(issue => {
          if (typeof issue?.msg !== 'string') return []
          const location = Array.isArray(issue.loc) ? issue.loc.filter((part: unknown) => part !== 'body').join('.') : ''
          return [location ? `${location}: ${issue.msg}` : issue.msg]
        }).join(' · ') : ''
        const reason = typeof detail === 'string' && detail ? detail : validation || (e instanceof Error ? e.message : String(e))
        this.message = `Could not ${redo ? 'redo' : 'undo'} “${action.label}”. ${reason}`
      }
    } finally { this.busy = false; this.emit() }
  }
}
export const undoHistory = new UndoHistory()
export function undoRefresh() { window.dispatchEvent(new Event('prosota:undo-refresh')) }
