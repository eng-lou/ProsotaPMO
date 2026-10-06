import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({
 entryPoints: [fileURLToPath(new URL('../src/modules/scheduling/useResourcesTabData.ts', import.meta.url))],
 bundle: true, write: false, format: 'esm', platform: 'browser',
 plugins: [{ name: 'no-network', setup(build) {
   build.onResolve({filter: /(?:^|\/)api$/}, () => ({path: 'api', namespace: 'stub'}))
   build.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export const api = {}'}))
 }}],
})
const { computeUsageProfileSeries: compute } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`).catch(error => { console.error(error.message); process.exit(1) })
const resource = {id: 'r', rate: '100', max_hours_per_day: '8'}
const buckets = Array.from({length: 7}, (_,i) => ({start: new Date(2011,i,1), end: new Date(2011,i+1,1), label: String(i)}))
const activity = {id:'a', status:'completed', start:'2011-01-01T00:00:00', finish:'2011-03-01T00:00:00', actual_start:'2011-01-01T00:00:00', actual_finish:'2011-03-01T00:00:00', ac:'5900', ev:'4720'}
const sum = a => a.reduce((s,v) => s+(v??0),0)
function series(a=activity, history=[], visible=buckets, unit='cost', duplicate=false) {
 const row = {activity:a, assignment:{id:'ra'}}
 return compute([resource],new Map([['r', duplicate?[row,row]:[row]]]),visible,new Map(),new Set(),unit,new Date(2011,4,15),history)
}
test('completed work before data date keeps all AC/EV in earlier months',()=>{
 const result=series()
 assert.equal(result.actualValues[4],null)
 assert.ok(Math.abs(sum(result.actualValues)-5900)<1e-8)
 assert.ok(Math.abs(sum(result.evValues)-4720)<1e-8)
 assert.ok(result.actualValues[0]>0 && result.actualValues[1]>0)
 assert.equal(result.estimatedPhasing,true)
})
test('in-progress totals end at data date and future periods stay blank',()=>{
 const result=series({...activity,status:'in_progress',actual_finish:null,finish:'2011-09-01T00:00:00'})
 assert.ok(result.actualValues[4]>0)
 assert.equal(result.actualValues[5],null)
 assert.ok(Math.abs(sum(result.actualValues)-5900)<1e-8)
})
test('zooming or clipping a range does not move all totals into the visible buckets',()=>{
 const full=series(), clipped=series(activity,[],[buckets[1]])
 assert.equal(clipped.actualValues[0],full.actualValues[1])
 assert.ok(sum(clipped.actualValues)<5900)
 const yearly=series(activity,[],[{start:new Date(2011,0,1),end:new Date(2012,0,1)}])
 assert.ok(Math.abs(sum(full.actualValues)-sum(yearly.actualValues))<1e-8)
})
test('recorded history on a bucket boundary is counted once, even after activity finish',()=>{
 const history=[{linked_activity_id:'a',baseline_date:'2011-02-01T00:00:00',ac:'2000',ev:'1600'}, {linked_activity_id:'a',baseline_date:'2011-04-01T00:00:00',ac:'5900',ev:'4720'}]
 const result=series(activity,history)
 assert.equal(result.actualValues[0],2000)
 assert.equal(result.actualValues[1],null)
 assert.equal(result.actualValues[3],3900)
 assert.equal(sum(result.actualValues),5900)
 assert.equal(result.estimatedPhasing,true)
})
test('EV can be shown without AC and duplicate assignments do not multiply totals',()=>{
 assert.equal(sum(series({...activity,ac:null}).evValues),4720)
 assert.equal(sum(series(activity,[],buckets,'days',true).actualValues),59)
})
test('zero duration completed work belongs to one bucket',()=>{
 const result=series({...activity,actual_start:'2011-02-01T00:00:00',actual_finish:'2011-02-01T00:00:00'})
 assert.equal(result.actualValues[0],null)
 assert.equal(result.actualValues[1],5900)
 assert.equal(sum(result.actualValues),5900)
})

test('a single cumulative snapshot after completion is reconstructed before the data date',()=>{
 const result=series(activity,[{linked_activity_id:'a',baseline_date:'2011-05-01T00:00:00',ac:'5900',ev:'4720'}])
 assert.ok(result.actualValues[0]>0 && result.actualValues[1]>0)
 assert.equal(result.actualValues[4],0)
 assert.ok(Math.abs(sum(result.actualValues)-5900)<1e-8)
})


test('tracking assignment figures match profile totals in every unit', () => {
  for (const unit of ['hours', 'days', 'cost']) {
    const result = series(activity, [], buckets, unit)
    assert.deepEqual(result.actualByAssignment.get('ra'), result.actualValues)
    assert.deepEqual(result.evByAssignment.get('ra'), result.evValues)
    assert.equal(result.actualByAssignment.get('ra')[5], null)
  }
})

test('multiple assignments of one activity do not duplicate tracking actuals or earned value', () => {
  const result = compute([resource], new Map([['r', [
    { activity, assignment: { id: 'first' } },
    { activity, assignment: { id: 'second' } },
  ]]]), buckets, new Map(), new Set(), 'cost', new Date(2011, 4, 15), [])
  assert.equal(result.actualByAssignment.has('second'), false)
  assert.deepEqual(result.actualByAssignment.get('first'), result.actualValues)
  assert.deepEqual(result.evByAssignment.get('first'), result.evValues)
})

test('tracking retains earned-only figures and recorded late actuals', () => {
  const earnedOnly = series({ ...activity, ac: null })
  assert.ok(earnedOnly.actualByAssignment.get('ra').every(v => v === null))
  assert.ok(sum(earnedOnly.evByAssignment.get('ra')) > 0)
  const result = series(activity, [
    { linked_activity_id: 'a', baseline_date: '2011-02-01T00:00:00', ac: '2000', ev: '1600' },
    { linked_activity_id: 'a', baseline_date: '2011-04-01T00:00:00', ac: '5900', ev: '4720' },
  ])
  assert.equal(result.actualByAssignment.get('ra')[3], 3900)
  assert.deepEqual(result.actualByAssignment.get('ra'), result.actualValues)
})
