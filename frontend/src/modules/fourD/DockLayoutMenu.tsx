import { useEffect, useRef, useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { DockLayout } from './dockLayouts'

interface Props {
  layouts: DockLayout[]
  loading: boolean
  onApply: (id: string) => void
  onSaveNew: (name: string) => void
  onOverwrite: (id: string, name: string) => void
  onDelete: (id: string) => void
  onReset: () => void
}

// Save/edit/delete named dock-window arrangements (2026-07-11, per Maro: "at
// the top, allow me to save layout, edit, delete. so i can create different
// dockable layouts sizes etc.") — same create(don't apply)/apply/delete/
// reset shape as Scheduling.tsx's LayoutWidget, condensed into a toolbar
// popover instead of a page section (there's no room in the 4D toolbar for
// a full table). "Edit" here means overwrite the saved layout with
// whatever's currently live (which windows are open, their dock side,
// heights, split ratios) — there's no separate settings form to tweak the
// way LayoutWidget's colour/font fields have one, the live arrangement IS
// the thing being saved.
export function DockLayoutMenu({ layouts, loading, onApply, onSaveNew, onOverwrite, onDelete, onReset }: Props) {
  const [open, setOpen] = useState(false)
  const [savingName, setSavingName] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const timer = setTimeout(() => document.addEventListener('click', onDocClick), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', onDocClick) }
  }, [open])

  const handleApply = async (layout: DockLayout) => {
    if (!(await confirmWithDontAsk('fourD.layout-apply', `Apply the dock layout "${layout.name}"? This replaces your current window arrangement.`))) return
    onApply(layout.id)
  }

  const handleDelete = async (layout: DockLayout) => {
    if (!(await confirmWithDontAsk('fourD.layout-delete', `Delete the saved layout "${layout.name}"? This cannot be undone.`))) return
    onDelete(layout.id)
  }

  const handleReset = async () => {
    if (!(await confirmWithDontAsk('fourD.layout-reset', 'Reset to the built-in default dock arrangement? Saved layouts are not deleted — just deactivated.'))) return
    onReset()
  }

  const startRename = (layout: DockLayout) => {
    setRenamingId(layout.id)
    setRenameValue(layout.name)
  }

  const confirmRename = (id: string) => {
    if (renameValue.trim()) onOverwrite(id, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
          open ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
        }`}
      >
        Layout ▾
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
            {loading && <p className="px-1 py-2 text-xs text-gray-400">Loading…</p>}
            {!loading && layouts.length === 0 && (
              <p className="px-1 py-2 text-xs text-gray-400">No saved layouts yet.</p>
            )}
            {layouts.map(layout => (
              <div key={layout.id} className="flex items-center gap-1.5 py-1.5">
                {renamingId === layout.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') confirmRename(layout.id); if (e.key === 'Escape') setRenamingId(null) }}
                    onBlur={() => confirmRename(layout.id)}
                    className="flex-1 min-w-0 text-xs border border-gray-300 rounded px-1.5 py-0.5"
                  />
                ) : (
                  <span className="flex-1 min-w-0 truncate text-xs text-gray-700" title={layout.name}>{layout.name}</span>
                )}
                {layout.is_active ? (
                  <span className="text-[10px] text-blue-600 font-medium shrink-0">✓ Applied</span>
                ) : (
                  <button onClick={() => handleApply(layout)} title="Apply" className="text-xs text-gray-400 hover:text-gray-700 shrink-0">Apply</button>
                )}
                <button
                  onClick={() => (renamingId === layout.id ? confirmRename(layout.id) : startRename(layout))}
                  title="Rename, or overwrite with the current arrangement"
                  className="text-xs text-gray-400 hover:text-gray-700 shrink-0"
                >
                  ✎
                </button>
                <button onClick={() => handleDelete(layout)} title="Delete" className="text-xs text-gray-400 hover:text-red-600 shrink-0">✕</button>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 mt-1 pt-1.5">
            {savingName !== null ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={savingName}
                  onChange={e => setSavingName(e.target.value)}
                  placeholder="Layout name…"
                  onKeyDown={e => { if (e.key === 'Enter' && savingName.trim()) { onSaveNew(savingName.trim()); setSavingName(null) }; if (e.key === 'Escape') setSavingName(null) }}
                  className="flex-1 min-w-0 text-xs border border-gray-300 rounded px-1.5 py-0.5"
                />
                <button
                  onClick={() => { if (savingName.trim()) { onSaveNew(savingName.trim()); setSavingName(null) } }}
                  disabled={!savingName.trim()}
                  className="text-xs px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            ) : (
              <button onClick={() => setSavingName('')} className="w-full text-left text-xs text-gray-600 hover:text-gray-900 px-1 py-1">
                + Save current as new layout
              </button>
            )}
            <button onClick={handleReset} className="w-full text-left text-[11px] text-gray-400 hover:text-gray-600 px-1 pt-1">
              ↺ Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
