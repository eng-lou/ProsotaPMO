import { Box3, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { addCoreHardware } from './coreRigGeometry'
import type { CorePose } from './coreCycle'

export function coreFrame(root?:Object3D|null) {
  let found:Object3D|undefined
  root?.traverse(n=>{
    if (found) return
    if (n.userData.coreRigVersion===1 || (/CLIMBING.FORMWORK.*12m.*8m.*clear.opening/i.test(n.name) &&
        ['North','South','East','West'].every(side=>n.children.some(c=>c.name.startsWith(side))))) found=n
  })
  return found
}

// The original export batches individual boards, rails and brackets by material.
// Identify complete connected solids before partitioning so a moving panel cannot tear a mesh.
function partition(mesh:Mesh, corner:boolean) {
  const source=mesh.geometry, xyz=source.getAttribute('position'), idx=source.index
  const positions=new BufferGeometry()
  const vertices=new Float32Array(xyz.count*3)
  for(let i=0;i<xyz.count;i++){vertices[i*3]=xyz.getX(i);vertices[i*3+1]=xyz.getY(i);vertices[i*3+2]=xyz.getZ(i)}
  positions.setAttribute('position',new Float32BufferAttribute(vertices,3));positions.setIndex(idx)
  const welded=mergeVertices(positions,1e-5), indices=welded.index!, count=welded.getAttribute('position').count
  const parent=Array.from({length:count},(_,i)=>i)
  function root(i:number){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i}
  for(let i=0;i<indices.count;i+=3){
    const a=root(indices.getX(i)); parent[root(indices.getX(i+1))]=a;parent[root(indices.getX(i+2))]=a
  }
  const bounds=new Map<number,Box3>(), point=new Vector3()
  mesh.updateMatrix()
  for(let i=0;i<count;i++){
    const key=root(i);let box=bounds.get(key);if(!box){box=new Box3();bounds.set(key,box)}
    box.expandByPoint(point.fromBufferAttribute(welded.getAttribute('position'),i).applyMatrix4(mesh.matrix))
  }
  const part=new Map<number,string>()
  for(const [key,box] of bounds){
    box.getCenter(point)
    const faceSide=!corner && box.min.y>=-.02 && box.max.y<=3.37 && point.z>-.56 &&
      (/Form.face|Safety.yellow|Galvanised/i.test(mesh.name))
    const sideLength=/^(North|South)/.test(mesh.parent!.name)?12:8
    const ladder=!corner && /Ladder.and.suspension|Galvanised.railings/i.test(mesh.name) &&
      Math.abs(Math.abs(point.x)-.23*sideLength)<.27 && point.z<-.88 && point.z>-1.5 && box.max.x-box.min.x<.55 && point.y<.66
    // Keep the upper flight's rungs with its stiles while the lower flight waits.
    const lower=ladder ? point.x>0 : point.y < -1.3
    part.set(key,lower?'lower':faceSide?'panel':'fixed')
  }
  const lists=new Map<string,number[]>()
  for(let i=0;i<indices.count;i+=3){
    const role=part.get(root(indices.getX(i)))!
    let list=lists.get(role);if(!list){list=[];lists.set(role,list)}
    for(let j=i;j<i+3;j++)list.push(idx?idx.getX(j):j)
  }
  positions.dispose();welded.dispose()
  return lists
}

export function articulateLegacy(frame:Object3D) {
  const generated:BufferGeometry[]=[]
  const sources:Mesh[]=[]
  frame.traverse(n=>{if(n instanceof Mesh)sources.push(n)})
  for(const mesh of sources){
    const parent=mesh.parent!, parts=partition(mesh,parent===frame)
    for(const [role,list] of parts){
      const shape=new BufferGeometry()
      for(const [attr,data] of Object.entries(mesh.geometry.attributes))shape.setAttribute(attr,data)
      shape.setIndex(list);shape.computeBoundingBox();shape.computeBoundingSphere();generated.push(shape)
      const section=mesh.clone(false);section.geometry=shape;section.name=mesh.name+'_'+role
      if(role==='fixed')parent.add(section)
      else {
        const pivot=new Group();pivot.name=parent.name+'_'+role+'_'+mesh.name
        pivot.userData.coreRigPart=role; parent.add(pivot);pivot.add(section)
      }
    }
    mesh.removeFromParent()
  }
  const hardware=addCoreHardware(frame)
  const materials=new Set<MeshStandardMaterial>()
  hardware.traverse(n=>{if(n instanceof Mesh){generated.push(n.geometry);materials.add(n.material)}})
  frame.userData.coreRigVersion=1
  return ()=>{generated.forEach(g=>g.dispose());materials.forEach(m=>m.dispose())}
}

const rad=Math.PI/180
export function bindCoreRig(frame:Object3D) {
  const parts=new Map<string,Object3D[]>(), rest=new Map<Object3D,Vector3>()
  frame.traverse(n=>{const key=n.userData.coreRigPart;if(!key)return
    const nodes=parts.get(key)??[];nodes.push(n);parts.set(key,nodes);rest.set(n,n.position.clone())})
  const vec=new Vector3(),inverse=new Matrix4(), localDelta=new Map<Object3D,Vector3>()
  const turn=(role:string,angle:number,axis:'y'|'z')=>{for(const n of parts.get(role)??[])n.rotation[axis]=angle}
  return (pose:CorePose,axis:'y'|'z'='y')=>{
    const gap=pose.lower-pose.upper
    // Convert the world climb into each parent's local coordinates, including the import's normalization and scale.
    localDelta.clear()
    const delta=(n:Object3D)=>{
      let d=localDelta.get(n)
      if(!d){
        n.updateWorldMatrix(true,false);inverse.copy(n.matrixWorld).invert()
        vec.set(0,0,0);vec[axis]=gap
        d=vec.clone().applyMatrix4(inverse).sub(new Vector3().setFromMatrixPosition(inverse));localDelta.set(n,d)
      }
      return d
    }
    for(const n of parts.get('lower')??[])n.position.copy(rest.get(n)!).add(delta(n.parent!))
    for(const n of parts.get('panel')??[])n.position.copy(rest.get(n)!).z-=pose.panels*.62
    for(const n of parts.get('ram')??[]){
      const end=vec.copy(delta(n.parent!)).add(new Vector3(0,-1.8,0))
      n.scale.y=end.length();n.quaternion.setFromUnitVectors(new Vector3(0,-1,0),end.normalize())
    }
    const t=pose.deployment, shoulder=(8+48*t)*rad, elbow=(166-216*t)*rad, tip=(-163+116*t)*rad
    turn('slew',pose.slew*rad,'y');turn('shoulder',shoulder,'z');turn('elbow',elbow,'z');turn('tip',tip,'z')
    turn('hose',-(shoulder+elbow+tip),'z')
  }
}

export function createCoreDisplay(source:Object3D) {
  const object=source.clone(true), frame=coreFrame(object)
  if(!frame)return null
  frame.traverse(n=>{const rest=n.userData.coreRigRest;if(Array.isArray(rest)&&rest.length===3)n.position.fromArray(rest)})
  const dispose=frame.userData.coreRigVersion===1 ? ()=>{} : articulateLegacy(frame)
  return {object,apply:bindCoreRig(frame),dispose}
}
