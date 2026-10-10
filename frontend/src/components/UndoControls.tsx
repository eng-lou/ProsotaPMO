import { useEffect, useSyncExternalStore } from 'react'
import { undoHistory } from '@/lib/undoHistory'
export function UndoControls() {
  useSyncExternalStore(undoHistory.subscribe, undoHistory.snapshot)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.defaultPrevented || e.altKey || !(e.ctrlKey || e.metaKey)) return
      // Preserve the browser's own text editing undo, including unsaved forms.
      if (target?.isContentEditable || target?.closest('input, textarea, select')) return
      const k = e.key.toLowerCase()
      if (k !== 'z' && k !== 'y') return
      e.preventDefault()
      void undoHistory.run(k === 'y' || e.shiftKey)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const disabled = undoHistory.busy || undoHistory.pending > 0
  const cls = 'rounded border px-2 py-1 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-prosota-panel'
  return <div className="no-print mb-3 text-xs text-gray-600 dark:text-prosota-muted">
    <div className="flex gap-1">
      <button className={cls} disabled={disabled || !undoHistory.past.length} title={`Ctrl+Z: ${undoHistory.past[undoHistory.past.length - 1]?.label ?? 'Nothing to undo'}`} onClick={() => void undoHistory.run()}>↶ Undo</button>
      <button className={cls} disabled={disabled || !undoHistory.future.length} title={`Ctrl+Shift+Z / Ctrl+Y: ${undoHistory.future[undoHistory.future.length - 1]?.label ?? 'Nothing to redo'}`} onClick={() => void undoHistory.run(true)}>↷ Redo</button>
    </div>
    {undoHistory.message && <p role="status" className="mt-1 break-words">{undoHistory.message}</p>}
  </div>
}
