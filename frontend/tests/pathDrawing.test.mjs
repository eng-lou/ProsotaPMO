import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/pathCurve';export * from './src/modules/fourD/pathDrawing';export {Ray,Vector3,CatmullRomCurve3} from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {appendPathPoint,materializePathSegments,setPathSegmentMode,pathSegmentCurve,buildPathCurve,samplePathCurve,constrainedPathPoint,togglePathAxis,Ray,Vector3,CatmullRomCurve3}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const p=(x,y,z=0)=>({x,y,z})
const near=(a,b)=>assert.ok(a.distanceTo(b)<1e-8,`${a.toArray()} != ${b.toArray()}`)
const ray=(origin,aim)=>new Ray(new Vector3(...origin),new Vector3(...aim).sub(new Vector3(...origin)).normalize())

test('Z lock intersects the actual height plane, and X + Z gives a Y-only line',()=>{
 const r=ray([20,-30,40],[6,8,2]),anchor=p(3,4,2)
 assert.deepEqual(constrainedPathPoint(r,anchor,['z']),p(6,8,2))
 const hit=constrainedPathPoint(r,anchor,['x','z'])
 assert.equal(hit.x,3);assert.equal(hit.z,2);assert.ok(hit.y>4)
})
test('all planes and axes work in either Y-up or Z-up worlds',()=>{
 const anchor=p(2,3,4),r=ray([30,40,50],[5,8,10])
 for(const locks of [['x'],['y'],['z'],['x','y'],['x','z'],['y','z']]){
  const hit=constrainedPathPoint(r,anchor,locks);assert.ok(hit)
  for(const axis of locks)assert.equal(hit[axis],anchor[axis])
 }
 assert.equal(constrainedPathPoint(ray([0,0,2],[1,0,2]),anchor,['z']),null)
 assert.equal(constrainedPathPoint(ray([0,0,2],[0,0,0]),anchor,['x','y']),null)
 assert.equal(constrainedPathPoint(ray([0,0,10],[0,0,20]),anchor,['z']),null)
})
test('locks can be changed between clicks but cannot lock all three axes',()=>{
 assert.deepEqual(togglePathAxis(['x','z'],'y'),['x','z'])
 assert.deepEqual(togglePathAxis(['x','z'],'x'),['z'])
 assert.deepEqual(togglePathAxis(['z'],'y'),['z','y'])
})
test('legacy open and closed curved paths retain every span when extended',()=>{
 const points=[p(0,0,2),p(10,0,4),p(13,9,3),p(-2,12,5)]
 for(const closed of [false,true]){
  const legacy=new CatmullRomCurve3(points.map(v=>new Vector3(v.x,v.y,v.z)),closed,'centripetal')
  const frozen=materializePathSegments(points,closed)
  const count=closed?4:3
  for(let i=0;i<count;i++)for(let j=0;j<=20;j++)near(pathSegmentCurve(frozen,(i+1)%4).getPoint(j/20),legacy.getPoint((i+j/20)/count))
  const extended=appendPathPoint(points,closed,'curved',p(-2,20,5),'straight')
  for(let i=1;i<points.length;i++)assert.deepEqual(extended[i],frozen[i])
 }
})
test('curve / straight / curve affects only the newly drawn segment',()=>{
 let points=[]
 for(const point of [p(0,0),p(10,0),p(10,10)])points=appendPathPoint(points,false,'curved',point,'curved')
 assert.ok(pathSegmentCurve(points,2).getPoint(.5).x>10,'curve blends from incoming heading')
 const frozen=structuredClone(points)
 points=appendPathPoint(points,false,'curved',p(20,10),'straight')
 assert.deepEqual(points.slice(0,3),frozen)
 near(pathSegmentCurve(points,3).getPoint(.5),new Vector3(15,10,0))
 points=appendPathPoint(points,false,'curved',p(20,20),'curved')
 assert.deepEqual(points.slice(0,3),frozen)
 assert.ok(pathSegmentCurve(points,4).getPoint(.5).x>20)
 const reload=JSON.parse(JSON.stringify(points)),curve=buildPathCurve(reload,false,'straight')
 assert.equal(curve.curves[1].type,'CubicBezierCurve3')
 assert.equal(curve.curves[2].type,'LineCurve3')
 for(let i=1;i<points.length-1;i++)for(let j=0;j<=20;j++)near(pathSegmentCurve(reload.slice(0,-1),i).getPoint(j/20),pathSegmentCurve(points,i).getPoint(j/20))
})
test('locking the next height also constrains curved handles after a sloping approach',()=>{
 const slope=[p(0,0,0),{...p(10,0,8),segment_mode:'straight'}]
 const next=appendPathPoint(slope,false,'curved',p(10,10,8),'curved',['z'])
 for(const v of pathSegmentCurve(next,2).getPoints(100))assert.ok(Math.abs(v.z-8)<1e-10)
 assert.equal(next[1].z,8)
})
test('editing one existing segment and moving a node preserve other segment choices',()=>{
 let points=materializePathSegments([p(0,0),p(10,0),p(10,10)],false)
 const before=structuredClone(points[1])
 points=setPathSegmentMode(points,2,'straight')
 assert.deepEqual(points[1],before)
 points=points.map((v,i)=>i===2?{...v,z:3}:v)
 near(pathSegmentCurve(points,2).getPoint(1),new Vector3(10,10,3))
 assert.ok(samplePathCurve(points,false).some(v=>v.equals(new Vector3(10,0,0))))
})
test('closed mixed path reaches its start and scrubbing is deterministic',()=>{
 const points=materializePathSegments([p(0,0),p(10,0),p(10,10)],true,'straight')
 const curve=buildPathCurve(setPathSegmentMode(points,2,'curved'),true)
 near(curve.getPointAt(1),new Vector3(0,0,0))
 const samples=[0,.25,.5,.75,1].map(t=>curve.getPointAt(t).toArray())
 for(let i=4;i>=0;i--)assert.deepEqual(curve.getPointAt(i/4).toArray(),samples[i])
})
