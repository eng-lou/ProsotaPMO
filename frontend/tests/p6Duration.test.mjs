import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({ stdin: { contents: "export {toFormValues,toActivityPayload} from './src/modules/scheduling/ActivityForm'; export {buildCalendarLookup} from './src/modules/scheduling/durationDisplay'", resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })
const {toFormValues,toActivityPayload,buildCalendarLookup} = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
test('editing a P6 task with missing display days preserves original hours', () => {
  const calendars=buildCalendarLookup([{id:'calendar',is_project_default:true,hours_per_day:'8'}])
  const task={task_name:'Design Building Addition', activity_type:'task',status:'planned',calendar_id:'calendar',duration_hours:'120',duration_days:null}
  const values=toFormValues(task,calendars)
  assert.equal(values.duration_days,'15')
  values.task_name='Renamed'
  assert.equal(toActivityPayload(values,calendars,false,'planned').duration_hours,120)
})
