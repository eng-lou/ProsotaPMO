import React from 'react'
import {checkGateSelection} from './gateSelection.fixture'
import {createRoot} from 'react-dom/client'
import {Canvas} from '@react-three/fiber'
import {TowerWrap} from '../../src/modules/fourD/TowerWrap'
import {EnclosureMesh} from '../../src/modules/fourD/EnclosureMesh'
import type {SiteLayerState} from '../../src/modules/fourD/SiteSceneLayer'
import * as T from 'three'
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {FenceSettings,TowerCoverSettings} from '../../src/modules/fourD/EnclosureSettings'
import {buildEnclosure} from '../../src/modules/fourD/enclosureGeometry'
import {arraySourceSnapshot,disposeArraySnapshot} from '../../src/modules/fourD/arraySourceSnapshot'
import type {SiteItem,FenceOpening,FenceStyle} from '../../src/modules/fourD/siteScene'
import netted from '../../src/modules/fourD/covers/Netted.glb?url'
import sheeted from '../../src/modules/fourD/covers/Sheeted.glb?url'
import '../../src/index.css'

const point=(x:number,y=0,z=0)=>({x,y,z})
const gate=(kind:FenceOpening['kind'],start:number,width:number):FenceOpening=>({kind,start,width,angle:55,board:'PROSOTA',lights:true})
function example(style:FenceStyle, starts:number[], width:number, openings:FenceOpening[]=[],levels=[0]){
  const id='enclosure-'+style
  return {id,kind:'fence',up_axis:'y',color:{edge:'#ec651b',hoarding:'#304d66',mesh:'#9aa9ad',plain:'#64748b'}[style],height:style==='edge'?1.22:2.3,
    module_length:width,gate_start:0,gate_width:0,enclosure:{style,openings,levels,perimeter_lights:true},
    layout:{panels:levels.flatMap(y=>starts.map(x=>({id:id+':panel:'+x+'@'+y,a:point(x,y),b:point(x+width,y)}))),
      openings:levels.flatMap(y=>openings.map(g=>({...g,level:y,a:point(g.start,y),b:point(g.start+g.width,y)})))} } as SiteItem
}
const check=(value:unknown,message:string)=>{if(!value)throw Error(message)}
const wait=()=>new Promise(r=>setTimeout(r,60))
const loader=new GLTFLoader()
export async function run(){
  const ui=document.createElement('div');ui.style.width='320px';document.body.append(ui)
  const root=createRoot(ui)
  const viewport=document.createElement('div');viewport.style.cssText='width:320px;height:240px';document.body.append(viewport)
  const live=createRoot(viewport)
  let item=example('edge',[0,2.4,6.8],2.4,[],[0,3])
  const slab=new T.Mesh(new T.BoxGeometry(8,.3,6)),upper=slab.clone();upper.position.y=3
  const draw=()=>root.render(<FenceSettings item={item} selection={()=>[slab,upper].map((object,i)=>({id:'slab-'+i,name:'Slab '+i,object,ifcType:'IfcSlab'}))} layout={item.layout} change={patch=>{item={...item,...patch};draw()}}/>)
  let tower={tower_cover:null} as SiteItem
  const drawTower=()=>root.render(<TowerCoverSettings item={tower} change={patch=>{tower={...tower,...patch};drawTower()}}/>)
  const assembly=buildEnclosure(item)
  const gateItem=example('hoarding',[-2.4,5,10],2.4,[gate('vehicle',0,5),gate('pedestrian',7.4,1.1),gate('turnstile',8.5,1.5)])
  const entrance=buildEnclosure(gateItem)
  const perimeter=buildEnclosure(example('mesh',[-3.5,0,3.5],3.5))
  const [net,sheet]=await Promise.all([loader.loadAsync(netted),loader.loadAsync(sheeted)])
  try{
    await checkGateSelection(gateItem)
    draw();await wait()
    const click=async(label:string)=>{const btn=[...ui.querySelectorAll('button')].find(b=>b.textContent===label);check(btn,label);btn!.click();await wait()}
    await click('Add opening')
    const kind=Array.from(ui.querySelectorAll('select')).find(s=>s.parentElement?.textContent?.startsWith('Entrance type'))!
    kind.value='vehicle';kind.dispatchEvent(new Event('change',{bubbles:true}));await wait()
    check(item.enclosure?.openings[0].width===5,'Gate preset not applied')
    await click('Add level');check(item.enclosure?.levels.join(',')==='0,3,6','Level editor')
    document.documentElement.classList.add('dark');await wait()
    const control=ui.querySelector('select')!
    const dark=getComputedStyle(control)
    check(dark.backgroundColor!==dark.color && ui.scrollWidth<=321,'Dark narrow controls')
    item=example('scaffold',[0,2.5],2.5)
    draw();await wait();await click('Use selected level slabs')
    check(item.enclosure?.scaffold?.slabs?.length===2,'Both slab references should be captured')
    const z=3.15, key='3.150/example'
    item.layout!.reference_bays=[{key,elevation:z,a:[-4,-3],b:[4,-3],status:'supported',stairs:false,reason:''}]
    draw();await wait()
    const choose=async(label:string,value:string)=>{
      const sel=[...ui.querySelectorAll('label')].find(l=>l.firstChild?.textContent===label)?.querySelector('select')
      check(sel,'Missing '+label);sel!.value=value;sel!.dispatchEvent(new Event('change',{bubbles:true}));await wait()
    }
    await choose('Bay',key);await choose('Bay use','stairs')
    check(item.enclosure?.scaffold?.bay_edits?.[key]==='stairs','Lost level-specific stair edit')
    await choose('Bay use','gap');check(item.enclosure?.scaffold?.bay_edits?.[key]==='gap','Lost local opening')
    const door={...gate('pedestrian',3.5,1.1),posters:['PPE','Site access','Fire exit'] as NonNullable<FenceOpening['posters']>}
    const street=example('street',[0,4.6],3.5,[door])
    Object.assign(street.enclosure!,{barrier_base:'ballast',blanket:true,blanket_bays:[1],reflective:true})
    const signed=buildEnclosure(street)
    check(signed.root.children.filter(m=>m.name.includes('poster')).length>=3,'Missing door posters')
    check(signed.root.children.some(m=>m.name.includes('blanket')),'Missing acoustic blanket')
    signed.dispose()
    drawTower();await wait()
    const wrapSelect=ui.querySelector('select')!
    wrapSelect.value='netted';wrapSelect.dispatchEvent(new Event('change',{bubbles:true}));await wait()
    check(tower.tower_cover?.style==='netted'&&tower.tower_cover.width===3.16,'Tower editor')
    const asset=new T.Group(),offset=new T.Group()
    asset.scale.set(.2,.05,.18);offset.position.set(0,.42,.81);asset.add(offset)
    let ready=false,stage:T.Scene|undefined
    const state={selected:null,onSelect:()=>{},items:[item],preview:null} as SiteLayerState
    live.render(<Canvas onCreated={({scene})=>{stage=scene}}><EnclosureMesh item={gateItem} state={state} preview={false}/>
      <group scale={[5,20,1/.18]}><React.Suspense fallback={null}><TowerWrap cover={{...tower.tower_cover!,offset:{x:.3,y:.1,z:.2}}} asset={asset} onLoaded={()=>{ready=true}}/></React.Suspense></group>
    </Canvas>)
    for(let n=0;n<100&&!ready;n++)await wait()
    check(ready&&stage?.getObjectByName('Site enclosure'),'Live site components failed to mount')
    stage!.updateMatrixWorld(true)
    const fabric:T.Object3D[]=[]
    stage!.traverse(n=>{if(n instanceof T.Mesh && n.material.name==='Blue-green knitted debris net')fabric.push(n)})
    check(fabric.length===1,'Live detachable wrap missing')
    const bounds=new T.Box3().setFromObject(fabric[0]),native=new T.Box3().setFromObject(net.scene)
    check(Math.abs(bounds.min.y-native.min.y-.52)<.002,'Normalised asset base or editable cover offset misaligned')
    const group=new T.Group();group.add(assembly.root,entrance.root,perimeter.root)
    entrance.root.position.z=4;perimeter.root.position.z=-4
    const materials:T.Material[]=[]
    net.scene.traverse(n=>{if(n instanceof T.Mesh)materials.push(n.material)})
    check(materials.some(m=>m.transparent&&(m as T.MeshStandardMaterial).map),'Embedded open net')
    check(new T.Box3().setFromObject(sheet.scene).max.y>19,'Sheeted cover height')
    // The rear bridge corridor at every bay must be free; check actual triangles.
    const ray=new T.Raycaster()
    for(let bay=0;bay<6;bay++){
      ray.set(new T.Vector3(0,.25+3*bay+1,-2),new T.Vector3(0,0,1));ray.far=1
      check(ray.intersectObject(net.scene,true).length===0,'Bridge exit blocked')
    }
    const gateOnly=buildEnclosure(example('mesh',[],2,[{...gate('vehicle',0,5),angle:90,board:''}]))
    gateOnly.root.updateMatrixWorld(true)
    ray.set(new T.Vector3(2.5,1,3),new T.Vector3(0,0,-1));ray.far=6
    check(!ray.intersectObject(gateOnly.root,true).length,'Open gate still crosses entrance')
    const opening = gateOnly.root.children.find(n => n.name.startsWith('hinge-1|'))!
    const otherLeaf = gateOnly.root.children.find(n => n.name.startsWith('hinge-2|'))!
    const post = gateOnly.root.children.find(n => !n.name.startsWith('hinge-'))!
    const fixed = post.matrix.clone()
    const track = [{...gate('vehicle',0,5),angle:90,pose:.25,pose_keys:[
      {date:'2026-11-21T08:00:00Z',value:0},{date:'2026-11-21T10:00:00Z',value:1}]}]
    const start = Date.parse(track[0].pose_keys[0].date)
    gateOnly.setPose(track,start + 3600000)
    const halfway = opening.matrix.clone()
    check(Math.abs(halfway.elements[0]-Math.SQRT1_2)<1e-8,'Gate did not interpolate to 45 degrees')
    check(Math.abs(otherLeaf.matrix.elements[2]+halfway.elements[2])<1e-8,'Vehicle hinges rotate in opposite directions')
    gateOnly.setPose(track,start); gateOnly.root.updateMatrixWorld(true)
    ray.set(new T.Vector3(1.15,1.0,3),new T.Vector3(0,0,-1));ray.far=6
    check(opening.matrix.elements[0]===1,'Reverse scrub did not close the gate')
    gateOnly.setPose(track,start+3600000);check(opening.matrix.equals(halfway),'Scrubbing is not repeatable')
    gateOnly.setPose(track,null)
    check(Math.abs(opening.matrix.elements[0]-Math.cos(Math.PI/8))<1e-8,'Rest pose did not survive outside playback')
    check(post.matrix.equals(fixed),'Gatepost moved with the leaf')
    gateOnly.dispose()
    const turn = example('mesh',[],2,[gate('turnstile',0,1.5)])
    turn.up_axis='z'
    const rotor = buildEnclosure(turn)
    const arm = rotor.root.children.find(n=>n.name.startsWith('hinge-'))!
    rotor.setPose([{...turn.enclosure!.openings[0],pose:0.5}],null)
    check(Math.abs(arm.matrix.elements[0]-.5)<1e-8 && Math.abs(arm.matrix.elements[1]-Math.sqrt(3)/2)<1e-8,'Z-up turnstile did not rotate 60 degrees')
    rotor.dispose()
    const panel=assembly.root.children.find(m=>m.name.startsWith('infill-')) as T.InstancedMesh
    check(panel.count===6&&assembly.root.children.length<12,'Repeated levels must share geometry')
    const sampleId=panel.userData.enclosureOwners[0]
    check(sampleId.includes(':panel:'),'Panel picking lost saved owner')
    const capture=arraySourceSnapshot(entrance.root,'y','Entrance')
    const bytes=await new GLTFExporter().parseAsync(capture,{binary:true}) as ArrayBuffer
    const roundtrip=await loader.parseAsync(bytes,'');disposeArraySnapshot(capture)
    let foundBoard=false
    roundtrip.scene.traverse(n=>{if(n instanceof T.Mesh && n.material.map)foundBoard=true})
    check(foundBoard,'Entrance board missing after GLB export')
    const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
    renderer.setSize(960,560);renderer.setClearColor('#dce3e5')
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(38,960/560,.05,160)
    scene.add(group,new T.HemisphereLight(0xfff6e8,0x748793,2.3))
    const sun=new T.DirectionalLight(0xfff1de,2.8);sun.position.set(4,12,8);scene.add(sun)
    function view(from:number[],to:number[]){
      camera.position.fromArray(from);camera.lookAt(new T.Vector3().fromArray(to));renderer.render(scene,camera)
      check(renderer.info.render.calls>0&&renderer.info.render.triangles>0,'Missing WebGL geometry')
      return renderer.domElement.toDataURL('image/png')
    }
    const images:Record<string,string>={}
    images.entrance=view([11,5,22],[4.2,1.3,3.2])
    entrance.root.visible=false;perimeter.root.visible=false
    images.edge=view([4.5,2.2,4.2],[2,.62,0])
    assembly.root.visible=false
    // Optional local proof with the real complete tower, independent of a project.
    const towerUrl=(window as any).enclosureTowerUrl
    if(towerUrl){
      const imported=await loader.loadAsync(towerUrl);scene.add(imported.scene)
      check(imported.animations.length===1,'Original hoist clip missing')
      const mixer=new T.AnimationMixer(imported.scene);mixer.clipAction(imported.animations[0]).play();mixer.setTime(2.6)
      images.tower=view([15,13,28],[0,9.6,0])
      images.towerDetail=view([5.4,8.7,8.0],[0,7.1,0])
    }
    ;(window as any).enclosureProofs=images
    renderer.dispose()
    return {passed:true,checks:['gate editor follows selection, deletion, preview cleanup and generated openings','slab capture and per-level bay editing','signed streetworks gate and acoustic blanket','gate swing and clear opening','hinge pivots, reverse seek, rest pose and Z-up turnstile travel','two-level instancing and selection','GLB board roundtrip','six open tower bridges','net and sheet loading','dark narrow controls','whole-site and close WebGL views']}
  }finally{
    live.unmount();viewport.remove();root.unmount();ui.remove();document.documentElement.classList.remove('dark')
    for(const part of [assembly,entrance,perimeter])part.dispose()
  }
}
