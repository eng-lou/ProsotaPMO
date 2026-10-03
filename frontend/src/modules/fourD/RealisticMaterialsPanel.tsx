import { useEffect, useRef, useState } from 'react'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import {
  REALISTIC_CLASSES, REALISTIC_CLASS_LABELS, colourOverrideHex, colourOverridesInUse, withColourOverride,
  REALISTIC_TEXTURE_SCALES, textureSettingsForKey, withTextureSettings, resetRealisticEntry, realisticTileSize,
  type RealisticEntryModel, type RealisticMapping, type RealisticMaterialEntry, type RealisticMaterialMap,
} from './realisticMaterials'

// Per-material colour override (2026-10-02, per Maro: "allow me to change
// material color in general") — a swatch on each row; empty outline = no
// override (the class/imported colour shows). The picker is anchored at
// page level so this narrow docked panel can't clip it.
function OverrideSwatch({ value, onChange, recentColors }: { value: string | null; onChange: (hex: string | null) => void; recentColors: string[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        ref={ref}
        onClick={() => { if (!value) onChange(recentColors[0] ?? '#8b6b4a'); setOpen(v => !v) }}
        title={value ? `Colour override ${value} — click to change` : 'Set a colour for this material'}
        className={`w-5 h-5 rounded border ${value ? 'border-gray-300 dark:border-prosota-line' : 'border-dashed border-gray-300 dark:border-prosota-line bg-[linear-gradient(135deg,transparent_45%,#d1d5db_45%,#d1d5db_55%,transparent_55%)]'}`}
        style={value ? { backgroundColor: value } : undefined}
      />
      {value && (
        <button onClick={() => { onChange(null); setOpen(false) }} title="Remove colour override" className="text-[10px] text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">✕</button>
      )}
      {open && value && (
        <ColorPickerPopover value={value} onChange={onChange} onClose={() => setOpen(false)} anchor={ref.current} recentColors={recentColors} />
      )}
    </div>
  )
}

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
  selectionKeys = null,
}: {
  // Materials used by the current viewport selection (null = nothing
  // selected). When set, the list narrows to just those (2026-10-02).
  selectionKeys?: Set<string> | null
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
  // "Show all" escape hatch while something is selected — reset whenever
  // the selection itself changes, so a new pick filters again.
  const [showAllDespiteSelection, setShowAllDespiteSelection] = useState(false)
  useEffect(() => { setShowAllDespiteSelection(false) }, [selectionKeys])
  const filteringToSelection = selectionKeys !== null && !showAllDespiteSelection
  const [search, setSearch] = useState('')
  const needsMapping = (e: RealisticMaterialEntry) => !mapping[e.key] && !e.autoClass
  const unmatchedCount = entries.filter(needsMapping).length
  const query = search.trim().toLowerCase()
  const visible = entries.filter(e =>
    (!filteringToSelection || selectionKeys!.has(e.key))
    && (!onlyUnmatched || needsMapping(e))
    && (!query || e.label.toLowerCase().includes(query) || e.detail.toLowerCase().includes(query)),
  )

  const recentColours = colourOverridesInUse(mapping)
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
            {selectionKeys !== null && (
              <div className="flex items-center gap-1.5 text-[11px] rounded bg-blue-50 dark:bg-prosota-panel2 text-blue-700 dark:text-prosota-azure px-2 py-1">
                <span className="flex-1">
                  {filteringToSelection
                    ? `Showing the ${selectionKeys.size} material${selectionKeys.size === 1 ? '' : 's'} of your selection`
                    : 'Showing all materials'}
                </span>
                <button onClick={() => setShowAllDespiteSelection(v => !v)} className="underline shrink-0">
                  {filteringToSelection ? 'Show all' : 'Only selection'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {!analysing && entries.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-gray-400 dark:text-prosota-muted">No model materials loaded.</p>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100 dark:divide-prosota-line">
        {visible.map(entry => {
          const manual = mapping[entry.key]
          const cls = manual === 'original' ? null : manual ?? entry.autoClass
          const texture = textureSettingsForKey(entry.key, mapping)
          const tile = cls ? realisticTileSize(cls, texture.scale) : null
          const customised = !!manual || !!colourOverrideHex(entry.key, mapping) || texture.scale !== 1 || texture.rotation !== 0
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
                  aria-label={`Finish for ${entry.label}`}
                  value={manual ?? 'auto'}
                  onChange={e => setEntry(entry.key, e.target.value as RealisticMapping | 'auto')}
                  className="flex-1 min-w-[9rem] text-[11px] border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
                >
                  <option value="auto">{autoLabel}</option>
                  <option value="original">Keep imported look</option>
                  {REALISTIC_CLASSES.map(cls => <option key={cls} value={cls}>{REALISTIC_CLASS_LABELS[cls]}</option>)}
                </select>
                <OverrideSwatch
                  value={colourOverrideHex(entry.key, mapping)}
                  onChange={hex => onMappingChange(withColourOverride(mapping, entry.key, hex))}
                  recentColors={recentColours}
                />
              </div>
              {cls && cls !== 'glass' && (
                <details className="text-[11px] text-gray-500 dark:text-prosota-muted">
                  <summary className="cursor-pointer py-1">Texture scale and direction</summary>
                  <div className="flex gap-2 py-1">
                    <label className="flex-1">Scale
                      <select aria-label={`Texture scale for ${entry.label}`} value={texture.scale}
                        onChange={e => onMappingChange(withTextureSettings(mapping, entry.key, { ...texture, scale: Number(e.target.value) }))}
                        className="block w-full border rounded px-1 py-0.5 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper">
                        {REALISTIC_TEXTURE_SCALES.map(scale => <option key={scale} value={scale}>{scale}×{scale === 1 ? ' (default)' : ''}</option>)}
                      </select>
                    </label>
                    <label className="flex-1">Direction
                      <select aria-label={`Texture direction for ${entry.label}`} value={texture.rotation}
                        onChange={e => onMappingChange(withTextureSettings(mapping, entry.key, { ...texture, rotation: Number(e.target.value) }))}
                        className="block w-full border rounded px-1 py-0.5 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper">
                        {[0, 90, 180, 270].map(rotation => <option key={rotation} value={rotation}>{rotation}°</option>)}
                      </select>
                    </label>
                  </div>
                  {tile && <p>Pattern repeat: {Number(tile[0].toFixed(3))} × {Number(tile[1].toFixed(3))} m. Preview changes in the model.</p>}
                </details>
              )}
              {customised && <button onClick={() => onMappingChange(resetRealisticEntry(mapping, entry.key))}
                title="Restore automatic mapping, original colour and default texture settings for this material"
                className="text-[10px] text-left underline text-gray-500 dark:text-prosota-muted">Reset material</button>}
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
