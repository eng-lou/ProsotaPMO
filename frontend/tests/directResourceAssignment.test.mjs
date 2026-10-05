import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/modules/scheduling/directResourceAssignment.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' })
const { buildDirectAssignments: assign } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const task = (name, extra = {}) => ({ id: 'a', task_name: name, activity_type: 'task', duration_hours: '40', ...extra })
const resource = (id, name, type = 'crew', extra = {}) => ({ id, name, resource_type: type, unit: 'day', rate: '250', max_hours_per_day: '8', ...extra })
const empty = { resources: [], assignments: [] }
test('assigns the existing pool without IFC and is repeatable', () => {
  const pool = [resource('crew', 'Groundworks crew'), resource('plant', '20t excavator', 'equipment')]
  const result = assign([task('Excavate foundations')], pool, [], empty)
  assert.deepEqual(result.assignments.map(a => a.resource_temp_id), ['crew', 'plant'])
  assert.deepEqual(result.resources.map(r => r.existing_id), ['crew', 'plant'])
  assert.equal(assign([task('Excavate foundations')], pool, result.assignments.map(a => ({activity_id: a.activity_id, resource_id: a.resource_temp_id})), empty).assignments.length, 0)
})
test('ambiguous crews and flat package allowances are not guessed', () => {
  const result = assign([task('Install electrical containment')], [resource('1', 'Electrical crew'), resource('2', 'Electrical crew B'), resource('3', 'Electrical allowance', 'subcontractor')], [], empty)
  assert.equal(result.assignments.length, 0)
  assert.match(result.issues.join(' '), /choose electrical/)
})
test('procurement, summaries, archived tasks and milestones are excluded', () => {
  const pool = [resource('1', 'Steel crew')]
  for (const a of [task('Procure steel'), task('Steel', { activity_type: 'wbs' }), task('Steel', { is_archived: true }), task('Steel', { duration_hours: '0' })]) assert.equal(assign([a], pool, [], empty).assignments.length, 0)
})
test('pile caps do not get piling crews; commissioning does not get installation crews', () => {
  const pool = [resource('c', 'Concrete crew'), resource('p', 'Piling crew'), resource('e', 'Electrical crew'), resource('q', 'Commissioning crew')]
  assert.deepEqual(assign([task('Construct pile caps')], pool, [], empty).assignments.map(a => a.resource_temp_id), ['c'])
  assert.deepEqual(assign([task('Electrical commissioning')], pool, [], empty).assignments.map(a => a.resource_temp_id), ['q'])
})
test('IFC exact matches retain existing IDs and edited rates', () => {
  const recipe = {resources: [{temp_id: 'r', name: 'Special crew', resource_type: 'crew', unit: 'day', rate: 10}], assignments: [{activity_id: 'a', resource_temp_id: 'r'}]}
  const result = assign([task('Install frame')], [resource('saved', 'Special crew', 'crew', { rate: '725' })], [], recipe)
  assert.equal(result.resources[0].existing_id, 'saved')
  assert.equal(result.resources[0].rate, 725)
})
test('materials require a measured quantity and matching units', () => {
  const pool = [resource('m', 'Concrete C30', 'material', { unit: 'm3' })]
  const a = task('Place slab', {schedule_material_name: 'Concrete C30', schedule_material_quantity: '12', schedule_material_unit: 'm3'})
  assert.equal(assign([a], pool, [], empty).assignments[0].quantity, 12)
  assert.equal(assign([{...a, schedule_material_unit: 'kg'}], pool, [], empty).assignments.length, 0)
  assert.equal(assign([{...a, schedule_material_quantity: null}], pool, [], empty).assignments.length, 0)
})
