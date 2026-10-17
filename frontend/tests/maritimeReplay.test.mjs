import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
const {outputFiles}=await build({entryPoints:[fileURLToPath(new URL('../src/modules/maritime/portPlayback.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'})
const {readTrack,assetTrack,flowAt,portLayout,vesselPosition}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const segment=(start,end,value,rate,state)=>({start,end,value,rate,state,reason:state,call_id:null})
const tracks=[segment(0,8,0,30,'working'),segment(8,14,240,0,'unavailable'),segment(14,20,240,30,'working')]

test('scrubbing across outage boundaries freezes quantity and resumes exactly',()=>{
  assert.equal(readTrack(tracks,7.5).value,225)
  for(const t of [8,10,13.999]){assert.equal(readTrack(tracks,t).value,240);assert.equal(readTrack(tracks,t).rate,0);assert.equal(readTrack(tracks,t).state,'unavailable')}
  assert.equal(readTrack(tracks,14).rate,30)
  assert.equal(readTrack(tracks,15).value,270)
  assert.equal(readTrack(tracks,40).value,420)
  assert.equal(readTrack(tracks,40).rate,0)
  assert.equal(readTrack(tracks,-1).value,0)
  assert.equal(readTrack([],0),null)
})

test('a truncated run stays blocked and legacy aggregates never fabricate asset movement',()=>{
  const asset={id:'v',kind:'vessel'},plan={assets:[asset],calls:[{id:'c',vessel_id:'v',arrival_hour:0}]}
  const result={status:'horizon_reached',elapsed_hours:10,calls:[{id:'c',finish_hour:null}],replay:{available:true,tracks:{'call:c':[segment(0,10,0,0,'blocked')]}}}
  assert.equal(assetTrack(asset,plan,result,10).state,'blocked')
  result.replay.available=false
  result.samples=[{hour:0,handled:0,yard_moves:0,gate_cleared:0},{hour:5,handled:20,yard_moves:5,gate_cleared:15}]
  assert.equal(assetTrack(asset,plan,result,8).state,'ready')
  assert.equal(assetTrack(asset,plan,result,8).value,0)
  assert.deepEqual(flowAt(result,plan,8),{handled:20,yard:5,cleared:15})
})

test('layout uses shared IDs and saved placement without modifying source records',()=>{
  const plan={assets:[{id:'b',kind:'berth'},{id:'v',kind:'vessel'},{id:'c',kind:'crane',placement:{x:4,z:5,heading:90}}],calls:[{id:'call',vessel_id:'v',berth_id:'b',crane_ids:['c']}]}
  const before=JSON.stringify(plan),layout=portLayout(plan)
  assert.deepEqual(layout.c,{x:4,z:5,heading:90})
  assert.deepEqual(Object.keys(layout),['b','v','c'])
  assert.deepEqual(vesselPosition(plan.assets[1],plan,null,0,layout),[layout.v.x,0,layout.v.z])
  assert.equal(JSON.stringify(plan),before)
})

test('repeat vessel calls select current call and completed unloading is explicit',()=>{
  const asset={id:'v',kind:'vessel'},plan={assets:[asset],calls:[{id:'c1',vessel_id:'v',arrival_hour:0},{id:'c2',vessel_id:'v',arrival_hour:20}]}
  const result={status:'complete',elapsed_hours:30,calls:[{id:'c1',finish_hour:10},{id:'c2',finish_hour:30}],replay:{available:true,tracks:{'call:c1':[segment(0,30,300,0,'complete')],'call:c2':[segment(0,20,0,0,'scheduled'),segment(20,30,0,30,'handling')]}}}
  assert.equal(assetTrack(asset,plan,result,15).call_id,'c2')
  assert.equal(assetTrack(asset,plan,result,25).value,150)
  assert.equal(assetTrack(asset,plan,result,30).state,'complete')
  assert.equal(assetTrack(asset,plan,result,30).value,300)
})
