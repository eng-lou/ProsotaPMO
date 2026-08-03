import { useEffect, useMemo, useState } from 'react'
import type { IfcModelHandle } from './ifcModel'

// "add a filter feature, i can select elements and filter like this by
// categories and additionally spatial decomposition" (2026-07-26, per Maro,
// referencing Revit's own Modify | Multi-Select > Filter dialog directly) —
// narrows an existing viewport selection down by two independent axes:
// each element's own real Category (Revit's own authored
// Pset_ProductRequirements.Category when present — the exact same
// authoritative signal ifcScheduleExtraction.ts's own CATEGORY_PROPERTY_
// OVERRIDES already prefers, since it's Revit's real classification, not a
// guess — falling back to a readable version of its raw IFC type when that
// Pset is absent) and its own real storey (buildElementStoreyMap, same bulk
// containment resolution the Schedule Wizard already uses). Two axes ANDed
// together, not unioned — an element only stays selected if BOTH its
// category and its storey are checked, matching how a real PM would read
// "show me Columns, but only on these floors."
interface Row {
  expressID: number
  category: string
  storeyName: string
}

// "IfcCurtainWall" -> "Curtain Wall" — only ever shown when an element has
// no real Pset_ProductRequirements.Category (the common case is every real
// element DOES carry one on a modern Revit IFC export, per buildElement
// PropertyData's own header), so this is a readability fallback, not the
// primary signal.
function readableTypeName(ifcType: string): string {
  return ifcType.replace(/^Ifc/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
}

interface Props {
  handle: IfcModelHandle
  // The current selection's own sub-elements to filter, scoped to `handle`
  // (2026-07-26 — mirrors this whole app's existing "selectedExpressIds is
  // implicitly scoped to the one active IFC model" convention, FourD.tsx's
  // own handleHideSelected/handleSelectAll).
  expressIds: number[]
  onApply: (keptExpressIds: number[]) => void
  onClose: () => void
}

export function ElementFilterDialog({ handle, expressIds, onApply, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [checkedCategories, setCheckedCategories] = useState<Set<string>>(new Set())
  const [checkedStoreys, setCheckedStoreys] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const ifcModel = await import('./ifcModel')
      // All three bulk reads run against the whole model, same as the
      // Schedule Wizard's own scan — cheap relative to per-element WASM
      // calls (buildIfcTypeByExpressId/buildElementStoreyMap: one call per
      // real type/storey, not per element; buildElementPropertyData: one
      // relationship+pset scan total) regardless of how large `expressIds`
      // is, so there's no per-selection-size cost blowup here.
      const [propertyData, storeyByExpressId, ifcTypeByExpressId] = await Promise.all([
        ifcModel.buildElementPropertyData(handle),
        ifcModel.buildElementStoreyMap(handle),
        Promise.resolve(ifcModel.buildIfcTypeByExpressId(handle)),
      ])
      if (cancelled) return
      const nextRows: Row[] = expressIds.map(expressID => {
        const rawCategory = propertyData.categoryByExpressId.get(expressID)
        const ifcType = ifcTypeByExpressId.get(expressID) ?? 'Unknown'
        const category = rawCategory && rawCategory !== '—' ? rawCategory : readableTypeName(ifcType)
        const storeyName = storeyByExpressId.get(expressID)?.name ?? 'Unassigned'
        return { expressID, category, storeyName }
      })
      setRows(nextRows)
      setCheckedCategories(new Set(nextRows.map(r => r.category)))
      setCheckedStoreys(new Set(nextRows.map(r => r.storeyName)))
      setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, expressIds])

  // Cross-filtering, not two static lists (2026-07-26, per Maro: "theres a
  // beam in l2 but not in l1. if in category by default i select beam, in
  // the spatial decomp i dont want to see l1 and vice versa" — a real
  // faceted-search interaction, not just "show every distinct value that
  // ever appears in the selection"). Category's own OPTIONS (which rows and
  // counts even show up) are computed against rows that pass the CURRENT
  // storey checks, and vice versa — each list narrows to only what's still
  // reachable given the other axis's current state, the same way Amazon's
  // own left-nav facets narrow Colour once you've checked a Brand. Checked-
  // state itself is never mutated by this (checkedCategories/checkedStoreys
  // only ever change from an explicit click) — a value that disappears from
  // view because the other axis excludes it entirely just contributes
  // nothing to Total Selected Items either way, so nothing is lost if the
  // user relaxes the other axis again later and it reappears.
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (!checkedStoreys.has(row.storeyName)) continue
      counts.set(row.category, (counts.get(row.category) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, checkedStoreys])

  const storeyOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (!checkedCategories.has(row.category)) continue
      counts.set(row.storeyName, (counts.get(row.storeyName) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, checkedCategories])

  const totalSelected = useMemo(
    () => rows.filter(row => checkedCategories.has(row.category) && checkedStoreys.has(row.storeyName)).length,
    [rows, checkedCategories, checkedStoreys],
  )

  const toggle = (set: Set<string>, setSet: (next: Set<string>) => void, value: string) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value); else next.add(value)
    setSet(next)
  }

  const applyAndClose = () => {
    const keptExpressIds = rows
      .filter(row => checkedCategories.has(row.category) && checkedStoreys.has(row.storeyName))
      .map(row => row.expressID)
    onApply(keptExpressIds)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-[640px] max-h-[80vh] flex flex-col bg-white dark:bg-prosota-panel rounded-lg shadow-xl border border-gray-200 dark:border-prosota-line" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-prosota-line flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 dark:text-prosota-paper">Filter Selection</h3>
          <div className="text-xs text-gray-400 dark:text-prosota-muted">{expressIds.length} elements selected</div>
        </div>

        <div className="px-4 py-3 flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-gray-400 dark:text-prosota-muted py-8 text-center">Scanning selection…</div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <FilterSection
                title="Category"
                counts={categoryOptions}
                checked={checkedCategories}
                onToggle={value => toggle(checkedCategories, setCheckedCategories, value)}
                onCheckAll={() => setCheckedCategories(new Set(categoryOptions.map(([name]) => name)))}
                onCheckNone={() => setCheckedCategories(new Set())}
              />
              <FilterSection
                title="Spatial Decomposition"
                counts={storeyOptions}
                checked={checkedStoreys}
                onToggle={value => toggle(checkedStoreys, setCheckedStoreys, value)}
                onCheckAll={() => setCheckedStoreys(new Set(storeyOptions.map(([name]) => name)))}
                onCheckNone={() => setCheckedStoreys(new Set())}
              />
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 dark:border-prosota-line flex justify-between items-center">
          <div className="text-xs text-gray-500 dark:text-prosota-muted">Total Selected Items: <span className="font-bold text-gray-800 dark:text-prosota-paper">{totalSelected}</span></div>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
              Cancel
            </button>
            <button
              onClick={applyAndClose}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FilterSection({ title, counts, checked, onToggle, onCheckAll, onCheckNone }: {
  title: string
  counts: [string, number][]
  checked: Set<string>
  onToggle: (value: string) => void
  onCheckAll: () => void
  onCheckNone: () => void
}) {
  return (
    <div className="border border-gray-200 dark:border-prosota-line rounded-md flex flex-col">
      <div className="px-2.5 py-2 border-b border-gray-100 dark:border-prosota-line flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide">{title}</span>
        <div className="flex gap-1">
          <button onClick={onCheckAll} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-500 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">All</button>
          <button onClick={onCheckNone} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-500 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">None</button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {counts.length === 0 && <div className="px-2.5 py-2 text-[11px] text-gray-400 dark:text-prosota-muted">Nothing to filter.</div>}
        {counts.map(([name, count]) => (
          <label key={name} className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 cursor-pointer">
            <input type="checkbox" checked={checked.has(name)} onChange={() => onToggle(name)} />
            <span className="flex-1 truncate">{name}</span>
            <span className="text-gray-400 dark:text-prosota-muted">{count}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
