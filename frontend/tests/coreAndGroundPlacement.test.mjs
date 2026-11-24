import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`
 export * from './src/modules/fourD/corePlacement'
 export * from './src/modules/fourD/coreRig'
 export * from './src/modules/fourD/groundFromObjects'
 export * from './src/modules/fourD/constructionHost'
 export * from './src/modules/fourD/constructionGeometry'
 export * from './src/modules/fourD/shapeBoolean'
 export {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
 export * from 'three'`,resolveDir:process.cwd()},bundle:true,format:'esm',write:false})
const t=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const close=(x,y)=>assert.ok(Math.abs(x-y)<1e-4,`${x} differs from ${y}`)
const source=(id,w,h,d,x,y,z,type)=>{const mesh=new t.Mesh(new t.BoxGeometry(w,h,d));mesh.position.set(x,y,z);return {name:id,id,object:mesh,ifcType:type}}
const yAxis=new t.Vector3(0,1,0),xAxis=new t.Vector3(1,0,0)
for(const withBoom of [true,false])test('fit the packaged '+(withBoom?'boom':'plain')+' rig to a first lift on both up axes',async()=>{
  const bytes=await fs.readFile('public/models/Prosota_Core_Formwork'+(withBoom?'_with_Boom':'')+'.glb')
  const {scene,animations}=await new t.GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
  const box=new t.Box3().setFromObject(scene),size=box.getSize(new t.Vector3())
  const normalized=new t.Group(),offset=new t.Group()
  offset.position.copy(box.getCenter(new t.Vector3())).negate();offset.position.y=-box.min.y
  normalized.scale.set(1/size.x,1/size.y,1/size.z);normalized.add(offset);offset.add(scene)
  const frame=t.coreFrame(normalized)
  assert.ok(frame)
  const roles=[];frame.traverse(n=>roles.push(n.userData.coreRigPart))
  assert.equal(roles.includes('slew'),withBoom);assert.ok(roles.includes('lower'))
  assert.equal(animations.length,withBoom?2:1)
  for(const axis of ['y','z']){
    const group=new t.Group(),walls=[source('front',10,3,.25,0,1.5,2.875,'IFCWALL'),source('back',10,3,.25,0,1.5,-2.875,'IFCWALL'),source('end',.25,3,5.5,4.875,1.5,0,'IFCWALL')]
    for(const wall of walls)group.add(wall.object)
    group.rotation.y=.42
    const target=new t.Group();target.add(group);target.position.set(34,19,27);target.rotation.x=axis==='z'?Math.PI/2:0
    const lift=t.readCoreLift(walls,axis),fit=t.fitCoreRig(lift,normalized,{width:size.x,height:size.y,depth:size.z},axis)
    const grouped=t.readCoreLift([{name:'Complete lift',id:'lift',object:target}],axis)
    close(grouped.size.x,lift.size.x);close(grouped.size.y,lift.size.y)
    close(lift.top,axis==='z'?30:22);close(lift.size.x,10);close(lift.size.y,6)
    close(fit.width/size.x,10/12);close(fit.depth/size.z,6/8)
    const actual=frame.getWorldPosition(new t.Vector3()).multiply(new t.Vector3(fit.width,fit.height,fit.depth))
      .applyAxisAngle(yAxis,fit.yaw*Math.PI/180).applyAxisAngle(xAxis,axis==='z'?Math.PI/2:0).add(new t.Vector3().copy(fit.position))
    close(actual.distanceTo(target.position),0)
    close(Math.abs(Math.cos(fit.yaw*Math.PI/180-.42)),1)
  }
})
test('mixed lifts and non-core IFC classes are rejected',()=>{
  const wall=y=>source('W'+y,6,3,.25,0,y,0,'IFCWALL')
  assert.throws(()=>t.readCoreLift([wall(2),wall(5)],'y'),/single lift/)
  assert.throws(()=>t.readCoreLift([source('P',1,5,1,0,1,0,'IFCPILE')],'y'),/core walls/)
})
test('ground beam shutters stop at a crossing, and slab formwork follows its opening',()=>{
  const options={mode:'groundBeam'}
  const beams=[source('B1',6,.5,1,0,.25,0),source('B2',1,.5,6,0,.25,0)].map(s=>t.readConstructionHost(s.id,s.object,'y'))
  const exposed=t.exposedShutterRuns(beams)
  close(exposed.flat().reduce((n,r)=>n+r.length,0),24)
  const beam=t.buildConstruction(beams[0],{...options,shutterRuns:exposed[0]})
  assert.deepEqual(beam.children.map(g=>g.name),['B1 - Side shutters','B1 - Stakes and braces'])
  const ring=(r)=>[[-r,-r],[r,-r],[r,r],[-r,r]].map(p=>new t.Vector2(...p))
  const shape=new t.Shape(ring(3));shape.holes.push(new t.Path(ring(1).reverse()))
  const host=t.readConstructionHost('slab',new t.Mesh(new t.ExtrudeGeometry(shape,{depth:.2,bevelEnabled:false}).rotateX(Math.PI/2)),'y')
  close(t.exposedShutterRuns([host])[0].reduce((n,r)=>n+r.length,0),32)
})
for(const axis of ['y','z'])test('automatic ground retains soil islands and assigns the overlap to the first excavation in '+axis+' up',()=>{
  const group=new t.Group();group.position.set(15000,20000,30000);group.rotation.x=axis==='z'?Math.PI/2:0
  const sources=[source('cap',4,1,4,0,-.5,0,'IFCFOOTING'),source('pile',1,5,1,0,-2.5,0,'IFCPILE'),source('within cap',.3,.6,.3,1,-.3,0,'IFCBEAM')]
  sources.forEach(s=>group.add(s.object))
  const cuts=sources.map(s=>t.groundCutSource(s,axis)),ground=t.makeGround(cuts,null,axis,{margin:1})
  assert.deepEqual(ground.skipped,['within cap'])
  assert.deepEqual(ground.pieces.map(p=>p.sourceId),[undefined,'cap','pile'])
  const volumes=ground.pieces.map(p=>t.volume(p.preview.scene.children[0].geometry))
  close(volumes[1],16);close(volumes[2],4);close(volumes[0],6*6*6-20)
  const anchor=ground.pieces[1].preview.anchor
  close(anchor[axis],group.position[axis]-1);close(anchor.x,15000)
})
test('existing ground base clips cuts to its boundary and excludes a cutter entirely outside',()=>{
  const base=source('site',5,2,4,8,3,5),beam=source('beam',8,1,.5,8,2.5,5,'IFCBEAM'),out=source('out',1,1,1,80,2.5,5,'IFCPILE')
  const ground=t.makeGround([beam,out].map(s=>t.groundCutSource(s,'y')),base,'y',{margin:3})
  close(t.volume(ground.pieces[1].preview.scene.children[0].geometry),5*2*.5)
  assert.deepEqual(ground.skipped,['out']);assert.equal(base.object.geometry.index.count,36)
})

test('a pointed pile uses the head footprint for the full bore depth',()=>{
  const pile=new t.Mesh(new t.CylinderGeometry(.4,0,5,24))
  const cut=t.groundCutSource({id:'P1',name:'Pile',ifcType:'IfcPile',object:pile},'y')
  close(cut.top-cut.bottom,5);assert.equal(cut.rings[0].length,24)
})
