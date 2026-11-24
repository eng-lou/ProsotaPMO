import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { outputFiles } = await build({
  stdin: { contents: "export * from './src/modules/fourD/scheduleGeneration'; export {classifyMaterial,extractScheduleElements} from './src/modules/fourD/ifcScheduleExtraction'; export {buildIfcScene} from './src/modules/fourD/ifcGeometryStream'", resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['web-ifc'], logOverride: { 'empty-import-meta': 'silent' },
})
const compiled = { exports: {} }
new Function('module', 'exports', 'require', outputFiles[0].text)(compiled, compiled.exports, createRequire(import.meta.url))
const { buildStagedSchedule, groupByLevel, classifyMaterial, resolveActivityPhase } = compiled.exports

function element(id, category, bottom, top, material, floor = 0) {
  const width = category === 'Slabs' ? 12 : .45
  return { name: id, globalId: id, ifcType: 'Ifc' + category.slice(0,-1), category, material, sourceModelId: 1,
    storeyName: 'Level '+(floor+1), storeyElevation: floor * 3,
    boxMinMetres: [0,bottom,0], boxMaxMetres: [width,top,width], quantity: 1, volumeM3: 1 }
}
function schedule(elements) {
  return buildStagedSchedule('project', 'live', groupByLevel(elements), {}, 'Frame', null, false).staged
}
function precedes(staged, first, second) {
  const queue = [first.temp_id], seen = new Set(queue)
  for (let i = 0; i < queue.length; i++) {
    for (const r of staged.relationships.filter(r => r.predecessor_temp_id === queue[i])) {
      if (r.successor_temp_id === second.temp_id) return true
      if (!seen.has(r.successor_temp_id)) { seen.add(r.successor_temp_id); queue.push(r.successor_temp_id) }
    }
  }
  return false
}

test('the bearing slab, lower columns, suspended slab and roof starters are linked in bearing order', () => {
  for (const upperFloor of [0, 1]) for (const axis of ['y','z']) {
    const elements = [
      element('deck', 'Slabs', 2.7, 3, 'unknown', upperFloor),
      element('starters', 'Columns', 3, 5.7, 'concrete', upperFloor),
      element('columns', 'Columns', 0, 2.7, 'concrete'),
      element('base', 'Slabs', -.3, 0, 'unknown'),
    ]
    if (axis === 'z') for (const e of elements) for (const v of [e.boxMinMetres,e.boxMaxMetres]) [v[1],v[2]] = [v[2],v[1]]
    const staged = schedule(elements)
    const placements = staged.activities.filter(a => a.element_refs.length)
    assert.deepEqual(placements.map(a=>a.element_refs), [['base'],['columns'],['deck'],['starters']])
    assert.ok(placements.every(a=>a.phase_key === 'rc_pour'))
    for (let i = 1; i < placements.length; i++) assert.ok(precedes(staged,placements[i-1],placements[i]))
    assert.ok(!staged.activities.some(a=>/bolt|erect steel|metal deck/i.test(a.task_name)))
  }
})

test('a suspended deck with no modelled base follows its supporting columns', () => {
  const staged = schedule([element('overhead','Slabs', 2.7,3,'concrete'),element('support','Columns',0,2.7,'concrete')])
  const rows = staged.activities.filter(a=>a.element_refs.length)
  assert.deepEqual(rows.map(a=>a.element_refs), [['support'],['overhead']])
  assert.ok(precedes(staged,rows[0],rows[1]))
})

test('assigned materials, precast families and composite decks generate distinct placement and resource phases', () => {
  const cases = [
    ['steel family','Columns',['Concrete, Cast-in-Place'],'concrete','rc_pour'],
    ['RC column','Columns',['Steel, S355'],'steel','erect'],
    ['Precast column','Columns',['Concrete'],'precast','pc_install'],
    ['Steel column','Columns',['Timber'],'other','install_frame'],
    ['Default floor','Slabs',[],'unknown','install_frame'],
    ['Concrete on metal deck','Slabs',['Concrete'],'composite','pour'],
  ]
  const elements = cases.map(([name,category,materials,method]) => {
    const material = classifyMaterial(name,materials,category)
    assert.equal(material,method,name)
    return element(name,category,0,category==='Slabs'?.3:3,material)
  })
  const staged = schedule(elements)
  for (const [name,category,,,key] of cases) {
    const rows = staged.activities.filter(a=>a.element_refs.includes(name))
    assert.equal(rows.length,1,name)
    assert.equal(rows[0].phase_key,key,name)
    if (key === 'rc_pour') assert.equal(resolveActivityPhase(category,key).rate.materialUnit,'m³')
    if (key === 'erect') assert.equal(resolveActivityPhase(category,key).rate.materialName,'Structural Steel')
  }
})

test('IFC authored in millimetres yields metre storey elevations, geometry and concrete quantities', async () => {
  const require = createRequire(import.meta.url)
  const { IfcAPI } = require(fileURLToPath(new URL('../node_modules/web-ifc/web-ifc-api-node.js',import.meta.url)))
  const fixture = readFileSync(new URL('../../desktop/tests/fixtures/wall.ifc',import.meta.url),'utf8')
    .replace('.LENGTHUNIT.,$,.METRE.', '.LENGTHUNIT.,.MILLI.,.METRE.')
    .replace('#13,2.,0.2)', '#13,2000.,200.)').replace('#6,#11,3.)','#6,#11,3000.)')
    .replace(/ENDSEC;\s*END-ISO/, [
      "#24=IFCBUILDINGSTOREY('0000000000000000000002',#23,'Upper',$,$,#9,$,$,.ELEMENT.,3000.);",
      "#25=IFCRELCONTAINEDINSPATIALSTRUCTURE('0000000000000000000003',#23,$,$,(#10),#24);",
      "#26=IFCMATERIAL('Concrete, Cast-in-Place');",
      "#27=IFCRELASSOCIATESMATERIAL('0000000000000000000004',#23,$,$,(#10),#26);",
      'ENDSEC;', 'END-ISO',
    ].join('\n'))
  const api = new IfcAPI()
  await api.Init()
  const id = api.OpenModel(Buffer.from(fixture))
  try {
    const { object, batch } = await compiled.exports.buildIfcScene(api,id,'mm-wall.ifc',null)
    const [wall] = await compiled.exports.extractScheduleElements({ api, object, batch, modelID: 1, ifcModelID: id })
    assert.equal(wall.storeyElevation,3)
    assert.equal(wall.material,'concrete')
    assert.ok(Math.abs(wall.volumeM3-1.2)<.0001)
    assert.ok(Math.abs(Math.max(...wall.boxMinMetres.map((v,i)=>wall.boxMaxMetres[i]-v))-3)<.0001)
  } finally {
    api.CloseModel(id)
    api.Dispose()
  }
})
