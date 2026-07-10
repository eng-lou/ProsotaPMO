import { useState } from 'react'
import type { Collection } from './collections'

interface Props {
  collections: Collection[]
  error: string | null
  canAddSelected: boolean
  onCreate: (parentCollectionId: string | null) => void
  onRename: (id: string, name: string) => void
  onReparent: (id: string, parentCollectionId: string | null) => void
  onDelete: (id: string) => void
  onAddSelected: (id: string) => void
}

// "Move to…" reparent picker, not drag-and-drop (2026-07-11) — a plain
// <select> of every *other* collection gets the same outcome (nesting) for
// a fraction of the frontend risk a real drag-and-drop outliner would need.
// Excludes the collection itself and (client-side, cheaply, since trees
// here are small) its own descendants, so the dropdown never even offers
// an option the backend's cycle check would 422 anyway.
function descendantIds(collections: Collection[], rootId: string): Set<string> {
  const ids = new Set<string>()
  const walk = (parentId: string) => {
    for (const c of collections) {
      if (c.parent_collection_id === parentId && !ids.has(c.id)) {
        ids.add(c.id)
        walk(c.id)
      }
    }
  }
  walk(rootId)
  return ids
}

// Raw, unbound callbacks passed all the way down the tree — each node binds
// its own `collection.id` when it actually calls one, rather than the
// parent pre-binding a version scoped to itself (which would make every
// descendant silently act on its *ancestor's* id instead of its own).
function CollectionNode({ collection, allCollections, depth, canAddSelected, onCreate, onRename, onReparent, onDelete, onAddSelected }: {
  collection: Collection
  allCollections: Collection[]
  depth: number
  canAddSelected: boolean
  onCreate: (parentCollectionId: string | null) => void
  onRename: (id: string, name: string) => void
  onReparent: (id: string, parentCollectionId: string | null) => void
  onDelete: (id: string) => void
  onAddSelected: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(collection.name)
  const [expanded, setExpanded] = useState(true)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== collection.name) onRename(collection.id, trimmed)
    else setDraftName(collection.name)
  }

  const children = allCollections.filter(c => c.parent_collection_id === collection.id)
  const excluded = descendantIds(allCollections, collection.id)
  excluded.add(collection.id)
  const moveTargets = allCollections.filter(c => !excluded.has(c.id))

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ paddingLeft: `${12 + depth * 16}px` }}>
        {children.length > 0 ? (
          <button onClick={() => setExpanded(v => !v)} className="text-xs text-gray-400 w-3 shrink-0" title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftName(collection.name); setEditing(false) }
            }}
            className="flex-1 text-xs border border-gray-300 rounded px-1 py-0.5 min-w-0"
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            className="flex-1 text-xs text-gray-700 truncate cursor-text"
            title="Double-click to rename"
          >
            {collection.name}
            <span className="text-gray-400 ml-1">({collection.members.length})</span>
          </span>
        )}
        <select
          value={collection.parent_collection_id ?? ''}
          onChange={e => onReparent(collection.id, e.target.value || null)}
          title="Move to another collection"
          className="text-xs border border-gray-300 rounded px-1 py-0.5 max-w-[90px] shrink-0"
        >
          <option value="">— top level —</option>
          {moveTargets.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={() => onAddSelected(collection.id)}
          disabled={!canAddSelected}
          title={canAddSelected ? 'Add the current viewport selection to this collection' : 'Select something in the viewport first'}
          className="text-xs text-gray-400 hover:text-gray-700 disabled:text-gray-200 disabled:hover:text-gray-200 shrink-0"
        >
          ⊕
        </button>
        <button onClick={() => onCreate(collection.id)} title="Add sub-collection" className="text-xs text-gray-400 hover:text-gray-700 shrink-0">+</button>
        <button onClick={() => onDelete(collection.id)} title="Delete" className="text-xs text-gray-400 hover:text-red-600 shrink-0">✕</button>
      </div>
      {expanded && children.map(child => (
        <CollectionNode
          key={child.id}
          collection={child}
          allCollections={allCollections}
          depth={depth + 1}
          canAddSelected={canAddSelected}
          onCreate={onCreate}
          onRename={onRename}
          onReparent={onReparent}
          onDelete={onDelete}
          onAddSelected={onAddSelected}
        />
      ))}
    </div>
  )
}

// "Collections" dockable panel (2026-07-11, per Maro's Blender reference):
// create/nest/rename collections, freely group IFC sub-elements and whole
// mesh-kind objects into them independent of the IFC import's own spatial
// hierarchy, then select/hide/isolate by the group. Content-only —
// SideDock.tsx owns the outer chrome, same as
// AnimationProfilePanel/SectionBoxPanel/CameraViewPanel.
//
// Select/Hide/Isolate-by-collection buttons land in a later phase of this
// same feature (needs the sub-element hide extension, not built yet) — for
// now, per-row action is just ⊕ Add Selected + Move-to/rename/delete.
export function CollectionsPanel({ collections, error, canAddSelected, onCreate, onRename, onReparent, onDelete, onAddSelected }: Props) {
  const roots = collections.filter(c => c.parent_collection_id === null)

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
        <span className="text-xs text-gray-500">Collections</span>
        <button
          onClick={() => onCreate(null)}
          title="Add a new top-level collection"
          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          + Add
        </button>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
      {roots.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400">
          "+ Add" to create a collection, then group elements into it however you like — independent of the model's own import hierarchy.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {roots.map(collection => (
            <CollectionNode
              key={collection.id}
              collection={collection}
              allCollections={collections}
              depth={0}
              canAddSelected={canAddSelected}
              onCreate={onCreate}
              onRename={onRename}
              onReparent={onReparent}
              onDelete={onDelete}
              onAddSelected={onAddSelected}
            />
          ))}
        </div>
      )}
    </div>
  )
}
