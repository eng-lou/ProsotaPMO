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
test('wall forms fit rotated walls on both axes and leave the window and doorway clear',()=>{
  const profile=new t.Shape([[-3,0],[-2.4,0],[-2.4,2],[-.8,2],[-.8,0],[3,0],[3,3.2],[-3,3.2]].map(([x,y])=>new t.Vector2(x,y)))
  profile.holes.push(new t.Path(rectangle(1.1,1).map(p=>p.add(new t.Vector2(1.6,1.7)))))
  for(const axis of ['y','z']){
    const mesh=new t.Mesh(new t.ExtrudeGeometry(profile,{depth:.28,bevelEnabled:false}))
    mesh.rotation.y=.45
    const group=new t.Group();group.add(mesh);group.position.set(11,23,34);group.rotation.x=axis==='z'?Math.PI/2:0
    const host=t.readConstructionHost('Wall W12',group,axis,'wallForm')
    const built=t.buildConstruction(host,{...options,mode:'wallForm',braceSide:'both',panelWidth:1})
    const faces=built.children.filter(g=>g.name.endsWith('panels'))
    assert.equal(faces.length,2)
    // Convert points on the original face to the generator's local axes.
    const local=(x,y)=>new t.Vector3(x,y,0).applyMatrix4(mesh.matrixWorld)
      .applyAxisAngle(new t.Vector3(1,0,0),axis==='z'?-Math.PI/2:0).sub(host.origin).applyAxisAngle(new t.Vector3(0,1,0),host.angle)
    const hits=(x,y)=>{
      const pt=local(x,y)
      const ray=new t.Raycaster(new t.Vector3(pt.x,pt.y,-3),new t.Vector3(0,0,1))
      return ray.intersectObjects(faces,true).length
    }
    built.updateMatrixWorld(true)
    assert.equal(hits(-1.65,1),0);assert.equal(hits(1.6,1.7),0)
    assert.ok(hits(-1.65,2.7)>=2);assert.ok(hits(1.6,.6)>=2)
    for(const [i,g] of faces.entries()){
      const bounds=new t.Box3().setFromObject(g),skin=new t.Box3().setFromObject(g.children.find(m=>m.material.name==='facing'))
      near(i===0?skin.min.z:skin.max.z,i===0?host.bounds.max.y:host.bounds.min.y)
      near(bounds.min.y,0);near(bounds.max.y,3.2)
    }
    assert.equal(built.children.filter(g=>g.name.includes('push-pull')).length,2)
    assert.ok(built.children.some(g=>g.name.includes('Through ties')))
    assert.ok(built.children.some(g=>g.name.includes('Stop ends')))
  }
})
test('wall formwork rejects non-prismatic wall selections',()=>{
  const mesh=new t.Mesh(new t.BoxGeometry(4,3,.3))
  const pos=mesh.geometry.getAttribute('position')
  for(let i=0;i<pos.count;i++)if(pos.getY(i)>0 && pos.getZ(i)>0)pos.setZ(i,.05)
  assert.throws(()=>t.readConstructionHost('Tapered wall',mesh,'y','wallForm'),/constant-thickness/)
})
test('wall forms and reinforcement offer separate editable activity templates',()=>{
  const rows=t.phaseRows('wallForm')
  const plan=t.buildSimulationActivities('p','s','wbs','',rows,'',true)
  assert.equal(plan.activities.length,rows.length)
  assert.equal(plan.relationships.length,rows.length-1)
  assert.deepEqual(rows.filter(r=>r.name.includes('Pour')).map(r=>r.name),['Pour wall concrete'])
  assert.ok(rows.at(-1).name.includes('Strip'))
  assert.ok(t.phaseRows('wall').some(r=>r.name.includes('curtain')))
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
