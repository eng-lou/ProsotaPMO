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
const { exportIntegratedIfc, normalizeStepRealExponents } = require(outfile)
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

test('Synchro restores original model-to-task links and preserves nonvisual resource data', async () => withApi(async api => {
  const input = { ...data(), compatibility: 'synchro' }
  input.links = [input.links[0], input.links[0], { ...input.links[0], activity_id: 'a' }]
  input.resources.push({ ...input.resources[0], id: 'crew', resource_type: 'crew', name: 'Excavation Crew' })
  input.assignments.push({ ...input.assignments[0], id: 'crew-assignment', resource_id: 'crew' })
  const result = await exportIntegratedIfc(api, [source('legacy.ifc', wallA, { schema: 'IFC2X3' })], input)
  const model = api.OpenModel(result.bytes)
  assert.equal(lines(api, model, W.IFCLABORRESOURCE).length, 0)
  assert.equal(lines(api, model, W.IFCCREWRESOURCE).length, 0)
  assert.equal(lines(api, model, W.IFCTASK).length, 2)
  assert.equal(lines(api, model, W.IFCRELSEQUENCE).length, 1)
  assert.equal(api.LoadAllGeometry(model).size(), 1)
  assert.equal(lines(api, model, W.IFCRELASSIGNSTOPRODUCT).length, 0)
  const modelLinks = lines(api, model, W.IFCRELASSIGNSTOPROCESS)
  assert.equal(modelLinks.length, 2)
  assert.deepEqual(modelLinks.map(r => api.GetLine(model, r.RelatingProcess.value).TaskId.value).sort(), ['a', 'b'])
  for (const rel of modelLinks) {
    assert.equal(rel.RelatedObjects.length, 1, 'duplicate model links are deduplicated')
    assert.equal(api.GetLine(model, rel.RelatedObjects[0].value).GlobalId.value, wallA)
  }
  const sets = lines(api, model, W.IFCPROPERTYSET).filter(p => p.Name.value.startsWith('Prosota_ResourceAssignment_'))
  assert.equal(sets.length, 2)
  for (const set of sets) {
    const rel = lines(api, model, W.IFCRELDEFINESBYPROPERTIES).find(r => r.RelatingPropertyDefinition.value === set.expressID)
    assert.equal(api.GetLine(model, rel.RelatedObjects[0].value).TaskId.value, 'b')
    const props = set.HasProperties.map(p => api.GetLine(model, p.value))
    const assignment = JSON.parse(props.find(p => p.Name.value === 'assignment').NominalValue.value)
    assert.deepEqual(assignment, input.assignments.find(a => a.id === assignment.id))
  }
  assert.ok(result.warnings.some(w => w.includes('not editable')))
  await assert.rejects(exportIntegratedIfc(api, [source('modern.ifc', wallA)], input), /requires IFC2X3/)
  input.assignments[0].resource_id = 'missing'
  await assert.rejects(exportIntegratedIfc(api, [source('legacy.ifc', wallA, { schema: 'IFC2X3' })], input), /cannot be resolved/)
}))

for (const schema of ['IFC2X3', 'IFC4']) test(`${schema}: separate solid and axis contexts without changing geometry`, async () => withApi(async api => {
  const input = source('axis-and-body.ifc', wallA, { schema })
  input.bytes = new TextEncoder().encode(new TextDecoder().decode(input.bytes)
    .replace('(#17));', '(#25,#17));')
    .replace('#17=IFCSHAPEREPRESENTATION', "#24=IFCPOLYLINE((#4,#7));\n#25=IFCSHAPEREPRESENTATION(#5,'Axis','Curve3D',(#24));\n#17=IFCSHAPEREPRESENTATION"))
  const result = await exportIntegratedIfc(api, [input], { ...data(), links: [] })
  const model = api.OpenModel(result.bytes)
  const reps = lines(api, model, W.IFCSHAPEREPRESENTATION)
  const body = reps.find(r => r.RepresentationIdentifier.value === 'Body')
  const axis = reps.find(r => r.RepresentationIdentifier.value === 'Axis')
  assert.notEqual(body.ContextOfItems.value, axis.ContextOfItems.value)
  for (const rep of [body, axis]) {
    const context = api.GetLine(model, rep.ContextOfItems.value)
    assert.equal(context.type, W.IFCGEOMETRICREPRESENTATIONSUBCONTEXT)
    assert.equal(context.ContextIdentifier.value, rep.RepresentationIdentifier.value)
    assert.equal(context.ParentContext.value, 5)
    assert.equal(context.TargetView.value, 'MODEL_VIEW')
  }
  assert.equal(body.Items[0].value, 15)
  assert.equal(axis.Items[0].value, 24)
  assert.equal(api.LoadAllGeometry(model).size(), 1)
}))

