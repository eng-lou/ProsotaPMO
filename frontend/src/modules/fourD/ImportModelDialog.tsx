import { useState } from 'react'
import { defaultSourceUpAxis, type UpAxis } from './upAxis'

interface Props {
  file: File
  kind: 'ifc' | 'mesh'
  // Set whenever more files are still queued behind this one (2026-07-17,
  // per Maro: "allow me to bulk import ifc files not one by one" — a
  // multi-select in the file picker feeds every file through this same
  // one-at-a-time dialog, FourD.tsx's own pendingImports queue) — just a
  // "N more to go" hint so it's clear confirming this one won't be the end.
  queuePosition?: { remaining: number }
  onConfirm: (sourceUpAxis: UpAxis, name: string, includeAnimation: boolean) => void
  onCancel: () => void
}

// One combined "Import Model" flow instead of separate Import 3D / Import
// IFC buttons (2026-07-08, per Maro: "combine the two import widgets to
// one... after selecting the model and its type, there should be an option
// to set its axis transformations"). Kind is auto-detected from the file
// extension (FourD.tsx's handleFileSelected) — this dialog is just the
// confirm step: shows what was picked and lets the user override the axis
// guess before anything actually loads, since real files don't reliably
// follow either the Y-up-mesh or Z-up-IFC convention (export settings,
// authoring tool, and per-project habits all vary — see upAxis.ts's
// axisCorrectionRotation header for the fuller story on why this stopped
// being a fixed per-kind rule).
export function ImportModelDialog({ file, kind, queuePosition, onConfirm, onCancel }: Props) {
  const [upAxis, setUpAxis] = useState<UpAxis>(defaultSourceUpAxis(kind))
  // Editable, pre-filled from the file's own name (2026-07-12, per Maro:
  // two files both literally called "Untitled.glb" — a common default
  // export name — were indistinguishable everywhere this app identifies a
  // mesh-kind element by name (Collections, Paths, links, rigging), with
  // no way to tell them apart short of renaming the file on disk first.
  // This *is* the element's identity going forward, not just a label —
  // see element_parent.py/collection_member.py/path_follower.py's own
  // docstrings on why mesh-kind element_ref is a plain filename.
  const [name, setName] = useState(file.name)
  // "Include animation" (2026-07-23, per Maro: "allow me to import a 3d
  // mesh with its animation optionally" — car2.fbx, exported from Blender
  // with a simple baked animation — then, once he'd seen it play but not
  // show up anywhere editable: "we discussed normal 3d animation before,
  // being able to animate the keyframes independent of schedule
  // activities. the same thing") — checked, this converts the file's own
  // clip into real ElementKeyframe rows on the Animation Timeline at
  // import time (FourD.tsx's own handleImport3D, see
  // embeddedAnimationBake.ts's header for the actual conversion), same as
  // hand-keying Location/Rotation/Scale would; unchecked, the clip is
  // simply discarded and the mesh imports with no animation at all. Only
  // offered for the loader kinds that can ever actually carry a clip
  // (import3d.ts's own parse: FBX always attaches `.animations`, GLTF/GLB
  // now does too; OBJLoader has no concept of animation at all).
  // Deliberately doesn't parse the file here to check whether it
  // *actually* has a clip before showing this — that would mean parsing
  // every mesh file twice (once to peek, once for the real import) for
  // what's a harmless no-op checkbox on a file that turns out to have
  // none. Defaults to checked: opting out is the exception.
  const ext = file.name.split('.').pop()?.toLowerCase()
  const supportsAnimation = kind === 'mesh' && (ext === 'fbx' || ext === 'glb' || ext === 'gltf')
  const [includeAnimation, setIncludeAnimation] = useState(true)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="w-80 bg-white rounded-lg shadow-xl border border-gray-200" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">Import Model</h3>
          {queuePosition && (
            <span className="text-[10px] text-gray-400">{queuePosition.remaining} more queued</span>
          )}
        </div>
        <div className="px-4 py-3 space-y-3">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Name</div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              title="This becomes the element's identity everywhere (Collections, Paths, links, Rigging) — give it a distinct name if you're importing more than one file with the same default export name"
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
            <div className="text-[11px] text-gray-400 mt-0.5">from {file.name} — {kind === 'ifc' ? 'IFC model' : '3D mesh (GLTF/OBJ/FBX)'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Up Axis</div>
            <p className="text-[11px] text-gray-400 mb-1.5">
              Which axis this file's own geometry treats as "up" — pick wrong and the model imports on its side.
            </p>
            <div className="flex gap-1.5">
              {(['z', 'y'] as UpAxis[]).map(axis => (
                <button
                  key={axis}
                  onClick={() => setUpAxis(axis)}
                  className={`flex-1 text-xs px-2 py-1.5 rounded border font-medium ${
                    upAxis === axis ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {axis === 'z' ? 'Z up (Blender/CAD)' : 'Y up (three.js/glTF)'}
                </button>
              ))}
            </div>
          </div>
          {supportsAnimation && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
              <input type="checkbox" checked={includeAnimation} onChange={e => setIncludeAnimation(e.target.checked)} />
              Convert this file's animation into keyframes, if it has any
            </label>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(upAxis, name.trim() || file.name, includeAnimation)}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  )
}
