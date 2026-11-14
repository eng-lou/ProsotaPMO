import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles} = await build({stdin:{contents:"export * from './src/modules/fourD/timelineScheduleUpdate'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {scheduleBindingKey,updateResolvedSchedule} = await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const activity = {id:'a',start:'2026-01-01',finish:'2026-01-05',bl_start:'2025-01-01',bl_finish:'2025-01-05',animation_profile_id:null}
const links=[{activity_id:'a',animation_profile_id:null}]
test('date and name edits reuse bindings; profile, missing dates and removal require rebuilding',()=>{
 const key=scheduleBindingKey([activity],links,false)
 assert.equal(scheduleBindingKey([{...activity,task_name:'Changed',finish:'2026-02-01'}],links,false),key)
 for (const changed of [{...activity,animation_profile_id:'grow'},{...activity,start:null}]) assert.notEqual(scheduleBindingKey([changed],links,false),key)
 assert.notEqual(scheduleBindingKey([],links,false),key)
})
test('date updates preserve geometry, material, stagger and link identity at model scale',()=>{
 const profile={transform_kind:'grow'}
 const targets=Array.from({length:20000},()=>({links:[{activityId:'a',activity:{start:activity.start,finish:activity.finish},startMs:0,finishMs:0,profile,staggerFraction:.4}],get object(){throw Error('date edits must not touch geometry')}}))
 const link=targets[0].links[0],updated={...activity,finish:'2026-02-10'}
 const start=performance.now();updateResolvedSchedule(targets,[updated],false)
 console.log(`20,000 existing timeline links updated in ${(performance.now()-start).toFixed(1)} ms`)
 assert.equal(targets[0].links[0],link)
 for (const target of targets) {
  assert.equal(target.links[0].finishMs,new Date(updated.finish).getTime())
  assert.equal(target.links[0].profile,profile)
  assert.equal(target.links[0].staggerFraction,.4)
 }
 updateResolvedSchedule(targets,[updated],true)
 assert.equal(link.finishMs,new Date(activity.bl_finish).getTime())
})
