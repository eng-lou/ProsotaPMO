import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/climbingFormwork'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {climbHeight,climbWindows}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const day=86400000,base=Date.parse('2026-11-01T00:00:00Z'),iso=n=>new Date(base+n*day).toISOString()
const activities=[{id:'a',start:iso(2)},{id:'b',start:iso(5)},{id:'c',start:iso(9)}]
const config={axis:'z',reference_elevation:10,lifts:[0,3.4,7.8].map((height,i)=>({id:String(i),activity_id:activities[i].id,height,duration_hours:24,start:null,finish:null}))}
test('holds, climbs at defined intervals and reverse seeks without accumulated drift',()=>{
 for(const [time,height] of [[0,0],[3,0],[4.5,1.7],[5,3.4],[7,3.4],[8.5,5.6],[10,7.8],[4.5,1.7],[0,0]])assert.ok(Math.abs(climbHeight(config,activities,base+time*day)-height)<1e-8)
 assert.equal(climbHeight(JSON.parse(JSON.stringify(config)),activities,base+10*day),7.8)
})
test('schedule changes retime climbs; overrides stay fixed; invalid windows reject',()=>{
 const moved=activities.map(a=>a.id==='b'?{...a,start:iso(6)}:a);assert.equal(climbHeight(config,moved,base+5*day),0)
 const manual={...config,lifts:config.lifts.map(l=>l.id==='1'?{...l,start:iso(4),finish:iso(5)}:l)};assert.equal(climbHeight(manual,moved,base+5*day),3.4)
 assert.throws(()=>climbWindows(config,[]),/dated activity/)
 assert.throws(()=>climbWindows({...config,lifts:config.lifts.map(l=>({...l,duration_hours:100}))},activities),/overlap/)
 assert.equal(climbHeight(config,activities,NaN),0)
})
