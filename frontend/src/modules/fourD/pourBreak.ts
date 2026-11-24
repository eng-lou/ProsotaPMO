import {Box3,BoxGeometry,Group,Mesh,Vector3} from 'three'
import {computeShapeBoolean,disposeBooleanResults} from './shapeBoolean'
import {arraySourceSnapshot,disposeArraySnapshot} from './arraySourceSnapshot'
import type {ConstructionPreview,HostSource} from './constructionLayout'
import type {Path} from './paths'

export function divideSlab(source:HostSource,path:Path,axis:'y'|'z'):ConstructionPreview[]{
  if(source.ifcType&&!/slab/i.test(source.ifcType))throw Error('Select a slab.')
  if(path.closed||path.points.length!==2)throw Error('Draw an open, two-point pour break in Paths.')
  const up=new Vector3(1,0,0),rotation=axis==='z'?-Math.PI/2:0
  const [a,b]=path.points.map(p=>new Vector3(p.x,p.y,p.z).applyAxisAngle(up,rotation))
  const normal=new Vector3(-(b.z-a.z),0,b.x-a.x)
  if(normal.length()<.01)throw Error('The break needs two different points in plan.')
  normal.normalize()
  const slab=arraySourceSnapshot(source.object,axis,'Slab',false)
  const box=new Box3().setFromObject(slab,true),origin=box.getCenter(new Vector3())
  const size=box.getSize(new Vector3()).length()+1
  const signed=normal.dot(a.sub(origin))
  const cutter=new Mesh(new BoxGeometry(size*2,size*2,size*2))
  try{
    slab.children.forEach(n=>(n as Mesh).geometry.translate(-origin.x,-origin.y,-origin.z))
    cutter.rotation.y=-Math.atan2(normal.z,normal.x)
    cutter.position.copy(normal).multiplyScalar(signed+size)
    const parts=computeShapeBoolean(slab,cutter,'y','excavate',true)
    if(parts.length!==2){disposeBooleanResults(parts);throw Error('Extend the break through the slab interior.')}
    return parts.map((piece,i)=>{
      const mesh=piece.mesh,scene=new Group()
      if(i===1){disposeBooleanResultsMaterials(mesh);mesh.material=(parts[0].mesh.material instanceof Array?parts[0].mesh.material[0]:parts[0].mesh.material).clone();mesh.geometry.clearGroups()}
      scene.add(mesh)
      return {scene,anchor:piece.position.add(origin).applyAxisAngle(up,-rotation),label:(source.name+' · Pour '+(i?'B':'A')).slice(0,95),hosts:1,parts:1,sourceRefs:[source.backupRef??source.id]}
    })
  }finally{disposeArraySnapshot(slab);cutter.geometry.dispose();disposeBooleanResultsMaterials(cutter)}
}
function disposeBooleanResultsMaterials(mesh:Mesh){for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.dispose()}
