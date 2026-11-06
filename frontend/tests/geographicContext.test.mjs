import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/geographicGeometry'; export * from './src/modules/fourD/siteIsolation'; export * from './src/modules/fourD/tileCutoutGeometry'; export * as T from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {buildGeographicContext,disposeGeographicContext,captureIsolation,isConvexPolygon,T}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const feature={id:'way/1',kind:'building',name:'Courtyard',category:'industrial',height:9,height_basis:'estimated',roof:'industrial',roof_basis:'estimated',color:'#c8c9ca',roof_color:'#829198',width:6,hidden:false,points:[[-20,-20],[20,-20],[20,20],[-20,20]],holes:[[[-5,-5],[-5,5],[5,5],[5,-5]]]}
const data={version:1,source:'OpenStreetMap',attribution:'© OpenStreetMap contributors · ODbL 1.0',source_date:'2026-10-26',lat:53.33,lon:-6.34,width:100,depth:100,features:[feature],hidden_layers:[],detail:'detailed'}
test('native scene builds finite batched geometry, respects courtyard holes and disposes',()=>{
 const root=buildGeographicContext(data);root.updateMatrixWorld(true)
 assert.ok(root.children.length<15)
 root.traverse(o=>{if(o.isMesh)assert.ok(Array.from(o.geometry.attributes.position.array).every(Number.isFinite))})
 const ray=new T.Raycaster(new T.Vector3(0,0,50),new T.Vector3(0,0,-1));const hits=ray.intersectObject(root,true)
 assert.equal(hits.filter(h=>h.object.name.startsWith('building')).length,0)
 assert.ok(new T.Box3().setFromObject(root).max.z>=8.9)
 let disposed=0;root.children.forEach(m=>m.geometry.addEventListener('dispose',()=>disposed++));disposeGeographicContext(root);assert.equal(disposed,root.children.length)
})
test('layer visibility and edited height regenerate actual geometry',()=>{
 const hidden=buildGeographicContext({...data,hidden_layers:['building']});assert.ok(hidden.children.every(o=>!o.name.startsWith('building')))
 const taller=buildGeographicContext({...data,features:[{...feature,height:25}]});assert.ok(new T.Box3().setFromObject(taller).max.z>=24.9)
 disposeGeographicContext(hidden);disposeGeographicContext(taller)
})
test('camera isolation keeps only the cropped frame and stays fixed after orbit',()=>{
 for(const camera of [new T.PerspectiveCamera(60,2,.1,100),new T.OrthographicCamera(-10,10,5,-5,.1,100)]){
  camera.position.set(0,0,20);camera.lookAt(0,0,0);camera.updateProjectionMatrix()
  const saved=captureIsolation(camera,2,1),planes=saved.map(p=>new T.Plane(new T.Vector3(...p.slice(0,3)),p[3]))
  assert.ok(planes.every(p=>p.distanceToPoint(new T.Vector3(0,0,0))>0))
  assert.ok(planes.some(p=>p.distanceToPoint(new T.Vector3(camera.isPerspectiveCamera?18:9,0,0))<0))
  camera.position.set(80,80,80);camera.lookAt(0,0,0);assert.ok(planes.every(p=>p.distanceToPoint(new T.Vector3(0,0,0))>0))
 }
})
test('degenerate, crossing and concave isolation zones are rejected',()=>{
 const pts=ps=>ps.map(([x,y])=>({x,y,z:0}))
 assert.equal(isConvexPolygon(pts([[0,0],[2,0],[2,2],[0,2]]),'z'),true)
 for(const ps of [[[0,0],[1,0],[2,0]],[[0,0],[2,2],[0,2],[2,0]],[[0,0],[2,0],[1,1],[2,2],[0,2]]])assert.equal(isConvexPolygon(pts(ps),'z'),false)
})
