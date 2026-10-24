import { ShapeOperationsPanel, type ShapeSource } from './ShapeOperationsPanel'
import type { Object3D } from 'three'
import { arraySourceSnapshot, disposeArraySnapshot } from './arraySourceSnapshot'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { Activity } from '@/modules/scheduling/types'
import type { Path } from './paths'
import type { Zone } from './zones'
import { recipe, siteError, type SiteItem, type useSiteScene } from './siteScene'
import { SiteAnimationControls } from './SiteAnimationControls'
import { SiteAssetLibrary } from './SiteAssetLibrary'
import { useSiteAssetInventory, importSiteAsset, type SiteAsset } from './siteAssets'
import { ElementLinkFields } from './ElementLinkFields'
import type { ModelElementLink } from './modelElementLinks'
import type { AnimationProfile } from './animationProfiles'

const input = 'w-full rounded border p-1.5 bg-white dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line'
const button = 'rounded border px-2 py-1.5 disabled:opacity-40 dark:border-prosota-line'
const presets: Record<Exclude<SiteItem['kind'], 'asset'>, { name: string; width: number; depth: number; height: number; color: string }> = {
  shape: { name:'Closed shape / water',width:1,depth:1,height:.2,color:'#236b73' },
  array: { name:'Objects along path',width:3,depth:3,height:5,color:'#4d7c0f' },
  scatter: { name:'Scatter in zone',width:3,depth:3,height:5,color:'#4d7c0f' },
  fence: { name: 'Fence', width: 2, depth: .08, height: 2, color: '#64748b' },
  context: { name: 'Context building', width: 12, depth: 10, height: 15, color: '#cbd5e1' },
  cabin: { name: 'Site cabin', width: 6, depth: 2.4, height: 2.6, color: '#e2e8f0' },
  tree: { name: 'Tree', width: 3, depth: 3, height: 5, color: '#4d7c0f' },
  person: { name: 'Static person', width: .5, depth: .3, height: 1.75, color: '#f59e0b' },
  arrow: { name: 'Road arrow', width: 1, depth: 2.5, height: .02, color: '#ffffff' },
}
export function SiteToolsPanel({ selectedShapeSources, hideShapeSources, importRequest, projectId, paths, zones, sceneSources, activities, upAxis, state, openPaths, focusSite, links, profiles, onLink, onUnlink, onAssignProfile, linkError }: {
  selectedShapeSources():ShapeSource[]
  hideShapeSources(ids:string[]):()=>void
  importRequest?: number
  sceneSources: {id:string;name:string;object:Object3D}[]
  projectId: string; paths: Path[]; zones: Zone[]; activities: Activity[]; upAxis: 'y' | 'z'
  state: ReturnType<typeof useSiteScene>; openPaths(): void; focusSite(): void
  links: ModelElementLink[]; profiles: AnimationProfile[]; linkError: string | null
  onLink(item: SiteItem, activityId: string, profileId: string | null): void
  onUnlink(id: string): void; onAssignProfile(id: string, profileId: string | null): void
}) {
  const [edit, setEdit] = useState<SiteItem | null>(null)
  const [capturing,setCapturing]=useState(false)
  const [sourceId,setSourceId]=useState('')
  const [previewing, setPreviewing] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [library, setLibrary] = useState(true)
  const inventory = useSiteAssetInventory(projectId)
  const [libraryFilter,setLibraryFilter] = useState('')
  useEffect(()=>{if(importRequest){setLibrary(true);setLibraryFilter('')}},[importRequest])
  const generation = useRef(0)
  const sequence = useRef<AbortController | null>(null)
  const { scene, draft, setDraft, selected, setSelected, save, busy, error, setError } = state
  function cancel() { generation.current++; sequence.current?.abort(); setEdit(null); setDraft(null); state.setPlacing(false); setPreviewing(false); setError('') }
  useEffect(() => () => { generation.current++; sequence.current?.abort(); setDraft(null); state.setPlacing(false) }, [])
  useEffect(() => {
    if (!state.placement || !edit) return
    const next = { ...edit, position: state.placement.point }
    setEdit(next); void preview(next)
  }, [state.placement])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  })
  function change(patch: Partial<SiteItem>) {
    generation.current++; sequence.current?.abort(); setPreviewing(false); setDraft(null); state.setPlacing(false)
    setEdit(old => old ? { ...old, ...patch } : null); setError('')
  }
  function startShape(kind: Exclude<SiteItem['kind'], 'asset'>) {
    cancel(); focusSite(); setSelected(null)
    setEdit({ id: crypto.randomUUID(), kind, ...presets[kind], generator_version: 1, up_axis: upAxis, units: 'm',
      position: { x: 0, y: 0, z: 0 }, yaw: 0, locked: false, activity_id: null, path_id: null,
      points: [], closed: false, module_length: 2, gate_start: 4, gate_width: 0, spacing:3, count:20, seed:1, placement_kind:'tree', panel_fit:'fit' })
  }
  function start(kind: Exclude<SiteItem['kind'], 'asset'>) {
    if (['shape','array','scatter','fence'].includes(kind)) {startShape(kind);return}
    const type = {shape:'',array:'',scatter:'',fence:'Fences',context:'Context buildings',cabin:'Cabins',tree:'Trees',person:'People',arrow:'Road arrows'}[kind]
    const matches = inventory.assets.filter(a=>a.category===type || (kind==='tree' && a.category==='Vegetation'))
    if(matches.length===1) {placeAsset(matches[0]);return}
    if(matches.length>1) {cancel();setLibraryFilter(type);setLibrary(true);return}
    startShape(kind)
  }
  function placeAsset(asset: SiteAsset) {
    cancel(); focusSite(); setSelected(null); setLibrary(false); setConfirmed(true)
    const value: SiteItem = { id: crypto.randomUUID(), kind: 'asset', asset_id: asset.id, name: asset.name,
      ...asset.dimensions, color: '#ffffff', generator_version: 1, up_axis: upAxis, units: 'm',
      position: { x: 0, y: 0, z: 0 }, yaw: 0, locked: false, activity_id: null, path_id: null,
      points: [], closed: false, module_length: 2, gate_start: 0, gate_width: 0 }
    setEdit(value); setDraft(value); state.setPlacing(true)
  }
  async function useSceneSource() {
    const source=sceneSources.find(s=>s.id===sourceId)
    if(!source || !edit)return
    const version=++generation.current
    setCapturing(true);setDraft(null);setError('')
    let snapshot: ReturnType<typeof arraySourceSnapshot> | undefined
    try {
      snapshot=arraySourceSnapshot(source.object,upAxis,source.name)
      const {GLTFExporter}=await import('three/examples/jsm/exporters/GLTFExporter.js')
      const bytes=await new GLTFExporter().parseAsync(snapshot,{binary:true,onlyVisible:false}) as ArrayBuffer
      const asset=await importSiteAsset(projectId,new File([bytes],source.name.replace(/\.glb$/i,'')+' - array source.glb',{type:'model/gltf-binary'}),'Other',()=>{})
      if(version!==generation.current)return
      inventory.setAssets(old=>[...old,asset]);change({placement_kind:'asset',asset_id:asset.id,...asset.dimensions})
    }catch(error){if(version===generation.current)setError(siteError(error))}
    finally{if(snapshot)disposeArraySnapshot(snapshot);setCapturing(false)}
  }
  function beginPlacement() {
    if (!edit || !confirmed) return
    focusSite(); setDraft(recipe(edit)); state.setPlacing(true)
  }
  async function preview(candidate?: SiteItem) {
    if (!(candidate || edit) || !confirmed) return
    const value = recipe(candidate || edit!)
    if (['fence','shape','array','scatter'].includes(value.kind)) {
      if(value.zone_id) {
        const zone=zones.find(z=>z.id===value.zone_id)
        if(!zone){setError('Choose a zone first');return}
        const axes= value.up_axis==='z'?['x','y'] as const:['x','z'] as const
        value.points=zone.shape==='circle' && zone.points[0] ? Array.from({length:64},(_,i)=>({...zone.points[0],[axes[0]]:zone.points[0][axes[0]]+zone.radius*Math.cos(i*Math.PI*2/64),[axes[1]]:zone.points[0][axes[1]]+zone.radius*Math.sin(i*Math.PI*2/64),[value.up_axis]:zone.elevation})) : zone.points.map(p=>({...p,[value.up_axis]:zone.elevation}))
        value.closed=true;value.curve_mode='straight'
      } else {
      const path = paths.find(p => p.id === value.path_id)
      if (!path) { setError('Choose a path first'); return }
      value.points = path.points; value.closed = path.closed; value.curve_mode=path.curve_mode || 'curved'
      }
    }
    const version = ++generation.current
    sequence.current?.abort(); sequence.current = new AbortController(); setPreviewing(true); setDraft(null); setError('')
    try {
      const { data } = await api.post<SiteItem>(`/api/v1/site-scenes/${projectId}/preview`, value, { signal: sequence.current.signal })
      if (generation.current === version) { setDraft(data); setEdit(recipe(data)) }
    } catch (error) { if (generation.current === version) setError(siteError(error)) }
    finally { if (generation.current === version) setPreviewing(false) }
  }
  async function commit() {
    if (!draft || state.placing) return
    const items = scene.items.filter(i => i.id !== draft.id)
    try { await save([...items, draft], `Site tools: ${draft.name}`); cancel() } catch { /* state shows error */ }
  }
  async function update(item: SiteItem, patch: Partial<SiteItem> | null) {
    try { await save(patch ? scene.items.map(i => i.id === item.id ? { ...i, ...patch } : i) : scene.items.filter(i => i.id !== item.id), `${patch ? 'Update' : 'Remove'} ${item.name}`) } catch { /* state shows error */ }
  }
  const chosen = scene.items.find(i => i.id === selected || selected?.startsWith(i.id + ':panel:'))
  const number = (label: string, key: 'width' | 'depth' | 'height' | 'yaw' | 'module_length' | 'gate_start' | 'gate_width' | 'spacing' | 'count' | 'seed') => <label>{label}<input className={input} type="number" step="any" value={edit?.[key] ?? 0} onChange={e => change({ [key]: e.target.valueAsNumber })} /></label>
  return <div className="p-3 space-y-3 text-xs text-gray-700 dark:text-prosota-paper">
    <div className="flex gap-2"><button className={`${button} flex-1 ${library ? 'bg-blue-600 text-white' : ''}`} onClick={() => { cancel(); setLibraryFilter(''); setLibrary(true) }}>Asset library</button><button className={`${button} flex-1 ${!library ? 'bg-blue-600 text-white' : ''}`} onClick={() => setLibrary(false)}>Layout tools</button></div>
    {library && <SiteAssetLibrary projectId={projectId} inventory={inventory} initialFilter={libraryFilter} onPlace={placeAsset} />}
    {!library && !edit && <><p>Place site object</p><div className="grid grid-cols-2 gap-1">{Object.entries(presets).map(([kind, value]) => <button key={kind} className={button} disabled={!state.ready || busy} onClick={() => start(kind as Exclude<SiteItem['kind'], 'asset'>)}>+ {value.name}</button>)}</div>{inventory.assets.some(a=>a.category==='Fences') && <button className={button} onClick={()=>startShape('fence')}>Draw fence run from path</button>}</>}
    {!library && !edit && <ShapeOperationsPanel projectId={projectId} upAxis={upAxis} sources={sceneSources} state={state} selectedSources={selectedShapeSources} hideSources={hideShapeSources}/> }
    {edit && <div className="space-y-2 border-t pt-2 dark:border-prosota-line">
      <label>Name<input className={input} value={edit.name} onChange={e => change({ name: e.target.value })} /></label>
      {['fence','shape','array','scatter'].includes(edit.kind) ? <>
        <label>Source path<select className={input} value={edit.path_id || ''} onChange={e => change({ path_id: e.target.value || null, zone_id:null })}><option value="">Choose path…</option>{paths.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {edit.kind!=='fence' && <label>Or source zone<select className={input} value={edit.zone_id || ''} onChange={e=>change({zone_id:e.target.value || null,path_id:null})}><option value="">Choose zone…</option>{zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label>}
        <button className={button} onClick={openPaths}>Draw / edit a path</button>
        <p>Follows the source geometry. Edit its points, then Preview and Save to regenerate. Saved geometry is retained if the source is hidden or removed.</p>
        <label>Tag<input className={input} value={edit.tag || ''} onChange={e=>change({tag:e.target.value})} placeholder="Water, landscaping, access…" /></label>
        {edit.kind==='shape' && <><p>Close a path or choose a zone to create a solid footprint.</p>{number('Height / thickness (m)','height')}<label>Surface<select className={input} value={edit.finish || 'default'} onChange={e=>change({finish:e.target.value as 'default'|'water'})}><option value="default">Standard · edit in Materials</option><option value="water">Animated water</option></select></label></>}
        {(edit.kind==='array'||edit.kind==='scatter') && <>
          <label>Use an existing scene object<select className={input} value={sourceId} disabled={capturing} onChange={e=>setSourceId(e.target.value)}><option value="">Choose imported or created object…</option>{sceneSources.filter(s=>s.id!=='site:'+edit.id).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button className={button} disabled={!sourceId || capturing} onClick={()=>void useSceneSource()}>{capturing?'Preparing source…':'Use object as source'}</button>
          <p>Creates a reusable copy of its current geometry and pose. The original stays in place; copies survive unloading it.</p>

          <label>Object<select className={input} value={edit.placement_kind==='asset'?'asset:'+edit.asset_id:edit.placement_kind || 'tree'} onChange={e=>{const a=inventory.assets.find(a=>'asset:'+a.id===e.target.value);change(a?{placement_kind:'asset',asset_id:a.id,...a.dimensions}:{placement_kind:e.target.value as SiteItem['placement_kind'],asset_id:null,...presets[e.target.value as keyof typeof presets]})}}>{['tree','person','cabin','context','arrow'].map(k=><option key={k} value={k}>{presets[k as keyof typeof presets].name}</option>)}{inventory.assets.map(a=><option key={a.id} value={'asset:'+a.id}>{a.name}</option>)}</select></label>
          {number(edit.kind==='array'?'Spacing (m)':'Minimum centre spacing (m)','spacing')}
          {edit.kind==='scatter'?<>{number('Object count','count')}{number('Random seed','seed')}<label><input type="checkbox" checked={edit.random_rotation!==false} onChange={e=>change({random_rotation:e.target.checked})} /> Random rotation</label></>:<label><input type="checkbox" checked={edit.align_to_path!==false} onChange={e=>change({align_to_path:e.target.checked})} /> Align to path</label>}
          <div className="grid grid-cols-2 gap-2">{number('Width (m)','width')}{number('Depth (m)','depth')}{number('Height (m)','height')}{number('Heading offset (°)','yaw')}</div>
        </>}
        {edit.kind==='fence' && <><label>Panel fitting<select className={input} value={edit.panel_fit || 'fit'} onChange={e=>change({panel_fit:e.target.value as SiteItem['panel_fit']})}><option value="fit">Fit equal panels to each span</option><option value="trim">Trim the final panel</option><option value="strict">Whole panels only</option></select></label>
        <div className="grid grid-cols-2 gap-2">{number('Panel length (m)', 'module_length')}{number('Height (m)', 'height')}{number('Gate start (m)', 'gate_start')}{number('Gate opening (m)', 'gate_width')}</div></>}
      </> : <>
        <button className={`${button} w-full bg-blue-600 text-white`} disabled={!confirmed || busy} onClick={beginPlacement}>{state.placing ? 'Click a surface to place' : 'Place in viewport'}</button>
        {state.placing && <p className="rounded bg-blue-50 text-blue-800 p-2">Move to preview · click to position · right-drag to navigate · Esc to cancel</p>}
        <details><summary className="cursor-pointer">Exact position</summary>
        <div className="grid grid-cols-3 gap-1">{(['x','y','z'] as const).map(axis => <label key={axis}>{axis.toUpperCase()} (m)<input type="number" step="any" className={input} value={edit.position[axis]} onChange={e => change({ position: { ...edit.position, [axis]: e.target.valueAsNumber } })} /></label>)}</div>
        <p>{edit.up_axis.toUpperCase()} is up. Position is the base anchor; set its ground elevation explicitly.</p>
        </details>
        <div className="grid grid-cols-2 gap-2">{number('Width (m)', 'width')}{number('Depth (m)', 'depth')}{number('Height (m)', 'height')}{number('Rotation (°)', 'yaw')}</div>
      </>}
      {edit.kind !== 'asset' && <label className="flex items-center gap-2">Colour<input type="color" value={edit.color} onChange={e => change({ color: e.target.value })} /></label>}
      {edit.activity_id && <label>Previous visibility setting<select className={input} value={edit.activity_id} onChange={e => change({ activity_id: e.target.value || null })}><option value="">Clear setting</option>{activities.filter(a => a.start && a.finish).map(a => <option value={a.id} key={a.id}>{a.code} · {a.task_name}</option>)}</select><span className="block">Activity links and profiles take precedence.</span></label>}
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => { generation.current++; sequence.current?.abort(); setPreviewing(false); setConfirmed(e.target.checked); setDraft(null); state.setPlacing(false) }} />Model coordinates are in metres</label>
      <div className="flex gap-2"><button className={button} disabled={!confirmed || busy || previewing || capturing || state.placing} onClick={() => void preview()}>{previewing ? 'Preparing…' : 'Preview'}</button><button className={`${button} bg-blue-600 text-white`} disabled={!draft || busy || state.placing || previewing || capturing} onClick={() => void commit()}>Save</button><button className={button} disabled={busy} onClick={cancel}>Cancel</button></div>
      {draft?.layout?.panels && <p>{draft.layout.panel_count} panels · {draft.layout.length?.toFixed(2)} m run · {draft.layout.gate_width?.toFixed(2)} m gate opening</p>}
    </div>}
    {draft?.layout?.placements && <p>{draft.layout.count} objects prepared</p>}
    {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
    <div className="flex justify-between"><strong>Site objects ({scene.items.length})</strong><button className={button} disabled={busy} onClick={() => { cancel(); void state.reload() }}>Reload</button></div>
    {scene.items.map(item => {
      const path = paths.find(p => p.id === item.path_id)
      const changed = ['fence','shape','array','scatter'].includes(item.kind) && (item.zone_id ? !zones.some(z=>z.id===item.zone_id) : !path || JSON.stringify(path.points) !== JSON.stringify(item.points) || path.closed !== item.closed || (path.curve_mode || 'curved') !== (item.curve_mode || 'straight'))
      return <button key={item.id} className={`w-full text-left rounded border p-2 ${selected === item.id || selected?.startsWith(item.id + ':panel:') ? 'border-blue-500 bg-blue-50 dark:bg-slate-800' : 'dark:border-prosota-line'}`} onClick={() => { focusSite(); setSelected(item.id) }}>
        {item.name}{item.tag ? ' · '+item.tag : ''}{item.locked ? ' · Locked' : ''}{changed && <span className="block text-amber-600">Source changed/missing · saved geometry retained</span>}
        {item.activity_id && !activities.some(a => a.id === item.activity_id) && <span className="block text-amber-600">Activity not in the loaded schedule · hidden in playback</span>}
      </button>
    })}
    {chosen && !edit && <div className="flex flex-wrap gap-2">
      <button className={button} disabled={chosen.locked || busy} onClick={() => { setEdit(recipe(chosen)); setConfirmed(true) }}>Edit / regenerate</button>
      <button className={button} disabled={busy} onClick={() => void update(chosen, { locked: !chosen.locked })}>{chosen.locked ? 'Unlock' : 'Lock'}</button>
      <button className={button} disabled={chosen.locked || busy} onClick={() => void update(chosen, null)}>Remove</button>
    </div>}
    {chosen && <p>Selected: {selected?.includes(':panel:') ? 'panel at ' + selected.split(':panel:')[1] + ' m' : chosen.name}. Use Frame Selected in the viewport.</p>}
    {chosen?.asset_id && !edit && <SiteAnimationControls item={chosen} disabled={chosen.locked || busy} onChange={patch=>void update(chosen,patch)} />}
    {chosen && !edit && <section className="border-t pt-2 space-y-2 dark:border-prosota-line">
      <strong>Activity links & profiles</strong>
      <ElementLinkFields key={chosen.id} activities={activities} links={links.filter(l => l.source_kind === 'site' && l.element_ref === chosen.id)} animationProfiles={profiles}
        onLink={(activityId, profileId) => onLink(chosen, activityId, profileId)} onUnlink={onUnlink} onAssignProfile={onAssignProfile} />
      {linkError && <p role="alert" className="text-red-600 dark:text-red-400">{linkError}</p>}
    </section>}
    <p className="text-gray-500">Use the main Undo / Redo controls to reverse a saved operation.</p>
  </div>
}
