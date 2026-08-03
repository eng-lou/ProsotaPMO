interface Props {
  name: string
  linkCount: number
  keyframeCount: number
  onUnloadOnly: () => void
  onUnloadAndDelete: () => void
  onCancel: () => void
}

// Confirms unloading a model that still has activity links/custom
// keyframes attached (2026-07-XX, per Maro: "if i unload a model and it
// still has linkages with other module data like an activity, this might
// cause an activity to store unnecessary amounts of data... I should be
// able to break all connection if I want"). Only ever shown when there's
// actually something attached — FourD.tsx's requestUnloadModel skips
// straight to unloading when a model has zero links/keyframes, so this
// isn't an extra click on the common case. Mirrors ImportModelDialog.tsx's
// own modal chrome.
export function UnloadModelDialog({ name, linkCount, keyframeCount, onUnloadOnly, onUnloadAndDelete, onCancel }: Props) {
  const parts = [
    linkCount > 0 ? `${linkCount} activity link${linkCount === 1 ? '' : 's'}` : null,
    keyframeCount > 0 ? `${keyframeCount} custom keyframe${keyframeCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="w-96 bg-white dark:bg-prosota-panel rounded-lg shadow-xl border border-gray-200 dark:border-prosota-line" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-prosota-line">
          <h3 className="text-sm font-bold text-gray-800 dark:text-prosota-paper">Unload "{name}"</h3>
        </div>
        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-gray-700 dark:text-prosota-muted">This model still has {parts.join(' and ')}.</p>
          <p className="text-[11px] text-gray-400 dark:text-prosota-muted">
            Keep them and they'll silently reattach if you re-import this exact same file later, or delete them now to fully break the connection.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-prosota-line flex justify-end gap-2">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
            Cancel
          </button>
          <button onClick={onUnloadOnly} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
            Unload Only
          </button>
          <button onClick={onUnloadAndDelete} className="text-xs px-3 py-1.5 rounded-md border border-red-600 bg-red-600 text-white hover:bg-red-700">
            Unload &amp; Delete Links
          </button>
        </div>
      </div>
    </div>
  )
}
