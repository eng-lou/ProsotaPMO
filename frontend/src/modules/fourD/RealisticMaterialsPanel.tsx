import { useState } from 'react'
import {
  REALISTIC_CLASSES, REALISTIC_CLASS_LABELS, type RealisticEntryModel, type RealisticMapping, type RealisticMaterialEntry,
  type RealisticMaterialMap,
} from './realisticMaterials'

// "NBU_MedicalClinic_Eng-MEP-Optimized.ifc" -> "Eng-MEP-Optimized": the part
// after the last shared-looking prefix separator, extension dropped.
function shortModelName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  const parts = base.split('_')
  return parts.length > 1 ? parts[parts.length - 1] : base
}

// Realistic Materials' own dockable panel (2026-09-29, per Maro: the
// mapping list and glass toggle were "a bit compressed" squeezed into 3D
// View Properties — "give them their own widget panel that pops only...
// when realistic materials are selected"). Every distinct imported material
// (IFC surface style + material, or a model's material name) is one row;
// "Auto" follows the name match, which is left blank when a name matches
// nothing or matches more than one class — those rows are flagged, since
// only a person can settle them.
export function RealisticMaterialsPanel({
  entries, mapping, onMappingChange, analysing, entryModels, onSelectEntry, glassTransmission, onGlassTransmissionChange,
}: {
  entries: RealisticMaterialEntry[]
  mapping: RealisticMaterialMap
  onMappingChange: (mapping: RealisticMaterialMap) => void
  analysing: boolean
  // Which IFC models use each entry — one Select button per model
  // (2026-09-29, per Maro: to see what an unmatched "IfcBeam (no material)"
  // actually is before mapping it).
  entryModels: Record<string, RealisticEntryModel[]>
  onSelectEntry: (key: string, objectId: string) => void
  glassTransmission: boolean
  onGlassTransmissionChange: (value: boolean) => void
}) {
  const [onlyUnmatched, setOnlyUnmatched] = useState(false)
  const [search, setSearch] = useState('')
  const needsMapping = (e: RealisticMaterialEntry) => !mapping[e.key] && !e.autoClass
  const unmatchedCount = entries.filter(needsMapping).length
  const query = search.trim().toLowerCase()
  const visible = entries.filter(e =>
    (!onlyUnmatched || needsMapping(e))
    && (!query || e.label.toLowerCase().includes(query) || e.detail.toLowerCase().includes(query)),
  )

  const setEntry = (key: string, value: RealisticMapping | 'auto') => {
    const next = { ...mapping }
    if (value === 'auto') delete next[key]
    else next[key] = value
    onMappingChange(next)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line space-y-2 shrink-0">
        <label className="flex items-start gap-2 text-xs text-gray-700 dark:text-prosota-muted cursor-pointer">
          <input
            type="checkbox" className="mt-0.5" checked={glassTransmission}
            onChange={e => onGlassTransmissionChange(e.target.checked)}
          />
          <span>
            <span className="font-semibold">Glass transmission</span>
            <span className="block text-[11px] text-gray-400 dark:text-prosota-muted">
              Real refracting glass. Slower: the scene is rendered an extra time every frame.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-prosota-muted">Material mapping</span>
          {analysing && <span className="text-[10px] text-gray-400 dark:text-prosota-muted">Reading model materials…</span>}
        </div>
        {entries.length > 0 && (
          <>
            <input
              type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search materials or IFC types"
              className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
              <input type="checkbox" checked={onlyUnmatched} onChange={e => setOnlyUnmatched(e.target.checked)} />
              Only unmatched ({unmatchedCount})
            </label>
          </>
        )}
      </div>
      {!analysing && entries.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-gray-400 dark:text-prosota-muted">No model materials loaded.</p>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100 dark:divide-prosota-line">
        {visible.map(entry => {
          const manual = mapping[entry.key]
          const flagged = needsMapping(entry)
          const models = entryModels[entry.key] ?? []
          const autoLabel = entry.autoClass
            ? `Auto: ${REALISTIC_CLASS_LABELS[entry.autoClass]}`
            : entry.candidates.length > 0
              ? `Auto: ambiguous (${entry.candidates.map(c => REALISTIC_CLASS_LABELS[c]).join(' / ')})`
              : 'Auto: not matched'
          return (
            <div key={entry.key} className="px-3 py-1.5 flex flex-col gap-1">
              <div className="flex items-baseline gap-1.5 min-w-0" title={[entry.label, entry.detail].filter(Boolean).join('\n')}>
                {flagged && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 self-center" title="Needs mapping" />}
                <span className="text-xs text-gray-800 dark:text-prosota-paper truncate">{entry.label}</span>
                <span className="text-[10px] text-gray-400 dark:text-prosota-muted shrink-0 ml-auto">×{entry.count}</span>
              </div>
              {entry.detail && <span className="text-[10px] text-gray-400 dark:text-prosota-muted truncate">{entry.detail}</span>}
              <div className="flex items-center gap-1.5 flex-wrap">
                {models.map(m => (
                  <button
                    key={m.objectId}
                    onClick={() => onSelectEntry(entry.key, m.objectId)}
                    title={`Select the ${m.count} element piece${m.count === 1 ? '' : 's'} using this material in ${m.name}`}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-gray-100 dark:hover:bg-prosota-panel2 shrink-0"
                  >
                    {models.length > 1 ? `Select in ${shortModelName(m.name)}` : 'Select'}
                  </button>
                ))}
                <select
                  value={manual ?? 'auto'}
                  onChange={e => setEntry(entry.key, e.target.value as RealisticMapping | 'auto')}
                  className="flex-1 min-w-[9rem] text-[11px] border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
                >
                  <option value="auto">{autoLabel}</option>
                  <option value="original">Keep imported look</option>
                  {REALISTIC_CLASSES.map(cls => <option key={cls} value={cls}>{REALISTIC_CLASS_LABELS[cls]}</option>)}
                </select>
              </div>
            </div>
          )
        })}
        {entries.length > 0 && visible.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-gray-400 dark:text-prosota-muted">No materials match.</p>
        )}
      </div>
    </div>
  )
}