function checkProductOutputs(api, model) {
  const outputs = lines(api, model, W.IFCRELASSIGNSTOPRODUCT).filter(r => r.Name.value === 'Prosota model elements')
  assert.deepEqual(outputs.map(r => api.GetLine(model, r.RelatingProduct.value).GlobalId.value).sort(), [wallA, wallB])
  for (const output of outputs) {
    assert.ok(output.RelatedObjects.length)
    for (const task of output.RelatedObjects) assert.equal(api.GetLine(model, task.value).type, W.IFCTASK)
  }
  const inputs = lines(api, model, W.IFCRELASSIGNSTOPROCESS)
  assert.equal(inputs.filter(r => r.Name.value === 'Prosota model elements').length, 0)
  assert.ok(inputs.some(r => r.Name.value === 'Prosota resource assignment'))
  for (const input of inputs) for (const object of input.RelatedObjects) {
    assert.notEqual(api.GetLine(model, object.value).type, W.IFCWALL)
  }
}

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
  checkProductOutputs(api, model)
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
  checkProductOutputs(api, model)
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

test('clinic architecture and converted structure combine without losing geometry', { skip: !process.env.PROSOTA_IFC_ARCH_FILE || !process.env.PROSOTA_IFC_TEST_FILE }, async () => withApi(async api => {
  const sources = [process.env.PROSOTA_IFC_ARCH_FILE, process.env.PROSOTA_IFC_TEST_FILE].map(name => ({name, bytes:new Uint8Array(readFileSync(name))}))
  let expectedGeometry = 0
  for (const s of sources) { const m=api.OpenModel(s.bytes); expectedGeometry += api.LoadAllGeometry(m).size(); api.CloseModel(m) }
  const d=data(); d.links=[]
  const result=await exportIntegratedIfc(api,sources,d)
  const m=api.OpenModel(result.bytes)
  assert.equal(api.LoadAllGeometry(m).size(), expectedGeometry)
  assert.equal(lines(api,m,W.IFCPROJECT).length,1)
  api.CloseModel(m)
}))

test('copied high-precision REAL measures reach the browser writer as numbers', async () => withApi(async api => {
  const second = source('converted.ifc', wallB)
  second.bytes = new TextEncoder().encode(new TextDecoder().decode(second.bytes).replace('#7=IFCCARTESIANPOINT((0.,0.,0.));', '#7=IFCCARTESIANPOINT((-37.993750000000027,28.380000000000098,4.6799999999959017));'))
  const originalWrite = api.WriteLine.bind(api)
  const check = value => {
    if (Array.isArray(value)) value.forEach(check)
    else if (value && typeof value === 'object' && value.type === W.REAL && 'internalValue' in value) {
      assert.equal(typeof value.internalValue, 'number', 'browser WASM rejects string REAL values')
    }
  }
  api.WriteLine = (model, line) => { Object.values(line).forEach(check); originalWrite(model, line) }
  const result = await exportIntegratedIfc(api, [source('first.ifc', wallA), second], data())
  const m = api.OpenModel(result.bytes)
  const wall = lines(api,m,W.IFCWALL).find(w=>w.GlobalId.value===wallB)
  const point = api.GetLine(m,api.GetLine(m,api.GetLine(m,wall.ObjectPlacement.value).RelativePlacement.value).Location.value)
  assert.deepEqual(point.Coordinates.map(v=>v.value), [-37.993750000000027,28.380000000000098,4.6799999999959017])
  assert.equal(api.LoadAllGeometry(m).size(), 2)
  api.CloseModel(m)
}))

test('STEP exponent normalization preserves quoted strings and comments', () => {
  assert.equal(normalizeStepRealExponents("#1=X(1E-09,-2e+10,1.2E-9,'1E-09 and ''2e10''',/* 3E-9 */1E9);"),
    "#1=X(1.E-09,-2.E+10,1.2E-9,'1E-09 and ''2e10''',/* 3E-9 */1.E9);")
})
