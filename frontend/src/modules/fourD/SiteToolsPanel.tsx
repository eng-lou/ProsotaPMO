import { WorkSequencePanel } from './WorkSequencePanel'
import { ClimbingFormworkPanel } from './ClimbingFormworkPanel'
import { GROUND_FINISHES, REALISTIC_CLASS_LABELS } from './realisticMaterials'
import { LightSettings, defaultSiteIllumination } from './LightSettings'
import { GatePosePanel } from './GatePosePanel'
import { AssetPartsPanel } from './AssetPartsPanel'
import { splitSiteAsset } from './assetParts'
import { loadSiteAsset } from './siteAssets'
import { GeographicEditor } from './GeographicEditor'
import { GeographicWorkbench } from './GeographicWorkbench'
import { ReplacementPanel } from './ReplacementPanel'
import { downloadObjectGlb, findGeographicRoot } from './geographicExport'
import { editableMapFeatures } from './geographicSelection'
import { buildGeographicContext, disposeGeographicContext } from './geographicGeometry'
import { ToolVisualGuide } from './ToolVisualGuide'
import { ShapeOperationsPanel, type ShapeSource } from './ShapeOperationsPanel'
import type { Box3, Object3D } from 'three'
import { arraySourceSnapshot, disposeArraySnapshot } from './arraySourceSnapshot'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { Activity } from '@/modules/scheduling/types'
import type { Path } from './paths'
import type { Zone } from './zones'
import { recipe, siteError, type SiteItem, type useSiteScene } from './siteScene'
import { SiteAnimationControls } from './SiteAnimationControls'
import { WorkerActionsPanel } from './WorkerActionsPanel'
import type { TimelineFormat } from './TimelinePointInput'
import { captureSlabReferences } from './slabReferences'
import { defaultScaffold } from './enclosureOptions'
import { FenceSettings, TowerCoverSettings, fencePresets } from './EnclosureSettings'
import { SiteToolSection } from './SiteToolSection'
import { SiteObjectList } from './SiteObjectList'
import { removeSitePlacements, type SiteSelectionMode } from './siteObjectSelection'
import type { ConstructionTemplate } from './constructionActivities'
import { ConstructionCreator, type CreatorKind } from './ConstructionCreator'
import { GroundFromObjectsPanel } from './GroundFromObjectsPanel'
import { PourZonesPanel } from './PourZonesPanel'
import { KitAndLiftPanel } from './KitAndLiftPanel'
import { CoreRigTemplate } from './CoreRigTemplate'
import { SiteAssetLibrary } from './SiteAssetLibrary'
import { useSiteAssetInventory, importSiteAsset, type SiteAsset } from './siteAssets'
import { ElementLinkFields } from './ElementLinkFields'
import type { ModelElementLink } from './modelElementLinks'
import type { AnimationProfile } from './animationProfiles'

