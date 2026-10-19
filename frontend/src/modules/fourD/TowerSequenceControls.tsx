import type { ExtractedElement } from './ifcScheduleExtraction'
import type { StoreyGroup } from './scheduleGeneration'
import type { TowerDetection } from './towerDetection'
import { useState } from 'react'

export interface TowerSettings {
  enabled: boolean; coreIds: string[]; facadeIds: string[]; retainedIds: string[]; levelMap: Record<string, string>
  coreLeadFloors: number; facadeLagFloors: number
}
export const initialTowerSettings: TowerSettings = { enabled: false, coreIds: [], facadeIds: [], retainedIds: [], levelMap: {}, coreLeadFloors: 1, facadeLagFloors: 2 }
const field = 'rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel2 text-gray-800 dark:text-prosota-paper p-1'
export function TowerSequenceControls({ value, onChange, elements, storeys, detection, onPreview, selectedIds, aiMode = false, onAiMode }: {
  aiMode?: boolean; onAiMode?: (enabled: boolean) => void
  value: TowerSettings; onChange: (value: TowerSettings) => void; elements: ExtractedElement[]; storeys: StoreyGroup[]
  detection: TowerDetection; onPreview: (ids: string[], modelId: number) => void; selectedIds: string[]
}) {
  const [group, setGroup] = useState<'core' | 'facade' | 'uncertain'>('core')
  const modelIds = [...new Set(elements.map(e => e.sourceModelId))]
  const [model, setModel] = useState<number | null>(null)
  const modelId = model ?? modelIds[0]
  const update = (patch: Partial<TowerSettings>) => onChange({ ...value, ...patch })
  const uncertain = detection.uncertain.filter(s => !value.coreIds.includes(s.id) && !value.facadeIds.includes(s.id) && !value.retainedIds.includes(s.id))
  const ids = group === 'core' ? value.coreIds : group === 'facade' ? value.facadeIds : uncertain.map(s => s.id)
  const show = (g: typeof group) => { setGroup(g); onPreview(g === 'core' ? value.coreIds : g === 'facade' ? value.facadeIds : uncertain.map(s => s.id), modelId) }
  const add = (target: 'core' | 'facade') => {
    const allowed = selectedIds.filter(id => { const e = elements.find(e => e.globalId === id); return e && (target !== 'core' || (e.ifcType.startsWith('IfcWall') && ['Walls', 'Non-Structural Walls'].includes(e.category))) })
    update(target === 'core' ? { coreIds: [...new Set([...value.coreIds, ...allowed])], facadeIds: value.facadeIds.filter(id => !allowed.includes(id)) } : { facadeIds: [...new Set([...value.facadeIds, ...allowed])], coreIds: value.coreIds.filter(id => !allowed.includes(id)) })
  }
  return <section className="space-y-3 text-xs text-gray-800 dark:text-prosota-paper">
    <label className="flex items-center gap-2">Sequence <select className={field} value={aiMode ? 'poe' : value.enabled ? 'tower' : 'standard'} onChange={e => { onAiMode?.(e.target.value === 'poe'); update({ enabled: e.target.value === 'tower' }) }}><option value="standard">Standard</option><option value="tower">Tower</option>{onAiMode && <option value="poe">Poe AI Generation</option>}</select></label>
    {value.enabled && <>
      <p>Suggested groups are ready. Highlight them in the model, then accept or adjust.</p>
      <div className="flex flex-wrap gap-2">
        <button className={field} onClick={() => show('core')}>Core · {value.coreIds.length}</button>
        <button className={field} onClick={() => show('facade')}>Façade · {value.facadeIds.length}</button>
        <button className={field} onClick={() => show('uncertain')}>Needs review · {uncertain.length}</button>
      </div>
      {modelIds.length > 1 && <label>Review model <select className={field} value={modelId} onChange={e => { const m = Number(e.target.value); setModel(m); onPreview(ids, m) }}>{modelIds.map(m => <option key={m} value={m}>Model {m}</option>)}</select></label>}
      <p className="text-gray-500 dark:text-prosota-muted">{group === 'uncertain' ? 'Exterior screens may be structural bracing. Unchanged classifications are retained unless you assign them below.' : 'Click elements in the model to adjust the group. Use the normal multi-selection controls.'}</p>
      {!value.coreIds.length && <p>No confident core identified. Select shaft/stair walls, or accept a sequence without a separate core.</p>}
      <p>{selectedIds.length} elements selected in the model.</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={!selectedIds.length} className={`${field} disabled:opacity-40`} onClick={() => add('core')}>Selection → core</button>
        <button disabled={!selectedIds.length} className={`${field} disabled:opacity-40`} onClick={() => add('facade')}>Selection → façade</button>
        <button disabled={!selectedIds.length} className={`${field} disabled:opacity-40`} onClick={() => update({ coreIds: value.coreIds.filter(id => !selectedIds.includes(id)), facadeIds: value.facadeIds.filter(id => !selectedIds.includes(id)), retainedIds: [...new Set([...value.retainedIds, ...selectedIds])] })}>Keep original role</button>
      </div>
      <details><summary className="cursor-pointer font-semibold">Advanced</summary><div className="space-y-2 pt-2">
        <label className="block">Core lead (floors) <input aria-label="Core lead in floors" className={`${field} w-14`} type="number" min={1} max={20} value={value.coreLeadFloors} onChange={e => update({ coreLeadFloors: Number(e.target.value) })} /></label>
        <label className="block">Façade lag (floors) <input aria-label="Facade lag in floors" className={`${field} w-14`} type="number" min={0} max={20} value={value.facadeLagFloors} onChange={e => update({ facadeLagFloors: Number(e.target.value) })} /></label>
        <p>{Object.keys(value.levelMap).length} intermediate levels grouped automatically. Core lifts rise from their supporting floor.</p>
        <details><summary>Adjust construction floors</summary><div className="max-h-40 overflow-y-auto">{storeys.map(s => <label key={s.storeyName} className="grid grid-cols-2 gap-1"><span>{s.storeyName}</span><select className={field} value={value.levelMap[s.storeyName] ?? s.storeyName} onChange={e => update({ levelMap: { ...value.levelMap, [s.storeyName]: e.target.value } })}>{storeys.map(t => <option key={t.storeyName}>{t.storeyName}</option>)}</select></label>)}</div></details>
        <p>Whole multi-storey façade objects wait for their highest supporting floor. Geometry is not split.</p>
      </div></details>
    </>}
  </section>
}
