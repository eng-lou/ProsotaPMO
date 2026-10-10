import { EquipmentPivotControls } from '../src/modules/fourD/EquipmentPivotControls'
import type { GizmoMode, GizmoSpace } from '../src/modules/fourD/TransformPanel'
import { EquipmentVisualEditor, type EquipmentVisualState } from '../src/modules/fourD/EquipmentVisualEditor'
import React, { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import '../src/index.css'
import { EquipmentPanel } from '../src/modules/fourD/EquipmentPanel'
import { EquipmentPlayback } from '../src/modules/fourD/EquipmentPlayback'
import { EquipmentTracks } from '../src/modules/fourD/EquipmentTracks'
import { equipmentNodes, type EquipmentRig } from '../src/modules/fourD/equipmentRig'
function Smoke() {
 const [mode,setMode]=useState<GizmoMode>('translate'),[space,setSpace]=useState<GizmoSpace>('world')
 const [visual,setVisual]=useState<EquipmentVisualState|null>(null)
 const [editing,setEditing]=useState(false); const [dark,setDark]=useState(false), [draft,setDraft]=useState<EquipmentRig|null>(null),[preview,setPreview]=useState<any>(null),[error,setError]=useState<string|null>(null)
 const date=useRef<Date|null>(new Date('2026-10-09T12:00:00Z'))
 const objects=useMemo(()=>{const root=new THREE.Group();root.name='Backhoe';const boom=new THREE.Mesh(new THREE.BoxGeometry(3,.3,.3),new THREE.MeshStandardMaterial({color:'#e7af22'}));boom.geometry.translate(1.5,0,0);boom.name='Boom';const bucket=new THREE.Mesh(new THREE.BoxGeometry(.6,.8,.7),new THREE.MeshStandardMaterial({color:'#536273'}));bucket.name='Bucket';bucket.position.x=3;root.add(boom,bucket);return [{name:'Demo backhoe.glb',kind:'mesh',object:root}]},[])
 const [rigs,setRigs]=useState<EquipmentRig[]>(()=>{const nodes=[...equipmentNodes(objects[0].object).keys()];return [{id:'demo',project_id:'demo',model_ref:objects[0].name,name:'Demo backhoe',version:1,definition:{schema_version:1,controls:[{id:'lift',name:'Boom lift',value:0,rest:0,keys:[]},{id:'curl',name:'Bucket curl',value:0,rest:0,keys:[]}],joints:[{id:'boom',name:'Boom',node:nodes[1],parent:null,control:'lift',kind:'hinge',pivot:[0,0,0],axis:[0,0,1],minimum:0,maximum:90,response:[[0,0],[1,1]]},{id:'bucket',name:'Bucket',node:nodes[2],parent:'boom',control:'curl',kind:'hinge',pivot:[3,0,0],axis:[0,0,1],minimum:0,maximum:90,response:[[0,0],[1,1]]}],followers:[]}}]})
 const playback=useMemo(()=>draft?[draft]:rigs,[draft,rigs])
 const save=async(r:EquipmentRig)=>{setRigs([{...structuredClone(r),version:r.version+1}]);return true}
 return <div className={dark?'dark':''}><main className="min-h-screen bg-white dark:bg-prosota-ink text-gray-800 dark:text-prosota-paper"><button onClick={()=>setDark(!dark)}>Toggle theme</button><div className="flex"><aside style={{width:360,height:'90vh',overflowY:'auto'}} className="shrink-0">{visual?.pivot && <EquipmentPivotControls upAxis="y" state={visual} root={objects[0].object} mode={mode} space={space} onMode={setMode} onSpace={setSpace}/>}<EquipmentPanel onVisual={setVisual} projectId="demo" objects={objects} rigs={rigs} busy={false} error={null} runtimeError={error} dateRef={date} onSave={save} onRemove={async()=>setRigs([])} onDraft={setDraft} onEditing={setEditing} onPreview={setPreview} onSeek={d=>{date.current=d}} /></aside><section className="flex-1"><div style={{height:500}}><Canvas camera={{position:[5,4,7],fov:40}}><ambientLight intensity={2}/><directionalLight position={[3,5,5]}/><primitive object={objects[0].object}/><EquipmentVisualEditor transformMode={mode} transformSpace={space} state={visual} objects={objects}/><EquipmentPlayback visual={visual} rigs={playback} objects={objects} dateRef={date} preview={preview} onError={setError}/><OrbitControls makeDefault target={[1.5,1,0]}/></Canvas></div><EquipmentTracks rigs={rigs} start={new Date('2026-10-09T12:00:00Z')} end={new Date('2026-10-09T12:00:10Z')} onSave={save} onSeek={d=>{date.current=d}} disabled={editing}/></section></div></main></div>
}
const root = createRoot(document.getElementById('root')!); root.render(<Smoke />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
