import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
const {outputFiles}=await build({entryPoints:['src/modules/fourD/comparisonSelection.ts'],bundle:true,write:false,platform:'node',format:'esm'})
const {paneCollectionIds,resolvePaneScopeIds}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const scope=id=>({scope_mode:'wbs',wbs_node_activity_id:id})
const activities=[{id:'w1',activity_type:'wbs_summary'},{id:'w2',activity_type:'wbs_summary',parent_id:'w1'},{id:'a',parent_id:'w1'},{id:'b',parent_id:'w2'},{id:'c',parent_id:'w3'},{id:'d'}]
test('multiple nested WBS and UDF scopes form a deduplicated union',()=>{
 const config={scopes:[scope('w1'),scope('w2'),{scope_mode:'udf',udf_field_definition_id:'f',udf_value:'yes'}]}
 assert.deepEqual([...resolvePaneScopeIds(config,activities,(_,id)=>id==='c'?{value_text:'yes'}:undefined)].sort(),['a','b','c'])
 assert.deepEqual([...resolvePaneScopeIds(JSON.parse(JSON.stringify(config)),activities,(_,id)=>id==='c'?{value_text:'yes'}:undefined)].sort(),['a','b','c'])
})
test('legacy selections remain valid; cleared and incomplete selections stay empty',()=>{
 assert.deepEqual(paneCollectionIds({collectionId:'old'}),['old'])
 assert.deepEqual(paneCollectionIds({collectionId:'old',collectionIds:[]}),[])
 assert.deepEqual(paneCollectionIds({collectionIds:['one','two','one']}),['one','two'])
 assert.deepEqual([...resolvePaneScopeIds({scope:scope('w2')},activities,()=>undefined)],['b'])
 assert.equal(resolvePaneScopeIds({scope:{scope_mode:'all'},scopes:[]},activities,()=>undefined).size,0)
 assert.equal(resolvePaneScopeIds({scopes:[scope(null),{scope_mode:'udf'}]},activities,()=>undefined).size,0)
})
