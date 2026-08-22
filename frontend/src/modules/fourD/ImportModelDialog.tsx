import { useState } from 'react'
import { defaultSourceUpAxis, type UpAxis } from './upAxis'

interface Props {
  // Always the whole batch, even a batch of one (2026-07-28, per Maro: "i
  // said i didnt want this?" — a 39-file mesh selection was showing this
  // dialog 39 times, once per file, "38 more queued" ticking down one at a
  // time, every confirm picking the identical Up Axis. One confirm now
  // applies its single axis choice — and includeAnimation, forced false
  // for a real multi-file batch — to every file at once.
  files: File[]
  kind: 'ifc' | 'mesh'
  // Set whenever more BATCHES are still queued behind this one (2026-07-17,
  // per Maro: "allow me to bulk import ifc files not one by one" — a
  // multi-select in the file picker feeds every batch through this same
  // dialog, FourD.tsx's own pendingImports queue) — just a "N more to go"
  // hint so it's clear confirming this one won't be the end.
  queuePosition?: { remaining: number }
  onConfirm: (sourceUpAxis: UpAxis, includeAnimation: boolean) => void
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
//
// No name field (2026-07-28, per Maro: "remove the name" — reversing the
// 2026-07-12 fix that added one; multi-file import is now the common case
// this dialog exists for, and a name field per file defeats the point of
// importing several at once). onConfirm's caller always uses each file's
// own name — same identity contract mesh-kind element_ref already
// documents elsewhere (element_parent.py/collection_member.py/
// path_follower.py), a real filename is just as fine an identity as a
// hand-typed one.
export function ImportModelDialog({ files, kind, queuePosition, onConfirm, onCancel }: Props) {
  const isMultiFile = files.length > 1
  const [upAxis, setUpAxis] = useState<UpAxis>(defaultSourceUpAxis(kind))
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
  // now does too; OBJLoader has no concept of animation at all) — AND only
  // for a single-file batch (2026-07-28, per Maro): a multi-file batch
  // assumes no animation for all of them, since a per-file "does this one
  // have a clip too?" prompt is exactly the one-by-one friction bulk
  // import exists to remove; a single-file batch still gets the choice.
  // Deliberately doesn't parse the file here to check whether it
  // *actually* has a clip before showing this — that would mean parsing
  // every mesh file twice (once to peek, once for the real import) for
  // what's a harmless no-op checkbox on a file that turns out to have
  // none. Defaults to checked (single-file only): opting out is the
  // exception.
  const ext = files[0]?.name.split('.').pop()?.toLowerCase()
  const supportsAnimation = !isMultiFile && kind === 'mesh' && (ext === 'fbx' || ext === 'glb' || ext === 'gltf')
  const [includeAnimation, setIncludeAnimation] = useState(!isMultiFile)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="w-80 bg-white dark:bg-prosota-panel rounded-lg shadow-xl border border-gray-200 dark:border-prosota-line" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-prosota-line flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 dark:text-prosota-paper">Import Model</h3>
          {queuePosition && (
            <span className="text-[10px] text-gray-400 dark:text-prosota-muted">{queuePosition.remaining} more queued</span>
          )}
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="text-[11px] text-gray-400 dark:text-prosota-muted">
            {isMultiFile
              ? `${files.length} files — 3D mesh (GLTF/OBJ/FBX)`
              : `${files[0].name} — ${kind === 'ifc' ? 'IFC model' : '3D mesh (GLTF/OBJ/FBX)'}`}
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide mb-1">Up Axis</div>
            <p className="text-[11px] text-gray-400 dark:text-prosota-muted mb-1.5">
              Which axis {isMultiFile ? 'these files' : "this file's own geometry"} treat{isMultiFile ? '' : 's'} as "up" — pick wrong and the model{isMultiFile ? 's import' : ' imports'} on its side.
              {isMultiFile && ' Applies to every file in this batch.'}
            </p>
            <div className="flex gap-1.5">
              {(['z', 'y'] as UpAxis[]).map(axis => (
                <button
                  key={axis}
                  onClick={() => setUpAxis(axis)}
                  className={`flex-1 text-xs px-2 py-1.5 rounded border font-medium ${
                    upAxis === axis ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
                  }`}
                >
                  {axis === 'z' ? 'Z up (Blender/CAD)' : 'Y up (three.js/glTF)'}
                </button>
              ))}
            </div>
          </div>
          {supportsAnimation && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-prosota-muted cursor-pointer">
              <input type="checkbox" checked={includeAnimation} onChange={e => setIncludeAnimation(e.target.checked)} />
              Include this file's animation, if it has any (converted to editable keyframes when possible, otherwise played back as a raw loop)
            </label>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-prosota-line flex justify-end gap-2">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(upAxis, includeAnimation)}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-gray-800"
          >
            Import{isMultiFile ? ` all ${files.length}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
