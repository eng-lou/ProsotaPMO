import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/poeEquipmentTools'; export * from './src/modules/fourD/equipmentRig'; export * as THREE from 'three'",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'})
const {createPoeEquipmentTools,THREE,emptyEquipment,equipmentNodes,bindEquipment}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
function fixture(){
 const root=new THREE.Group(),part=new THREE.Mesh(new THREE.BoxGeometry(2,4,6));part.name='Boom';part.position.x=3;root.add(part);root.updateMatrixWorld(true)
 const definition=emptyEquipment();definition.controls=[{id:'lift',name:'Lift',value:0,rest:0,keys:[]}]
 definition.joints=[{id:'boom',name:'Boom',node:[...equipmentNodes(root).keys()][1],parent:null,control:'lift',kind:'hinge',pivot:[3,0,0],axis:[0,0,1],minimum:0,maximum:90,response:[[0,0],[1,1]]}]
 const state={projectId:'project',objects:[{name:'site:one',kind:'mesh',object:root}],rigs:[],editing:false},staged=[]
 const tools=createPoeEquipmentTools(()=>state,p=>staged.push(p))
 return {root,part,definition,state,staged,tools,input:{model_ref:'site:one',name:'Crane',rationale:'Assumed hinge centre; review before saving.',definition}}
}
test('inspection returns paginated geometry in root coordinates without mutation',async()=>{
 const f=fixture(),before=f.root.toJSON()
 const page=await f.tools.inspect_equipment({model_ref:'site:one',limit:1})
 assert.equal(page.next_offset,1)
 const next=await f.tools.inspect_equipment({model_ref:'site:one',offset:1})
 assert.deepEqual(next.parts[0].bounds,{min:[2,-2,-3],max:[4,2,3]})
 assert.deepEqual(f.root.toJSON(),before)
})
test('draft requires inspection, stages existing-version edits and never poses geometry',async()=>{
 const f=fixture();await assert.rejects(f.tools.draft_equipment_rig(f.input),/Inspect/)
 await f.tools.inspect_equipment({model_ref:'site:one'})
 f.state.rigs=[{id:'saved-id',version:4,model_ref:'site:one',definition:f.definition}]
 const result=await f.tools.draft_equipment_rig(f.input)
 assert.equal(result.saved,false);assert.equal(f.staged[0].rig.id,'saved-id');assert.equal(f.staged[0].rig.version,4)
 assert.equal(f.part.rotation.z,0);assert.equal(f.state.rigs[0].version,4)
})
test('rejects missing parts, unsaved edits, reloaded objects and animated models',async()=>{
 const f=fixture();await f.tools.inspect_equipment({model_ref:'site:one'})
 f.input.definition.joints[0].node='/missing';await assert.rejects(f.tools.draft_equipment_rig(f.input),/missing/i)
 f.state.editing=true;await assert.rejects(f.tools.draft_equipment_rig(f.input),/Save or discard/);f.state.editing=false
 f.state.objects[0].object=new THREE.Group();await assert.rejects(f.tools.draft_equipment_rig(f.input),/Inspect/)
 await f.tools.inspect_equipment({model_ref:'site:one'});f.state.objects[0].object.animations=[{}]
 await assert.rejects(f.tools.draft_equipment_rig(f.input),/Embedded/);assert.equal(f.staged.length,0)
})
test('serialized keyframes produce identical poses after runtime disposal and recreation',()=>{
 const f=fixture(),start='2026-10-24T00:00:00.000Z',end='2026-10-24T00:00:10.000Z'
 f.definition.controls[0].keys=[{date:start,value:0,interpolation:'linear'},{date:end,value:1,interpolation:'linear'}]
 const runtime=bindEquipment(f.root,f.definition);runtime.evaluate(Date.parse(end));const pose=f.part.matrix.toArray()
 runtime.restore();const reloaded=bindEquipment(f.root,JSON.parse(JSON.stringify(f.definition)));reloaded.evaluate(Date.parse(end))
 assert.deepEqual(f.part.matrix.toArray(),pose)
})
