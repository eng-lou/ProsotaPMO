import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, OrbitControls } from '@react-three/drei'
import { api } from '@/lib/api'
import { SITE_ASSET_CATEGORIES, importSiteAsset, type useSiteAssetInventory, type SiteAsset } from './siteAssets'
import { SiteAssetModel } from './SiteAssetModel'
import { siteError } from './siteScene'
import { convertSiteImportSet } from './convertSiteImport'
import { AssetImportReview } from './AssetImportReview'

const categories = SITE_ASSET_CATEGORIES
export function SiteAssetLibrary({ projectId, onPlace, inventory, initialFilter = '' }: { projectId: string; onPlace(asset: SiteAsset): void; inventory: ReturnType<typeof useSiteAssetInventory>; initialFilter?: string }) {
  const {assets,setAssets} = inventory
  const [focusedId,setFocusedId] = useState<string|null>(null)
  const focused = assets.find(a=>a.id===focusedId) ?? null
  const setFocused = (asset: SiteAsset) => setFocusedId(asset.id)
  const [checked, setChecked] = useState<string[]>([]), [search, setSearch] = useState('')
  const [category, setCategory] = useState('Other'), [filter, setFilter] = useState(initialFilter)
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null), alive = useRef(true)
  const [pendingImport, setPendingImport] = useState<File>()
  const [sourceFiles,setSourceFiles]=useState<File[]>([]),[sourceName,setSourceName]=useState('')
  const [sourceAxis,setSourceAxis]=useState<'auto'|'y'|'z'>('auto'),[unitScale,setUnitScale]=useState(0),[includeAnimation,setIncludeAnimation]=useState(true)
  const [assemblyName,setAssemblyName]=useState('Equipment')
  const sources=sourceFiles.filter(f=>/\.(glb|gltf|fbx|obj)$/i.test(f.name))
  const source=sourceFiles.find(f=>/\.(glb|gltf|fbx|obj)$/i.test(f.name))
  async function prepare() {
    if(!source)return
    setBusy(true);setError('')
    try{const file=await convertSiteImportSet(sourceFiles,{upAxis:sourceAxis,unitScale,includeAnimation},assemblyName);if(alive.current){setSourceName(sources.length>1?assemblyName+'.glb':source.name);setPendingImport(file);setSourceFiles([])}}catch(e){if(alive.current)setError(siteError(e))}finally{if(alive.current)setBusy(false)}
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(()=>{setFilter(initialFilter)},[initialFilter])
  async function edit(asset: SiteAsset, patch: Partial<Pick<SiteAsset,'name'|'category'>>) {
    setBusy(true);setError('')
    try {const {data}=await api.patch<SiteAsset>(`/api/v1/site-assets/${asset.id}`,{name:asset.name,category:asset.category,...patch});setAssets(old=>old.map(a=>a.id===asset.id?data:a))}
    catch(e){setError(siteError(e))}finally{setBusy(false)}
  }
  async function remove(ids: string[]) {
    setBusy(true);setError('')
    try {for(const id of ids){await api.delete(`/api/v1/site-assets/${id}`);setAssets(old=>old.filter(a=>a.id!==id));setChecked(old=>old.filter(value=>value!==id))}}
    catch(e){setError(siteError(e))}finally{setBusy(false)}
  }

  async function upload(file?: File) {
    if (!file) return
    setBusy(true); setError(''); setProgress(0)
    try {
      const asset = await importSiteAsset(projectId, file, category, value => { if (alive.current) setProgress(value) }, sourceName || file.name)
      if (alive.current) { setAssets(old => [asset, ...old]); setFocused(asset); setFilter(''); setPendingImport(undefined) }
    } catch (e) { if (alive.current) setError(siteError(e)) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="space-y-2">
    <div className="flex gap-2"><select aria-label="Import category" className="min-w-0 flex-1 rounded border p-2 bg-transparent" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c} value={c}>{c==='Equipment'?'Construction equipment':c}</option>)}</select>
      <button className="rounded bg-blue-600 text-white px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => input.current?.click()}>{busy ? `Importing ${Math.round(progress)}%` : 'Import 3D'}</button></div>
    <input ref={input} hidden type="file" multiple accept=".glb,.gltf,.fbx,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.bmp,.tga" onChange={e => { const files=Array.from(e.target.files||[]);const models=files.filter(f=>/\.(glb|gltf|fbx|obj)$/i.test(f.name));setPendingImport(undefined);setError(models.length===0?'Choose models together with supporting MTL, BIN and texture files.':'');setSourceFiles(models.length?files:[]);setSourceAxis('auto');setUnitScale(0);e.target.value = '' }} />
    {source && <section className="border rounded p-2 space-y-2">
      <strong>{sources.length>1?`${sources.length} model files · assembly`:source.name}</strong>
      {sources.length>1 && <><label className="block">Assembly name<input aria-label="Import assembly name" className="w-full border rounded p-1 dark:bg-prosota-panel2" value={assemblyName} onChange={e=>setAssemblyName(e.target.value)}/></label><p className="text-xs">Imports one asset with named, separate parts at their authored positions. Place it, then open Rigging to configure joints.</p></>}
      <label className="block">Source up axis<select className="w-full border rounded p-1 dark:bg-prosota-panel2" value={sourceAxis} onChange={e=>setSourceAxis(e.target.value as 'auto'|'y'|'z')}><option value="auto">Automatic (file metadata)</option><option value="y">Y up</option><option value="z">Z up (Blender)</option></select></label>
      <label className="block">Source units<select className="w-full border rounded p-1 dark:bg-prosota-panel2" value={unitScale} onChange={e=>setUnitScale(Number(e.target.value))}><option value={0}>Automatic (file metadata)</option><option value={1}>Metres</option><option value={.01}>Centimetres</option><option value={.001}>Millimetres</option></select></label>
      <label className="flex gap-2"><input type="checkbox" checked={includeAnimation} onChange={e=>setIncludeAnimation(e.target.checked)}/>Include animation clips</label>
      <p className="text-xs">Select companion textures and MTL/BIN files with the model. Materials and animations are saved with the asset.</p>
      <button className="border rounded p-2" disabled={busy} onClick={()=>void prepare()}>{busy?'Preparing…':'Review import'}</button>
      <button className="ml-2" disabled={busy} onClick={()=>setSourceFiles([])}>Cancel</button>
    </section>}
    {pendingImport && <AssetImportReview key={pendingImport.name + pendingImport.lastModified} file={pendingImport} onImport={upload} onCancel={() => setPendingImport(undefined)} />}
    <input aria-label="Search assets" placeholder="Search your assets…" className="w-full border rounded p-2 bg-transparent" value={search} onChange={e => setSearch(e.target.value)} />
    <select aria-label="Filter category" className="w-full border rounded p-2 bg-transparent" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{c==='Equipment'?'Construction equipment':c}</option>)}</select>
    {(error || inventory.error) && <p role="alert" className="text-red-600">{error || inventory.error}</p>}
    {!assets.length && <p className="py-4 text-slate-500">Import a cabin, tree or other model to start your library. Previewing does not place it.</p>}
    <div className="max-h-40 overflow-auto space-y-1">{assets.filter(a => (!filter || a.category === filter || (filter === 'Trees' && a.category === 'Vegetation')) && a.name.toLowerCase().includes(search.toLowerCase())).map(asset => <div key={asset.id} className={`flex gap-2 border rounded p-2 ${focused?.id === asset.id ? 'border-blue-500' : ''}`}>
      <input type="checkbox" aria-label={`Select ${asset.name}`} checked={checked.includes(asset.id)} onChange={e => setChecked(old => e.target.checked ? [...old, asset.id] : old.filter(id => id !== asset.id))} />
      <button className="text-left min-w-0 flex-1" onClick={() => setFocused(asset)}><span className="block truncate" title={asset.name}>{asset.name}</span><span className="text-slate-500">{asset.category==='Equipment'?'Construction equipment':asset.category} · Ready</span></button>
    </div>)}</div>
    {focused && <>
      <div className="h-44 rounded bg-slate-100 overflow-hidden" key={focused.id}><Canvas camera={{ position: [4, 3, 5], fov: 40 }}><ambientLight intensity={1.8} /><directionalLight position={[5, 8, 5]} intensity={2} /><Suspense fallback={null}><Bounds fit clip observe margin={1.3}><group scale={[focused.dimensions.width, focused.dimensions.height, focused.dimensions.depth]}><SiteAssetModel id={focused.id} fit /></group></Bounds></Suspense><OrbitControls makeDefault /></Canvas></div>
      <label className="block">Asset name<input key={focused.id+focused.name} aria-label="Asset name" className="block w-full border rounded p-2 bg-transparent" defaultValue={focused.name} disabled={busy} onBlur={e=>{if(e.target.value.trim() && e.target.value.trim()!==focused.name)void edit(focused,{name:e.target.value.trim()})}} /></label>
      <label className="block">Use as<select aria-label="Asset type" className="block w-full border rounded p-2 bg-transparent" value={focused.category} disabled={busy} onChange={e=>void edit(focused,{category:e.target.value})}>{categories.map(c=><option key={c} value={c}>{c==='Equipment'?'Construction equipment':c}</option>)}</select></label>
      <p>{[focused.dimensions.width, focused.dimensions.depth, focused.dimensions.height].map(v => v.toFixed(2)).join(' × ')} m (W × D × H) · base centre</p>
      <button disabled={busy} className="w-full rounded bg-blue-600 text-white p-2" onClick={() => onPlace(focused)}>Place this asset</button>
      <button className="text-red-600 dark:text-red-400" disabled={busy} onClick={()=>void remove([focused.id])}>Remove from library</button>
      <p className="text-slate-500">Placed copies are kept. Remove those under Site objects.</p>
    </>}
    {!!checked.length && <details><summary>{checked.length} checked assets</summary><div className="space-y-1 mt-2">{assets.filter(a => checked.includes(a.id)).map(a => <button key={a.id} className="block border rounded p-2 w-full text-left" onClick={() => onPlace(a)}>Place {a.name}</button>)}<button onClick={() => setChecked([])}>Clear selection</button><button className="block text-red-600 dark:text-red-400" disabled={busy} onClick={()=>void remove(checked)}>Remove checked imports</button></div></details>}
    <p className="text-slate-500">GLB / glTF / FBX / OBJ · embedded textures · animation clips retained. Each import is a separate saved version.</p>
  </section>
}
