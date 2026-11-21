import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/suspendedLoad'; export * from './src/modules/fourD/loadHandling'; export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {balanceSuspendedLoad,liftingPointWorld,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const setup=()=>{const world=new T.Group(),root=new T.Group();world.add(root);root.add(new T.Mesh(new T.BoxGeometry(4,4,.2),new T.MeshStandardMaterial()));return root}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`)
test('two eyes on one edge tilt the load while holding both sling endpoints',()=>{
 const root=setup(),h={events:[],lifting_points:[[-2,-2,0],[2,-2,0]],center_of_gravity:[0,0,0]};root.position.set(10,5,7);root.rotation.z=.4;root.scale.setScalar(2);root.updateWorldMatrix(true,true)
 const before=h.lifting_points.map(p=>liftingPointWorld(root,p)),matrix=root.matrix.clone();assert.equal(balanceSuspendedLoad(root,h,'z'),true)
 before.forEach((p,i)=>near(p.distanceTo(liftingPointWorld(root,h.lifting_points[i])),0));const cog=root.localToWorld(new T.Vector3()),mid=before[0].clone().add(before[1]).multiplyScalar(.5);near(cog.x,mid.x);near(cog.y,mid.y);near(cog.z,mid.z-4)
 const settled=root.matrixWorld.clone();matrix.decompose(root.position,root.quaternion,root.scale);balanceSuspendedLoad(root,h,'z');settled.elements.forEach((v,i)=>near(root.matrixWorld.elements[i],v))
})
test('single eye hangs centre below it; manual centre controls the pose',()=>{
 const root=setup(),h={events:[],lifting_points:[[2,0,0]],center_of_gravity:[0,1,0]};const p=liftingPointWorld(root,h.lifting_points[0]);balanceSuspendedLoad(root,h,'y');const centre=root.localToWorld(new T.Vector3(...h.center_of_gravity));near(centre.x,p.x);near(centre.z,p.z);near(centre.y,p.y-Math.sqrt(5));near(p.distanceTo(liftingPointWorld(root,h.lifting_points[0])),0)
})
test('fixed orientation, four eyes, degenerate and missing named supports stay unchanged',()=>{
 for(const h of [{events:[],balance_mode:'fixed',lifting_points:[[1,0,0]]},{events:[],lifting_points:[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]]},{events:[],lifting_points:[[1,0,0],[1,0,0]]},{events:[],lifting_points:[[1,0,0]],lifting_nodes:['missing']}]){const root=setup();assert.equal(balanceSuspendedLoad(root,h,'z'),false);near(root.quaternion.angleTo(new T.Quaternion()),0)}
})
test('named articulated eyes stay fixed and geometry centre provides fallback',()=>{
 const root=setup();for(const [i,x] of [-2,2].entries()){const eye=new T.Group();eye.name='Eye'+i;eye.position.set(x,-2,0);root.add(eye)}
 const h={events:[],lifting_points:[[0,0,0],[0,0,0]],lifting_nodes:['Eye0','Eye1']};const before=h.lifting_points.map((p,i)=>liftingPointWorld(root,p,h.lifting_nodes[i]));balanceSuspendedLoad(root,h,'z');before.forEach((p,i)=>near(p.distanceTo(liftingPointWorld(root,h.lifting_points[i],h.lifting_nodes[i])),0));assert.ok(root.localToWorld(new T.Vector3()).z<-1.9)
})
