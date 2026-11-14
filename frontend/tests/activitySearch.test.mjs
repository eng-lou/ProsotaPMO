import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles} = await build({stdin:{contents:"export * from './src/modules/fourD/activitySearch'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {searchActivityIds} = await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const rows = [
 {id:'root',parent_id:null,code:'P-1',task_name:'Tower'},
 {id:'wbs',parent_id:'root',code:'W-1',task_name:'Groundworks'},
 {id:'a',parent_id:'wbs',code:'T-004',task_name:'Clear Vegetation'},
 {id:'b',parent_id:'root',code:'T-005',task_name:'Concrete'},
]
test('name and code search retains ancestors, ignores case and surrounding spaces',()=>{
 for(const query of [' vegetation ', 't-004']) assert.deepEqual([...searchActivityIds(rows,query)],['a','wbs','root'])
 assert.equal(searchActivityIds(rows,'  '),null)
 assert.equal(searchActivityIds(rows,'missing').size,0)
})
test('search respects isolation scope and handles cyclic parents',()=>{
 assert.equal(searchActivityIds(rows,'Concrete',new Set(['root','wbs','a'])).size,0)
 const cycle=[{...rows[0],parent_id:'wbs'},rows[1],rows[2]]
 assert.deepEqual([...searchActivityIds(cycle,'T-004')],['a','wbs','root'])
})
