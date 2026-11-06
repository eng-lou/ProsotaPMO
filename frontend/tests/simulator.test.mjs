import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/simulator/handling';export * from './src/modules/simulator/scope';export * from './src/modules/simulator/report';export * as THREE from 'three'",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'})
const {THREE,handlingAt,handlingKey,handlingMatrix,designBounds,scopeDefinitions,excavationExample,simulationReport}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const pose=(p=[0,0,0])=>({position:p,rotation:[0,0,0]})
const h={model_ref:'beam',element_id:'global-id',state:'moving',from_pose:pose([0,0,0]),to_pose:pose([10,0,0]),attachment:pose()}
const event={task_id:'a',step_id:'a',activity_id:'a',phase:'carry',state:'moving',start:'2026-10-28T08:00:00',end:'2026-10-28T09:00:00',progress_from:0,progress_to:1,resources:{},object_states:[h]}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`)
test('seeking an operational state is deterministic and holds between events',()=>{
 const t=Date.parse('2026-10-28T08:30:00'),key=handlingKey(h)
 assert.equal(handlingAt([event],key,t).progress,.5)
 assert.equal(handlingAt([event],key,t-3600000),null)
 assert.equal(handlingAt([event],key,t+3600000).progress,1)
 assert.deepEqual(handlingAt([event],key,t),handlingAt([event],key,t))
})
test('world offsets preserve designed pose and installed state restores it',()=>{
 const original=new THREE.Matrix4().makeTranslation(30,5,0),anchor=new THREE.Matrix4().makeTranslation(30,5,0),before=original.toArray()
 near(new THREE.Vector3().setFromMatrixPosition(handlingMatrix(h,.5,original,anchor)).x,35)
 assert.deepEqual(handlingMatrix({...h,state:'installed'},1,original,anchor).toArray(),before)
 assert.deepEqual(original.toArray(),before)
})
test('attachment follows a rotated hook without shrinking the carried element to the carrier import scale',()=>{
 const design=new THREE.Matrix4().makeTranslation(31,5,0),anchor=new THREE.Matrix4().makeTranslation(30,5,0)
 const carrier=new THREE.Matrix4().compose(new THREE.Vector3(10,20,30),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2),new THREE.Vector3(.01,.01,.01))
 const matrix=handlingMatrix({...h,state:'attached'},.5,design,anchor,carrier)
 const p=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();matrix.decompose(p,q,scale)
 near(p.x,10);near(p.y,21);near(p.z,30);near(scale.x,1)
 assert.equal(handlingMatrix({...h,state:'attached'},.5,design,anchor),null)
})

test('attachment offsets are metres even for centimetre-scaled carrier assets',()=>{
 const carrier=new THREE.Matrix4().makeScale(.01,.01,.01)
 const matrix=handlingMatrix({...h,state:'attached',attachment:pose([2,0,0])},0,new THREE.Matrix4(),new THREE.Matrix4(),carrier)
 near(new THREE.Vector3().setFromMatrixPosition(matrix).x,2)
})
test('design bounds ignore the active path offset',()=>{
 const root=new THREE.Group();root.position.x=100
 const box=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));box.position.x=4;root.add(box);root.updateMatrixWorld(true)
 near(designBounds(box,new THREE.Matrix4().makeTranslation(4,0,0)).getCenter(new THREE.Vector3()).x,4)
})
test('reused definitions share programme resource capacity and exclude storage metadata',()=>{
 const a=excavationExample('a'),b=excavationExample('b')
 a.resources[0].source_resource_id='same-loader';b.resources[0].source_resource_id='same-loader'
 const context={activities:[],steps:[a,b].map((x,i)=>({id:'source-'+i,activity_id:x.step.activity_id,name:x.step.name,is_complete:false,operation:{...x.step,_resources:x.resources}}))}
 const before=JSON.stringify(context),scope=scopeDefinitions(context,['a','b'],null)
 assert.equal(scope.resources.filter(r=>r.source_resource_id==='same-loader').length,1)
 assert.equal(scope.steps[0].phases[0].resources[0].resource_id,scope.steps[1].phases[0].resources[0].resource_id)
 assert.equal(scope.steps[0]._resources,undefined);assert.equal(JSON.stringify(context),before)
})
test('visual report escapes user text and keeps explicit unresolved information',()=>{
 const sample={name:'<script>alert(1)</script>',revision:1,status:'incomplete',config:{steps:[],assumptions:'<b>assumed</b>'},decisions:[],result:{basis:'event_simulation',start:event.start,finish:event.end,steps:[],events:[],activities:[],resources:[],waiting:[],issues:[{reason:'Access not supplied'}],warnings:[]}}
 const html=simulationReport(sample,null,null)
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Access not supplied'))
})
