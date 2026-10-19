import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
async function load(file) {
 const {outputFiles}=await build({entryPoints:[new URL(`../src/modules/fourD/${file}.ts`,import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'})
 return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
}
const {buildStagedSchedule}=await load('scheduleGeneration')
const {prepareTowerStoreys,sequenceTower}=await load('towerSequencing')
const cat=(name,id,workstream)=>({name,elementRefs:[id],elementLabels:[id],quantity:20,materialVolumeM3:4,workstream})
const floors=Array.from({length:6},(_,i)=>({storeyName:`Level ${i}`,categories:[cat('Slabs',`slab${i}`),cat('Walls',`core${i}`,'core'),cat('Curtain Walls',`glass${i}`),cat('Ductwork',`duct${i}`)]}))
const generate=(opts,full=false,ss=floors)=>buildStagedSchedule('p','period',ss,{},'Tower',null,full,opts).staged
const reaches=(s,from,to)=>{
 const seen=new Set([from]);const q=[from]
 for(let i=0;i<q.length;i++) for(const r of s.relationships.filter(r=>r.predecessor_temp_id===q[i])) if(!seen.has(r.successor_temp_id)){seen.add(r.successor_temp_id);q.push(r.successor_temp_id)}
 return seen.has(to)
}
const ids=(s,f,c)=>s.activities.filter(a=>a.temp_id.startsWith(`act-${f}-${c}-`)).map(a=>a.temp_id)
for(const full of [false,true]) test(`tower conventional and advancing core are acyclic, full=${full}`,()=>{
 for(const lead of [1,3]){
 const s=generate({coreLeadFloors:lead,facadeLagFloors:2},full)
 assert(reaches(s,ids(s,0,0).at(-1),ids(s,0,1)[0]))
 assert(reaches(s,ids(s,0,1).at(-1),ids(s,1,0)[0]))
 assert.equal(reaches(s,ids(s,1,0).at(-1),ids(s,1,1)[0]),lead===1)
 assert(reaches(s,ids(s,1,0).at(-1),ids(s,3,1)[0]))
 assert(reaches(s,ids(s,2,0).at(-1),ids(s,0,2)[0]))
 assert(!reaches(s,ids(s,5,0).at(-1),ids(s,0,2)[0]))
 assert(reaches(s,ids(s,0,2).at(-1),ids(s,0,3)[0]))
 assert.deepEqual(s.activities.flatMap(a=>a.element_refs).sort(),floors.flatMap(f=>f.categories.flatMap(c=>c.elementRefs)).sort())
 }
})
test('default mode keeps legacy links and labels',()=>{
 const a=generate(undefined),b=buildStagedSchedule('p','period',floors,{},'Tower',null,false).staged
 assert.deepEqual(a,b)
 assert(reaches(a,ids(a,5,1).at(-1),ids(a,0,2)[0]))
})
test('merge intermediate levels and split reviewed core without losing quantities or links',()=>{
 const ss=[{storeyName:'Ground',categories:[cat('Slabs','slab'),{...cat('Walls','wall'),elementRefs:['wall','core'],elementLabels:['Wall','Core'],quantity:30,materialVolumeM3:6}]},{storeyName:'Stair landing',categories:[cat('Walls','landing')]}]
 const elements=[{globalId:'wall',ifcType:'IfcWall',quantity:20,volumeM3:4},{globalId:'core',ifcType:'IfcWallStandardCase',quantity:10,volumeM3:2},{globalId:'landing',ifcType:'IfcWall',quantity:20,volumeM3:4}]
 const before=JSON.stringify(ss)
 const out=prepareTowerStoreys(ss,elements,new Set(['core','landing']),{'Stair landing':'Ground'})
 assert.equal(out.length,1);assert.equal(out[0].categories.find(c=>c.workstream==='core').quantity,30)
 assert.equal(out[0].categories.find(c=>c.workstream==='core').materialVolumeM3,6)
 assert.equal(JSON.stringify(ss),before)
 assert.throws(()=>prepareTowerStoreys(ss,elements,new Set(['core']),{Ground:'Stair landing','Stair landing':'Ground'}),/loop/)
 assert.throws(()=>prepareTowerStoreys(ss,elements,new Set(),{}),/Select/)
 assert.throws(()=>prepareTowerStoreys(ss,elements,new Set(['slab']),{}),/walls/)
})
test('invalid tower assumptions fail before saving',()=>{
 for(const opts of [{coreLeadFloors:0,facadeLagFloors:2},{coreLeadFloors:1,facadeLagFloors:-1},{coreLeadFloors:1.5,facadeLagFloors:2}]) assert.throws(()=>generate(opts),/whole number/)
 assert.throws(()=>generate({coreLeadFloors:1,facadeLagFloors:2},false,[{storeyName:'Stair landing',categories:[cat('Walls','core','core')]}]),/supporting/)
})

test('tower facade phases link mullions before panels without counting assembly twice',()=>{
 const elements=[{globalId:'core',ifcType:'IfcWall',quantity:20,volumeM3:4}, ...[['parent','IfcCurtainWall'],['frame','IfcMember'],['panel','IfcPlate']].map(([globalId,ifcType])=>({globalId,ifcType,facadeAssemblyId:'parent'}))]
 const ss=[{storeyName:'Ground',categories:[cat('Slabs','slab'),cat('Walls','core'),{...cat('Curtain Walls','parent'),elementRefs:['parent','frame','panel'],elementLabels:['Assembly','Mullion','Glass'],quantity:3}]}]
 const prepared=prepareTowerStoreys(ss,elements,new Set(['core']),{})
 const s=generate({coreLeadFloors:1,facadeLagFloors:0},false,prepared)
 const frame=s.activities.find(a=>a.category==='Curtain Walls'&&a.phase_key==='frame')
 const glaze=s.activities.find(a=>a.category==='Curtain Walls'&&a.phase_key==='glaze')
 assert.equal(frame.quantity,1); assert.equal(glaze.quantity,1)
 assert.deepEqual(frame.element_refs,['frame']);assert.deepEqual(glaze.element_refs,['parent','panel'])
 assert(reaches(s,frame.temp_id,glaze.temp_id))
 assert.equal(s.activities.flatMap(a=>a.element_refs).length,5)
 const legacy=generate(undefined,false,prepared)
 assert.equal(legacy.activities.find(a=>a.category==='Curtain Walls'&&a.phase_key==='frame').element_refs.length,0)
})
import { createHash } from 'node:crypto'
test('standard recipe matches pre-change payloads, including full schedule',()=>{
 const hashes=['416e4bfeef29f0c5e1d15f9a530a2dd1829f99f18fd0052025121f4b983dc3d3','20c4b56d559262395414f8a55bea7d21078e9e762ad46a7fed3a851d60d4fa1c']
 for(const [index,full] of [false,true].entries()) assert.equal(createHash('sha256').update(JSON.stringify(generate(undefined,full))).digest('hex'),hashes[index])
})

test('buried services remain ahead of the slab above in tower mode',()=>{
 const foundation={storeyName:'Substructure',categories:[cat('Foundation','footing'),cat('Piping','drain')]}
 const s=generate({coreLeadFloors:3,facadeLagFloors:2},true,[foundation,...floors])
 const drain=s.activities.filter(a=>a.parent_temp_id==='wbs-storey-0'&&a.category==='Piping').at(-1)
 const slab=s.activities.find(a=>a.parent_temp_id==='wbs-storey-1'&&a.category==='Slabs')
 assert(reaches(s,drain.temp_id,slab.temp_id))
 assert(!reaches(s,slab.temp_id,drain.temp_id))
})

test('conflicting external dependencies are rejected rather than silently removed',()=>{
 const s=generate(undefined)
 const edge=(a,b)=>({predecessor_temp_id:a,successor_temp_id:b,relationship_type:'FS',lag_hours:0})
 assert.throws(()=>sequenceTower(s.activities,[...s.relationships,edge('act-construction-start','act-substantial-completion'),edge('act-substantial-completion','act-construction-start')],floors,{coreLeadFloors:1,facadeLagFloors:2}),/conflict/)
})
