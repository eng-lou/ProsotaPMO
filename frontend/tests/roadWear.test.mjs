import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import * as THREE from 'three'

const {outputFiles} = await build({
  stdin: {contents: "export * from './roadWear'; export * from './footprintEdges'; export * from './surfaceWearGuides'; export * from './materialScope'; export * from './realisticMaterials'",
    resolveDir: fileURLToPath(new URL('../src/modules/fourD/',import.meta.url))},
  bundle:true,write:false,format:'esm',platform:'node'
})
const m=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const scale=new THREE.Vector3(1,1,1)
function paint(field,style,paths,area){
  const pixels=new Uint8Array(field.w*field.h*4)
  m.paintRoadWear(field,paths,style,pixels,area)
  return pixels
}
test('automatic wheel pairs reach all three arms of a T junction and follow the bend',()=>{
  const shape=new THREE.Shape().moveTo(0,0).lineTo(24,0).lineTo(24,4).lineTo(14,4).lineTo(14,16).lineTo(10,16).lineTo(10,4).lineTo(0,4).closePath()
  const field=m.footprintField(new THREE.ShapeGeometry(shape),scale)
  const style={...m.DEFAULT_ROAD_WEAR,wander:0,potholes:0}
  const pixels=paint(field,style,m.roadRoutes(field))
  function runs(x,y,dx,dy){
    let count=0,last=false
    for(let t=0;t<4;t+=.05){
      const i=(Math.floor((y+dy*t)/field.pitch)+3)*field.w+Math.floor((x+dx*t)/field.pitch)+3
      const hit=pixels[i*4+1]>10
      if(hit&&!last)count++
      last=hit
    }
    return count
  }
  assert.equal(runs(2,0,0,1),2)
  assert.equal(runs(22,0,0,1),2)
  assert.equal(runs(10,14,1,0),2)
  assert.equal(pixels[(Math.floor(8/field.pitch)*field.w+Math.floor(5/field.pitch))*4+1],0)
})
test('drawn routes, roughness and clipping use separate channels and are deterministic',()=>{
  const field=m.footprintField(new THREE.PlaneGeometry(12,8),scale)
  const route=[[{x:10,y:120},{x:350,y:120}]]
  const area=[{x:50,y:30},{x:200,y:30},{x:200,y:230},{x:50,y:230}]
  for(const mode of ['tracks','rough']){
    const style={...m.DEFAULT_ROAD_WEAR,mode,roughness:1,potholes:1}
    const pixels=paint(field,style,mode==='rough'?[]:route,area)
    assert.ok(pixels.some((value,i)=>i%4===1&&value>40))
    assert.deepEqual(pixels,paint(field,style,mode==='rough'?[]:route,area))
    for(let y=0;y<field.h;y+=3)for(let x=0;x<field.w;x+=3){
      if(x>=50&&x<200&&y>=30&&y<230)continue
      const i=(y*field.w+x)*4;assert.equal(pixels[i+1]+pixels[i+2]+pixels[i+3],0)
    }
  }
  assert.ok(paint(field,{...m.DEFAULT_ROAD_WEAR,potholes:0},[],[]).every(v=>v===0))
})
test('a narrow disconnected strip retains an opaque middle beside a broad pad',()=>{
  const g=new THREE.BufferGeometry()
  g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,20,0,0,20,10,0,0,10,0, 0,14,0,20,14,0,20,14.5,0,0,14.5,0],3))
  g.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);g.addGroup(0,6,0);g.addGroup(6,6,1)
  const field=m.footprintField(g,scale)
  for(const width of [.6,5]){
    const mask=m.footprintMask(field,{fade:width,radius:2})
    assert.equal(mask[(Math.floor(14.25/field.pitch)+3)*field.w+Math.floor(8/field.pitch)+3],255)
  }
  const narrow=m.footprintField(g,scale,1)
  assert.ok(narrow.h*narrow.pitch<1)
})
test('an overlay round-trips for one surface on one element independently of the base finish and guide geometry',()=>{
  const target=['tower','element:47'], base={pad:'stone',rim:'metal'}
  const wear={...m.DEFAULT_ROAD_WEAR,mode:'rough',area:'zone:yard',colour:'#978676',depthCm:7}
  const saved=JSON.parse(JSON.stringify(m.editMaterialFields(base,[target],{'roadWear:pad':JSON.stringify(wear)})))
  const guides=m.makeWearGuides([],[{id:'yard',name:'Yard',shape:'circle',points:[{x:3,y:2,z:0}],radius:5,elevation:1}],'z')
  const render={...saved,[m.WEAR_GUIDES]:guides}
  const scoped=m.mappingAtTarget(render,target), overlay=m.footprintEdgesForKey('pad',scoped)
  assert.equal(scoped.pad,'stone');assert.deepEqual(overlay.road,wear)
  assert.equal(overlay.guideMap.get(wear.area).points.length,64)
  assert.equal(m.footprintEdgesForKey('rim',scoped).road,undefined)
  assert.equal(m.footprintEdgesForKey('pad',m.mappingAtTarget(render,['tower','element:48'])).road,undefined)
})
