import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const { outputFiles } = await build({ stdin: { contents: "export { toFormValues, toActivityPatch } from './src/modules/scheduling/ActivityForm'; export {buildCalendarLookup} from './src/modules/scheduling/durationDisplay'", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' })
const { toFormValues, toActivityPatch, buildCalendarLookup } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
const calendars = buildCalendarLookup([{id:'eight', is_project_default:true, hours_per_day:'8'}, {id:'ten',hours_per_day:'10'}])
const activity = {id:'a',task_name:'New Activity',activity_type:'task',status:'planned',duration_hours:'8',pct_complete:'0',calendar_id:null,constraint_type:'mandatory_start',constraint_date:'2026-11-12T08:00:37',suspend_date:null,resume_date:null}
test('renaming sends only the label, never rounded dates or unchanged schedule inputs', () => {
 const values=toFormValues(activity,calendars)
 assert.deepEqual(toActivityPatch(activity,{...values,task_name:'Core L1-L2'},calendars),{task_name:'Core L1-L2'})
 assert.deepEqual(toActivityPatch(activity,values,calendars),{})
})
test('duration, calendar and status edits keep their required inputs', () => {
 const values=toFormValues(activity,calendars)
 assert.deepEqual(toActivityPatch(activity,{...values,duration_days:'3'},calendars),{duration_hours:24})
 assert.deepEqual(toActivityPatch(activity,{...values,calendar_id:'ten'},calendars),{calendar_id:'ten',duration_hours:10})
 assert.deepEqual(toActivityPatch(activity,{...values,status:'completed'},calendars),{status:'completed'})
})
