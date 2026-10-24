
import * as THREE from 'three'
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { arraySourceSnapshot, disposeArraySnapshot } from './arraySourceSnapshot'
import { checkSolid, type BooleanResult } from './shapeBoolean'
const LIMIT=20000
export function prepareTerrain(source:THREE.Object3D, up:'y'|'z'):BooleanResult {
  const group=arraySourceSnapshot(source,up,'Terrain',false)
  try{
    if(group.children.length!==1)throw Error('Choose a single solid surface for terrain editing. Union multiple solids first.')
    const mesh=group.children[0] as THREE.Mesh
    checkSolid(mesh.geometry)
    const geometry=mesh.geometry.clone();geometry.computeBoundingBox()
    const box=geometry.boundingBox!,centre=box.getCenter(new THREE.Vector3()),anchor=new THREE.Vector3(centre.x,box.min.y,centre.z)
    geometry.translate(-anchor.x,-anchor.y,-anchor.z)
    const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material]
    return {name:'Terrain',mesh:new THREE.Mesh(geometry,Array.isArray(mesh.material)?mats.map(m=>m.clone()):mesh.material.clone()),position:anchor.applyAxisAngle(new THREE.Vector3(1,0,0),up==='z'?Math.PI/2:0)}
  }finally{disposeArraySnapshot(group)}
}
export function subdivideTerrain(source:THREE.BufferGeometry) {
  const g=source.index?source.toNonIndexed():source.clone(),count=g.getAttribute('position').count
  if(count/3*4>LIMIT){g.dispose();throw Error('Subdivision would exceed 20,000 triangles. Use a smaller solid or simplify first.')}
  const result=new THREE.BufferGeometry()
  const weights=[[1,0,0],[.5,.5,0],[.5,0,.5],[.5,.5,0],[0,1,0],[0,.5,.5],[.5,0,.5],[0,.5,.5],[0,0,1],[.5,.5,0],[0,.5,.5],[.5,0,.5]]
  for(const name of ['position','normal','uv']){
    const attr=g.getAttribute(name);if(!attr)continue
    const values=new Float32Array(count*4*attr.itemSize)
    for(let i=0;i<count;i+=3)for(let j=0;j<12;j++)for(let k=0;k<attr.itemSize;k++){
      values[(i*4+j)*attr.itemSize+k]=weights[j].reduce((sum,w,v)=>sum+w*attr.getComponent(i+v,k),0)
    }
    result.setAttribute(name,new THREE.BufferAttribute(values,attr.itemSize))
  }
  for(const group of g.groups)result.addGroup(group.start*4,group.count*4,group.materialIndex)
  g.dispose();return result
}
export function raiseTerrain(source:THREE.BufferGeometry,centre:THREE.Vector3,radius:number,amount:number,falloff:number) {
  if(!Number.isFinite(radius)||radius<=0||!Number.isFinite(amount))throw Error('Enter a positive radius and a finite height.')
  const g=source.clone(),p=g.getAttribute('position')
  const originalNormals=g.getAttribute('normal'), surface=new Set<string>()
  const positionKey=(x:number,y:number,z:number)=>[x,y,z].map(v=>Math.round(v*1e5)).join(',')
  for(let i=0;i<p.count;i++)if(!originalNormals || originalNormals.getY(i)>.2)surface.add(positionKey(p.getX(i),p.getY(i),p.getZ(i)))
  g.computeBoundingBox();const base=g.boundingBox!.min.y
  let changed=0
  for(let i=0;i<p.count;i++){
    const distance=Math.hypot(p.getX(i)-centre.x,p.getY(i)-centre.y,p.getZ(i)-centre.z)
    if(distance<radius && surface.has(positionKey(p.getX(i),p.getY(i),p.getZ(i)))){const t=1-distance/radius,weight=Math.pow(t*t*(3-2*t),falloff);const y=p.getY(i)+amount*weight;if(y<=base+1e-5){g.dispose();throw Error('This pull would cross the solid base. Reduce the height or use a thicker ground shape.')}p.setY(i,y);changed++}
  }
  if(!changed){g.dispose();throw Error('No vertices in this brush. Subdivide or increase the radius.')}
  // Positional weld gives matching normals across duplicate vertices at triangle seams.
  const welded=g.clone();welded.deleteAttribute('normal');welded.deleteAttribute('uv')
  const smooth=mergeVertices(welded,1e-5);smooth.computeVertexNormals()
  const normals=new Map<string,THREE.Vector3>(),sp=smooth.getAttribute('position'),sn=smooth.getAttribute('normal')
  const key=(x:number,y:number,z:number)=>[x,y,z].map(v=>Math.round(v*1e5)).join(',')
  for(let i=0;i<sp.count;i++)normals.set(key(sp.getX(i),sp.getY(i),sp.getZ(i)),new THREE.Vector3(sn.getX(i),sn.getY(i),sn.getZ(i)))
  const n=new Float32Array(p.count*3)
  for(let i=0;i<p.count;i++){const normal=normals.get(key(p.getX(i),p.getY(i),p.getZ(i)))!;n.set(normal.toArray(),i*3)}
  g.setAttribute('normal',new THREE.BufferAttribute(n,3));smooth.dispose();welded.dispose()
  g.computeBoundingBox();g.computeBoundingSphere();return g
}
export function simplifyTerrain(source:THREE.BufferGeometry,percent:number) {
  const plain=source.clone();plain.deleteAttribute('normal');plain.deleteAttribute('uv')
  const welded=mergeVertices(plain,1e-5);plain.dispose()
  const count=Math.floor(welded.getAttribute('position').count*Math.max(0,Math.min(.75,percent/100)))
  const result=new SimplifyModifier().modify(welded,count);welded.dispose()
  try{checkSolid(result);result.computeVertexNormals();return result}catch(e){result.dispose();throw e}
}
