import { test } from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({ stdin: { contents: "export * from './src/lib/undoHistory'; export * from './src/lib/apiUndo'; export * from './src/modules/fourD/transformUndo'; export * as THREE from 'three'", resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })
const { UndoHistory, undoHistory, installApiUndo, captureTransform, restoreTransform, THREE } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
globalThis.window = new EventTarget()
test('only ten steps retained, drag frames merge, redo branches clear', async () => {
 const h = new UndoHistory(); let value = 0
 for(let i=1;i<=15;i++) { const before=value, after=i; value=i; h.record({label:'edit',undo:()=>{value=before},redo:()=>{value=after}}) }
 assert.equal(h.past.length,10)
 for(let i=0;i<10;i++) await h.run()
 assert.equal(value,5)
 await h.run(true); assert.equal(value,6)
 const group={}, owner={}
 for(let i=7;i<=12;i++) { const before=value, after=i; value=i; h.record({label:'drag',group,owner,undo:()=>{value=before},redo:()=>{value=after}}) }
 assert.equal(h.future.length,0)
 await h.run(); assert.equal(value,6)
 await h.run(true); assert.equal(value,12)
})
test('failed undo remains retryable; overlapping undo is ignored', async () => {
 const h=new UndoHistory(); let reject, calls=0
 h.record({label:'save',undo:()=>{calls++;return new Promise((_,r)=>reject=r)},redo:()=>{}})
 const pending=h.run(); await h.run(); assert.equal(calls,1)
 reject(new Error('offline')); await pending
 assert.equal(h.past.length,1);assert.equal(h.future.length,0);assert.match(h.message,/offline/)
 h.setScope('new');assert.equal(h.past.length,0)
})
function server(resource, initial) {
 undoHistory.clear();undoHistory.setScope('project')
 let row=structuredClone(initial), fail=false, writes=0
 const api=axios.create({adapter:async config=>{
   if(config.method==='get') return {data:[structuredClone(row)],status:200,statusText:'OK',headers:{},config}
   if(fail) throw Object.assign(new Error('offline'),{config})
   const payload=typeof config.data==='string'?JSON.parse(config.data):config.data
   if(resource==='equipment-rigs') { assert.ok(payload.definition); assert.ok(payload.name); assert.equal(payload.version,row.version) }
   row={...row,...payload};if('version' in row) row.version++
   writes++
   return {data:structuredClone(row),status:200,statusText:'OK',headers:{},config}
 }})
 installApiUndo(api)
 return {api, list:()=>api.get(`/api/v1/${resource}/`,{params:{project_id:'project'}}), edit:p=>api[resource==='equipment-rigs'?'put':'patch'](`/api/v1/${resource}/${initial.id}`,p), row:()=>row, change:p=>{row={...row,...p}}, fail:v=>{fail=v}, writes:()=>writes}
}
test('schedule duration undo persists previous value and redo restores ten', async()=>{
 const s=server('activities',{id:'a',task_name:'Excavate',duration_hours:'24',status:'planned'})
 await s.list();await s.edit({duration_hours:'80'})
 assert.equal(undoHistory.past.length,1)
 await undoHistory.run();assert.equal(s.row().duration_hours,'24')
 await undoHistory.run(true);assert.equal(s.row().duration_hours,'80')
 assert.equal(undoHistory.past.length,1);assert.equal(s.writes(),3)
})
test('field histories cover resources, risk, costs and ICD', async()=>{
 for(const [resource,key,old,next] of [['resources','name','Crew','Team'],['risks','probability','0.1','0.8'],['cost-elements','budget','500','900'],['icd-items','title','Old','New']]) {
  const s=server(resource,{id:'a',[key]:old});await s.list();await s.edit({[key]:next})
  await undoHistory.run();assert.equal(s.row()[key],old,resource)
  await undoHistory.run(true);assert.equal(s.row()[key],next,resource)
 }
})
test('failed saves add no history; newer server edits are not overwritten', async()=>{
 const s=server('risks',{id:'r',title:'Risk',probability:'0.1'})
 await s.list();s.fail(true);await assert.rejects(s.edit({probability:'0.5'}));assert.equal(undoHistory.pending,0);assert.equal(undoHistory.past.length,0)
 s.fail(false);await s.edit({probability:'0.5'});s.change({probability:'0.9'})
 await undoHistory.run();assert.equal(s.row().probability,'0.9');assert.equal(undoHistory.past.length,1);assert.match(undoHistory.message,/changed/)
})
test('server version is taken from latest record on each rig undo and redo',async()=>{
 const s=server('equipment-rigs',{id:'r',name:'Old',definition:{joints:[]},version:1})
 await s.list();await s.edit({name:'New',definition:{joints:[]},version:1})
 await undoHistory.run();assert.equal(s.row().name,'Old');assert.equal(s.row().version,3)
 await undoHistory.run(true);assert.equal(s.row().name,'New');assert.equal(s.row().version,4)
})
test('transform snapshots restore a group without copying its geometry',()=>{
 const parent=new THREE.Group(), a=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),b=a.clone()
 parent.add(a,b);b.position.set(4,5,6)
 const rows=[a,b].map(object=>({object,state:captureTransform(object)}))
 a.position.x=25;b.position.x=29;a.rotation.z=.5;b.scale.setScalar(3)
 for(const r of rows) restoreTransform(r.object,r.state)
 assert.deepEqual(a.position.toArray(),[0,0,0]);assert.deepEqual(b.position.toArray(),[4,5,6]);assert.deepEqual(b.scale.toArray(),[1,1,1])
 assert.equal(a.geometry,b.geometry)
})
