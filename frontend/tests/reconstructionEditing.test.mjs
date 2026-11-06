import test from 'node:test'
Error.stackTraceLimit=0
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/geographicGeometry';export * from './src/modules/fourD/geographicSelection';export * from './src/modules/fourD/geographicExport';export * from './src/modules/fourD/geographicRegeneration';export * from './src/modules/fourD/siteReplacement';export * from './src/modules/fourD/reconstructionPlan';export * from './src/modules/fourD/shapeBoolean';export * as T from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {buildGeographicContext,disposeGeographicContext,geographicHit,geographicSnapshot,disposeSnapshot,editableMapFeatures,updateMapFeatures,mergeReconstruction,replaceSiteObjects,planArea,checkSolid,computeShapeBoolean,disposeBooleanResults,T}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const feature={id:'way/1',kind:'building',name:'Building',category:'industrial',height:9,height_basis:'estimated',roof:'industrial',roof_basis:'estimated',color:'#c8c9ca',roof_color:'#829198',width:6,hidden:false,points:[[-20,-20],[20,-20],[20,20],[-20,20]],holes:[]}
const data={version:1,source:'OpenStreetMap',attribution:'© OpenStreetMap contributors · ODbL 1.0',source_date:'2026-10-26',lat:53.33,lon:-6.34,width:100,depth:100,features:[feature],hidden_layers:[],detail:'detailed'}
const asset={id:'new-tree',name:'Oak',dimensions:{width:4,depth:5,height:10}}
test('batched roof picks its stable feature, individual wall tint and structured snapshot survive serialization',()=>{
 const saved=JSON.parse(JSON.stringify({...data,features:[{...feature,surfaces:{'wall:0:1':{color:'#ff0000',finish:'original'}}}]})),root=buildGeographicContext(saved)
 const ray=new T.Raycaster(new T.Vector3(5,3,50),new T.Vector3(0,0,-1));root.updateMatrixWorld(true);const hits=ray.intersectObject(root,true)
 const roof=hits.find(h=>geographicHit(h.object,h.faceIndex)?.surface==='roof');assert.equal(geographicHit(roof.object,roof.faceIndex).featureId,feature.id)
 const snap=geographicSnapshot(root,saved,new Set([feature.id]),true);assert.equal(snap.root.children[0].name,'building');assert.equal(snap.root.children[0].children[0].userData.prosotaFeatureId,feature.id)
 const wall=snap.root.children[0].children[0].children.find(m=>m.name==='wall:0:1');assert.equal(wall.material.color.getHexString(),'ff0000');assert.ok(snap.root.children[0].children[0].children.some(m=>m.name==='roof'))
 disposeSnapshot(snap.root);disposeGeographicContext(root)
})
test('generated building shells support boolean cutting for every roof and courtyard',()=>{
 for(const roof of ['flat','gabled','hipped','industrial'])for(const holes of [[],[[[-5,-5],[-5,5],[5,5],[5,-5]]]]){
   const root=buildGeographicContext({...data,features:[{...feature,roof,holes}]},null,{solidOnly:true}),tool=new T.Mesh(new T.BoxGeometry(12,60,20),new T.MeshStandardMaterial());tool.position.set(15,0,5)
   let results;try{results=computeShapeBoolean(root,tool,'z','subtract')}catch(e){throw Error(roof+' input '+holes.length+': '+e.message)}assert.equal(results.length,1);try{checkSolid(results[0].mesh.geometry)}catch(e){throw Error(roof+' result '+holes.length+': '+e.message)};disposeBooleanResults(results);disposeGeographicContext(root);tool.geometry.dispose();tool.material.dispose()
 }
})
test('woodland trees can be individually replaced without duplicating derived instances',()=>{
 const wood={...feature,id:'way/wood',kind:'wood'},d={...data,features:[wood]},trees=editableMapFeatures(d).filter(f=>f.kind==='tree');assert.ok(trees.length>2)
 const changed=updateMapFeatures(d,[{...trees[0],replacement:{asset_id:'oak',width:4,depth:4,height:8,yaw:0,anchor:[...trees[0].points[0],.14]}}]);assert.equal(editableMapFeatures(changed).filter(f=>f.kind==='tree').length,trees.length)
 const scene=[{id:'geo',kind:'geographic',geographic:changed}],one=replaceSiteObjects(scene,{itemId:'geo',featureId:trees[1].id},asset,false,true);assert.equal(one.count,1)
 const all=replaceSiteObjects(scene,{itemId:'geo',featureId:trees[1].id},asset,true,true);assert.equal(all.count,trees.length-1)
})
test('generic replacements reset motion and rigs, respect locks and address array instances',()=>{
 const original={id:'a',kind:'asset',asset_id:'worker',position:{x:4,y:2,z:1},width:1,depth:2,height:3,path_motion:{path_id:'p'},object_state:{pivot:123},animation_playing:true},array={...original,id:'row',kind:'array',layout:{placements:[{},{}]}},locked={...original,id:'lock',locked:true}
 const result=replaceSiteObjects([original,array,locked],{itemId:'a'},asset,true,true);assert.equal(result.count,3);assert.equal(result.locked,1);assert.deepEqual(result.items[0].position,original.position);assert.equal(result.items[0].path_motion,null);assert.equal(result.items[0].rig_disabled,true);assert.equal(result.items[0].animation_playing,false);assert.equal(result.items[1].instance_overrides[1].asset_id,asset.id);assert.equal(result.items[2],locked)
 const single=replaceSiteObjects([array],{itemId:'row',instanceIndex:1},asset,false,true);assert.equal(single.count,1);assert.equal(single.items[0].instance_overrides[0],undefined)
})
test('regeneration preserves chosen edit types and missing features; reset is explicit',()=>{
 const edited={...feature,height:20,color:'#ff0000',replacement:{asset_id:'r'}},old={...data,features:[edited,{...feature,id:'way/missing'}]},incoming={...data,features:[{...feature,height:10}]}
 const preserved=mergeReconstruction(old,incoming,{geometry:true,materials:true,replacements:true,featureIds:new Set([feature.id,'way/missing'])});assert.equal(preserved.data.features[0].height,20);assert.equal(preserved.data.features[0].color,'#ff0000');assert.equal(preserved.data.features[0].replacement.asset_id,'r');assert.deepEqual(preserved.missing,['way/missing'])
 const reset=mergeReconstruction(old,incoming,{geometry:false,materials:true,replacements:false,featureIds:new Set([feature.id])});assert.equal(reset.data.features[0].height,10);assert.equal(reset.data.features[0].color,'#ff0000');assert.equal(reset.data.features[0].replacement,undefined);assert.equal(reset.data.features.length,1)
})
test('plan footprint requires orthographic plan and removes site scale, offset and yaw',()=>{
 for(const axis of ['y','z']){const camera=new T.OrthographicCamera(-400,400,300,-300,.1,5000),up=new T.Vector3(0,axis==='y'?1:0,axis==='z'?1:0),ctx={offset_x:20,offset_y:30,offset_z:40,offset_yaw_deg:25,scale:2},target=new T.Vector3(20,30,40),north=new T.Vector3(0,axis==='z'?1:0,axis==='y'?-1:0).applyAxisAngle(up,25*Math.PI/180)
 camera.up.copy(north);camera.position.copy(target).addScaledVector(up,1000);camera.lookAt(target);camera.updateProjectionMatrix();const result=planArea(camera,ctx,axis);assert.ok(Math.abs(result.width-400)<=1);assert.ok(Math.abs(result.depth-300)<=1);assert.ok(Math.abs(result.east)<1e-8);assert.ok(Math.abs(result.north)<1e-8)
 camera.position.add(new T.Vector3(100,0,0));camera.lookAt(target);assert.throws(()=>planArea(camera,ctx,axis),/plan view/)
 }
 assert.throws(()=>planArea(new T.PerspectiveCamera(),{},'z'),/plan view/)
})

