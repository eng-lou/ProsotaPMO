import { useState } from 'react'
import {
  REALISTIC_CLASSES, REALISTIC_CLASS_LABELS, type RealisticMapping, type RealisticMaterialEntry, type RealisticMaterialMap,
} from './realisticMaterials'

// Manual material -> class mapping for Realistic Materials mode (2026-09-28,
// per Maro). Every distinct imported material (IFC surface style + material,
// or a model's material name) is one row; "Auto" follows the name match,
// which is left blank when a name matches nothing or matches more than one
// class — those rows are flagged, since only a person can settle them.
export function RealisticMaterialsPanel({
  entries, mapping, onMappingChange, analysing,
}: {
  entries: RealisticMaterialEntry[]
  mapping: RealisticMaterialMap
  onMappingChange: (mapping: RealisticMaterialMap) => void
  analysing: boolean
}) {
  const [onlyUnmatched, setOnlyUnmatched] = useState(false)
  const needsMapping = (e: RealisticMaterialEntry) => !mapping[e.key] && !e.autoClass
  const unmatchedCount = entries.filter(needsMapping).length
  const visible = onlyUnmatched ? entries.filter(needsMapping) : entries

  const setEntry = (key: string, value: RealisticMapping | 'auto') => {
    const next = { ...mapping }
    if (value === 'auto') delete next[key]
    else next[key] = value
    onMappingChange(next)
  }

  return (
    <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-gray-600 dark:text-prosota-muted">Material mapping</span>
        {analysing && <span className="text-[10px] text-gray-400 dark:text-prosota-muted">Reading model materials…</span>}
      </div>
      {!analysing && entries.length === 0 && (
        <p className="text-[11px] text-gray-400 dark:text-prosota-muted">No model materials loaded.</p>
      )}
      {entries.length > 0 && (
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted mb-1.5">
          <input type="checkbox" checked={onlyUnmatched} onChange={e => setOnlyUnmatched(e.target.checked)} />
          Only unmatched ({unmatchedCount})
        </label>
      )}
      <div className="max-h-72 overflow-y-auto flex flex-col gap-1.5">
        {visible.map(entry => {
          const manual = mapping[entry.key]
          const flagged = needsMapping(entry)
          const autoLabel = entry.autoClass
            ? `Auto: ${REALISTIC_CLASS_LABELS[entry.autoClass]}`
            : entry.candidates.length > 0
              ? `Auto: ambiguous (${entry.candidates.map(c => REALISTIC_CLASS_LABELS[c]).join(' / ')})`
              : 'Auto: not matched'
          return (
            <div key={entry.key} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-1 min-w-0" title={[entry.label, entry.detail].filter(Boolean).join('\n')}>
                {flagged && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 self-center" />}
                <span className="text-[11px] text-gray-700 dark:text-prosota-paper truncate">{entry.label}</span>
                <span className="text-[10px] text-gray-400 dark:text-prosota-muted shrink-0 ml-auto">×{entry.count}</span>
              </div>
              {entry.detail && <span className="text-[10px] text-gray-400 dark:text-prosota-muted truncate">{entry.detail}</span>}
              <select
                value={manual ?? 'auto'}
                onChange={e => setEntry(entry.key, e.target.value as RealisticMapping | 'auto')}
                className="text-[11px] border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
              >
                <option value="auto">{autoLabel}</option>
                <option value="original">Keep imported look</option>
                {REALISTIC_CLASSES.map(cls => <option key={cls} value={cls}>{REALISTIC_CLASS_LABELS[cls]}</option>)}
              </select>
            </div>
          )
        })}
      </div>
    </div>
  )
}
