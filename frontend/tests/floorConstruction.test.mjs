import {test} from 'node:test'
import {IfcAPI} from 'web-ifc'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {writeFile,unlink} from 'node:fs/promises'
const exports=['constructionStages','groundFromObjects','phasedFoundations','pourBreak','floorReview','enclosureGeometry','slabReferences','constructionLayout','constructionHost','constructionGeometry'].map(name=>"export * from './src/modules/fourD/"+name+"'")
const {outputFiles}=await build({stdin:{contents:[...exports,"export {volume,checkSolid} from './src/modules/fourD/shapeBoolean'","export * from './tests/pourSlab.fixture'","export * from 'three'"].join(';'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',external:['web-ifc'],alias:{'@':'./src'},define:{'import.meta.env':'{}'}})
const moduleUrl=new URL('./.floor-fixture-'+process.pid+'.mjs',import.meta.url)
await writeFile(moduleUrl,outputFiles[0].text)
const t=await import(moduleUrl.href).finally(()=>unlink(moduleUrl))
const groundApi=new IfcAPI()
await groundApi.Init(undefined,true)
const source=(id,x,y,z,w,h,d)=>{const object=new t.Mesh(new t.BoxGeometry(w,h,d),new t.MeshStandardMaterial());object.position.set(x,y,z);return {id,name:id,object}}
const date=n=>new Date(n*86400000).toISOString()
const tasks=[1,2,3,4].map(i=>({id:'a'+i,start:date(i),finish:date(i+.5)}))
const close=(a,b)=>assert.ok(Math.abs(a-b)<.001,a+' != '+b)
test('two pours share one host reference and preserve volume on either up axis',()=>{
 for(const axis of ['y','z']){
  const s=source('slab',10,3,8,8,.3,5)
  if(axis==='z'){s.object.rotation.x=Math.PI/2;s.object.position.set(10,-8,3)}
  const points=axis==='y'?[{x:10,y:3,z:0},{x:10,y:3,z:20}]:[{x:10,y:0,z:3},{x:10,y:-20,z:3}]
  const zones=t.divideSlab(s,{points,closed:false},axis)
  assert.equal(zones.length,2);for(const p of zones){close(t.volume(p.scene.children[0].geometry),6);assert.deepEqual(p.sourceRefs,['slab']);assert.ok(t.readConstructionHost('Zone',p.scene,'y','slabTop').rings.length)}
 }
})
test('incomplete IFC shaft lining yields two closed formwork hosts in the right place on either up axis',()=>{
 for (const axis of ['y','z']) {
  const object=t.openRevealSlab(), rotation=axis==='z'?Math.PI/2:0
  const world=(x,y,z)=>new t.Vector3(x,y,z).applyAxisAngle(new t.Vector3(1,0,0),rotation)
  object.rotation.x=rotation
  object.position.copy(world(17,6,-8))
  const src={object,id:'model::186',backupRef:'file:floor::186',ifcType:'IfcSlab',name:'Floor'}
  assert.throws(()=>t.checkSolid(object.geometry),/closed solids/)
  for(const [x,slope,expected] of [[0,0,[12,12]],[4,0,[4.8,19.2]],[0,.27,[12,12]],[2,0,[9.6,14.4]]]){
   const path={closed:false,points:[world(17+x-slope*6,6,-14),world(17+x+slope*6,6,-2)]}
   const zones=t.divideSlab(src,path,axis)
   const volumes=[]
   const geometries=zones.map(z=>{
    const mesh=z.scene.children[0]
    t.checkSolid(mesh.geometry)
    volumes.push(t.volume(mesh.geometry))
    assert.deepEqual(z.sourceRefs,['file:floor::186'])
    assert.ok(t.readConstructionHost('zone',z.scene,'y').rings.length)
    assert.ok(t.readConstructionHost('zone',z.scene,'y','slabTop').rings.length)
    z.scene.rotation.x=rotation; z.scene.position.copy(z.anchor); z.scene.updateMatrixWorld(true)
    return mesh
   })
   volumes.sort((a,b)=>a-b).forEach((v,i)=>close(v,expected[i]))
   const ray=new t.Raycaster()
   for(const [px,pz,solid] of [[.7,-.5,false],[-3.5,1,true],[4.5,-3,true],[0,5,false]]){
    ray.set(world(17+px,7,-8+pz),world(0,-1,0))
    assert.equal(ray.intersectObjects(geometries).length,solid?1:0)
   }
   zones.forEach(z=>t.releaseConstruction(z.scene))
  }
  assert.throws(()=>t.divideSlab(src,{closed:false,points:[world(25,6,-14),world(25,6,-2)]},axis),/interior/)
  assert.throws(()=>t.checkSolid(object.geometry),/closed solids/)
 }
})
test('an incomplete cap or an interior side cannot be inferred from the other slab faces',()=>{
 const slab=t.openRevealSlab(), geom=slab.geometry, p=geom.attributes.position
 const cut=object=>t.divideSlab({id:'floor',ifcType:'IfcSlab',name:'Floor',object},
   {closed:false,points:[{x:0,y:0,z:-7},{x:0,y:0,z:7}]},'y')
 const extra=new t.BufferGeometry()
 extra.setAttribute('position',new t.Float32BufferAttribute([-4,0,0,-4,-.3,0,-4,-.3,1],3))
 const group=new t.Group().add(slab,new t.Mesh(extra))
 assert.throws(()=>cut(group),/profile|boundary/)
 const idx=Array.from(geom.index.array), keep=[]
 for(let i=0;i<idx.length;i+=3){
   const ids=idx.slice(i,i+3)
   if(!ids.every(j=>p.getY(j)<-.29))keep.push(...ids)
 }
 geom.setIndex(keep)
 assert.throws(()=>cut(slab),/profile|boundary/)
})
test('merged excavation, crossed beam and cap conserve concrete, blinding and backfill',()=>{
 const cap=source('cap',0,-.6,0,3,1,2),beam=source('beam',2,-.35,0,4,.5,.5)
 const cuts=[cap,beam].map(s=>t.groundCutSource(s,'y'))
 const {pieces}=t.phasedFoundations(cuts,null,'y',{margin:1,top:0,bottom:-2},.25,.05,groundApi)
 const v=Object.fromEntries(pieces.filter(p=>p.phase).map(p=>[p.phase,t.volume(p.preview.scene.children[0].geometry)]))
 assert.ok(v.backfill>0 && v.blinding>0)
 close(v.concrete,6+1-1.5*.5*.5)
 close(v.excavation,v.concrete+v.backfill+v.blinding)
})
test('slab references retain openings and measure each receiving floor separately',()=>{
 const base=source('G',0,-.15,0,12,.3,9),middle=source('M',0,3.8,0,9,.4,9),roof=source('R',0,6.9,0,9,.2,9)
 const read=s=>t.readConstructionHost(s.name,s.object,'y','slabTop')
 const floors=[roof,base,middle].map(read)
 close(t.selectedDeckBearing(floors[0],floors).clearance,2.8)
 close(t.selectedDeckBearing(floors[2],floors).clearance,3.6)
 const shallow=read(source('near',0,6.3,0,9,.2,9))
 assert.throws(()=>t.selectedDeckBearing(floors[0],[shallow,read(base)]),/less than/)
 middle.object.position.x=20
 assert.throws(()=>t.selectedDeckBearing(floors[0],[read(base),read(middle)]),/immediately below/)
 const donut=new t.Shape();donut.moveTo(0,0);donut.lineTo(8,0);donut.lineTo(8,6);donut.lineTo(0,6);donut.closePath()
 const hole=new t.Path();hole.moveTo(2,2);hole.lineTo(2,4);hole.lineTo(4,4);hole.lineTo(4,2);hole.closePath();donut.holes.push(hole)
 const object=new t.Mesh(new t.ExtrudeGeometry(donut,{depth:.2,bevelEnabled:false}))
 const ref=t.captureSlabReferences([{id:'model::7',backupRef:'file:test::7',ifcType:'IfcSlab',name:'L2',object}],'z')[0]
 assert.equal(ref.ref,'file:test::7');assert.equal(ref.rings.length,2);close(ref.elevation,.2)
})
test('screens in a slab stack omit bays where the lower shoe misses the façade',async()=>{
 const lower=source('G',0,0,0,8,.3,6),upper=source('L2',1,3.2,0,10,.3,6)
 const opts={mode:'screen',screenHeight:6.5,bayWidth:2.4}
 const p=await t.prepareConstruction([upper],'y',opts,[],[lower])
 assert.match(p.bearingSummary,/excluded/);assert.ok(p.parts>0)
 t.releaseConstruction(p.scene)
})
test('above-grade concrete survives a phased cut',()=>{
 const pier=source('cap',0,0,0,2,1,2)
 const {pieces}=t.phasedFoundations([t.groundCutSource(pier,'y')],null,'y',{margin:2,top:0,bottom:-1},.25,.05,groundApi)
 const concrete=pieces.find(p=>p.phase==='concrete')
 close(t.volume(concrete.preview.scene.children[0].geometry),4)
})
test('combined cuts preserve a rotated slab opening, skip elevated and offsite slabs, and conserve soil',()=>{
 const base=source('Site',5,-1,8,20,2,18)
 const outline=new t.Shape([[-4,-3],[-4,3],[4,3],[4,-3]].map(([x,z])=>new t.Vector2(x,z)))
 outline.holes.push(new t.Path([[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>new t.Vector2(x,z))))
 const object=new t.Mesh(new t.ExtrudeGeometry(outline,{depth:.4,bevelEnabled:false}).rotateX(Math.PI/2))
 object.rotation.y=.37;object.position.set(5,-.2,8)
 const slab={id:'slab',name:'Slab',object}
 const above=source('Upper floor',5,4,8,10,.5,10),outside=source('Outside',55,-.5,8,2,1,2)
 for(const axis of ['y','z']){
  const root=new t.Group()
  root.add(base.object,slab.object,above.object,outside.object)
  if(axis==='z')root.rotation.x=Math.PI/2
  const cuts=[slab,above,outside].map(s=>t.groundCutSource(s,axis))
  const {pieces,skipped}=t.phasedFoundations(cuts,base,axis,{margin:0},0,.05,groundApi)
  assert.deepEqual(skipped,['Upper floor','Outside'])
  const v=Object.fromEntries(pieces.map(p=>[p.phase??'soil',t.volume(p.preview.scene.children[0].geometry)]))
  close(v.soil+v.excavation,720);close(v.concrete,44*.4);close(v.excavation,44*.65)
  close(v.excavation,v.concrete+v.blinding+v.backfill)
  for(const p of pieces){
    assert.deepEqual(p.preview.sourceRefs,['slab'])
    t.checkSolid(p.preview.scene.children[0].geometry)
  }
  const removed=pieces.find(p=>p.phase==='excavation').preview
  const ray=new t.Raycaster(new t.Vector3(5,2,8),new t.Vector3(0,-1,0))
  const anchor=removed.anchor.clone()
  if(axis==='z')anchor.applyAxisAngle(new t.Vector3(1,0,0),-Math.PI/2)
  removed.scene.position.copy(anchor);removed.scene.updateMatrixWorld(true)
  assert.equal(ray.intersectObject(removed.scene).length,0)
 }
})
test('a tapered pile uses the original solid for the concrete phase',()=>{
 const object=new t.Mesh(new t.CylinderGeometry(1,.45,3,16))
 object.position.y=-1
 const pile={id:'p',name:'Tapered pile',ifcType:'IfcPile',object}
 const base=source('Site',0,-2,0,8,4,8)
 const {pieces}=t.phasedFoundations([t.groundCutSource(pile,'y')],base,'y',{margin:2},.3,.05,groundApi)
 const v=Object.fromEntries(pieces.map(p=>[p.phase??'soil',t.volume(p.preview.scene.children[0].geometry)]))
 close(v.concrete,t.volume(object.geometry))
 close(v.soil+v.excavation,256)
 assert.ok(v.backfill>0 && v.blinding>0)
})
test('transfer holds backprops and rejects an unverified receiving deck',()=>{
 const ids=['table','prop','new'];const items=ids.map(id=>({id,name:id,construction_mode:'deck',measured_bearing:true}))
 const out=t.transferKit(items,ids.slice(0,2),['new'],'a2',tasks,'a3')
 assert.equal(t.stageInterval(out[0].stage_window,tasks).end,Date.parse(date(2)))
 assert.equal(t.stageInterval(out[1].stage_window,tasks).end,Date.parse(date(3.5)))
 assert.equal(t.stageInterval(out[2].stage_window,tasks).start,Date.parse(date(2)))
 assert.equal(out[0].stage_window.kit_id,out[2].stage_window.kit_id)
 items[2].measured_bearing=false;assert.throws(()=>t.transferKit(items,['table'],['new'],'a2',tasks),/bearing/)
})
test('crane picks lower hook, lift clear, land, hold and seek backwards',()=>{
 const lift={activity_id:'a1',clearance:3,hook_height:1,pickup:{x:-10,y:0,z:0},landing:{x:10,y:3,z:5}}
 const rows=t.resolvePicks([lift],tasks),at=u=>t.samplePick(rows,Date.parse(date(1+.5*u)),'y')
 assert.deepEqual(at(-1).load,lift.pickup);assert.deepEqual(at(1.5).load,lift.landing)
 close(at(.5).load.y,6);close(at(.5).load.x,0);assert.ok(at(.05).hook.y>at(.15).hook.y)
 assert.deepEqual(at(-.5).load,lift.pickup)
 assert.throws(()=>t.resolvePicks([lift,{...lift,activity_id:'a2'}],tasks),/pickup/)
})
test('floor repeat holds changed slabs for review and finds material and timing conflicts',()=>{
 const e={ifcType:'IfcColumn',material:'concrete',name:'C1',signature:'c',storeyName:'L1',globalId:'c1',boxMinMetres:[0,0,0],boxMaxMetres:[1,3,1]}
 const slab={...e,globalId:'s1',name:'S1',signature:'old slab',ifcType:'IfcSlab',boxMinMetres:[-1,-.2,-1],boxMaxMetres:[2,0,2],outline:[[[-1,-1],[2,-1],[2,2],[-1,2]].map(p=>new t.Vector2(...p))]}
 const rows=[e,slab,{...e,storeyName:'L2',globalId:'c2'},{...slab,storeyName:'L2',globalId:'s2',signature:'opening'}]
 const matches=t.matchFloor(rows,'L1','L2');assert.deepEqual(matches.hosts,{c1:{ref:'c2',label:'C1'}});assert.equal(matches.review.length,2)
 const links=['c1','s1'].map((element_ref,i)=>({element_ref,activity_id:tasks[i].id,source_kind:'ifc'}))
 const findings=t.sequenceIssues(rows.slice(0,2),tasks.map((a,i)=>({...a,task_name:i?'Pour slab':'Erect steel columns'})),links,'y');assert.equal(findings.length,2)
})
test('scaffold stairs and nets fit an individual bay on both up axes',()=>{
 for(const axis of ['y','z']){
 const item={id:'s',up_axis:axis,color:'#aabbcc',height:2,layout:{panels:[{id:'bay',stairs:true,a:{x:0,y:0,z:0},b:{x:3,y:0,z:0}}]},enclosure:{openings:[],style:'scaffold',scaffold:{stairs:[1],side:'right',width:1.2,lifts:2,netted:true}}}
 const r=t.buildEnclosure(item),bounds=new t.Box3().setFromObject(r.root,true)
 assert.ok(bounds.max[axis]>4.99);assert.ok(r.root.children.some(m=>m.name.includes('scaffoldNet')))
 const count=r.root.children.reduce((n,m)=>n+m.count,0);r.dispose()
 item.layout.panels[0].stairs=false;const bare=t.buildEnclosure(item)
 assert.ok(count-bare.root.children.reduce((n,m)=>n+m.count,0)>20);bare.dispose()
 }
})