const input = 'w-full rounded border p-1.5 bg-white dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line'
const button = 'rounded border px-2 py-1.5 disabled:opacity-40 dark:border-prosota-line'
const presets: Record<Exclude<SiteItem['kind'], 'asset'|'geographic'>, { name: string; width: number; depth: number; height: number; color: string }> = {
  light: { name: 'Illumination', width: 1.2, depth: .6, height: 1, color: '#fff4dd' },
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
export function SiteToolsPanel({ floorTools, sceneLightsEnabled, enableSceneLights, timelineFormat, timelineDateRef, onSeek, onEditAttachment, selectedShapeSources, readPileBounds, hideShapeSources, importRequest, projectId, paths, zones, sceneSources, activities, riggedIds, extractionBlocks, onGenerateSchedule, upAxis, state, openPaths, focusSite, selectedObjectIds, onPickItems, links, profiles, onLink, onUnlink, onAssignProfile, linkError }: {
  floorTools?: React.ReactNode
  sceneLightsEnabled: boolean; enableSceneLights(): void
  timelineFormat?: TimelineFormat
  timelineDateRef?: React.MutableRefObject<Date|null>
  onSeek?(date:Date):void
  onEditAttachment?(mode:"translate"|"rotate"):void
  riggedIds?: Set<string>
  extractionBlocks?: Record<string,string>
  onGenerateSchedule(ids:string[],template?:ConstructionTemplate):void
  readPileBounds(machineId: string): Box3
  selectedShapeSources(scope?:'construction'):ShapeSource[]
  hideShapeSources(ids:string[]):()=>void
  importRequest?: number
  sceneSources: {id:string;name:string;object:Object3D}[]
  projectId: string; paths: Path[]; zones: Zone[]; activities: Activity[]; upAxis: 'y' | 'z'
  state: ReturnType<typeof useSiteScene>; openPaths(): void; focusSite(): void
  selectedObjectIds: ReadonlySet<string>; onPickItems(ids: string[], mode: SiteSelectionMode): void
  links: ModelElementLink[]; profiles: AnimationProfile[]; linkError: string | null
  onLink(item: SiteItem, activityId: string, profileId: string | null): void
  onUnlink(id: string): void; onAssignProfile(id: string, profileId: string | null): void
}) {
  const [edit, setEdit] = useState<SiteItem | null>(null)
  const [capturing,setCapturing]=useState(false)
  const [placeAsParts,setPlaceAsParts]=useState(false)
  const [sourceId,setSourceId]=useState('')
  const [previewing, setPreviewing] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [library, setLibrary] = useState(true)
  const [creator,setCreator]=useState<CreatorKind|null>(null)
  const inventory = useSiteAssetInventory(projectId)
  const [libraryFilter,setLibraryFilter] = useState('')
  useEffect(()=>{if(importRequest){setLibrary(true);setLibraryFilter('')}},[importRequest])
  const [bayReview,setBayReview]=useState<SiteItem|null>(null)
  const generation = useRef(0)
  const sequence = useRef<AbortController | null>(null)
  const { scene, draft, setDraft, selected, setSelected, save, busy, error, setError } = state
  function cancel() { setBayReview(null); setCreator(null); setPlaceAsParts(false); generation.current++; sequence.current?.abort(); setEdit(null); setDraft(null); state.setPlacing(false); setPreviewing(false); setError('') }
  useEffect(() => () => { generation.current++; sequence.current?.abort(); setDraft(null); state.setPlacing(false) }, [])
  useEffect(() => {
    if (!state.placement || !edit) return
    const next = { ...edit, position: state.placement.point }
    setEdit(next)
    if (next.kind === 'light') setDraft(next)
    else void preview(next)
  }, [state.placement])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  })
  function change(patch: Partial<SiteItem>) {
    if(!edit?.enclosure?.scaffold?.slabs?.length && patch.enclosure?.scaffold?.slabs?.length)setConfirmed(true)
    if (edit?.kind === 'light') {
      const next = { ...edit, ...patch }
      setEdit(next); setDraft(next); setError('')
      if (patch.position) state.setPlacing(false)
      return
    }
    generation.current++; sequence.current?.abort(); setPreviewing(false); setDraft(null); state.setPlacing(false)
    setEdit(old => old ? { ...old, ...patch } : null); setError('')
  }
  function makeShape(kind: Exclude<SiteItem['kind'], 'asset'|'geographic'>) {
    const item: SiteItem = { id: crypto.randomUUID(), kind, ...presets[kind], generator_version: 1, up_axis: upAxis, units: 'm',
      position: { x: 0, y: 0, z: 0 }, yaw: 0, locked: false, activity_id: null, path_id: null,
      points: [], closed: false, module_length: 2, gate_start: 4, gate_width: 0, spacing:3, count:20, seed:1, placement_kind:'tree', panel_fit:'fit' }
    if (kind === 'fence') {
      const {color,height,module_length} = fencePresets.edge
      Object.assign(item,{color,height,module_length,enclosure:{style:'edge',openings:[],levels:[0],perimeter_lights:false}})
    }
    if (kind === 'light') {
      item.name = 'Spot light'
      item.illumination = defaultSiteIllumination('spot')
    }
    return item
  }
  const pathDrafts = useRef<Partial<Record<'fence'|'array', SiteItem>>>({})
  function startShape(kind: Exclude<SiteItem['kind'], 'asset'|'geographic'>) {
    cancel(); focusSite(); setSelected(null)
    pathDrafts.current = {}
    const item = makeShape(kind)
    if (kind === 'light') { setConfirmed(true); setDraft(item); state.setPlacing(true) }
    setEdit(item)
  }
  function startSlabScaffold(){
    cancel()
    const item=makeShape('fence')
    const {label,...preset}=fencePresets.scaffold
    const scaffold={...defaultScaffold}
    try{
      const selected=selectedShapeSources('construction')
      if(selected.length){
        scaffold.slabs=captureSlabReferences(selected,upAxis)
        scaffold.base_elevation=Math.min(...scaffold.slabs.map(s=>s.elevation))
      }
    }catch(e){setError(siteError(e))}
    focusSite();setSelected(null);setConfirmed(true)
    setEdit({...item,...preset,name:label,enclosure:{...item.enclosure!,style:'scaffold',scaffold}})
  }
  function switchPathLayout(kind: 'fence'|'array') {
    if (!edit || (edit.kind !== 'fence' && edit.kind !== 'array') || edit.kind === kind) return
    pathDrafts.current[edit.kind] = edit
    const target = pathDrafts.current[kind] || makeShape(kind)
    const pathId = edit.path_id || (edit.zone_id ? target.path_id : null)
    cancel()
    setEdit({ ...target, id: edit.id, path_id: pathId, zone_id: pathId ? null : target.zone_id,
      name: edit.name === presets[edit.kind].name ? target.name : edit.name })
  }
  function startLayout(kind: 'fence'|'scatter'|'shape'|'context'|'light') {
    if (kind === 'context') {
      const buildings = inventory.assets.filter(asset => asset.category === 'Context buildings')
      if (buildings.length === 1) { placeAsset(buildings[0]); return }
      if (buildings.length > 1) { cancel(); setLibraryFilter('Context buildings'); setLibrary(true); return }
    }
    startShape(kind)
  }
  function placeAsset(asset: SiteAsset, parts=false, articulated=false, fit?:Partial<SiteItem>) {
    cancel(); setPlaceAsParts(parts); focusSite(); setSelected(null); setLibrary(false); setConfirmed(true)
    const value: SiteItem = { id: crypto.randomUUID(), kind: 'asset', asset_id: asset.id, name: asset.name,
      ...asset.dimensions, color: '#ffffff', generator_version: 1, up_axis: upAxis, units: 'm',
      position: { x: 0, y: 0, z: 0 }, yaw: 0, locked: false, activity_id: null, path_id: null,
      points: [], closed: false, module_length: 2, gate_start: 0, gate_width: 0 }
    if (articulated) {
      value.climbing_formwork={mode:'articulated',axis:upAxis,reference_elevation:0,lifts:[]}
      value.animation_playing=false
    }
    if(fit) Object.assign(value,fit)
    setEdit(value); setDraft(value); state.setPlacing(!fit)
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
    const slabRun=value.enclosure?.style==='scaffold'&&value.enclosure.scaffold?.slabs?.length
    if(slabRun){value.path_id=null;value.points=[];value.closed=false}
    if (!slabRun && ['fence','shape','array','scatter'].includes(value.kind)) {
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
      if (generation.current === version) { setDraft(data); setEdit(recipe(data)); setBayReview(data) }
    } catch (error) { if (generation.current === version) setError(siteError(error)) }
    finally { if (generation.current === version) setPreviewing(false) }
  }
  // A changed slab or bay invalidates every floor above. Refresh the complete draft
  // after the user finishes an edit, and ignore superseded requests in preview().
  const slabScaffold=edit?.enclosure?.style==='scaffold'&&!!edit.enclosure.scaffold?.slabs?.length
  useEffect(()=>{
    if(!slabScaffold||!confirmed||!edit||draft)return
    const timer=window.setTimeout(()=>void preview(edit),300)
    return ()=>window.clearTimeout(timer)
  },[edit,confirmed,slabScaffold])
  async function commit() {
    if (!draft || state.placing) return
    setCapturing(true)
    try { const placements=placeAsParts&&draft.kind==='asset'&&draft.asset_id ? splitSiteAsset(draft,await loadSiteAsset(draft.asset_id)) : [draft]
      if(!await save(current=>[...current.filter(i=>i.id!==draft.id),...placements], `3D Site tools: ${draft.name}`))return
      cancel()
      if (draft.kind === 'light' || draft.climbing_formwork?.mode==='articulated') setSelected(draft.id)
      if (draft.climbing_formwork?.reference_sources?.length) onPickItems([draft.id],'replace')
    } catch(e) { setError(siteError(e)) } finally { setCapturing(false) }
  }
  async function update(item: SiteItem, patch: Partial<SiteItem>) {
    try { await save(items => items.map(i => i.id === item.id ? { ...i, ...patch } : i), `Update ${item.name}`) } catch (error) { setError(siteError(error)) }
  }
  async function remove(ids: string[]) {
    const targets = new Set(ids)
    const single = ids.length === 1 && scene.items.find(item => item.id === ids[0])
    const label = single ? `Remove ${single.name}` : `Remove ${targets.size} site objects`
    try { await save(items => removeSitePlacements(items,targets),label) } catch (error) { setError(siteError(error)) }
  }
  const selectedSites = scene.items.filter(item => selectedObjectIds.has('site:' + item.id))
  const onlySite = selectedSites.length === 1 ? selectedSites[0] : undefined
  const chosen = selectedObjectIds.size === 1 ? onlySite : undefined
  const singleMachine = chosen?.kind === 'asset' && !chosen.asset_part ? chosen : undefined
  const [lastMachineId, setLastMachineId] = useState<string | null>(null)
  useEffect(() => {
    setLastMachineId(previous => singleMachine?.id ?? (previous && selectedObjectIds.has('site:' + previous) ? previous : null))
  }, [singleMachine?.id, selectedObjectIds])
  const sequenceOwner = singleMachine ?? selectedSites.find(item => item.id === lastMachineId)
    ?? (onlySite?.work_sequence?.kind === 'piling' ? onlySite : undefined)
  const sequenceMachine = sequenceOwner?.kind === 'asset' && !sequenceOwner.asset_part ? sequenceOwner : undefined
  const source=chosen?sceneSources.find(s=>s.id==='site:'+chosen.id)?.object:undefined
  const shapeSources=()=>{
    const selectedFeature=chosen?.geographic&&state.detailSelection?.itemId===chosen.id?editableMapFeatures(chosen.geographic).find(f=>f.id===state.detailSelection?.featureId):null
    if(selectedFeature&&chosen?.geographic&&source){
      if(selectedFeature.kind!=='building'&&!selectedFeature.replacement)throw Error('Select a building or a closed imported solid. Roads and landscape surfaces have no enclosed volume to cut.')
      const root=findGeographicRoot(source);if(!root)throw Error('Wait for the reconstruction to load')
      root.updateWorldMatrix(true,false)
      const solid=buildGeographicContext({...chosen.geographic,features:[selectedFeature],hidden_layers:[]},null,{solidOnly:true,assets:root.userData.replacementSources});solid.applyMatrix4(root.matrixWorld)
      return [{id:'geo:'+chosen.id+':'+selectedFeature.id,name:selectedFeature.name,object:solid,geographic:{itemId:chosen.id,featureId:selectedFeature.id},dispose:()=>disposeGeographicContext(solid)}]
    }
    return selectedShapeSources()
  }
  const number = (label: string, key: 'width' | 'depth' | 'height' | 'yaw' | 'module_length' | 'gate_start' | 'gate_width' | 'spacing' | 'count' | 'seed') => <label>{label}<input className={input} type="number" step="any" value={edit?.[key] ?? 0} onChange={e => change({ [key]: e.target.valueAsNumber })} /></label>
  return <div className="p-3 space-y-3 text-xs text-gray-700 dark:text-prosota-paper">
    <div className="flex gap-2"><button className={`${button} flex-1 ${library ? 'bg-blue-600 text-white' : ''}`} onClick={() => { cancel(); setLibraryFilter(''); setLibrary(true) }}>Asset library</button><button className={`${button} flex-1 ${!library ? 'bg-blue-600 text-white' : ''}`} onClick={() => setLibrary(false)}>Layout tools</button></div>
    {library && <SiteAssetLibrary projectId={projectId} inventory={inventory} initialFilter={libraryFilter} onPlace={placeAsset} />}
    {library && !edit && <CoreRigTemplate projectId={projectId} inventory={inventory} onPlace={asset=>placeAsset(asset,false,true)}/>}
    {!library && !edit && !creator && <div className="grid grid-cols-2 gap-1" aria-label="Place site object">
      {(['fence','scatter','shape','context','light'] as const).map(kind =>
        <button key={kind} className={button} disabled={!state.ready || busy} onClick={() => startLayout(kind)}>
          + {kind === 'fence' ? 'Fence / objects along path' : presets[kind].name}
        </button>)}
      <button className={button} disabled={!state.ready || busy} onClick={startSlabScaffold}>+ Scaffold from slabs</button>
      {(['Formwork','Reinforcement'] as const).map(kind=><button key={kind} className={button} disabled={!state.ready || busy}
        onClick={()=>setCreator(kind)}>+ {kind} creator</button>)}
      <button className={button} onClick={()=>onGenerateSchedule([],'cycle')}>Add simulation activities…</button>
    </div>}
    {!library && !edit && !creator && floorTools}
    {!library && !edit && !creator && <PourZonesPanel projectId={projectId} axis={upAxis} paths={paths} activities={activities} state={state} openPaths={openPaths} selection={()=>selectedShapeSources('construction')} hideSources={hideShapeSources} onSelect={ids=>onPickItems(ids,'replace')}/>}
    {!library && !edit && !creator && <KitAndLiftPanel state={state} activities={activities} axis={upAxis} selected={()=>selectedShapeSources('construction')}/>}
    {!library && !edit && !creator && <CoreRigTemplate projectId={projectId} inventory={inventory}
      selection={{sources:()=>selectedShapeSources('construction'),activities,axis:upAxis}}
      onPlace={(asset,fit)=>placeAsset(asset,false,true,fit)}/>}
    {!library && !edit && creator && <ConstructionCreator key={projectId+creator+upAxis} kind={creator} projectId={projectId} upAxis={upAxis} state={state} selectedSources={()=>selectedShapeSources('construction')} onSelect={ids=>onPickItems(ids,'replace')} onPlan={onGenerateSchedule} onClose={()=>setCreator(null)}/>}
    {!library && !edit && !creator && <GroundFromObjectsPanel activities={activities} key={projectId+upAxis} projectId={projectId} axis={upAxis} state={state}
      selection={()=>selectedShapeSources('construction')} hideSources={hideShapeSources}
      onSelect={ids=>onPickItems(ids,'replace')} onPlan={ids=>onGenerateSchedule(ids,'ground')}/>}
    {!edit && !creator && <ShapeOperationsPanel projectId={projectId} upAxis={upAxis} sources={sceneSources.filter(s=>!scene.items.some(i=>i.kind==='geographic'&&s.id==='site:'+i.id))} state={state} selectedSources={shapeSources} hideSources={hideShapeSources}/> }
    {edit && <div className="space-y-2 border-t pt-2 dark:border-prosota-line">
      {edit.kind==='asset'&&!edit.asset_part&&<TowerCoverSettings item={edit} change={change}/>}
      {edit.kind==='asset'&&!edit.asset_part&&edit.climbing_formwork?.mode!=='articulated'&&<label className="flex gap-2"><input type="checkbox" checked={placeAsParts} onChange={e=>setPlaceAsParts(e.target.checked)}/>Save as independent construction parts</label>}
      {(edit.kind === 'fence' || edit.kind === 'array') && !scene.items.some(item => item.id === edit.id) &&
        <label>Path layout<select className={input} value={edit.kind} onChange={e => switchPathLayout(e.target.value as 'fence'|'array')}>
          <option value="fence">Fence / hoarding</option><option value="array">Repeated objects</option>
        </select></label>}
      <label>Name<input className={input} value={edit.name} onChange={e => change({ name: e.target.value })} /></label>
      {edit.kind==='geographic' && edit.geographic ? <GeographicEditor data={edit.geographic} onChange={geographic=>change({geographic})}/> : ['fence','shape','array','scatter'].includes(edit.kind) ? <>
        {!(edit.enclosure?.style==='scaffold'&&edit.enclosure.scaffold?.slabs?.length)&&<><label>Source path<select className={input} value={edit.path_id || ''} onChange={e => change({ path_id: e.target.value || null, zone_id:null })}><option value="">Choose path…</option>{paths.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {edit.kind!=='fence' && <label>Or source zone<select className={input} value={edit.zone_id || ''} onChange={e=>change({zone_id:e.target.value || null,path_id:null})}><option value="">Choose zone…</option>{zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label>}
        <button className={button} onClick={openPaths}>Draw / edit a path</button>
        <p>Follows the source geometry. Edit its points, then Preview and Save to regenerate. Saved geometry is retained if the source is hidden or removed.</p></> }
        <label>Tag<input className={input} value={edit.tag || ''} onChange={e=>change({tag:e.target.value})} placeholder="Water, landscaping, access…" /></label>
        {edit.kind==='shape' && <><p>Close a path or choose a zone to create a solid footprint.</p>{number('Height / thickness (m)','height')}<label>Surface<select className={input} value={edit.finish || 'default'} onChange={e=>change({finish:e.target.value as SiteItem['finish']})}><option value="default">Standard · edit in Materials</option><option value="water">Animated water</option><optgroup label="Temporary ground">{GROUND_FINISHES.map(f=><option key={f} value={f}>{REALISTIC_CLASS_LABELS[f]}</option>)}</optgroup></select></label></>}
        {(edit.kind==='array'||edit.kind==='scatter') && <>
          <ToolVisualGuide topic="placement" mode={edit.kind}/>
          <label>Use an existing scene object<select className={input} value={sourceId} disabled={capturing} onChange={e=>setSourceId(e.target.value)}><option value="">Choose imported or created object…</option>{sceneSources.filter(s=>s.id!=='site:'+edit.id).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button className={button} disabled={!sourceId || capturing} onClick={()=>void useSceneSource()}>{capturing?'Preparing source…':'Use object as source'}</button>
          <p>Creates a reusable copy of its current geometry and pose. The original stays in place; copies survive unloading it.</p>

          <label>Object<select className={input} value={edit.placement_kind==='asset'?'asset:'+edit.asset_id:edit.placement_kind || 'tree'} onChange={e=>{
            const asset = inventory.assets.find(a => 'asset:'+a.id === e.target.value)
            if (asset) { change({placement_kind:'asset', asset_id:asset.id, ...asset.dimensions}); return }
            const kind = e.target.value as 'tree'|'person'|'cabin'|'context'|'arrow'
            const { width, depth, height, color } = presets[kind]
            change({placement_kind:kind, asset_id:null, width, depth, height, color})
          }}>{['tree','person','cabin','context','arrow'].map(k=><option key={k} value={k}>{presets[k as keyof typeof presets].name}</option>)}{inventory.assets.map(a=><option key={a.id} value={'asset:'+a.id}>{a.name}</option>)}</select></label>
          {number(edit.kind==='array'?'Spacing (m)':'Minimum centre spacing (m)','spacing')}
          {edit.kind==='scatter'?<>{number('Object count','count')}{number('Random seed','seed')}<label><input type="checkbox" checked={edit.random_rotation!==false} onChange={e=>change({random_rotation:e.target.checked})} /> Random rotation</label></>:<label><input type="checkbox" checked={edit.align_to_path!==false} onChange={e=>change({align_to_path:e.target.checked})} /> Align to path</label>}
          <div className="grid grid-cols-2 gap-2">{number('Width (m)','width')}{number('Depth (m)','depth')}{number('Height (m)','height')}{number('Heading offset (°)','yaw')}</div>
        </>}
        {edit.kind==='fence' && <FenceSettings item={edit} change={change} selection={()=>selectedShapeSources('construction')} layout={bayReview?.id===edit.id?bayReview.layout:scene.items.find(i=>i.id===edit.id)?.layout}/>}
      </> : <>
        <button className={`${button} w-full bg-blue-600 text-white`} disabled={!confirmed || busy} onClick={beginPlacement}>{state.placing ? 'Click a surface to place' : 'Place in viewport'}</button>
        {state.placing && <p className="rounded bg-blue-50 text-blue-800 p-2">Move to preview · click to position · right-drag to navigate · Esc to cancel</p>}
        <details><summary className="cursor-pointer">Exact position</summary>
        <div className="grid grid-cols-3 gap-1">{(['x','y','z'] as const).map(axis => <label key={axis}>{axis.toUpperCase()} (m)<input type="number" step="any" className={input} value={edit.position[axis]} onChange={e => change({ position: { ...edit.position, [axis]: e.target.valueAsNumber } })} /></label>)}</div>
        <p>{edit.up_axis.toUpperCase()} is up. {edit.kind === 'light' ? 'Position is the light source.' : 'Position is the base anchor; set its ground elevation explicitly.'}</p>
        </details>
        {edit.kind === 'light' && edit.illumination ? <>
          <LightSettings item={edit} onChange={change} />
          {!sceneLightsEnabled && <button className={button} onClick={enableSceneLights}>Turn on scene lights to preview</button>}
        </> : <div className="grid grid-cols-2 gap-2">{number('Width (m)', 'width')}{number('Depth (m)', 'depth')}{number('Height (m)', 'height')}{number('Rotation (°)', 'yaw')}</div>}
      </>}
      {edit.kind !== 'light' && edit.kind !== 'asset' && edit.kind !== 'geographic' && <label className="flex items-center gap-2">Colour<input type="color" value={edit.color} onChange={e => change({ color: e.target.value })} /></label>}
      {edit.activity_id && <label>Previous visibility setting<select className={input} value={edit.activity_id} onChange={e => change({ activity_id: e.target.value || null })}><option value="">Clear setting</option>{activities.filter(a => a.start && a.finish).map(a => <option value={a.id} key={a.id}>{a.code} · {a.task_name}</option>)}</select><span className="block">Activity links and profiles take precedence.</span></label>}
      {edit.kind !== 'light' && <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => { generation.current++; sequence.current?.abort(); setPreviewing(false); setConfirmed(e.target.checked); setDraft(null); state.setPlacing(false) }} />Model coordinates are in metres</label>}
      <div className="flex gap-2">{edit.kind !== 'light' && <button className={button} disabled={!confirmed || busy || previewing || capturing || state.placing} onClick={() => void preview()}>{previewing ? 'Preparing…' : 'Preview'}</button>}<button className={`${button} bg-blue-600 text-white`} disabled={!draft || !!draft.layout?.reference_bays&&!draft.layout.panel_count || busy || state.placing || previewing || capturing} onClick={() => void commit()}>Save</button><button className={button} disabled={busy} onClick={cancel}>Cancel</button></div>
      {draft?.layout?.panels && <p>{draft.layout.panel_count} panels · {draft.layout.length?.toFixed(2)} m run · {draft.layout.gate_width?.toFixed(2)} m openings per level</p>}
    </div>}
    {draft?.layout?.placements && <p>{draft.layout.count} objects prepared</p>}
    {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
    <SiteObjectList key={projectId} items={scene.items} selected={selectedObjectIds} active={selected}
      paths={paths} zones={zones} activities={activities} busy={busy} ready={state.ready} editing={!!edit}
      reload={()=>{cancel();void state.reload()}} select={onPickItems} remove={remove}/>
    {chosen && !edit && <div className="flex flex-wrap gap-2">
      {chosen.kind!=='geographic'&&<button className={button} disabled={chosen.locked || busy} onClick={() => { setPlaceAsParts(false); setEdit(recipe(chosen)); if (chosen.kind === 'light') setDraft(recipe(chosen)); setConfirmed(true) }}>{chosen.kind === 'light' ? 'Edit light' : 'Edit / regenerate'}</button>}
      <button className={button} disabled={busy} onClick={() => void update(chosen, { locked: !chosen.locked })}>{chosen.locked ? 'Unlock' : 'Lock'}</button>
    </div>}
    {chosen?.kind==='fence' && chosen.enclosure && !edit && <GatePosePanel key={'gate:'+chosen.id} item={chosen} state={state} dateRef={timelineDateRef} format={timelineFormat} onSeek={onSeek}/>}
    {chosen && <p>Selected: {selected?.includes(':panel:') ? 'panel at ' + selected.split(':panel:')[1] + ' m' : chosen.name}. Use Frame Selected in the viewport.</p>}
    {scene.items.length>0&&!edit&&<button className={button} onClick={()=>onGenerateSchedule(scene.items.map(i=>i.id))}>Generate schedule from 3D objects…</button>}
    {chosen?.assembly_id&&!edit&&<button className={button} onClick={()=>onGenerateSchedule(scene.items.filter(i=>i.assembly_id===chosen.assembly_id).map(i=>i.id))}>Schedule this assembly’s parts…</button>}
    {chosen?.kind==='asset'&&!chosen.asset_part&&!edit&&<AssetPartsPanel key={'parts:'+chosen.id} item={chosen} state={state} blocked={extractionBlocks?.[chosen.id] || (chosen.climbing_formwork?.mode==='articulated'?'Remove the articulated climb setup before extracting the rig into independent parts.':undefined) || (links.some(l=>l.source_kind==='site'&&l.element_ref===chosen.id)?'Unlink the whole assembly from its activities before extracting. Then link the new individual parts.':riggedIds?.has('site:'+chosen.id)?'Remove the equipment rig before extracting construction parts.':chosen.path_motion?'Remove the assembly movement path before extracting.':undefined)}/>}
    {chosen?.geographic&&!edit&&<GeographicWorkbench key={'geography:'+chosen.id} item={chosen} state={state} source={source} projectId={projectId} assets={inventory.assets}/>}
    {chosen&&chosen.kind!=='light'&&!chosen.geographic&&!edit&&<><ReplacementPanel key={chosen.id} state={state} assets={inventory.assets} selection={{itemId:chosen.id,instanceIndex:state.detailSelection?.itemId===chosen.id?state.detailSelection.instanceIndex:undefined}}/><button className={button} disabled={!source||busy||capturing} onClick={async()=>{if(!source)return;setCapturing(true);try{await downloadObjectGlb(source,chosen.name,upAxis)}catch(e){setError(siteError(e))}finally{setCapturing(false)}}}>Export object GLB (static pose)</button></>}
    {chosen?.asset_id && !chosen.asset_part && !edit && <SiteAnimationControls item={chosen} projectId={projectId} disabled={chosen.locked || busy} onChange={patch=>void update(chosen,patch)} onApplyMotion={async patch=>{await save(scene.items.map(i=>i.id===chosen.id?{...i,...patch}:i),`Import motion for ${chosen.name}`)}} />}
    {sequenceMachine && !edit && timelineFormat && onSeek && <WorkSequencePanel key={'work:'+sequenceMachine.id}
      item={sequenceMachine} items={scene.items} activities={activities} paths={paths} projectId={projectId}
      format={timelineFormat} onSeek={onSeek} disabled={sequenceMachine.locked || busy} mixedSelection={!singleMachine}
      readPileBounds={readPileBounds} onApply={async patch=>{
        await save(items=>items.map(i=>i.id===sequenceMachine.id?{...i,...patch}:i), `Work sequence for ${sequenceMachine.name}`)
      }}/>}
    {chosen?.kind==='asset'&&!chosen.asset_part&&!edit&&timelineFormat&&onSeek&&<ClimbingFormworkPanel onPlan={withBoom=>onGenerateSchedule([chosen.id],withBoom?'core':'corePlain')} source={source} dateRef={timelineDateRef} key={'climb:'+chosen.id} item={chosen} activities={activities} axis={upAxis} format={timelineFormat} onSeek={onSeek} disabled={chosen.locked||busy} selectedSources={selectedShapeSources} onApply={async patch=>{await save(items=>items.map(i=>i.id===chosen.id?{...i,...patch}:i),`Climb setup for ${chosen.name}`)}}/>}
    {chosen?.kind==='asset'&&!chosen.asset_part&&!edit&&timelineFormat&&timelineDateRef&&onSeek&&<WorkerActionsPanel key={'actions:'+chosen.id} item={chosen} items={scene.items} paths={paths} disabled={chosen.locked||busy} format={timelineFormat} dateRef={timelineDateRef} onSeek={onSeek} onEditAttachment={onEditAttachment} onApply={async patch=>{await save(scene.items.map(i=>i.id===chosen.id?{...i,...patch}:i),`Actions for ${chosen.name}`)}}/>}
    {chosen && !edit && <SiteToolSection key={'links:'+chosen.id} title="Activity links & profiles">
      <ToolVisualGuide topic="links"/>
      <ElementLinkFields key={chosen.id} activities={activities} links={links.filter(l => l.source_kind === 'site' && l.element_ref === chosen.id)} animationProfiles={profiles}
        onLink={(activityId, profileId) => onLink(chosen, activityId, profileId)} onUnlink={onUnlink} onAssignProfile={onAssignProfile} />
      {linkError && <p role="alert" className="text-red-600 dark:text-red-400">{linkError}</p>}
    </SiteToolSection>}
    <p className="text-gray-500">{scene.history ? 'The last 10 saved site edits can be undone after reopening this project.' : 'Use the main Undo / Redo controls to reverse a saved operation.'}</p>
  </div>
}
