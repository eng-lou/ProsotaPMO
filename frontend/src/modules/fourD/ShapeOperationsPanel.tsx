import { prepareTerrain, subdivideTerrain, raiseTerrain, simplifyTerrain } from './terrainShape'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Bounds, OrbitControls } from '@react-three/drei'
import { computeShapeBoolean, disposeBooleanResults, type BooleanResult, type ShapeOperation } from './shapeBoolean'
import { importSiteAsset } from './siteAssets'
import { siteError, type SiteItem, type useSiteScene } from './siteScene'
export interface ShapeSource {backupRef?:string;id:string;name:string;object:THREE.Object3D}
export interface ShapeOperationsProps {
  projectId:string; upAxis:'y'|'z'; sources:ShapeSource[]; state:ReturnType<typeof useSiteScene>
  selectedSources():ShapeSource[]
  hideSources(ids:string[]):()=>void
}
const input='min-w-0 max-w-full w-full rounded border p-1.5 bg-white dark:bg-prosota-panel2 dark:border-prosota-line'
const button='rounded border px-2 py-1.5 dark:border-prosota-line disabled:opacity-40'
export function ShapeOperationsPanel(p:ShapeOperationsProps) {
  const [a,setA]=useState<ShapeSource|null>(null),[b,setB]=useState<ShapeSource|null>(null)
  const [operation,setOperation]=useState<ShapeOperation|'terrain'>('excavate'),[name,setName]=useState('Excavation')
  const [results,setResults]=useState<BooleanResult[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [hide,setHide]=useState(true),[message,setMessage]=useState('')
  const [point,setPoint]=useState<THREE.Vector3|null>(null),[radius,setRadius]=useState(2),[height,setHeight]=useState(.2),[falloff,setFalloff]=useState(1),[reduction,setReduction]=useState(25)
  const history=useRef<THREE.BufferGeometry[]>([])
  function editTerrain(action:'subdivide'|'raise'|'lower'|'simplify'){
    const result=results[0];if(!result)return
    try{
      const materials=Array.isArray(result.mesh.material)?result.mesh.material:[result.mesh.material]
      if(action==='simplify'&&(materials.length>1||materials.some(m=>(m as THREE.MeshStandardMaterial).map)))throw Error('Simplify supports a single untextured surface. Keep textured/multi-material solids unchanged.')
      const old=result.mesh.geometry
      const next=action==='subdivide'?subdivideTerrain(old):action==='simplify'?simplifyTerrain(old,reduction):point?raiseTerrain(old,point,radius,(action==='lower'?-1:1)*height,falloff):null
      if(!next)throw Error('Click a surface in the preview to choose the brush centre.')
      history.current.push(old);if(history.current.length>10)history.current.shift()?.dispose()
      result.mesh.geometry=next;setResults([...results]);setError('')
    }catch(e){setError(siteError(e))}
  }
  const owned=useRef(results)
  function clear(){for(const g of history.current)g.dispose();history.current=[];setPoint(null);disposeBooleanResults(owned.current);owned.current=[];setResults([]);setError('');setMessage('')}
  useEffect(()=>()=>{disposeBooleanResults(owned.current);for(const g of history.current)g.dispose()},[])
  function selected(which:'a'|'b'){
    try{const sources=p.selectedSources();if(sources.length!==1)throw Error('Select one object or one IFC element, then use this button.');clear();(which==='a'?setA:setB)(sources[0])}catch(e){setError(siteError(e))}
  }
  async function preview(){
    if(!a||(!b&&operation!=='terrain'))return
    clear();setBusy(true)
    try{await new Promise(r=>setTimeout(r,30));const next=operation==='terrain'?[prepareTerrain(a.object,p.upAxis)]:computeShapeBoolean(a.object,b!.object,p.upAxis,operation);owned.current=next;setResults(next)}
    catch(e){setError(siteError(e))}finally{setBusy(false)}
  }
  async function apply(){
    if(!results.length)return
    setBusy(true);setError('')
    try{
      const {GLTFExporter}=await import('three/examples/jsm/exporters/GLTFExporter.js')
      const items:SiteItem[]=[]
      for(const [i,result] of results.entries()){
        const label=(name.trim()+(i===1?' · removed':' · result')).slice(0,100)
        const exportMesh=result.mesh.clone();exportMesh.geometry=result.mesh.geometry.clone();exportMesh.geometry.computeBoundingBox()
        const bounds=exportMesh.geometry.boundingBox!,centre=bounds.getCenter(new THREE.Vector3()),anchor=new THREE.Vector3(centre.x,bounds.min.y,centre.z)
        exportMesh.geometry.translate(-anchor.x,-anchor.y,-anchor.z);exportMesh.position.set(0,0,0);exportMesh.rotation.set(0,0,0);exportMesh.scale.set(1,1,1)
        let bytes:ArrayBuffer
        try{bytes=await new GLTFExporter().parseAsync(exportMesh,{binary:true,onlyVisible:false}) as ArrayBuffer}finally{exportMesh.geometry.dispose()}
        const position=result.position.clone().add(anchor.applyAxisAngle(new THREE.Vector3(1,0,0),p.upAxis==='z'?Math.PI/2:0))
        const asset=await importSiteAsset(p.projectId,new File([bytes],label+'.glb',{type:'model/gltf-binary'}),'Other',()=>{},label)
        items.push({id:crypto.randomUUID(),name:label,kind:'asset',asset_id:asset.id,operation_inputs:hide?(operation==='terrain'?[a!.backupRef || a!.id]:[a!.backupRef || a!.id,b!.backupRef || b!.id]):[],...asset.dimensions,
          generator_version:1,up_axis:p.upAxis,units:'m',position:{x:position.x,y:position.y,z:position.z},
          yaw:0,color:'#ffffff',locked:false,activity_id:null,path_id:null,points:[],closed:false,module_length:2,gate_start:0,gate_width:0})
      }
      let restore:(()=>void)|undefined
      await p.state.save([...p.state.scene.items,...items], 'Shape '+operation, hide?{redo:()=>{restore=p.hideSources(operation==='terrain'?[a!.id]:[a!.id,b!.id])},undo:()=>restore?.()}:undefined)
      p.state.setSelected(items[0].id);clear();setMessage('Created '+items.length+' object(s). Select a result to edit materials, transforms or link an activity/profile. Originals are retained. Undo restores the inputs.')
    }catch(e){setError(siteError(e))}finally{setBusy(false)}
  }
  return <details className="min-w-0 max-w-full border rounded p-2 dark:border-prosota-line"><summary className="cursor-pointer font-semibold">Shape operations</summary>
    <fieldset disabled={busy||p.state.busy} className="min-w-0 space-y-2 mt-2">
      <p>Position two closed solids to overlap. Results are independent copies; IFC source geometry stays intact.</p>
      {((operation==='terrain'?['a']:['a','b']) as ('a'|'b')[]).map(which=><div key={which}><label className="block">{which==='a'?'Base solid':'Cutter / second solid'}<select className={input} value={(which==='a'?a:b)?.id||''} onChange={e=>{clear();(which==='a'?setA:setB)(p.sources.find(s=>s.id===e.target.value)||null)}}>
        <option value="">Choose object…</option>{[...p.sources,...[a,b].filter((s):s is ShapeSource=>!!s&&!p.sources.some(x=>x.id===s.id))].filter((s,i,all)=>all.findIndex(x=>x.id===s.id)===i).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label><button className={button} onClick={()=>selected(which)}>Use selected {which==='a'?'as base':'as cutter'}</button></div>)}
      <label className="block">Operation<select className={input} value={operation} onChange={e=>{clear();setOperation(e.target.value as ShapeOperation|'terrain')}}>
        <option value="terrain">Terrain · subdivide / raise / lower / simplify</option><option value="excavate">Excavate · cut + keep removed section</option><option value="subtract">Subtract · hole / cut</option><option value="union">Union · join solids</option><option value="intersect">Intersection · keep overlap</option>
      </select></label>
      <label className="block">Result name<input className={input} value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label>
      <label className="block"><input type="checkbox" checked={hide} onChange={e=>setHide(e.target.checked)}/> Hide inputs after creating results</label>
      <button className={button} disabled={!a||(operation!=='terrain'&&(!b||a.id===b.id))||!p.state.ready} onClick={()=>void preview()}>{busy?'Working…':'Preview operation'}</button>
      {!!results.length&&<><div className="h-56 bg-slate-800 rounded" aria-label="Shape operation preview"><Canvas camera={{position:[8,14,10],fov:45}}><ambientLight intensity={1.5}/><directionalLight position={[5,10,5]} intensity={3}/><Bounds fit clip observe margin={1.3}>{results.map((r,i)=><group key={i} position={r.position.clone().sub(results[0].position).applyAxisAngle(new THREE.Vector3(1,0,0),p.upAxis==='z'?-Math.PI/2:0)}><primitive object={r.mesh} dispose={null} onClick={(e:any)=>{if(operation==='terrain'&&e.delta<4){e.stopPropagation();setPoint(r.mesh.worldToLocal(e.point.clone()))}}}/>{operation==='terrain'&&point&&<mesh position={point}><sphereGeometry args={[Math.max(.02,radius*.05),12,8]}/><meshBasicMaterial color="#fbbf24" depthTest={false}/></mesh>}</group>)}</Bounds><OrbitControls makeDefault/></Canvas></div>
      {operation==='terrain'&&<div className="space-y-2">
        <p>Click the preview surface for the brush centre. {Math.round((results[0].mesh.geometry.index?.count??results[0].mesh.geometry.getAttribute('position').count)/3)} triangles.</p>
        <button className={button} onClick={()=>editTerrain('subdivide')}>Subdivide ×4</button>
        <label className="block">Brush radius (m)<input className={input} type="number" min=".01" step=".1" value={radius} onChange={e=>setRadius(Math.max(.01,+e.target.value))}/></label>
        <label className="block">Height per push/pull (m)<input className={input} type="number" min=".001" step=".1" value={height} onChange={e=>setHeight(Math.max(.001,+e.target.value))}/></label>
        <label className="block">Falloff<select className={input} value={falloff} onChange={e=>setFalloff(+e.target.value)}><option value={.5}>Broad</option><option value={1}>Smooth</option><option value={2}>Focused</option></select></label>
        <button className={button} disabled={!point} onClick={()=>editTerrain('raise')}>Raise area</button> <button className={button} disabled={!point} onClick={()=>editTerrain('lower')}>Lower area</button>
        <label className="block">Remove vertices (%)<input className={input} type="number" min="1" max="75" value={reduction} onChange={e=>setReduction(Math.max(1,Math.min(75,+e.target.value)))}/></label>
        <button className={button} onClick={()=>editTerrain('simplify')}>Simplify</button> <button className={button} disabled={!history.current.length} onClick={()=>{const old=history.current.pop();if(old){results[0].mesh.geometry.dispose();results[0].mesh.geometry=old;setResults([...results])}}}>Undo shape edit</button>
        <p>Preview before saving. Subdivision preserves the surface; raise/lower changes its shape. Excessive deformation can fold a thin solid.</p>
      </div>}
      <p>{operation==='excavate'?'Red is the retained excavated section.':'Review the resulting solid before creating it.'}</p>
      <button className={button} disabled={!name.trim()} onClick={()=>void apply()}>Create results</button> <button className={button} onClick={clear}>Discard preview</button></>}
    </fieldset>
    {error&&<p role="alert" className="text-red-500 mt-2">{error}</p>}{message&&<p role="status" className="mt-2">{message}</p>}
  </details>
}
