import { useState } from 'react'
import type { UnloadedElementInfo } from './model3dFiles'

interface Props {
  fileName: string
  unloadedElements: UnloadedElementInfo[]
  onReload: (guidsToRestore: string[]) => void
  onCancel: () => void
}

// "Reload IFC" (2026-07-26, per Maro: "give me an option to reload ifc
// which can identify the elements unloaded and i can choose which ones to
// reload") — re-downloads and re-parses fileName fresh (FourD.tsx's own
// handleReloadIfc), then re-applies exclusion only to whichever of these
// checkboxes stay unchecked. Defaults every checkbox OFF (nothing restored
// unless actively picked) — the safer default given a full reload is a
// real, disruptive action, matching this dialog's own "choose which ones"
// framing rather than "everything comes back unless you opt out".
export function ReloadIfcDialog({ fileName, unloadedElements, onReload, onCancel }: Props) {
  const [checkedGuids, setCheckedGuids] = useState<Set<string>>(new Set())

  const toggle = (guid: string) => {
    setCheckedGuids(prev => {
      const next = new Set(prev)
      if (next.has(guid)) next.delete(guid); else next.add(guid)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="w-[420px] max-h-[80vh] flex flex-col bg-white dark:bg-prosota-panel rounded-lg shadow-xl border border-gray-200 dark:border-prosota-line" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-prosota-line">
          <h3 className="text-sm font-bold text-gray-800 dark:text-prosota-paper">Reload "{fileName}"</h3>
          <p className="text-[11px] text-gray-400 dark:text-prosota-muted mt-1">
            Re-downloads and re-parses this file fresh, then keeps everything unchecked below still unloaded.
            Check the elements you want brought back.
          </p>
        </div>
        <div className="px-2 py-2 flex-1 overflow-y-auto">
          <div className="flex justify-end gap-2 px-2 pb-1">
            <button
              onClick={() => setCheckedGuids(new Set(unloadedElements.map(e => e.guid)))}
              className="text-[11px] text-blue-600 dark:text-prosota-azure hover:underline"
            >
              Check All
            </button>
            <button onClick={() => setCheckedGuids(new Set())} className="text-[11px] text-blue-600 dark:text-prosota-azure hover:underline">
              Check None
            </button>
          </div>
          {unloadedElements.map(el => (
            <label key={el.guid} className="flex items-center gap-2 px-2 py-1 text-xs text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 rounded cursor-pointer">
              <input type="checkbox" checked={checkedGuids.has(el.guid)} onChange={() => toggle(el.guid)} />
              <span className="truncate flex-1" title={el.name || el.type_name}>{el.name || '(unnamed)'}</span>
              <span className="text-gray-400 dark:text-prosota-muted shrink-0">{el.type_name}</span>
            </label>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-prosota-line flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-prosota-muted">{checkedGuids.size} of {unloadedElements.length} selected</span>
          <div className="flex gap-2">
            <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
              Cancel
            </button>
            <button
              onClick={() => onReload([...checkedGuids])}
              disabled={checkedGuids.size === 0}
              className="text-xs px-3 py-1.5 rounded-md border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reload Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
