import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
const {outputFiles}=await build({entryPoints:[new URL('../src/modules/fourD/towerDetection.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'})
const {detectTowerGroups}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
function fixture(axis=2){
 const box=(x,y,z)=>axis===2?[x,y,z]:[x,z,y]
 const element=(globalId,ifcType,category,z,min,max)=>({globalId,ifcType,category,name:globalId,storeyName:`Floor ${z/3}`,storeyElevation:z,sourceModelId:1,boxMinMetres:box(...min),boxMaxMetres:box(...max),quantity:1,volumeM3:0})
 const elements=[0,3,6].flatMap(z=>[
 element('slab'+z,'IfcSlab','Slabs',z,[-10,-10,z],[10,10,z+.2]),
 element('stairs'+z,'IfcStairFlight','Stairs',z,[-2,-2,z],[2,2,z+3]),
 element('wall'+z,'IfcWall','Walls',z,[-2.2,-2,z],[-2,2,z+3]),
 element('partition'+z,'IfcWall','Non-Structural Walls',z,[5,3,z],[5.2,8,z+3]),
 element('glass'+z,'IfcPlate','Curtain Walls',z,[-10,-10,z],[-9.9,10,z+3])])
 elements.push(element('lattice','IfcMember','Structural Members',0,[9.8,-10,0],[10,10,9]))
 const storeys=[0,3,6].map(z=>({storeyName:`Floor ${z/3}`,categories:[{name:'Slabs',elementRefs:['slab'+z]}]}))
 storeys.splice(1,0,{storeyName:'Landing',categories:[{name:'Walls',elementRefs:[]}]})
 return {elements,storeys}
}
for(const axis of [1,2])test(`detects repeated core walls, known glazing and uncertain lattice with axis ${axis}`,()=>{
 const {elements,storeys}=fixture(axis);const before=JSON.stringify(elements)
 const r=detectTowerGroups(elements,storeys)
 assert.deepEqual(r.coreIds,['wall0','wall3','wall6'])
 assert.deepEqual(r.facadeIds,['glass0','glass3','glass6'])
 assert(r.uncertain.some(e=>e.id==='lattice'));assert(!r.facadeIds.includes('lattice'))
 assert.equal(r.levelMap.Landing,'Floor 0');assert.equal(r.facadeLevels.lattice,'Floor 2')
 assert.equal(JSON.stringify(elements),before)
})
test('does not guess a core from generic wall names alone',()=>{
 const {elements,storeys}=fixture();const r=detectTowerGroups(elements.filter(e=>e.category!=='Stairs'),storeys)
 assert.deepEqual(r.coreIds,[])
})
