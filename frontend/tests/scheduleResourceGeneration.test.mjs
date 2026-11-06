import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const load = async name => {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(`../src/modules/scheduling/${name}.ts`, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
}
const { buildScheduleResourcePlan: generate } = await load('scheduleResourceGeneration')
const { buildDirectAssignments: assign } = await load('directResourceAssignment')
const task = (name, extra = {}) => ({ id: 'a', task_name: name, activity_type: 'task', duration_hours: '40', ...extra })
const resource = (id, name, type = 'crew', extra = {}) => ({ id, name, resource_type: type, unit: 'day', rate: '725', max_hours_per_day: '6', ...extra })

test('ordinary imported tasks generate a deduplicated pool and assign without IFC', () => {
  const activities = [task('Excavate foundations'), task('Excavate service trenches', { id: 'b' })]
  const plan = generate(activities, [])
  assert.deepEqual(plan.resources.map(r => r.name), ['Groundworks crew', 'Excavator', 'Dumper'])
  assert.ok(plan.resources.every(r => r.rate === 0))
  assert.equal(plan.assignments.length, 6)
  const pool = plan.resources.map((r, i) => resource(`saved-${i}`, r.name, r.resource_type))
  const next = generate(activities, pool)
  assert.ok(next.resources.every(r => r.existing_id && r.rate === 725 && r.max_hours_per_day === 6))
  const assigned = assign(activities, pool, [], next)
  assert.equal(assigned.assignments.length, 6)
  assert.equal(assign(activities, pool, assigned.assignments.map(a => ({activity_id:a.activity_id, resource_id:a.resource_temp_id})), next).assignments.length, 0)
})

test('foundations use the construction trade, not the system they will support', () => {
  for (const name of ['Electrical yard foundations and containment', 'Cooling plant foundations and equipment pads'])
    assert.deepEqual(generate([task(name)], []).resources.map(r => r.name), ['Concrete crew'])
  assert.deepEqual(generate([task('Campus power and telecom ductbanks')], []).resources.map(r => r.name), ['Electrical crew'])
})

test('uncertain work, milestones, procurement and curing are left for review', () => {
  const result = generate([task('Coordinate work'), task('Procure steel', {id:'b'}), task('Concrete cure and foundation release', {id:'c'}), task('Steel complete', {id:'d',activity_type:'finish_milestone',duration_hours:'0'})], [])
  assert.equal(result.resources.length, 0)
  assert.equal(result.issues.length, 3)
})

test('ambiguous existing crews are reported rather than duplicated', () => {
  const result = generate([task('Install electrical containment')], [resource('x','Electrical crew A'), resource('y','Electrical crew B')])
  assert.equal(result.resources.length, 0)
  assert.match(result.issues.join(' '), /choose Electrical crew/)
})

test('IFC phase recipes and measured materials still work', () => {
  const a = task('Install piles', {schedule_category:'Piling',schedule_phase_key:'install_piles',schedule_material_name:'Concrete C30',schedule_material_quantity:'12',schedule_material_unit:'m3',schedule_material_cost_per_unit:'180'})
  const plan = generate([a], [])
  assert.ok(plan.resources.some(r => r.name === 'Piling Rig'))
  const material = plan.resources.find(r => r.resource_type === 'material')
  assert.equal(material.name, 'Concrete C30')
  assert.equal(material.rate, 180)
  assert.equal(plan.assignments.find(r => r.resource_temp_id === material.temp_id).quantity, 12)
})

test('material quantities are never invented and incompatible units are not reused', () => {
  const a = task('Place material', {schedule_material_name:'Concrete C30',schedule_material_quantity:'12',schedule_material_unit:'m³'})
  assert.equal(generate([a], [resource('m','Concrete C30','material',{unit:'m3'})]).resources[0].existing_id, 'm')
  assert.equal(generate([a], [resource('m','Concrete C30','material',{unit:'kg'})]).resources.length, 0)
  assert.equal(generate([{...a,schedule_material_quantity:null}], []).resources.length, 0)
  const conflict = generate([a, {...a,id:'b',schedule_material_unit:'kg'}], [])
  assert.equal(conflict.resources.length, 1)
  assert.match(conflict.issues.join(' '), /conflicting types or units/)
})
