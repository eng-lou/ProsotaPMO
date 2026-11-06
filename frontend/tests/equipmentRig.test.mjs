import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({ stdin: { contents: "export * from './src/modules/fourD/equipmentRig'; export * from './src/modules/fourD/equipmentAssembly'; export * from './src/modules/fourD/equipmentPreset'; export * as THREE from 'three'; export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'; export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'", resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })
const { THREE, GLTFExporter, GLTFLoader, assembleEquipment, bindEquipment, equipmentNodes, validateEquipment, controlValue, emptyEquipment, importEquipmentPreset, jointOffset, setJointTravel, sampleEquipmentNode } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
const near = (a, b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`)
function setup() {
 const root = new THREE.Group(); root.name = 'Backhoe'
 for (const name of ['Boom','Arm','Bucket','Barrel','Piston','Barrel2','Piston2']) { const n=new THREE.Group(); n.name=name; root.add(n) }
 root.children[1].position.x=2; root.children[2].position.x=3
 const keys=[...equipmentNodes(root).keys()].slice(1)
 const def=emptyEquipment(); def.controls=[{id:'lift',name:'Lift',value:0,rest:0,keys:[]},{id:'curl',name:'Curl',value:0,rest:0,keys:[]}]
 def.joints=[{id:'boom',name:'Boom',node:keys[0],parent:null,control:'lift',kind:'hinge',pivot:[0,0,0],axis:[0,0,1],minimum:0,maximum:90,response:[[0,0],[1,1]]},{id:'arm',name:'Arm',node:keys[1],parent:'boom',control:'curl',kind:'hinge',pivot:[2,0,0],axis:[0,0,1],minimum:0,maximum:90,response:[[0,0],[1,1]]},{id:'bucket',name:'Bucket',node:keys[2],parent:'arm',control:'curl',kind:'hinge',pivot:[3,0,0],axis:[0,0,1],minimum:0,maximum:0,response:[[0,0],[1,1]]}]
 return {root,def,keys}
}

test('rigid links aim about either endpoint without a dummy piston or moving the root',()=>{
 const {root,def,keys}=setup();def.joints=def.joints.slice(0,1)
 root.children[3].position.set(0,-1,0);root.children[4].position.set(2,0,0)
 def.followers=[{id:'a',name:'Base link',barrel:keys[3],piston:'',base_node:'',tip_node:keys[0],base_point:[0,-1,0],tip_point:[2,0,0]},
 {id:'b',name:'Tip link',barrel:keys[4],piston:'',base_node:keys[0],tip_node:'',base_point:[2,0,0],tip_point:[0,-1,0]}]
 const before=JSON.stringify(def),rig=bindEquipment(root,def)
 for(const t of [1,0,.5,1])rig.evaluate(null,{lift:t})
 near(root.children[3].position.y,-1);near(root.children[4].position.x,0);near(root.children[4].position.y,2);near(root.position.y,0)
 rig.restore();near(root.children[4].position.x,2);assert.equal(JSON.stringify(def),before)
 const bad=structuredClone(def);bad.followers[0].barrel='';assert.throws(()=>validateEquipment(bad,equipmentNodes(root)))
 bad.followers[0].barrel=keys[3];bad.followers[0].base_node=keys[4];validateEquipment(bad,equipmentNodes(root))
 bad.followers[1].base_node=keys[3];assert.throws(()=>validateEquipment(bad,equipmentNodes(root)),/cycle/)
})

test('preset wrapper adaptation preserves full articulated motion, links, slides and source data',()=>{
 const {root,def,keys}=setup();def.joints[1].kind='slide';def.joints[1].maximum=3;def.joints[0].pivot_rotation=[.1,.2,.3]
 def.followers=[{id:'f',name:'Link',barrel:keys[3],piston:'',base_node:'',tip_node:keys[2],base_point:[0,-1,0],tip_point:[1,0,0]}]
 def.controls[0].keys=[{date:'2026-01-01T00:00:00Z',value:1,interpolation:'linear'}]
 const copy=root.clone(true),outer=new THREE.Group(),wrapper=new THREE.Group();outer.add(wrapper);wrapper.add(copy)
 wrapper.position.set(5,-3,8);wrapper.rotation.set(.3,.6,.1);wrapper.scale.setScalar(2);outer.scale.set(0,0,0)
 const before=JSON.stringify(def),adapted=importEquipmentPreset(def,outer)
 assert.equal(adapted.controls[0].keys.length,0);assert.equal(JSON.stringify(def),before)
 const a=bindEquipment(root,def),b=bindEquipment(outer,adapted);outer.scale.set(1,1,1);outer.updateMatrixWorld(true)
 const transform=wrapper.matrix.clone();assert.equal(adapted.followers[0].base_node,'/0:/0:Backhoe');assert.equal(adapted.followers[0].piston,'')
 for(const pose of [{lift:0,curl:0},{lift:1,curl:.5},{lift:.3,curl:1}]){
  a.evaluate(null,pose);b.evaluate(null,pose)
  for(let i=0;i<root.children.length;i++){
   const expected=transform.clone().multiply(root.children[i].matrixWorld)
   expected.elements.forEach((n,j)=>near(copy.children[i].matrixWorld.elements[j],n))
  }
 }
})

test('preset import rejects missing groups, duplicate machines, stretch and mirror',()=>{
 const {root,def}=setup(),outer=new THREE.Group();outer.add(root)
 const before=JSON.stringify(def);root.children[0].name='Different';assert.throws(()=>importEquipmentPreset(def,outer),/Part missing/)
 root.children[0].name='Boom';outer.add(root.clone(true));assert.throws(()=>importEquipmentPreset(def,outer),/Several matching/)
 outer.remove(outer.children[1]);root.scale.set(2,1,1);assert.throws(()=>importEquipmentPreset(def,outer),/stretched/)
 root.scale.set(-1,1,1);assert.throws(()=>importEquipmentPreset(def,outer),/mirrored/);assert.equal(JSON.stringify(def),before)
})
test('articulated sibling meshes follow joint chain and equipment root transform',()=>{
 const {root,def}=setup(); const rig=bindEquipment(root,def)
 root.position.set(10,20,0); rig.evaluate(null,{lift:1,curl:1})
 const bucket=root.children[2].getWorldPosition(new THREE.Vector3()); near(bucket.x,9);near(bucket.y,22)
 for(let i=0;i<50;i++) rig.evaluate(null,{lift:1,curl:1})
 near(root.children[2].getWorldPosition(new THREE.Vector3()).x,9)
 rig.evaluate(null,{lift:0,curl:0}); near(root.children[2].position.x,3);near(root.children[2].position.y,0)
 rig.restore(); near(root.children[1].position.x,2)
})
test('linear slide and nonlinear response retain calibrated rest pose',()=>{
 const {root,def}=setup();def.joints=def.joints.slice(0,1);def.joints[0].kind='slide';def.joints[0].axis=[1,0,0];def.joints[0].maximum=4;def.joints[0].response=[[0,0],[0.5,0.25],[1,1]];def.controls[0].rest=.5
 const rig=bindEquipment(root,def);rig.evaluate(null,{lift:.5});near(root.children[0].position.x,0);rig.evaluate(null,{lift:1});near(root.children[0].position.x,3)
})
test('keyframes interpolate independent of seek order and respect hold and smooth',()=>{
 const c={id:'a',name:'a',value:.3,rest:0,keys:[{date:'2026-01-01T00:00:00Z',value:0,interpolation:'linear'},{date:'2026-01-01T00:00:10Z',value:1,interpolation:'linear'}]};const t=Date.parse(c.keys[0].date)
 near(controlValue(c,t+5000),.5);near(controlValue(c,t+100000),1);near(controlValue(c,t-1),0);near(controlValue(c,null),.3)
 c.keys[0].interpolation='hold';near(controlValue(c,t+9999),0);near(controlValue(c,t+10000),1)
 c.keys[0].interpolation='smooth';near(controlValue(c,t+2500),.15625)
})
test('multiple cylinders follow moving endpoints without scaling',()=>{
 const {root,def,keys}=setup();def.joints=def.joints.slice(0,1)
 root.children[3].position.set(0,-1,0);root.children[4].position.set(2,0,0)
 root.children[5].position.set(0,-2,0);root.children[6].position.set(3,0,0)
 def.followers=[{id:'f',name:'Hydraulic',barrel:keys[3],piston:keys[4],base_node:'',tip_node:keys[0],base_point:[0,-1,0],tip_point:[2,0,0]},{id:'f2',name:'Hydraulic2',barrel:keys[5],piston:keys[6],base_node:'',tip_node:keys[0],base_point:[0,-2,0],tip_point:[3,0,0]}]
 const rig=bindEquipment(root,def);rig.evaluate(null,{lift:1});near(root.children[3].position.y,-1);near(root.children[4].position.x,0);near(root.children[4].position.y,2);near(root.children[6].position.y,3);near(root.children[4].scale.x,1)
 rig.evaluate(null,{lift:0});near(root.children[4].position.x,2)
})

test('cylinder inherits mounting roll when both endpoints rotate together',()=>{
 const {root,def,keys}=setup();def.joints=def.joints.slice(0,1);def.joints[0].axis=[1,0,0]
 root.children[3].position.set(0,1,0)
 def.followers=[{id:'f',name:'Cylinder',barrel:keys[3],piston:'',base_node:keys[0],tip_node:keys[0],base_point:[0,0,0],tip_point:[2,0,0]}]
 const runtime=bindEquipment(root,def);runtime.evaluate(null,{lift:1})
 near(root.children[3].position.y,0);near(root.children[3].position.z,1);runtime.dispose()
})

test('dependent followers evaluate in dependency order regardless of saved order',()=>{
 const {root,def,keys}=setup();def.joints=def.joints.slice(0,1)
 def.followers=[{id:'dependent',name:'Attached link',barrel:keys[5],piston:'',base_node:keys[3],tip_node:keys[0],base_point:[0,0,0],tip_point:[2,0,0]},
 {id:'driver',name:'Cylinder',barrel:keys[3],piston:keys[4],base_node:'',tip_node:keys[0],base_point:[0,-1,0],tip_point:[2,0,0]}]
 const runtime=bindEquipment(root,def);runtime.evaluate(null,{lift:.7});const expected=root.children[5].matrix.clone();runtime.dispose()
 def.followers.reverse();const second=bindEquipment(root,def);second.evaluate(null,{lift:.7});root.children[5].matrix.elements.forEach((n,i)=>near(n,expected.elements[i]));second.dispose()
})

test('flexible hose pins endpoints, preserves shared geometry, samples safely and restores',()=>{
 const {root,def,keys}=setup();def.joints=def.joints.slice(0,1);def.joints[0].kind='slide';def.joints[0].axis=[0,1,0];def.joints[0].maximum=2
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0, .01,.05,0, 2,0,0, 1.99,.05,0, 1,0,0, 1,.05,0],3));g.computeVertexNormals()
 const hose=new THREE.Mesh(g),shared=new THREE.Mesh(g);hose.name='Hose';root.add(hose,shared);const hoseKey=[...equipmentNodes(root)].find(([,n])=>n===hose)[0]
 def.followers=[{id:'h',name:'Hose',barrel:hoseKey,piston:'',base_node:'',tip_node:keys[0],base_point:[0,0,0],tip_point:[2,0,0],flex_curve:[[0,0,0],[1,0,0],[2,0,0]]}]
 const original=Array.from(g.attributes.position.array),runtime=bindEquipment(root,def);runtime.evaluate(null,{lift:1})
 assert.notEqual(hose.geometry,g);assert.equal(shared.geometry,g);assert.deepEqual(Array.from(g.attributes.position.array),original)
 const p=hose.geometry.attributes.position;near(p.getY(0),0);near(p.getY(2),2);near(p.getY(4),1)
 const surface=Array.from(p.array);assert.ok(sampleEquipmentNode(root,def,hoseKey,{lift:0}));assert.deepEqual(Array.from(p.array),surface)
 runtime.restore();assert.deepEqual(Array.from(p.array),original);runtime.dispose();assert.equal(hose.geometry,g)
 const bad=structuredClone(def);bad.followers[0].flex_curve=[[0,0,0],[0,0,0]];assert.throws(()=>bindEquipment(root,bad),/centreline/);assert.equal(hose.geometry,g)
})
test('rejects cycles, missing parts, duplicate drivers, zero axes, invalid curves and feedback',()=>{
 const {root,def,keys}=setup(); const check=(mutate)=>{const d=structuredClone(def);mutate(d);assert.throws(()=>validateEquipment(d,equipmentNodes(root)))}
 check(d=>d.joints[0].parent='arm');check(d=>d.joints[0].node='missing');check(d=>d.joints[1].node=keys[0]);check(d=>d.joints[0].axis=[0,0,0]);check(d=>d.joints[0].response=[[0,0],[0,1]]);check(d=>d.controls[0].value=NaN)
 check(d=>d.followers=[{id:'f',name:'f',barrel:keys[3],piston:keys[4],base_node:keys[3],tip_node:'',base_point:[0,0,0],tip_point:[1,0,0]}])
})
test('stable node references survive cloning and detect renamed parts',()=>{
 const {root,def}=setup();validateEquipment(def,equipmentNodes(root.clone(true)));const clone=root.clone(true);clone.children[0].name='Different';assert.throws(()=>validateEquipment(def,equipmentNodes(clone)))
})
test('native mesh nesting composes once and cleanup restores original hierarchy',()=>{
 const root=new THREE.Group(),boom=new THREE.Group(),bucket=new THREE.Group();root.add(boom);boom.add(bucket);bucket.position.x=2
 const keys=[...equipmentNodes(root).keys()];const d=emptyEquipment();d.controls=[{id:'c',name:'c',value:1,rest:0,keys:[]}];d.joints=[{id:'b',name:'b',node:keys[1],parent:null,control:'c',kind:'hinge',pivot:[0,0,0],axis:[0,0,1],minimum:0,maximum:90,response:[[0,0],[1,1]]},{id:'k',name:'k',node:keys[2],parent:'b',control:'c',kind:'hinge',pivot:[2,0,0],axis:[0,0,1],minimum:0,maximum:0,response:[[0,0],[1,1]]}]
 const rig=bindEquipment(root,d);rig.evaluate(null);const p=bucket.getWorldPosition(new THREE.Vector3());near(p.x,0);near(p.y,2);rig.restore();root.updateWorldMatrix(true,true);near(bucket.getWorldPosition(new THREE.Vector3()).x,2);assert.equal(bucket.parent,boom)
})

test('zero-scale schedule root does not corrupt internal bind pose',()=>{
 const {root,def}=setup();root.scale.setScalar(0);const rig=bindEquipment(root,def);root.scale.setScalar(1);rig.evaluate(null,{lift:1,curl:0});near(root.children[2].position.y,3)
})

test('assembly preserves world placement, distinct parts and original parents', () => {
 const parent=new THREE.Group(); parent.rotation.x=Math.PI/2; parent.position.set(4,5,6)
 const a=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()); a.position.set(1,2,3); parent.add(a)
 const b=new THREE.Group(); b.position.set(9,8,7); const child=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()); b.add(child)
 a.userData.circular=a
 const root=assembleEquipment([{name:'Boom.glb',object:a,fileId:'a'},{name:'Bucket.glb',object:b,fileId:'b'}],'Loader')
 root.updateWorldMatrix(true,true)
 assert.equal(a.parent,parent); assert.equal(b.children[0],child)
 assert.equal(root.children.length,2); assert.equal(root.children[0].name,'Boom.glb')
 a.matrixWorld.elements.forEach((v,i)=>near(v,root.children[0].matrixWorld.elements[i]))
 assert.deepEqual(root.userData.prosotaEquipmentSources,['a','b'])
 assert.deepEqual(root.children[0].userData,{})
 const def=emptyEquipment();def.controls=[{id:'c',name:'Lift',value:0,rest:0,keys:[]}]
 def.joints=[{id:'j',name:'Lift',node:[...equipmentNodes(root).keys()][1],parent:null,control:'c',kind:'slide',pivot:[0,0,0],axis:[1,0,0],minimum:0,maximum:5,response:[[0,0],[1,1]]}]
 const runtime=bindEquipment(root,def);runtime.evaluate(null,{c:1});near(root.children[0].position.x,10);runtime.restore();near(root.children[0].position.x,5)
})
test('assembly rejects singular and animated imports',()=>{
 const a=new THREE.Group(),b=new THREE.Group();a.scale.setScalar(0)
 assert.throws(()=>assembleEquipment([{name:'a',object:a},{name:'b',object:b}],'X'),/zero scale/)
 a.scale.setScalar(1);a.animations=[new THREE.AnimationClip('clip',1,[])]
 assert.throws(()=>assembleEquipment([{name:'a',object:a},{name:'b',object:b}],'X'),/embedded animation/)
})

test('assembled GLB reload preserves backup references and riggable part transforms', async()=>{
 globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.()})}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result='data:application/octet-stream;base64,'+Buffer.from(value).toString('base64');this.onloadend?.()})}
 }
 const a=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()),b=a.clone();b.position.x=3
 const assembly=assembleEquipment([{name:'Boom.glb',object:a,fileId:'a'},{name:'Bucket.glb',object:b,fileId:'b'}],'Loader')
 const bytes=await new GLTFExporter().parseAsync(assembly,{binary:true,onlyVisible:false})
 const loaded=(await new GLTFLoader().parseAsync(bytes,'')).scene
 const group=loaded.children[0]
 assert.deepEqual(group.userData.prosotaEquipmentSources,['a','b'])
 assert.equal(group.children.length,2);near(group.children[1].position.x,3)
 assert.ok([...equipmentNodes(loaded).keys()].some(k=>k.includes('Bucketglb')))
})

test('multi-part group shares a rigid delta and carries child joints once',()=>{
 const {root,def,keys}=setup();def.joints=def.joints.slice(0,2)
 def.joints[0].members=[keys[2]]
 const rt=bindEquipment(root,def);rt.evaluate(null,{lift:1,curl:0})
 near(root.children[2].position.x,0);near(root.children[2].position.y,3)
 near(root.children[1].position.x,0);near(root.children[1].position.y,2)
 rt.evaluate(null,{lift:0,curl:0},{boom:45})
 near(root.children[2].position.x,3/Math.sqrt(2));near(root.children[2].position.y,3/Math.sqrt(2))
 rt.restore();near(root.children[2].position.x,3);near(root.children[2].position.y,0)
})
test('group members reject duplicate ownership and ancestor overlap',()=>{
 const {root,def,keys}=setup();def.joints[0].members=[keys[1]]
 assert.throws(()=>bindEquipment(root,def),/one driver/)
 def.joints[0].members=[keys[0]+'/0:Child']
 assert.throws(()=>validateEquipment(def),/children/)
})


test('changing pivot orientation preserves rest pose and changes the motion axis',()=>{
 const {root,def}=setup();def.joints=def.joints.slice(0,1)
 def.joints[0].pivot_rotation=[Math.PI/2,0,0]
 def.joints[0].axis=new THREE.Vector3(0,0,1).applyEuler(new THREE.Euler(...def.joints[0].pivot_rotation)).toArray()
 const rt=bindEquipment(root,def);rt.evaluate(null,{lift:0});near(root.children[0].quaternion.angleTo(new THREE.Quaternion()),0)
 rt.evaluate(null,{lift:1})
 const expected=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,-1,0),Math.PI/2)
 near(root.children[0].quaternion.angleTo(expected),0)
 rt.restore();near(root.children[0].quaternion.angleTo(new THREE.Quaternion()),0)
})


test('travel endpoints apply to keyed shared controls without rebasing linked mechanisms',()=>{
 const {root,def}=setup();def.controls[1].rest=.5
 def.controls[1].keys=[{date:'2026-01-01T00:00:00Z',value:.3,interpolation:'linear'}]
 const sibling=structuredClone(def.joints[2]),controls=structuredClone(def.controls)
 const next=setJointTravel(def,'arm',-40,110),j=next.joints[1],c=next.controls[1]
 near(jointOffset(j,c,0),-40);near(jointOffset(j,c,.5),0);near(jointOffset(j,c,1),110)
 assert.deepEqual(next.controls,controls);assert.deepEqual(next.joints[2],sibling)
 validateEquipment(next,equipmentNodes(root))
 const reverse=setJointTravel(next,'arm',110,-40)
 near(jointOffset(reverse.joints[1],c,0),110);near(jointOffset(reverse.joints[1],c,1),-40)
 const reloaded=JSON.parse(JSON.stringify(next));near(jointOffset(reloaded.joints[1],reloaded.controls[1],1),110)
 assert.throws(()=>setJointTravel(def,'arm',20,80),/imported pose/)
 assert.throws(()=>setJointTravel(def,'boom',-10,80),/rest pose/)
})

test('capture samples the requested pose from rest, then restores the visible Setup pose',()=>{
 const {root,def,keys}=setup(),runtime=bindEquipment(root,def)
 root.position.set(5,2,1);root.rotation.y=.3
 runtime.evaluate(null,{lift:.8,curl:.2},{boom:17})
 const before=[...equipmentNodes(root).values()].map(n=>n.matrix.toArray())
 const sampled=sampleEquipmentNode(root,def,keys[2],{lift:.3,curl:1})
 assert.ok(sampled);assert.deepEqual([...equipmentNodes(root).values()].map(n=>n.matrix.toArray()),before)
 runtime.evaluate(null,{lift:.3,curl:1});const expected=equipmentNodes(root).get(keys[2]).matrixWorld
 sampled.elements.forEach((v,i)=>near(v,expected.elements[i]))
 assert.ok(sampleEquipmentNode(root,structuredClone(def),keys[2],{lift:0}))
 const changed=structuredClone(def);changed.joints[0].maximum=120
 assert.equal(sampleEquipmentNode(root,changed,keys[2],{lift:0}),undefined)
})

test('minor fittings hide only outside the rest clearance and restore on seek, sampling and disposal',()=>{
 const {root,def,keys}=setup();def.motion_details=[{node:keys[1],joint:'boom',threshold:.5}]
 const t0='2026-01-01T00:00:00Z',t1='2026-01-01T00:00:10Z'
 def.controls[0].keys=[{date:t0,value:0,interpolation:'linear'},{date:t1,value:1,interpolation:'linear'}]
 const rig=bindEquipment(root,def),fitting=root.children[1]
 rig.evaluate(Date.parse(t1));assert.equal(fitting.visible,false)
 sampleEquipmentNode(root,def,keys[2],{lift:0,curl:0});assert.equal(fitting.visible,false)
 rig.evaluate(Date.parse(t0));assert.equal(fitting.visible,true)
 rig.evaluate(null,{}, {boom:20});assert.equal(fitting.visible,false)
 rig.restore();assert.equal(fitting.visible,true)
 fitting.visible=false;rig.evaluate(Date.parse(t0));rig.dispose();assert.equal(fitting.visible,false)
 fitting.visible=true;const outer=new THREE.Group();outer.add(root)
 const adapted=importEquipmentPreset(JSON.parse(JSON.stringify(def)),outer)
 assert.equal(adapted.motion_details[0].node,'/0:Backhoe'+keys[1])
 const other=bindEquipment(outer,adapted);other.evaluate(null,{lift:1});assert.equal(fitting.visible,false)
 other.dispose();assert.equal(fitting.visible,true)
 for(const bad of [{node:'',joint:'boom',threshold:.5},{node:keys[1],joint:'unknown',threshold:.5},{node:keys[1],joint:'boom',threshold:-1}]){
  assert.throws(()=>validateEquipment({...def,motion_details:[bad]}))
 }
})
