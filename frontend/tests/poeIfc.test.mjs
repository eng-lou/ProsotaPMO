import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
async function load(file) {
  const {outputFiles} = await build({entryPoints:[new URL(`../src/modules/fourD/${file}.ts`,import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node',external:['./ifcModel']})
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
}
const {createPoeIfcTools} = await load('poeIfcTools')
const {modelInventory,validatePoeSchedule} = await load('poeSchedule')
function fixture() {
  const handle = {modelID:7}
  let models = [{handle,name:'Tower'}]
  const readers = {
    getTypeCounts:()=>[{typeName:'IfcWall',count:3}], getExpressIdsForType:()=>[3,1,2],
    getGuidFromExpressId:(_,id)=>`guid${id}`, getElementName:async(_,id)=>id===1?'Core':'External wall',
    buildElementStoreyMap:async()=>new Map([[1,{name:'Ground',elevationMetres:0}],[2,{name:'Level 1',elevationMetres:3}]]),
    getElementInfo:async(_,id)=>({expressID:id,globalId:`guid${id}`,type:'IfcWall',name:'Core',propertySets:[{name:'Pset_WallCommon',properties:[{name:'LoadBearing',value:'true'}]}]}),
  }
  return {readers, tools:createPoeIfcTools(()=>models,async()=>readers), unload:()=>{models=[]}}
}
test('reads a loaded model without schedule or selection; deterministic pagination and filters',async()=>{
  const {tools}=fixture()
  assert.equal((await tools.get_loaded_ifc_models()).models[0].model_id,7)
  const first=await tools.read_ifc_model({model_id:7,limit:2})
  assert.deepEqual(first.elements.map(e=>e.express_id),[1,2]);assert.equal(first.next_offset,2)
  const last=await tools.read_ifc_model({model_id:7,offset:2,limit:2})
  assert.deepEqual(last.elements.map(e=>e.express_id),[3]);assert.equal(last.total_matches,3)
  assert.equal((await tools.read_ifc_model({model_id:7,search:'core',storey:'ground'})).elements.length,1)
  assert.equal((await tools.read_ifc_model({model_id:7,ifc_type:'IfcSlab'})).elements.length,0)
  const info=await tools.read_ifc_model({model_id:7,express_id:1})
  assert.equal(info.property_sets[0].properties[0].value,'true')
})
test('rejects stale models and does not return results after unloading during a query',async()=>{
  const f=fixture();assert.match((await f.tools.read_ifc_model({model_id:8})).error,/no longer loaded/)
  f.readers.buildElementStoreyMap=async()=>{f.unload();return new Map()}
  assert.match((await f.tools.read_ifc_model({model_id:7})).error,/unloaded/)
  assert.deepEqual((await f.tools.get_loaded_ifc_models()).models,[])
})
const elements=[1,2].map(id=>({sourceModelId:7,expressID:id,globalId:`guid${id}`,name:`Wall ${id}`,ifcType:'IfcWall',category:'Walls',material:'concrete',storeyName:'Level 1',quantity:10}))
const groups=modelInventory(elements)
const context={projectId:'project',schedulePeriodId:'schedule',calendarId:null,rootName:'AI draft'}
const proposal=()=>({rationale:'Core before frame',assumptions:['Hours are preliminary crew estimates'],activities:[{temp_id:'core',task_name:'Build core',duration_hours:40,group_ids:['g1']},{temp_id:'release',task_name:'Release frame',duration_hours:8,group_ids:[]}],relationships:[{predecessor_temp_id:'core',successor_temp_id:'release'}]})
test('AI draft resolves verified GUIDs and labels into existing bulk-save payload, with no resources fabricated',()=>{
  const draft=validatePoeSchedule(proposal(),groups,context)
  assert.deepEqual(draft.staged.activities[1].element_refs,['guid1','guid2'])
  assert.deepEqual(draft.staged.activities[1].element_labels,['Wall 1','Wall 2'])
  assert.equal(draft.linked,2);assert.equal(draft.unassigned.length,0)
  assert.deepEqual(draft.staged.resources,[]);assert.equal(draft.staged.relationships[0].relationship_type,'FS')
})
test('individual references are scoped and omitted elements are reported',()=>{
  const p=proposal();p.activities[0].group_ids=[];p.activities[0].element_keys=['7:1']
  assert.equal(validatePoeSchedule(p,groups,context).unassigned[0].globalId,'guid2')
  p.activities[0].element_keys=['8:1'];assert.throws(()=>validatePoeSchedule(p,groups,context),/outside/)
})
test('invalid AI logic or identities cannot be saved',()=>{
  for(const [mutate,pattern] of [
    [p=>p.activities[1].group_ids=['g1'],/more than one/],
    [p=>p.activities[0].group_ids=['invented'],/unknown model group/],
    [p=>p.activities[1].temp_id='core',/Duplicate/],
    [p=>p.activities[0].duration_hours=NaN,/Hours/],
    [p=>p.relationships.push({predecessor_temp_id:'release',successor_temp_id:'core'}),/circular/],
    [p=>p.relationships[0].successor_temp_id='fake',/unknown activity/],
    [p=>p.activities[0].parent_temp_id='fake',/unknown activity/],
  ]){const p=proposal();mutate(p);assert.throws(()=>validatePoeSchedule(p,groups,context),pattern)}
})
