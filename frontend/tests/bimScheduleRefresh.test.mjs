import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {build} from 'esbuild'

// Exercise the refresh that the workspace actually calls, including its
// out-of-order response guard and state setters.
const source=readFileSync('src/modules/fourD/FourD.tsx','utf8').replace(/\r\n/g,'\n')
const start=source.indexOf('  const refreshSchedule = async () => {')
const refresh=source.slice(start,source.indexOf('\n  }',start)+4)
const {outputFiles}=await build({stdin:{contents:`
import {replaceEqualDeep} from '@tanstack/react-query';
export function make(api, state) {
 const selectedProject={id:'project'},period={id:'period'},scheduleRequestRef={current:0};
 const set=(key,value)=>{state[key]=typeof value==='function'?value(state[key]):value};
 const setActivities=v=>set('activities',v),setRelationships=v=>set('relationships',v),setResources=v=>set('resources',v);
 const setResourceAssignments=v=>set('assignments',v),setCalendars=v=>set('calendars',v),setScheduleLoading=v=>set('loading',v);
 ${refresh}
 return refreshSchedule;
}`,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'})
const {make}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text+'\n//# sourceURL=bim-schedule-refresh.js').toString('base64'))
const datasets=['activities','activity-relationships','resources','resource-assignments','calendars']
const fields=['activities','relationships','resources','assignments','calendars']
const clone=value=>JSON.parse(JSON.stringify(value))
const makeState=()=>Object.fromEntries(fields.map((key,index)=>[key,[{id:key,name:key,duration:index,custom:{value:'original'}}]]))

test('unchanged workspace refresh preserves all schedule references; changed duration and nested data propagate',async()=>{
 const state=makeState(),before={...state},data=clone(state)
 const refresh=make({get:async url=>({data:clone(data[fields[datasets.indexOf(url.split('/')[3])]])})},state)
 await refresh()
 for(const key of fields)assert.equal(state[key],before[key],`${key} should not invalidate downstream work`)
 data.activities[0].duration=12;data.activities[0].custom.value='updated'
 await refresh()
 assert.notEqual(state.activities,before.activities)
 assert.equal(state.activities[0].duration,12);assert.equal(state.activities[0].custom.value,'updated')
 assert.equal(before.activities[0].duration,0);assert.equal(before.activities[0].custom.value,'original')
 for(const key of fields.slice(1))assert.equal(state[key],before[key])
 data.relationships=[];await refresh();assert.deepEqual(state.relationships,[])
 assert.equal(state.loading,false)
})

test('a late refresh cannot overwrite a newer schedule',async()=>{
 const state=makeState(),older=clone(state),newer=clone(state);newer.activities[0].duration=42
 const pending=[];const refresh=make({get:url=>new Promise(resolve=>pending.push({url,resolve}))},state)
 const first=refresh(),second=refresh()
 for(const request of pending.slice(5))request.resolve({data:newer[fields[datasets.indexOf(request.url.split('/')[3])]]})
 await second;assert.equal(state.activities[0].duration,42)
 for(const request of pending.slice(0,5))request.resolve({data:older[fields[datasets.indexOf(request.url.split('/')[3])]]})
 await first;assert.equal(state.activities[0].duration,42);assert.equal(state.loading,false)
})

test('hidden BIM stops schedule/working-sequence requests and focus listeners; activation refreshes again',()=>{
 const hook=readFileSync('src/modules/simulator/useWorkingSequence.ts','utf8')
 const body=hook.match(/useEffect\(\(\)=>\{(if\(!active\)return;setError[\s\S]*?)\},\[refresh,active\]\)/)[1]
 const mount=new Function('active','refresh','window','generation','setError',body)
 const listeners=new Map(),generation={current:0};let requests=0
 const refresh=()=>requests++,window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}
 assert.equal(mount(false,refresh,window,generation,()=>{}),undefined)
 assert.equal(requests,0);assert.equal(listeners.size,0)
 const cleanup=mount(true,refresh,window,generation,()=>{})
 assert.equal(requests,1);listeners.get('focus')();assert.equal(requests,2)
 cleanup();assert.equal(listeners.size,0);assert.equal(generation.current,1,'in-flight response invalidated when hidden')
 mount(false,refresh,window,generation,()=>{});assert.equal(requests,2)
 mount(true,refresh,window,generation,()=>{})();assert.equal(requests,3)

 const queuedBody=source.match(/useEffect\(\(\)=>\{(if\(!active\)return;const timer=setTimeout\(\(\)=>void workingSequence.refresh\(\),400\);return\(\)=>clearTimeout\(timer\))\}/)[1]
 const queue=new Function('active','workingSequence','setTimeout','clearTimeout',queuedBody)
 let scheduled=0,cancelled=0
 assert.equal(queue(false,{refresh},()=>scheduled++,()=>cancelled++),undefined)
 assert.equal(scheduled,0)
 queue(true,{refresh},()=>scheduled++,()=>cancelled++)()
 assert.equal(scheduled,1);assert.equal(cancelled,1)
 const undoBody=source.match(/useEffect\(\(\) => \{ (if \(active && undoRevision\) refreshSchedule\(\)) \}, \[undoRevision\]\)/)[1]
 const undo=new Function('active','undoRevision','refreshSchedule',undoBody)
 undo(false,12,refresh);assert.equal(requests,3)
 undo(true,12,refresh);assert.equal(requests,4)
})
