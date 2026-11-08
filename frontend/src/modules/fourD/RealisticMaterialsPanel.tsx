import { editMaterialFields, mappingAtTarget, type MaterialTarget } from './materialScope'
import { ToolVisualGuide } from './ToolVisualGuide'
import { WaterSurfaceControls } from './WaterSurface'
import { useRef, useState } from 'react'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import { SurfaceWearControls } from './SurfaceWearControls'
import type { WearGuide } from './surfaceWearGuides'
import { roadWearForKey } from './realisticMaterials'
import {
  REALISTIC_CLASSES, REALISTIC_CLASS_LABELS, colourOverrideHex, colourOverridesInUse, opacityForKey, footprintEdgesForKey,
  REALISTIC_TEXTURE_SCALES, textureSettingsForKey, realisticTileSize,
  type RealisticEntryModel, type RealisticMaterialEntry, type RealisticMaterialMap,
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
        onClick={() => setOpen(v => !v)}
        title={value ? `Colour override ${value} — click to change` : 'Set a colour for this material'}
        className={`w-5 h-5 rounded border ${value ? 'border-gray-300 dark:border-prosota-line' : 'border-dashed border-gray-300 dark:border-prosota-line bg-[linear-gradient(135deg,transparent_45%,#d1d5db_45%,#d1d5db_55%,transparent_55%)]'}`}
        style={value ? { backgroundColor: value } : undefined}
      />
      {value && (
        <button onClick={() => { onChange(null); setOpen(false) }} title="Remove colour override" className="text-[10px] text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">✕</button>
      )}
      {open && (
        <ColorPickerPopover value={value ?? recentColors[0] ?? '#8b6b4a'} onChange={onChange} onClose={() => setOpen(false)} anchor={ref.current} recentColors={recentColors} />
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
  targetsByKey = null, customEditor, loadErrors = [], onRetry, wearGuides,
}: {
  // Materials used by the current viewport selection (null = nothing
  // selected). When set, the list narrows to just those (2026-10-02).
  customEditor?: React.ReactNode
  wearGuides?: Map<string,WearGuide>
  targetsByKey?: Map<string, MaterialTarget[]> | null
  entries: RealisticMaterialEntry[]
  mapping: RealisticMaterialMap
  onMappingChange: (mapping: RealisticMaterialMap) => void
  analysing: boolean
  loadErrors?: string[]
  onRetry?: () => void
  // Which IFC models use each entry — one Select button per model
  // (2026-09-29, per Maro: to see what an unmatched "IfcBeam (no material)"
  // actually is before mapping it).
  entryModels: Record<string, RealisticEntryModel[]>
  onSelectEntry: (key: string, objectId: string) => void
  glassTransmission: boolean
  onGlassTransmissionChange: (value: boolean) => void
}) {
  const [onlyUnmatched, setOnlyUnmatched] = useState(false)
  const globalTargets: MaterialTarget[] = [[]]
  const targetsFor = (key: string) => targetsByKey === null ? globalTargets : targetsByKey.get(key) ?? []
  const rowMapping = (key: string) => mappingAtTarget(mapping, targetsFor(key)[0] ?? [])
  const [search, setSearch] = useState('')
  const needsMapping = (e: RealisticMaterialEntry) => !rowMapping(e.key)[e.key] && !e.autoClass
  const unmatchedCount = entries.filter(e => targetsFor(e.key).length && needsMapping(e)).length
  const query = search.trim().toLowerCase()
  const visible = entries.filter(e =>
    targetsFor(e.key).length > 0
    && (!onlyUnmatched || needsMapping(e))
    && (!query || e.label.toLowerCase().includes(query) || e.detail.toLowerCase().includes(query)),
  )

  const recentColours = colourOverridesInUse(mapping)
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      <div className="px-3 py-2"><ToolVisualGuide topic="materials"/></div>
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
        <WaterSurfaceControls />
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
            <p className="text-[11px] text-blue-700 dark:text-prosota-azure">
              {targetsByKey !== null ? 'Edits apply to your selection only.' : 'Editing project defaults for all uses of each material. Select an object to edit it individually.'}
            </p>
          </>
        )}
      </div>
      {!analysing && loadErrors.length > 0 && (
        <div role="alert" className="px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <p>Could not read material mapping for {loadErrors.join(', ')}.</p>
          {onRetry && <button onClick={onRetry} className="mt-2 rounded border border-current px-2 py-1">Retry material lookup</button>}
        </div>
      )}
      {!analysing && loadErrors.length === 0 && entries.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-gray-400 dark:text-prosota-muted">No model materials loaded.</p>
      )}
      <div className="shrink-0 divide-y divide-gray-100 dark:divide-prosota-line">
        {visible.map(entry => {
          const targets = targetsFor(entry.key)
          const current = rowMapping(entry.key)
          const manual = current[entry.key] || undefined
          const mixedFinish = targets.some(target => (mappingAtTarget(mapping, target)[entry.key] || undefined) !== manual)
          const edit = (fields: Parameters<typeof editMaterialFields>[2], reset = false) =>
            onMappingChange(editMaterialFields(mapping, targets, fields, reset))
          const updateTexture = (patch: {scale?: number; rotation?: number}) => edit(local => {
            const value = { ...textureSettingsForKey(entry.key, local), ...patch }
            return { ['texture:' + entry.key]: value.scale === 1 && value.rotation === 0 ? null : JSON.stringify(value) }
          })
          const cls = manual === 'original' ? null : manual ?? entry.autoClass
          const texture = textureSettingsForKey(entry.key, current)
          const tile = cls ? realisticTileSize(cls, texture.scale) : null
          const guideKey = 'guide:' + entry.key
          const guideMode = (target: MaterialTarget) => String(mappingAtTarget(mapping, target)[guideKey]) === 'surface' ? 'surface' : 'outline'
          const guide = targets.length && targets.some(target => guideMode(target) !== guideMode(targets[0])) ? 'mixed'
            : String(current[guideKey]) === 'surface' ? 'surface' : 'outline'
          const opacityKey = 'opacity:' + entry.key
          const opacity = opacityForKey(entry.key, current) ?? (entry.sourceOpacity === undefined ? 1 : entry.sourceOpacity)
          const mixedOpacity = opacity === null || targets.some(target =>
            (opacityForKey(entry.key, mappingAtTarget(mapping, target)) ?? (entry.sourceOpacity === undefined ? 1 : entry.sourceOpacity)) !== opacity)
          const hasOpacityEdit = targets.some(target => opacityForKey(entry.key, mappingAtTarget(mapping, target)) !== undefined)
          const edgeControls=!!targetsByKey && targets.length>0 && !entry.volumeGuide && cls!=='glass' && cls!=='water' &&
            (entry.footprint || entry.key.startsWith('site|') || entry.key.startsWith('mat|') || targets.every(t=>t.some(s=>s.startsWith('element:'))))
          const edges=footprintEdgesForKey(entry.key,current)
          const wearField='roadWear:'+entry.key
          const wearFor=(map:RealisticMaterialMap)=>{
            const wear=roadWearForKey(entry.key,map)
            return map[wearField] || (map[entry.key] || entry.autoClass)==='haul-road' ? wear : {...wear,mode:'off' as const}
          }
          const wear=wearFor(current)
          const mixedEdgeLocation=targets.some(t=>!!footprintEdgesForKey(entry.key,mappingAtTarget(mapping,t)).endsOnly!==!!edges.endsOnly)
          const edgeFields=[['fade','edgeFade:','Edge fade width'],['radius','cornerRadius:','Corner radius']] as const
          const hasEdgeEdit=targets.some(t=>{const e=footprintEdgesForKey(entry.key,mappingAtTarget(mapping,t));return !!(e.fade||e.radius||e.endsOnly)})
          const customised = targets.some(target => !!mappingAtTarget(mapping, target)[guideKey]) || hasOpacityEdit || targets.some(target => target.length > 0 && [entry.key, 'colour:' + entry.key, 'texture:' + entry.key].some(k => Object.prototype.hasOwnProperty.call(mappingAtTarget(mapping, target), k))) || mixedFinish || !!manual || !!colourOverrideHex(entry.key, current) || texture.scale !== 1 || texture.rotation !== 0
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
                <span className="text-[10px] text-gray-400 dark:text-prosota-muted shrink-0 ml-auto">{targetsByKey === null ? '×' + entry.count : targets.length + ' selected'}</span>
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
                    {models.length > 1 ? `Select in ${shortModelName(m.name)}` : 'Select linked'}
                  </button>
                ))}
                <select
                  aria-label={`Finish for ${entry.label}`}
                  value={mixedFinish ? 'mixed' : manual ?? 'auto'}
                  onChange={e => edit({ [entry.key]: e.target.value === 'auto' ? null : e.target.value })}
                  className="flex-1 min-w-[9rem] text-[11px] border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
                >
                  {mixedFinish && <option value="mixed" disabled>Mixed finishes</option>}
                  <option value="auto">{autoLabel}</option>
                  <option value="original">Keep imported look</option>
                  {REALISTIC_CLASSES.map(cls => <option key={cls} value={cls}>{REALISTIC_CLASS_LABELS[cls]}</option>)}
                </select>
                <OverrideSwatch
                  value={colourOverrideHex(entry.key, current)}
                  onChange={hex => edit({ ['colour:' + entry.key]: hex })}
                  recentColors={recentColours}
                />
              </div>
              {entry.volumeGuide && <label className="flex items-center gap-2 text-[11px]">
                Guide display
                <select aria-label={`Guide display for ${entry.label}`} value={guide}
                  onChange={e => edit({[guideKey]: e.target.value})}
                  className="flex-1 min-w-0 rounded border px-1 py-0.5 dark:border-prosota-line dark:bg-prosota-panel2">
                  {guide === 'mixed' && <option value="mixed" disabled>Mixed</option>}
                  <option value="outline">Dashed outline</option>
                  <option value="surface">Filled surface</option>
                </select>
              </label>}
              {(!entry.volumeGuide || guide === 'surface') && <div className="flex items-center gap-2 text-[11px]">
                <label className="flex items-center gap-2 flex-1 min-w-0">
                  Surface opacity
                  <input type="range" min="0" max="100" step="1" className="flex-1 min-w-0"
                    aria-label={`Surface opacity for ${entry.label}`}
                    value={Math.round((opacity ?? 1) * 100)}
                    onChange={e => edit({[opacityKey]: String(Number(e.target.value) / 100)})} />
                </label>
                <span>{mixedOpacity ? 'Mixed' : Math.round((opacity ?? 1) * 100) + '%'}</span>
                {hasOpacityEdit && <button title="Restore inherited surface opacity" className="underline" onClick={() => edit({[opacityKey]: null}, true)}>Reset</button>}
              </div>}
              {!!targetsByKey && targets.length>0 && <SurfaceWearControls wear={wear} guides={wearGuides} recentColours={recentColours}
                mixed={targets.some(t=>wearFor(mappingAtTarget(mapping,t)).mode!==wear.mode)}
                update={patch=>edit(local=>({[wearField]:JSON.stringify({...wearFor(local),...patch})}))}/>}
              {edgeControls && <details className="text-[11px]">
                <summary className="cursor-pointer py-1">Surface edges</summary>
                <label className="flex items-center gap-2 py-1">Fade location
                  <select aria-label={'Fade location for '+entry.label} value={mixedEdgeLocation?'mixed':edges.endsOnly?'ends':'all'} className="rounded border px-1 py-0.5 dark:bg-prosota-panel2"
                    onChange={e=>edit({['edgeMode:'+entry.key]:e.target.value==='ends'?'ends':null})}>
                    {mixedEdgeLocation && <option disabled value="mixed">Mixed</option>}
                    <option value="all">Entire perimeter</option><option value="ends">Two ends (long axis)</option>
                  </select>
                </label>
                {edgeFields.map(([property,field,label])=><label key={field} className="flex items-center gap-2 py-1">
                  {label}<input aria-label={label+' for '+entry.label} type="range" min="0" max="5" step=".05"
                    className="flex-1 min-w-0" value={edges[property]} onChange={e=>edit({[field+entry.key]:e.target.value==='0'?null:e.target.value})}/>
                  <span>{targets.some(t=>footprintEdgesForKey(entry.key,mappingAtTarget(mapping,t))[property]!==edges[property])?'Mixed':edges[property]+' m'}</span>
                </label>)}
                <p>Fade reveals the surface beneath. Narrow sections keep a solid centre. Radius rounds the corners.</p>
              </details>}
              {cls && cls !== 'glass' && (
                <details className="text-[11px] text-gray-500 dark:text-prosota-muted">
                  <summary className="cursor-pointer py-1">Texture scale and direction</summary>
                  <div className="flex gap-2 py-1">
                    <label className="flex-1">Scale
                      <select aria-label={`Texture scale for ${entry.label}`} value={texture.scale}
                        onChange={e => updateTexture({scale: Number(e.target.value)})}
                        className="block w-full border rounded px-1 py-0.5 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper">
                        {REALISTIC_TEXTURE_SCALES.map(scale => <option key={scale} value={scale}>{scale}×{scale === 1 ? ' (default)' : ''}</option>)}
                      </select>
                    </label>
                    <label className="flex-1">Direction
                      <select aria-label={`Texture direction for ${entry.label}`} value={texture.rotation}
                        onChange={e => updateTexture({rotation: Number(e.target.value)})}
                        className="block w-full border rounded px-1 py-0.5 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper">
                        {[0, 90, 180, 270].map(rotation => <option key={rotation} value={rotation}>{rotation}°</option>)}
                      </select>
                    </label>
                  </div>
                  {tile && <p>Pattern repeat: {Number(tile[0].toFixed(3))} × {Number(tile[1].toFixed(3))} m. Preview changes in the model.</p>}
                </details>
              )}
              {(cls === 'grass' || cls === 'moquette' || cls === 'moquette-checkered') && <p className="text-[11px] text-gray-500 dark:text-prosota-muted">{cls === 'moquette-checkered' ? 'Fine felt turf with alternating mowing tones. Checks are 0.75 m at default scale; scale adjusts both checks and fibres.' : cls === 'moquette' ? 'Soft matte sage turf with fine felt texture and smooth edges.' : 'Natural grass with patch variation and short fibre shading.'} Surface texture only: no individual blades. Use the colour swatch, scale and direction to adjust the finish.</p>}
              {(customised || hasEdgeEdit || targets.some(t=>mappingAtTarget(mapping,t)[wearField])) && <button onClick={() => edit({ [entry.key]: null, ['colour:' + entry.key]: null, ['texture:' + entry.key]: null, [opacityKey]: null, [guideKey]: null, [wearField]:null, ['edgeFade:'+entry.key]:null, ['cornerRadius:'+entry.key]:null, ['edgeMode:'+entry.key]:null }, true)}
                title="Restore automatic mapping, original colour and default texture settings for this material"
                className="text-[10px] text-left underline text-gray-500 dark:text-prosota-muted">Reset material</button>}
            </div>
          )
        })}
        {entries.length > 0 && visible.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-gray-400 dark:text-prosota-muted">{targetsByKey?.size === 0 ? 'No editable materials in this selection.' : 'No materials match.'}</p>
        )}
      </div>
      {customEditor}
    </div>
  )
}
