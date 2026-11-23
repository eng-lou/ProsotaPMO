import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/constructionHost';export * from './src/modules/fourD/constructionGeometry';export * from './src/modules/fourD/constructionActivities';export * from './src/modules/fourD/coreCycle';export * from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const t=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const options={spacing:.2,cover:.035,diameter:.016,doubleMat:true,screenHeight:7.2,bayWidth:2.4,clearance:3.424}
const rectangle=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>new t.Vector2(x,y))
const near=(a,b)=>assert.ok(Math.abs(a-b)<.00005,`${a} != ${b}`)
function slab(){
  const face=new t.Shape(rectangle(8,6))
  face.holes.push(new t.Path(rectangle(2,2).reverse()))
  return new t.Mesh(new t.ExtrudeGeometry(face,{depth:.24,bevelEnabled:false}).rotateX(-Math.PI/2))
}
test('rebar respects the slab opening, world axis, rotated footprint and base elevation',()=>{
  for(const axis of ['y','z']){
    const group=new t.Group(),s=slab();group.add(s);s.rotation.y=.33
    group.position.set(30,40,50);group.rotation.x=axis==='z'?Math.PI/2:0
    const host=t.readConstructionHost('L4 slab',group,axis)
    assert.equal(host.rings.length,2);near(host.height,.24)
    near(host.origin.y,axis==='z'?50:40)
    const ranges=t.spans(host.rings,true,0)
    assert.equal(ranges.length,2);near(ranges[0][1],-1);near(ranges[1][0],1)
    const mat=t.buildConstruction(host,{...options,mode:'mat'})
    assert.equal(mat.children.length,2);mat.updateMatrixWorld(true)
    const ray=new t.Raycaster(new t.Vector3(0,2,0),new t.Vector3(0,-1,0))
    assert.equal(ray.intersectObject(mat,true).length,0)
    const screens=t.constructionEdges(host)
    assert.equal(screens.length,4)
    const model=t.buildConstruction(host,{...options,mode:'screen',excludedEdges:new Set([screens[0].id])})
    assert.ok(model.children.length>4);assert.ok(model.children.some(g=>g.name.endsWith('shoes')))
    assert.ok(!model.children.some(g=>g.name.includes('Edge 1 bay')))
  }
})
test('column shutters follow its four faces and its cage includes projecting starter bars',()=>{
  const host=t.readConstructionHost('C4',new t.Mesh(new t.BoxGeometry(.70,3,.55)),'y')
  assert.equal(t.buildConstruction(host,{...options,mode:'shutter'}).children.length,4)
  const cage=t.buildConstruction(host,{...options,mode:'column'})
  assert.equal(cage.children.length,2)
  near(new t.Box3().setFromObject(cage).max.y,3.36)
})
test('adjacent slab selections trim full and partial shared screen edges only on the same floor',()=>{
  const host=(w,d,x,z,y)=>{
    const mesh=new t.Mesh(new t.BoxGeometry(w,.2,d))
    mesh.position.set(x,y,z)
    return t.readConstructionHost('Slab',mesh,'y')
  }
  const a=host(6,4,0,0,0),b=host(2,2,4,0,0),upper=host(2,2,4,0,3)
  const lengths=t.perimeterRuns([a,b,upper]).map(runs=>runs.reduce((sum,r)=>sum+r.length,0))
  assert.deepEqual(lengths,[18,6,8])
})
test('core activities support later assignments and matching by phase after renaming',()=>{
  const rows=t.phaseRows('core')
  rows[0].name='Raise boom and core deck'
  const plan=t.buildSimulationActivities('project','period','floor','',rows,'',false)
  assert.equal(plan.activities.length,rows.length)
  assert.equal(plan.parent_wbs_id,'floor')
  assert.equal(plan.relationships.length,0)
  assert.ok(plan.activities.every(a=>!a.element_refs&&!a.parent_temp_id))
  const activities=plan.activities.map(a=>({id:a.temp_id,parent_id:'floor',task_name:a.task_name,schedule_category:a.category,schedule_phase_key:a.phase_key}))
  const anchor=activities.find(a=>a.schedule_phase_key==='formwork_rebar')
  const phases=t.corePhases(anchor,activities)
  assert.equal(phases.climb_activity_id,rows[0].id)
  const ambiguous=[...activities,{...activities[3],id:'another-pour'}]
  assert.equal(t.corePhases(anchor,ambiguous).pour_activity_id,null)
  const existing={...anchor,schedule_category:'Walls',task_name:'L35 — Core walls — Erect'}
  assert.deepEqual(t.corePhases(existing,[existing,...activities.filter(a=>a!==anchor)]),phases)
})
test('wall reinforcement leaves an actual window opening clear through both curtains',()=>{
  const face=new t.Shape(rectangle(6,3));face.holes.push(new t.Path(rectangle(1.5,1).reverse()))
  const mesh=new t.Mesh(new t.ExtrudeGeometry(face,{depth:.30,bevelEnabled:false}))
  const host=t.readConstructionHost('Wall',mesh,'y',true)
  assert.equal(host.wallFace.length,2)
  const wall=t.buildConstruction(host,{...options,mode:'wall'});wall.updateMatrixWorld(true)
  const ray=new t.Raycaster(new t.Vector3(0,1.5,-2),new t.Vector3(0,0,1))
  assert.equal(ray.intersectObject(wall,true).length,0)
})
