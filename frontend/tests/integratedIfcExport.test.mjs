import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { rmSync, readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const W = require('web-ifc')
const outfile = fileURLToPath(new URL(`.ifc-export-${process.pid}.cjs`, import.meta.url))
await build({ entryPoints: [fileURLToPath(new URL('../src/modules/fourD/integratedIfcExport.ts', import.meta.url))], outfile, bundle: true, format: 'cjs', platform: 'node', external: ['web-ifc'] })
const { exportIntegratedIfc } = require(outfile)
rmSync(outfile)

function source(name, wallGuid, { schema = 'IFC4', prefix = '$', offset = 0, projectGuid = '0000000000000000000000' } = {}) {
  // Two fixtures intentionally reuse every EXPRESS id. Geometry has to be
  // remapped, not overwritten; translations must remain distinct.
  return { name, bytes: new TextEncoder().encode(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'),'2;1');
FILE_NAME('test.ifc','2026-10-05T12:00:00',('Tester'),('Test'),'Test','Test','');
FILE_SCHEMA(('${schema}'));
ENDSEC;
DATA;
#1=IFCPROJECT('${projectGuid}',${schema === 'IFC2X3' ? '#23' : '$'},'Project',$,$,$,$,(#5),#3);
#2=IFCSIUNIT(*,.LENGTHUNIT.,${prefix},.METRE.);
#3=IFCUNITASSIGNMENT((#2));
#4=IFCCARTESIANPOINT((0.,0.,0.));
#5=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#6,$);
#6=IFCAXIS2PLACEMENT3D(#4,$,$);
#7=IFCCARTESIANPOINT((${offset}.,0.,0.));
#8=IFCAXIS2PLACEMENT3D(#7,$,$);
#9=IFCLOCALPLACEMENT($,#8);
#10=IFCWALL('${wallGuid}',${schema === 'IFC2X3' ? '#23' : '$'},'Wall',$,$,#9,#16,$${schema === 'IFC2X3' ? '' : ',.NOTDEFINED.'});
#11=IFCDIRECTION((0.,0.,1.));
#12=IFCCARTESIANPOINT((0.,0.));
#13=IFCAXIS2PLACEMENT2D(#12,$);
#14=IFCRECTANGLEPROFILEDEF(.AREA.,$,#13,2.,0.2);
#15=IFCEXTRUDEDAREASOLID(#14,#6,#11,3.);
#16=IFCPRODUCTDEFINITIONSHAPE($,$,(#17));
#17=IFCSHAPEREPRESENTATION(#5,'Body','SweptSolid',(#15));
${schema === 'IFC2X3' ? `#19=IFCPERSON($,$,'Tester',$,$,$,$,$);
#20=IFCORGANIZATION($,'Test',$,$,$);
#21=IFCPERSONANDORGANIZATION(#19,#20,$);
#22=IFCAPPLICATION(#20,'1','Test ${offset}','Test ${offset}');
#23=IFCOWNERHISTORY(#21,#22,$,.ADDED.,$,$,$,1791201600);` : ''}
ENDSEC;
END-ISO-10303-21;`) }
}
const wallA = '0000000000000000000001', wallB = '0000000000000000000002'
const activity = (id, parent_id = null) => ({ id, parent_id, code: id, task_name: `Pour 'roof' \\ café 🏗 ${id}`, commentary: null,
  activity_type: 'task', duration_hours: 8, start: '2026-10-05T08:00:00', finish: '2026-10-05T17:00:00',
  actual_start: null, actual_finish: null, remaining_duration_hours: 4, free_float_hours: 0, total_float_hours: -2,
  is_critical: true, pct_complete: '50', status: 'in_progress', calendar_id: 'calendar' })
const data = () => ({ project: { id: 'p', name: 'Test project' }, schedulePeriodId: 's', costPeriodId: 'c', currency: 'GBP', exportedAt: '2026-10-05T12:00:00Z',
  activities: [activity('a'), activity('b', 'a')], relationships: [{ predecessor_id: 'a', successor_id: 'b', relationship_type: 'FS', lag_hours: -2 }],
  resources: [{ id: 'r', resource_type: 'labour', name: 'Team', rate: '250', unit: 'day' }],
  assignments: [{ id: 'ra', resource_id: 'r', activity_id: 'b', utilisation_pct: '50', quantity: null, budget: '125' }],
  calendars: [{ id: 'calendar', name: 'Week', day_start_time: '08:00:00', day_end_time: '17:00:00', is_project_default: true, works_monday: true, works_tuesday: true, works_wednesday: true, works_thursday: true, works_friday: true }],
  breaks: [{ calendar_id: 'calendar', start_time: '12:00:00', end_time: '13:00:00' }], exceptions: [],
  costs: [{ code: 'C1', description: 'Concrete', scope_note: null, bac: '1000', actuals: '400', forecast: '1100', linked_activity_id: 'b' }],
  links: [{ activity_id: 'b', source_kind: 'ifc', element_ref: wallA }, { activity_id: 'a', source_kind: 'ifc', element_ref: wallB }] })
async function withApi(fn) { const api = new W.IfcAPI(); await api.Init(); try { await fn(api) } finally { api.Dispose() } }
function lines(api, model, type) { const v = api.GetLineIDsWithType(model, type); return Array.from({ length: v.size() }, (_, i) => api.GetLine(model, v.get(i))) }

test('combined IFC reopens with geometry, native planning, currencies and remapped element links', async () => withApi(async api => {
  const result = await exportIntegratedIfc(api, [source('a.ifc', wallA), source('b.ifc', wallB, { offset: 25 })], data())
  assert.deepEqual(result.warnings, [])
  const model = api.OpenModel(result.bytes)
  assert.equal(lines(api, model, W.IFCPROJECT).length, 1)
  assert.equal(lines(api, model, W.IFCWALL).length, 2)
  const walls = lines(api, model, W.IFCWALL)
  const positions = walls.map(w => api.GetLine(model, api.GetLine(model, api.GetLine(model, w.ObjectPlacement.value).RelativePlacement.value).Location.value).Coordinates[0].value)
  assert.deepEqual(positions.sort((a,b) => a-b), [0, 25], new TextDecoder().decode(result.bytes).split('\n').filter(l => l.includes('IFCCARTESIANPOINT')).join('\n'))
  assert.equal(api.LoadAllGeometry(model).size(), 2)
  const tasks = lines(api, model, W.IFCTASK)
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].Name.value, data().activities[0].task_name)
  const time = api.GetLine(model, tasks[0].TaskTime.value)
  assert.equal(time.Completion.value, 0.5)
  assert.equal(time.ScheduleDuration.value, 'PT8H')
  assert.equal(time.TotalFloat.value, '-PT2H')
  const sequence = lines(api, model, W.IFCRELSEQUENCE)[0]
  assert.equal(sequence.SequenceType.value, 'FINISH_START')
  assert.equal(api.GetLine(model, sequence.TimeLag.value).LagValue.value, '-PT2H')
  assert.equal(lines(api, model, W.IFCLABORRESOURCE).length, 1)
  assert.equal(lines(api, model, W.IFCCOSTITEM).length, 1)
  assert.equal(lines(api, model, W.IFCMONETARYUNIT)[0].Currency.value, 'GBP')
  const process = lines(api, model, W.IFCRELASSIGNSTOPROCESS).filter(r => r.Name.value === 'Prosota model elements')
  const linkedWalls = process.flatMap(r => r.RelatedObjects.map(h => api.GetLine(model, h.value).GlobalId.value)).sort()
  assert.deepEqual(linkedWalls, [wallA, wallB])
  // Every serialized reference resolves, including second-model geometry.
  const v = api.GetAllLines(model), present = new Set(Array.from({ length: v.size() }, (_, i) => v.get(i)))
  function check(value) { if (Array.isArray(value)) value.forEach(check); else if (value && typeof value === 'object') { if (value.type === W.REF) assert.ok(present.has(value.value), `dangling #${value.value}`); else Object.values(value).forEach(check) } }
  for (const id of present) check(api.GetRawLineData(model, id).arguments)
  api.CloseModel(model)
}))
test('mixed source units fail rather than corrupting model scale', async () => withApi(async api => {
  await assert.rejects(exportIntegratedIfc(api, [source('m.ifc', wallA), source('mm.ifc', wallB, { prefix: '.MILLI.' })], data()), /different project units/)
}))
test('duplicate linked GlobalIds fail rather than assigning a task to the wrong element', async () => withApi(async api => {
  await assert.rejects(exportIntegratedIfc(api, [source('a.ifc', wallA), source('b.ifc', wallA)], data()), /Duplicate linked IFC GlobalId/)
}))
test('missing and split links are reported, not silently discarded', async () => withApi(async api => {
  const d = data(); d.links.push({ activity_id: 'b', source_kind: 'ifc_split', element_ref: `${wallA}::split:1` })
  const result = await exportIntegratedIfc(api, [source('a.ifc', wallA)], d)
  assert.ok(result.warnings.some(w => w.includes('could not be resolved')))
  assert.ok(result.warnings.some(w => w.includes('split links')))
}))
test('invalid resource references stop the export', async () => withApi(async api => {
  const d = data(); d.assignments[0].resource_id = 'missing'
  await assert.rejects(exportIntegratedIfc(api, [source('a.ifc', wallA)], d), /resource assignment cannot be resolved/)
}))

test('IFC2X3 combines geometry and exports native tasks, dates, lags, resources and cost associations', async () => withApi(async api => {
  const d = data()
  d.calendars.push({...d.calendars[0], id: 'unused', name: 'Unused retained calendar', is_project_default: false})
  for (const type of ['crew', 'equipment', 'material', 'subcontractor', 'cost']) {
    d.resources.push({ id: type, resource_type: type, name: type, rate: '10', unit: 'day' })
    d.assignments.push({ id: type, resource_id: type, activity_id: 'b', utilisation_pct: '25', quantity: '3', budget: '30' })
  }
  const result = await exportIntegratedIfc(api, [source('old-a.ifc', wallA, {schema: 'IFC2X3'}), source('old-b.ifc', wallB, {schema: 'IFC2X3', offset: 25})], d)
  const model = api.OpenModel(result.bytes)
  assert.equal(api.GetModelSchema(model), 'IFC2X3')
  assert.equal(api.LoadAllGeometry(model).size(), 2)
  assert.equal(lines(api, model, W.IFCPROJECT).length, 1)
  assert.equal(lines(api, model, W.IFCTASK).length, 2)
  assert.equal(lines(api, model, W.IFCTASK)[0].Name.value, d.activities[0].task_name)
  const time = lines(api, model, W.IFCSCHEDULETIMECONTROL)[0]
  assert.equal(time.ScheduleDuration.value, 28800)
  assert.equal(time.TotalFloat.value, -7200)
  assert.equal(time.Completion.value, .5)
  const start = api.GetLine(model, time.ScheduleStart.value)
  assert.equal(api.GetLine(model, start.TimeComponent.value).HourComponent.value, 8)
  assert.equal(api.GetLine(model, start.DateComponent.value).DayComponent.value, 5)
  assert.equal(lines(api, model, W.IFCRELASSIGNSTASKS).length, 2)
  assert.equal(lines(api, model, W.IFCRELSEQUENCE)[0].TimeLag.value, -7200)
  assert.equal(lines(api, model, W.IFCMONETARYUNIT)[0].Currency.value, 'GBP')
  assert.equal(lines(api, model, W.IFCRELASSOCIATESAPPLIEDVALUE).length, 9)
  assert.ok(lines(api, model, W.IFCPROPERTYSET).some(p => p.Name.value === 'Prosota_Calendar'))
  assert.ok(result.warnings.some(w => w.includes('IFC2X3')))
  const text = new TextDecoder().decode(result.bytes)
  assert.doesNotMatch(text, /IFCTASKTIME\(|IFCWORKCALENDAR\(|IFCRELDECLARES\(|IFCRESOURCETIME\(/)
  const ids = api.GetAllLines(model), present = new Set(Array.from({length: ids.size()}, (_, i) => ids.get(i)))
  const check = value => { if (Array.isArray(value)) value.forEach(check); else if (value && typeof value === 'object') { if (value.type === W.REF) assert.ok(present.has(value.value), `dangling #${value.value}`); else Object.values(value).forEach(check) } }
  for (const id of present) check(api.GetRawLineData(model, id).arguments)
  if (process.env.PROSOTA_IFC_OUTPUT) {
    const {writeFileSync} = await import('node:fs')
    writeFileSync(process.env.PROSOTA_IFC_OUTPUT, result.bytes)
  }
  api.CloseModel(model)
}))

test('mixed schemas are rejected explicitly without corrupting source models', async () => withApi(async api => {
  await assert.rejects(exportIntegratedIfc(api, [source('old.ifc', wallA, {schema: 'IFC2X3'}), source('new.ifc', wallB)], data()), /mix IFC2X3 and IFC4/)
}))

test('IFC2X3 durations respect conversion-based hour units', async () => withApi(async api => {
  const s = source('hours.ifc', wallA, {schema: 'IFC2X3'})
  s.bytes = new TextEncoder().encode(new TextDecoder().decode(s.bytes).replace('#3=IFCUNITASSIGNMENT((#2));', `#3=IFCUNITASSIGNMENT((#2,#24));
#24=IFCCONVERSIONBASEDUNIT(#25,.TIMEUNIT.,'hour',#26);
#25=IFCDIMENSIONALEXPONENTS(0,0,1,0,0,0,0);
#26=IFCMEASUREWITHUNIT(IFCTIMEMEASURE(3600.),#27);
#27=IFCSIUNIT(*,.TIMEUNIT.,$,.SECOND.);`))
  const result = await exportIntegratedIfc(api, [s], data())
  const m = api.OpenModel(result.bytes)
  assert.equal(lines(api, m, W.IFCSCHEDULETIMECONTROL)[0].ScheduleDuration.value, 8)
  assert.equal(lines(api, m, W.IFCRELSEQUENCE)[0].TimeLag.value, -2)
  api.CloseModel(m)
}))

test('real IFC source retains its geometry when combined with a second copy', { skip: !process.env.PROSOTA_IFC_TEST_FILE }, async () => withApi(async api => {
  const bytes = new Uint8Array(readFileSync(process.env.PROSOTA_IFC_TEST_FILE))
  const original = api.OpenModel(bytes)
  const geometryCount = api.LoadAllGeometry(original).size()
  const propertyValues = (model) => lines(api, model, W.IFCPROPERTYSINGLEVALUE).map(p => JSON.stringify([p.Name.value, p.NominalValue?.value ?? null])).sort()
  const originalProperties = propertyValues(original)
  const productCount = lines(api, original, W.IFCWALL).length
  api.CloseModel(original)
  const d = data(); d.links = []
  const result = await exportIntegratedIfc(api, [{ name: 'discipline-a.ifc', bytes }, { name: 'discipline-b.ifc', bytes }], d)
  assert.ok(!new TextDecoder().decode(result.bytes).includes('(nan'))
  const model = api.OpenModel(result.bytes)
  assert.equal(lines(api, model, W.IFCPROJECT).length, 1)
  assert.equal(lines(api, model, W.IFCWALL).length, productCount * 2)
  assert.equal(api.LoadAllGeometry(model).size(), geometryCount * 2)
  const copiedProperties = propertyValues(model)
  for (const value of new Set(originalProperties)) {
    assert.ok(copiedProperties.filter(p => p === value).length >= originalProperties.filter(p => p === value).length * 2, `Lost source property ${value}`)
  }
  const rootIds = api.GetLineIDsWithType(model, W.IFCROOT, true)
  const guids = Array.from({ length: rootIds.size() }, (_, i) => api.GetLine(model, rootIds.get(i)).GlobalId.value)
  assert.equal(new Set(guids).size, guids.length)
  api.CloseModel(model)
}))
