import * as THREE from 'three'
import type { SiteItem } from './siteScene'

/** Paths address immutable library geometry, never runtime UUIDs or non-unique names. */
export interface AssetPart { path: number[]; transform: number[]; own_mesh?: boolean }
export interface PartCandidate { path: number[]; name: string; meshes: number }
const meshCount = (object: THREE.Object3D) => { let count=0;object.traverse(n=>{if((n as THREE.Mesh).isMesh)count++});return count }
export function assetPartNode(root:THREE.Object3D,path:number[]) {
  let node=root
  for(const index of path){if(!Number.isInteger(index)||index<0||!node.children[index])throw Error('The saved part is missing from this asset.');node=node.children[index]}
  return node
}
export function inspectAssetParts(root:THREE.Object3D,mode:'groups'|'meshes'='groups'):PartCandidate[] {
  let animated=!!root.animations.length
  root.traverse(n=>{if((n as THREE.SkinnedMesh).isSkinnedMesh||n.animations.length)animated=true})
  if(animated)throw Error('This asset has a skeleton or animation. Keep it as one asset for rigging, or import a static version before extracting construction parts.')
  const candidates:PartCandidate[]=[]
  const visit=(node:THREE.Object3D,path:number[])=>{
    if(mode==='groups'&&node.userData.prosotaSourceFile){candidates.push({path,name:node.userData.prosotaSourceFile,meshes:meshCount(node)});return}
    if(mode==='meshes'&&(node as THREE.Mesh).isMesh)candidates.push({path,name:node.name||`Part ${candidates.length+1}`,meshes:1})
    node.children.forEach((child,i)=>visit(child,[...path,i]))
  }
  visit(root,[])
  if(!candidates.length&&mode==='groups'){
    let node=root,path:number[]=[]
    while(!(node as THREE.Mesh).isMesh){const indices=node.children.map((child,i)=>meshCount(child)?i:-1).filter(i=>i>=0);if(indices.length!==1)break;path=[...path,indices[0]];node=node.children[indices[0]]}
    if((node as THREE.Mesh).isMesh)candidates.push({path,name:node.name||'Part',meshes:meshCount(node)})
    else node.children.forEach((child,i)=>{const meshes=meshCount(child);if(meshes)candidates.push({path:[...path,i],name:child.name||`Part ${i+1}`,meshes})})
  }
  return candidates.filter(c=>c.meshes>0).map(c=>({...c,name:c.name.replace(/\.(glb|gltf|fbx|obj)$/i,'').replace(/___/g,' · ').replace(/_/g,' ')}))
}
/** Clone just the subtree; share immutable geometry/textures rather than cloning the whole assembly per part. */
export function extractAssetPart(root:THREE.Object3D,part:AssetPart):THREE.Group {
  const node=assetPartNode(root,part.path)
  // Only ancestors contribute to this part's placement. Updating the entire
  // assembly for every part makes large static imports quadratic.
  node.parent?.updateWorldMatrix(true,false)
  const copy=node.clone(!part.own_mesh),group=new THREE.Group()
  // Mesh mode excludes nested meshes, which receive their own separate item.
  group.matrixAutoUpdate=false
  group.matrix.fromArray(part.transform).multiply(node.parent?.matrixWorld||new THREE.Matrix4())
  group.add(copy);group.updateMatrixWorld(true)
  return group
}
const vector=(v?:{x:number;y:number;z:number},fallback=0)=>new THREE.Vector3(v?.x??fallback,v?.y??fallback,v?.z??fallback)
const matrix=(p?:{x:number;y:number;z:number},r?:{x:number;y:number;z:number},s?:{x:number;y:number;z:number})=>new THREE.Matrix4().compose(vector(p),new THREE.Quaternion().setFromEuler(new THREE.Euler(r?.x||0,r?.y||0,r?.z||0)),vector(s,1))
export function siteAssetPlacement(item:SiteItem){
  const state=item.object_state
  return matrix(item.position,item.rotation,item.scale)
    .multiply(matrix(state?.content_position,state?.content_rotation,state?.content_scale))
    .multiply(new THREE.Matrix4().makeRotationX(item.up_axis==='z'?Math.PI/2:0))
    .multiply(new THREE.Matrix4().makeRotationY(item.yaw*Math.PI/180))
    .multiply(new THREE.Matrix4().makeScale(item.width,item.height,item.depth))
}
export function splitSiteAsset(item:SiteItem,root:THREE.Object3D,mode:'groups'|'meshes'='groups'):SiteItem[]{
  if(item.kind!=='asset'||!item.asset_id||item.asset_part)throw Error('Select a complete imported asset.')
  if(item.locked||item.path_motion)throw Error('Unlock the assembly and remove its movement path before extracting parts.')
  if(item.attachment||item.motion_actions?.length)throw Error('Remove timed actions and attachments before extracting construction parts.')
  const parts=inspectAssetParts(root,mode)
  if(parts.length<2)throw Error('Only one part was found. Try Meshes, or export separate objects from your modelling application.')
  const toY=new THREE.Matrix4().makeRotationX(item.up_axis==='z'?-Math.PI/2:0)
  const placement=toY.multiply(siteAssetPlacement(item)),toWorld=new THREE.Matrix4().makeRotationX(item.up_axis==='z'?Math.PI/2:0)
  return parts.map((part,index)=>{
    const subset=extractAssetPart(root,{path:part.path,transform:placement.toArray(),own_mesh:mode==='meshes'})
    const bounds=new THREE.Box3().setFromObject(subset),size=bounds.getSize(new THREE.Vector3()).max(new THREE.Vector3(.001,.001,.001))
    if(bounds.isEmpty()||!size.toArray().every(Number.isFinite))throw Error('Part has invalid bounds: '+part.name)
    const anchor=new THREE.Vector3((bounds.min.x+bounds.max.x)/2,bounds.min.y,(bounds.min.z+bounds.max.z)/2)
    const transform=new THREE.Matrix4().makeScale(1/size.x,1/size.y,1/size.z).multiply(new THREE.Matrix4().makeTranslation(-anchor.x,-anchor.y,-anchor.z)).multiply(placement)
    const position=anchor.applyMatrix4(toWorld)
    return {...item,id:crypto.randomUUID(),name:part.name.slice(0,100),assembly_id:item.id,assembly_name:item.name,
      asset_part:{path:part.path,transform:transform.toArray(),own_mesh:mode==='meshes'},position:{x:position.x,y:position.y,z:position.z},
      width:size.x,height:size.y,depth:size.z,yaw:0,rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},object_state:null,
      activity_id:null,path_motion:null,animation_playing:false,rig_disabled:true,operation_inputs:index===0?item.operation_inputs||[]:[],instance_overrides:{}}
  })
}
