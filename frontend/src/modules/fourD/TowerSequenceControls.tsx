import type { ExtractedElement } from './ifcScheduleExtraction'
import type { StoreyGroup } from './scheduleGeneration'
import { flattenCollectionMemberRefs, type Collection } from './collections'
import { useState } from 'react'

export interface TowerSettings {
  enabled: boolean
  coreIds: string[]
  levelMap: Record<string, string>
  coreLeadFloors: number
  facadeLagFloors: number
}
export const initialTowerSettings: TowerSettings = { enabled: false, coreIds: [], levelMap: {}, coreLeadFloors: 1, facadeLagFloors: 2 }
const field = 'rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel2 text-gray-800 dark:text-prosota-paper p-1'

export function TowerSequenceControls({ value, onChange, elements, storeys, collections }: {
  value: TowerSettings; onChange: (value: TowerSettings) => void
  elements: ExtractedElement[]; storeys: StoreyGroup[]; collections: Collection[]
}) {
  const [search, setSearch] = useState('')
  const walls = elements.filter(e => e.ifcType.startsWith('IfcWall') && ['Walls', 'Non-Structural Walls'].includes(e.category))
  const matches = walls.filter(e => `${e.name} ${e.storeyName} ${e.globalId}`.toLowerCase().includes(search.toLowerCase()))
  const update = (patch: Partial<TowerSettings>) => onChange({ ...value, ...patch })
  return <section className="space-y-2 border rounded p-2 text-xs text-gray-800 dark:text-prosota-paper dark:border-prosota-line">
    <label className="flex items-center gap-2">Construction sequence
      <select className={field} value={value.enabled ? 'tower' : 'standard'} onChange={e => update({ enabled: e.target.value === 'tower' })}>
        <option value="standard">Standard (existing sequence)</option><option value="tower">Tower — core and following façade</option>
      </select>
    </label>
    {value.enabled && <>
      <p>Core lifts rise from their mapped floor. A lead of 1 follows each slab; larger leads allow the core to advance ahead.</p>
      <div className="flex gap-4 flex-wrap">
        <label>Core lead (floors) <input aria-label="Core lead in floors" className={`${field} w-14`} type="number" min={1} max={20} value={value.coreLeadFloors} onChange={e => update({ coreLeadFloors: Number(e.target.value) })} /></label>
        <label>Façade follows by (floors) <input aria-label="Facade lag in floors" className={`${field} w-14`} type="number" min={0} max={20} value={value.facadeLagFloors} onChange={e => update({ facadeLagFloors: Number(e.target.value) })} /></label>
      </div>
      <details open><summary className="cursor-pointer font-semibold">Core walls — {value.coreIds.length} selected</summary>
        <p className="my-1">Use a reviewed core collection from Models, or select individual walls. Generic wall names cannot identify the core reliably.</p>
        <select aria-label="Add core collection" className={`${field} w-full`} value="" onChange={e => {
          const wallIds = new Set(walls.map(w => w.globalId))
          const ids = flattenCollectionMemberRefs(e.target.value, collections).filter(r => r.source_kind === 'ifc' && wallIds.has(r.element_ref)).map(r => r.element_ref)
          update({ coreIds: [...new Set([...value.coreIds, ...ids])] })
        }}><option value="">Add walls from collection…</option>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="flex gap-2 my-1"><input className={`${field} flex-1 min-w-0`} placeholder="Find wall by name, level or IFC ID" aria-label="Find core walls" value={search} onChange={e => setSearch(e.target.value)} /><button type="button" onClick={() => update({ coreIds: [] })}>Clear</button></div>
        <div className="max-h-32 overflow-y-auto">{matches.slice(0, 50).map(w => <label key={w.globalId} className="flex gap-2 py-1" title={w.globalId}>
          <input type="checkbox" checked={value.coreIds.includes(w.globalId)} onChange={e => update({ coreIds: e.target.checked ? [...value.coreIds, w.globalId] : value.coreIds.filter(id => id !== w.globalId) })} />
          <span>{w.storeyName} · {w.name}</span>
        </label>)}</div>
        {matches.length > 50 && <p>Showing 50 of {matches.length}. Refine the search or use a collection.</p>}
      </details>
      <details><summary className="cursor-pointer font-semibold">Construction floors — review intermediate stair levels</summary>
        <p className="my-1">Merge intermediate authoring levels into the floor supporting those elements. The IFC model itself stays unchanged.</p>
        <div className="max-h-48 overflow-y-auto space-y-1">{storeys.map(s => <label key={s.storeyName} className="grid grid-cols-2 gap-2 items-center"><span>{s.storeyName}</span>
          <select aria-label={`Construction floor for ${s.storeyName}`} className={field} value={value.levelMap[s.storeyName] ?? s.storeyName} onChange={e => update({ levelMap: { ...value.levelMap, [s.storeyName]: e.target.value } })}>
            {storeys.map(t => <option key={t.storeyName}>{t.storeyName}</option>)}
          </select></label>)}</div>
      </details>
      <p className="text-gray-500 dark:text-prosota-muted">Façade advances floor by floor after the chosen structural lead. Full-height objects remain whole; split them in the model for floor-by-floor animation. Review estimated durations before using the schedule.</p>
    </>}
  </section>
}
