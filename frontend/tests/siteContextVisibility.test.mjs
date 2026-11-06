import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles} = await build({stdin:{contents:`export * from './src/modules/fourD/siteContextUpdates'; export {TileCutoutClipPlugin} from './src/modules/fourD/SiteTilesLayer'; export * as T from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {createSiteContextUpdates,TileCutoutClipPlugin,T} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const planes = [[1,0,0,10],[-1,0,0,10],[0,1,0,10],[0,-1,0,10],[0,0,1,10],[0,0,-1,10]]

test('capture then immediate hide/show keeps saved frame across queued full-row updates and reload',async()=>{
 let state={id:'row',project_id:'p',enabled:true,view_isolation:null,cutout_active:false},stored=state,release
 const gate=new Promise(resolve=>release=resolve),writes=[]
 const update=createSiteContextUpdates(()=>state,()=> 'p',async value=>{writes.push(structuredClone(value));if(writes.length===1)await gate;stored=structuredClone(value);return stored},value=>state=value)
 const capture=update('p',{view_isolation:planes}),hide=update('p',{enabled:false}),show=update('p',{enabled:true})
 await Promise.resolve();await Promise.resolve();release();await Promise.all([capture,hide,show])
 assert.equal(writes.length,3)
 assert.equal(writes[1].enabled,false)
 for(const value of writes)assert.deepEqual(value.view_isolation,planes)
 state=JSON.parse(JSON.stringify(stored));assert.equal(state.enabled,true);assert.deepEqual(state.view_isolation,planes)
 await update('p',{view_isolation:null,cutout_active:false,enabled:true});assert.equal(state.view_isolation,null)
})

test('failed visibility save does not poison queue or publish into another project',async()=>{
 let project='p',state={project_id:'p',enabled:true,view_isolation:planes},fail=true,release
 const update=createSiteContextUpdates(()=>state,()=>project,async value=>{if(fail){fail=false;throw Error('offline')}await new Promise(resolve=>release=resolve);return value},value=>state=value)
 await assert.rejects(update('p',{enabled:false}),/offline/)
 const pending=update('p',{enabled:false});await Promise.resolve();await Promise.resolve();await Promise.resolve()
 project='other';release();await pending;assert.equal(state.enabled,true)
})

test('restored isolation clips both existing and newly streamed tile meshes after remount',()=>{
 const mesh=()=>new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial())
 for(let mount=0;mount<2;mount++){
  const clipping=JSON.parse(JSON.stringify(planes)).map(p=>new T.Plane(new T.Vector3(...p.slice(0,3)),p[3]))
  const plugin=new TileCutoutClipPlugin({planes:clipping,intersection:false}),group=new T.Group(),existing=mesh(),streamed=mesh();group.add(existing)
  plugin.init({group});plugin.processTileModel(streamed)
  for(const node of [existing,streamed]){
   assert.equal(node.material.clippingPlanes.length,6);assert.equal(node.material.clipIntersection,false)
   assert.ok(node.material.clippingPlanes.every(p=>p.distanceToPoint(new T.Vector3(0,0,0))>0))
   assert.ok(node.material.clippingPlanes.some(p=>p.distanceToPoint(new T.Vector3(20,0,0))<0))
   node.geometry.dispose();node.material.dispose()
  }
 }
})
