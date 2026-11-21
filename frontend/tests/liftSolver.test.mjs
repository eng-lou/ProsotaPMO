import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/liftSolver';export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {solveLift,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),q=()=>new T.Quaternion(),up=v(0,1,0)
const solve=(legs,corners=[],floor)=>solveLift(v(),q(),legs,up,1000,corners,floor)
const near=(a,b,t=.02)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`)
test('four-leg symmetric lift balances and shares weight',()=>{
 const legs=[[-1,-1],[1,-1],[-1,1],[1,1]].map(([x,z])=>({point:v(x,0,z),anchor:v(0,4,0),length:Math.sqrt(18)}));const r=solve(legs);assert.ok(r.valid,JSON.stringify(r));near(r.position.y,0);near(r.tensions.reduce((n,t)=>n+t*4/Math.sqrt(18),0),9.80665);assert.ok(r.tensions.every(t=>t>0));
})
test('two independent hooks tilt a load and reverse seek repeats exactly',()=>{
 const legs=[{point:v(-1,0,0),anchor:v(-1,4,0),length:4},{point:v(1,0,0),anchor:v(1,5,0),length:4}];const a=solve(legs),b=solve(legs);assert.ok(a.valid,JSON.stringify(a));assert.ok(a.rotation.angleTo(q())>.3);assert.deepEqual(a.position.toArray(),b.position.toArray());near(a.tensions.reduce((n,t)=>n+t,0),9.80665,.5)
})
test('long unused leg becomes slack and has zero tension',()=>{
 const legs=[{point:v(),anchor:v(0,4,0),length:4},{point:v(),anchor:v(1,4,0),length:8}];const r=solve(legs);assert.ok(r.valid,JSON.stringify(r));assert.equal(r.slack[1],true);near(r.tensions[1],0);near(r.tensions[0],9.80665)
})
test('landing support takes weight when slings are slack',()=>{
 const r=solve([{point:v(),anchor:v(0,4,0),length:8}],[v(-1,-1,-1),v(1,-1,-1),v(-1,-1,1),v(1,-1,1)],-1);assert.ok(r.valid,JSON.stringify(r));assert.ok(r.supported);near(r.position.y,0);near(r.tensions[0],0)
})
test('impossible hook separation reports failure',()=>{
 const r=solve([{point:v(-1,0,0),anchor:v(-10,4,0),length:1},{point:v(1,0,0),anchor:v(10,4,0),length:1}]);assert.equal(r.valid,false);assert.ok(r.error>.1)
})

test('long ropes take up slack and Z-up uses the same balance equations',()=>{
 const r=solveLift(v(),q(),[{point:v(),anchor:v(0,0,10),length:100}],v(0,0,1),250);
 assert.ok(r.valid,JSON.stringify(r));near(r.position.z,-90);near(r.tensions[0],2.4516625)
})
test('off-centre mass shifts load sharing',()=>{
 const r=solve([{point:v(-.5,0,0),anchor:v(-.5,4,0),length:4},{point:v(1.5,0,0),anchor:v(1.5,4,0),length:4}]);assert.ok(r.valid,JSON.stringify(r));near(r.tensions[0]/r.tensions[1],3,.05)
})
