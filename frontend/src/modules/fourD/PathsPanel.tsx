import { useState } from 'react'
import type { Path } from './paths'
import type { PathFollower, PathFollowerTargetKind } from './pathFollowers'

interface BindTarget {
  kind: Exclude<PathFollowerTargetKind, 'camera'>
  ref: string
  label: string
}

interface Props {
  paths: Path[]
  error: string | null
  addingPointsForPathId: string | null
  bindTarget: BindTarget | null
  followers: PathFollower[]
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onToggleClosed: (id: string) => void
  onToggleVisible: (id: string) => void
  onDelete: (id: string) => void
  onToggleAddPoints: (id: string) => void
  onRemoveLastPoint: (id: string) => void
  onBind: (pathId: string) => void
  onUnbind: (followerId: string) => void
  onToggleOrient: (followerId: string) => void
}

function Item({
  path, addingPoints, binding, error: _error, onRename, onToggleClosed, onToggleVisible, onDelete, onToggleAddPoints, onRemoveLastPoint, onBind, onUnbind, onToggleOrient, bindTarget,
}: {
  path: Path
  addingPoints: boolean
  binding: PathFollower | undefined
  error: string | null
  onRename: (name: string) => void
  onToggleClosed: () => void
  onToggleVisible: () => void
  onDelete: () => void
  onToggleAddPoints: () => void
  onRemoveLastPoint: () => void
  onBind: () => void
  onUnbind: () => void
  onToggleOrient: () => void
  bindTarget: BindTarget | null
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(path.name)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== path.name) onRename(trimmed)
    else setDraftName(path.name)
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input type="checkbox" checked={path.visible} onChange={onToggleVisible} title={path.visible ? 'Visible — click to hide the curve' : 'Hidden — click to show the curve'} />
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftName(path.name); setEditing(false) }
            }}
            className="flex-1 text-xs border border-gray-300 rounded px-1 py-0.5 min-w-0"
          />
        ) : (
          <span onDoubleClick={() => setEditing(true)} className="flex-1 text-xs text-gray-700 truncate cursor-text" title="Double-click to rename">
            {path.name}
          </span>
        )}
        <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 hover:text-red-600 shrink-0">✕</button>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={onToggleAddPoints}
          className={`text-xs px-2 py-0.5 rounded border font-medium ${
            addingPoints ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
          title={addingPoints ? 'Click in the viewport to add points — click again to stop' : 'Click points in the viewport to add to this curve'}
        >
          {addingPoints ? 'Adding… (click viewport)' : '+ Point'}
        </button>
        <button
          onClick={onRemoveLastPoint}
          disabled={path.points.length === 0}
          className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 disabled:hover:bg-transparent"
        >
          Undo last point
        </button>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          <input type="checkbox" checked={path.closed} onChange={onToggleClosed} />
          Closed
        </label>
        <span className="text-xs text-gray-400">{path.points.length} pt{path.points.length === 1 ? '' : 's'}</span>
      </div>
      {binding ? (
        <div className="flex items-center gap-1.5 text-xs text-gray-600 bg-sky-50 border border-sky-100 rounded px-2 py-1">
          <span className="flex-1 truncate">Bound: {binding.target_kind} · {binding.element_ref || '(whole)'}</span>
          <label className="flex items-center gap-1 shrink-0">
            <input type="checkbox" checked={binding.orient_to_path} onChange={onToggleOrient} />
            Orient
          </label>
          <button onClick={onUnbind} className="text-gray-400 hover:text-red-600 shrink-0">✕</button>
        </div>
      ) : (
        <button
          onClick={onBind}
          disabled={!bindTarget || path.points.length < 2}
          title={!bindTarget ? 'Select a mesh or IFC element first' : path.points.length < 2 ? 'Add at least 2 points first' : `Bind ${bindTarget.label} to follow this path`}
          className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 disabled:hover:bg-transparent"
        >
          Bind selected {bindTarget ? `(${bindTarget.label})` : ''}
        </button>
      )}
    </div>
  )
}

// "Paths" dockable panel (2026-07-11, per Maro's Blender curve reference:
// "in blender you can add a curve, edit it and set a path from point a to
// b... i can then place an object to follow that path") — same shared-
// side-dock treatment as Sections/Camera Views/Collections (SideDock.tsx).
// Each path: visibility + closed toggles, "+ Point" arms click-to-place mode
// in the viewport (PathGizmo.tsx's PathAddPointCatcher), and a bind control
// that attaches whatever's currently selected (a mesh or IFC element —
// camera binding is a later pass, see this session's own scoping decision)
// as a PathFollower. Deliberately no per-point numeric editing here — drag
// handles in the viewport (PathGizmo.tsx) are the only way to reposition an
// existing point, matching the "click-to-place" spirit of the whole feature
// rather than mixing in a second, numeric-list editing mode.
export function PathsPanel({
  paths, error, addingPointsForPathId, bindTarget, followers,
  onCreate, onRename, onToggleClosed, onToggleVisible, onDelete, onToggleAddPoints, onRemoveLastPoint, onBind, onUnbind, onToggleOrient,
}: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
        <span className="text-xs text-gray-500">Paths</span>
        <button onClick={onCreate} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
          + Add
        </button>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
      {paths.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400">
          "+ Add" a path, then "+ Point" and click in the viewport to lay down its curve.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {paths.map(path => (
            <Item
              key={path.id}
              path={path}
              addingPoints={addingPointsForPathId === path.id}
              binding={followers.find(f => f.path_id === path.id)}
              error={error}
              bindTarget={bindTarget}
              onRename={name => onRename(path.id, name)}
              onToggleClosed={() => onToggleClosed(path.id)}
              onToggleVisible={() => onToggleVisible(path.id)}
              onDelete={() => onDelete(path.id)}
              onToggleAddPoints={() => onToggleAddPoints(path.id)}
              onRemoveLastPoint={() => onRemoveLastPoint(path.id)}
              onBind={() => onBind(path.id)}
              onUnbind={() => {
                const binding = followers.find(f => f.path_id === path.id)
                if (binding) onUnbind(binding.id)
              }}
              onToggleOrient={() => {
                const binding = followers.find(f => f.path_id === path.id)
                if (binding) onToggleOrient(binding.id)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
