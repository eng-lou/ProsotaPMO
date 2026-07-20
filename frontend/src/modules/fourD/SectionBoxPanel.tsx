import { useState } from 'react'
import type { SectionBox } from './sectionBoxes'

export type SectionBoxTool = 'resize' | 'rotate'

interface Props {
  boxes: SectionBox[]
  canCreate: boolean
  error: string | null
  tool: SectionBoxTool
  onToolChange: (tool: SectionBoxTool) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onToggleActive: (id: string) => void
  onToggleVisible: (id: string) => void
  onDelete: (id: string) => void
}

function Item({ box, onRename, onToggleActive, onToggleVisible, onDelete }: {
  box: SectionBox
  onRename: (name: string) => void
  onToggleActive: () => void
  onToggleVisible: () => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(box.name)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== box.name) onRename(trimmed)
    else setDraftName(box.name)
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2">
      <input
        type="checkbox"
        checked={box.active}
        onChange={onToggleActive}
        title={box.active ? 'Active — click to disable clipping' : 'Inactive — click to enable clipping'}
      />
      <input
        type="checkbox"
        checked={box.visible}
        onChange={onToggleVisible}
        title={box.visible ? 'Visible — click to hide the box' : 'Hidden — click to show the box'}
      />
      {editing ? (
        <input
          autoFocus
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') { setDraftName(box.name); setEditing(false) }
          }}
          className="flex-1 text-xs border border-gray-300 rounded px-1 py-0.5 min-w-0"
        />
      ) : (
        <span
          onDoubleClick={() => setEditing(true)}
          className="flex-1 text-xs text-gray-700 truncate cursor-text"
          title="Double-click to rename"
        >
          {box.name}
        </span>
      )}
      <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 hover:text-red-600 shrink-0">✕</button>
    </div>
  )
}

// "Sections" tab of the right-side DataPanel (2026-07-09, per Maro's
// Blender "Section Box" plugin reference, walked through via screenshots)
// — a list of section boxes with the same checkbox-vs-eye-icon distinction
// as the reference (active = clip is applied, visible = wireframe gizmo is
// shown; independent of each other), double-click-to-rename, delete, and
// "+ Add" seeded from whatever's currently selected in the viewport
// (FourD.tsx's handleCreateSectionBox — mirrors the reference's own
// "select something, then click +" flow). Content-only — DataPanel.tsx
// owns the outer chrome and tab bar, same as IfcDataPanel/MeshDataPanel.
//
// This tab covers create/rename/toggle/delete; the interactive per-face
// resize/rotate handles and element/multi-element scoping live in the
// viewport itself (SectionBoxGizmo.tsx), not here.
export function SectionBoxPanel({ boxes, canCreate, error, tool, onToolChange, onCreate, onRename, onToggleActive, onToggleVisible, onDelete }: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
        <span className="text-xs text-gray-500">Section Boxes</span>
        <button
          onClick={onCreate}
          disabled={!canCreate}
          title={canCreate ? 'Add a section box around the selected object' : 'Select an object first'}
          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 disabled:hover:bg-transparent"
        >
          + Add
        </button>
      </div>
      {/* Resize vs Rotate (2026-07-17, per Maro: "the rotation handles make
          it hard to manipulate the original handles" — showing both the
          6 face-resize cones and drei's own rotate rings at once meant
          they fought over the same clicks/screen space, worse the bigger
          the rotate rings' own camera-distance-based auto-scaling made
          them relative to a small/thin box. One tool active at a time
          instead, same G/R mode-switch convention as the Blender reference
          this whole feature is built from — defaults to resize so nothing
          about existing drag behavior changes unless you switch.) */}
      {boxes.length > 0 && (
        <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-1">
          <button
            onClick={() => onToolChange('resize')}
            className={`text-xs px-2 py-1 rounded border ${tool === 'resize' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            Resize
          </button>
          <button
            onClick={() => onToolChange('rotate')}
            className={`text-xs px-2 py-1 rounded border ${tool === 'rotate' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            Rotate
          </button>
        </div>
      )}
      {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
      {boxes.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400">
          Select an object, then "+ Add" to create a section box you can use to cut through it.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {boxes.map(box => (
            <Item
              key={box.id}
              box={box}
              onRename={name => onRename(box.id, name)}
              onToggleActive={() => onToggleActive(box.id)}
              onToggleVisible={() => onToggleVisible(box.id)}
              onDelete={() => onDelete(box.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
