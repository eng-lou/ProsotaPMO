import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/siteAnimation'; export * from './src/modules/fourD/siteAnimationRender'; export * from './src/modules/fourD/animationDefaults'; export * as THREE from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {resolveSiteLinks,applySiteAnimation,DEFAULT_ANIMATION_CONFIG:defaults,THREE}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const activities=[{id:'install',start:'2026-10-01',finish:'2026-10-11',animation_profile_id:'fade'},{id:'remove',start:'2026-10-21',finish:'2026-10-31',animation_profile_id:'out'}]
const profiles=[{id:'fade',config:{...defaults}},{id:'out',config:{...defaults,opacity_from:1,opacity_to:0,color_from:'#ff0000'}},{id:'move',config:{...defaults,opacity_from:1,transform_kind:'translate',axis:'z',distance:10}}]
const links=[{source_kind:'site',element_ref:'cabin',activity_id:'install',animation_profile_id:null},{source_kind:'site',element_ref:'cabin',activity_id:'remove',animation_profile_id:null}]
const resolve=(ls=links,ps=profiles)=>resolveSiteLinks('cabin',ls,activities,ps)
function fixture(){const root=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:'#123456'});root.add(new THREE.Mesh(new THREE.BoxGeometry(),mat));return {root,mat,originals:new WeakMap(),base:new THREE.Vector3(20,30,40)}}
function at(f,date,resolved=resolve(),hasLinks=true){applySiteAnimation(f.root,f.base,resolved,hasLinks,date?new Date(date):null,false,true,f.originals)}
test('installation/removal reuse profiles, restore authored materials and reverse scrubbing',()=>{
 const f=fixture()
 for(const [date,opacity] of [['2026-09-30',0],['2026-10-06',.5],['2026-10-15',1],['2026-11-01',0],['2026-10-26',.5],['2026-10-15',1],['2026-10-06',.5]]){
  at(f,date); assert.equal(f.mat.opacity,opacity);assert.equal(f.root.visible,opacity>0)
 }
 at(f,'2026-10-15');assert.equal(f.mat.color.getHexString(),'123456');assert.equal(f.mat.transparent,false)
 at(f,'2026-10-06');at(f,'2026-10-06',[],false);assert.equal(f.mat.opacity,1);assert.equal(f.mat.color.getHexString(),'123456')
})
test('link override wins, world movement resets and does not affect another instance',()=>{
 const f=fixture(),other=fixture(),resolved=resolve([{...links[0],animation_profile_id:'move'}])
 assert.equal(resolved[0].profile.transform_kind,'translate')
 at(f,'2026-10-06',resolved);assert.notDeepEqual(f.root.position.toArray(),f.base.toArray());assert.equal(other.mat.color.getHexString(),'123456')
 at(f,null,resolved);assert.deepEqual(f.root.position.toArray(),f.base.toArray());assert.equal(f.mat.color.getHexString(),'123456')
})
test('grow clipping and scale restore safely after unlink',()=>{
 for(const kind of ['grow','scale','rotate','fall','pop','spiral']) {
  const f=fixture(),resolved=resolve([links[0]],[{id:'fade',config:{...defaults,transform_kind:kind,distance:10}}])
  at(f,'2026-10-06',resolved)
  if(kind==='grow')assert.equal(f.mat.clippingPlanes.length,1)
  at(f,null,[],false);assert.equal(f.mat.clippingPlanes,null);assert.deepEqual(f.root.scale.toArray(),[1,1,1]);assert.deepEqual(f.root.position.toArray(),f.base.toArray())
 }
})
test('missing dates/profile cannot accidentally animate; source identity is scoped',()=>{
 assert.equal(resolveSiteLinks('cabin',[{...links[0],source_kind:'mesh'}],activities,profiles).length,0)
 assert.equal(resolveSiteLinks('cabin',links,[],profiles).length,0)
 assert.equal(resolve([{...links[0],animation_profile_id:'missing'}]).length,0)
 const f=fixture();at(f,'2026-10-06',[],true);assert.equal(f.root.visible,false)
})
test('stagger order stable by site position and supports reverse',()=>{
 const ls=[links[0],{...links[0],element_ref:'second'}],items=[{id:'cabin',kind:'asset',position:{x:0,y:0,z:0},up_axis:'z'},{id:'second',kind:'asset',position:{x:10,y:0,z:0},up_axis:'z'}]
 const ps=[{id:'fade',config:{...defaults,stagger:.5}}]
 assert.equal(resolveSiteLinks('cabin',ls,activities,ps,items)[0].staggerFraction,0)
 assert.equal(resolveSiteLinks('second',ls,activities,ps,items)[0].staggerFraction,1)
 ps[0].config.stagger_reverse=true
 assert.equal(resolveSiteLinks('cabin',ls,activities,ps,items)[0].staggerFraction,1)
})
