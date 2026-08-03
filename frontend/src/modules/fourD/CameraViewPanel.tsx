import { useState } from 'react'
import type { CameraView } from './cameraViews'

interface Props {
  views: CameraView[]
  error: string | null
  onApply: (view: CameraView) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

function Item({ view, onApply, onRename, onDelete }: {
  view: CameraView
  onApply: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(view.name)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== view.name) onRename(trimmed)
    else setDraftName(view.name)
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2">
      {editing ? (
        <input
          autoFocus
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') { setDraftName(view.name); setEditing(false) }
          }}
          className="flex-1 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 min-w-0"
        />
      ) : (
        <span
          onClick={onApply}
          onDoubleClick={e => { e.stopPropagation(); setEditing(true) }}
          className="flex-1 text-xs text-gray-700 dark:text-prosota-muted truncate cursor-pointer hover:text-gray-900"
          title="Click to jump to this view — double-click to rename"
        >
          {view.name}
        </span>
      )}
      <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
    </div>
  )
}

// "Camera Views" tab of the right-side dockable panel (2026-07-10, per
// Maro: "add camera too so i can capture the model at different angles
// like blender") — Blender's own numbered-viewpoint bookmarks: save the
// current camera position + orbit target under a name, click any saved
// entry to jump straight back to it. Content-only — SideDock.tsx owns the
// outer chrome, same as AnimationProfilePanel/SectionBoxPanel.
//
// No "Save Current" button *here* — that lives in Viewport3D.tsx's own
// toolbar ("Save View", next to Frame Selected/Capture) since it needs
// direct access to the live camera/controls refs, which only that
// component holds; this panel only ever needs the already-saved list.
export function CameraViewPanel({ views, error, onApply, onRename, onDelete }: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line sticky top-0 bg-white dark:bg-prosota-panel">
        <span className="text-xs text-gray-500 dark:text-prosota-muted">Camera Views</span>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {views.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400 dark:text-prosota-muted">
          Line up the angle you want in the viewport, then click "Save View" in the toolbar above it to bookmark it — click any saved view here to jump back.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {views.map(view => (
            <Item
              key={view.id}
              view={view}
              onApply={() => onApply(view)}
              onRename={name => onRename(view.id, name)}
              onDelete={() => onDelete(view.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