test('regeneration matches edited faces across ring reordering and retains unmatchable geometry',()=>{
 const old={...data,features:[{...feature,surfaces:{'wall:0:1':{color:'#ff0000',finish:'brick'}}}]}
 const rotated={...feature,points:[...feature.points.slice(1),feature.points[0]],height:11}
 const options={geometry:false,materials:true,replacements:true,featureIds:new Set([feature.id])}
 const reordered=mergeReconstruction(old,{...data,features:[rotated]},options)
 assert.equal(reordered.data.features[0].height,11)
 assert.equal(reordered.data.features[0].surfaces['wall:0:0'].finish,'brick')
 assert.equal(reordered.data.features[0].surfaces['wall:0:1'],undefined)
 const changed=mergeReconstruction(old,{...data,features:[{...rotated,points:rotated.points.map(([x,y])=>[x+1,y])}]},options)
 assert.deepEqual(changed.retainedGeometry,[feature.id])
 assert.deepEqual(changed.data.features[0].points,feature.points)
 assert.equal(changed.data.features[0].surfaces['wall:0:1'].color,'#ff0000')
})

test('same imported asset replacement matches reconstruction and standalone instances without reusing material slots',()=>{
 const f={...feature,replacement:{asset_id:'old',width:5,depth:5,height:8,anchor:[0,0,0]},surfaces:{'material:0':{color:'#ff0000'},roof:{color:'#aabbcc'}}}
 const geo={id:'geo',kind:'geographic',geographic:{...data,features:[f]}}
 const standalone={id:'standalone',kind:'asset',asset_id:'old',width:5,depth:5,height:8}
 for(const selection of [{itemId:'geo',featureId:f.id},{itemId:'standalone'}]){
  const result=replaceSiteObjects([geo,standalone],selection,asset,true,true)
  assert.equal(result.count,2)
  assert.equal(result.items[0].geographic.features[0].replacement.asset_id,asset.id)
  assert.equal(result.items[0].geographic.features[0].surfaces['material:0'],undefined)
  assert.equal(result.items[0].geographic.features[0].surfaces.roof.color,'#aabbcc')
  assert.equal(result.items[1].rig_disabled,true)
 }
})
