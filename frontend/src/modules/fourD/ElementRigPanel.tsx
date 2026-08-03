import { useState } from 'react'
import type { ElementParent } from './elementParents'

interface RigChildTarget {
  ref: string
  label: string
}

interface Props {
  elementParents: ElementParent[]
  error: string | null
  childTarget: RigChildTarget | null
  // True when something IS selected right now but it isn't a mesh-kind
  // object (2026-07-12, per Maro: "i dont understand the parenting as it
  // its greyed out" — an IFC selection silently left childTarget null with
  // no explanation why). Distinguishes "select something" from "rigging
  // doesn't support what you've got selected" — see element_parent.py's
  // own docstring on why IFC isn't supported in this pass.
  selectedButUnsupported: boolean
  // Every other loaded mesh-kind object's filename, for the "parent" picker
  // — excludes the currently-selected child itself (can't parent to self,
  // also rejected server-side, see element_parent.py's own docstring).
  meshOptions: { ref: string; label: string }[]
  onSetParent: (parentElementRef: string) => void
  onClearParent: (id: string) => void
}

// "Rigging" dockable panel (2026-07-12, per Maro's crane-rigging request:
// base -> jib -> trolley -> hook, each part driving the next) — Blender's
// own pivot-based parenting (Ctrl+P), see elementRigging.ts's own header.
// Same "bind whatever's currently selected" shape PathsPanel's own "Bind
// selected" button already uses, not a separate child-picker — childTarget
// is FourD.tsx's own currently-active mesh-kind object.
export function ElementRigPanel({ elementParents, error, childTarget, selectedButUnsupported, meshOptions, onSetParent, onClearParent }: Props) {
  const [parentChoice, setParentChoice] = useState('')
  const existingParent = childTarget ? elementParents.find(ep => ep.child_element_ref === childTarget.ref) : undefined
  const availableParents = meshOptions.filter(o => o.ref !== childTarget?.ref)

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line sticky top-0 bg-white dark:bg-prosota-panel">
        <span className="text-xs text-gray-500 dark:text-prosota-muted">Rigging</span>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="px-3 py-2 space-y-1.5 border-b border-gray-100 dark:border-prosota-line">
        {!childTarget ? (
          <p className="text-xs text-gray-400 dark:text-prosota-muted">
            {selectedButUnsupported
              ? 'Rigging only works on plain 3D mesh imports (GLB/OBJ/FBX), not IFC — select a mesh-kind object instead.'
              : 'Select a mesh-kind object in the viewport to set or clear its parent.'}
          </p>
        ) : existingParent ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted bg-sky-50 border border-sky-100 rounded px-2 py-1">
            <span className="flex-1 truncate">{childTarget.label} → parented to {existingParent.parent_element_ref}</span>
            <button onClick={() => onClearParent(existingParent.id)} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
          </div>
        ) : availableParents.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-prosota-muted">
            Import at least one other mesh-kind object to rig {childTarget.label} to it.
          </p>
        ) : (
          <div className="flex items-center gap-1.5">
            <select
              value={parentChoice}
              onChange={e => setParentChoice(e.target.value)}
              className="flex-1 min-w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-1"
            >
              <option value="">Parent for {childTarget.label}…</option>
              {availableParents.map(o => <option key={o.ref} value={o.ref}>{o.label}</option>)}
            </select>
            <button
              onClick={() => { if (parentChoice) { onSetParent(parentChoice); setParentChoice('') } }}
              disabled={!parentChoice}
              title={!parentChoice ? 'Pick a parent from the list first' : undefined}
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:hover:bg-transparent"
            >
              Set Parent
            </button>
          </div>
        )}
      </div>

      {elementParents.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400 dark:text-prosota-muted">
          No rig relationships yet — select a part, pick its parent above, then rotate/move the parent to see the child ride along.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {elementParents.map(ep => (
            <div key={ep.id} className="px-3 py-1.5 flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted">
              <span className="flex-1 truncate">{ep.child_element_ref} → {ep.parent_element_ref}</span>
              <button onClick={() => onClearParent(ep.id)} title="Clear" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
