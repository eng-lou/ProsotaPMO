import { Box3, BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { splitSiteAsset } from './assetParts'
import { buildConstruction, constructionEdges, constructionModes, perimeterRuns, type ConstructionOptions, type PropPiece } from './constructionGeometry'
import { readConstructionHost } from './constructionHost'
import { importSiteAsset, loadSiteAsset, type SiteAsset } from './siteAssets'
import type { SiteItem } from './siteScene'

export interface HostSource {id:string; name:string; object:Object3D; ifcType?:string; backupRef?:string}
export function readPropKit(scene:Object3D){
  scene.updateWorldMatrix(true,true)
  const prop=scene.getObjectByName('Prop_-125_-19'),tripod=scene.getObjectByName('Tripod_-125_-19')
  if(!prop || !tripod)throw Error('The slab formwork asset is missing its prop or tripod.')
  const box=new Box3().setFromObject(prop),origin=box.getCenter(new Vector3())
  origin.y=box.min.y
  const pieces:PropPiece[]=[]
  for(const node of [prop,tripod]) node.traverse(child=>{
    if(child instanceof Mesh && child.material instanceof MeshStandardMaterial){
      const geo=child.geometry.clone().applyMatrix4(child.matrixWorld).translate(-origin.x,-origin.y,-origin.z)
      pieces.push({geometry:geo,material:child.material,tripod:node===tripod})
    }
  })
  return pieces
}
let propKit:Promise<PropPiece[]>|undefined
function loadPropKit(){
  return propKit??=new GLTFLoader().loadAsync((import.meta.env.BASE_URL || '/')+'models/Prosota_Slab_Formwork_Full.glb')
    .then(gltf=>readPropKit(gltf.scene)).catch(error=>{propKit=undefined;throw error})
}

export interface ConstructionPreview { scene: Group; anchor:Vector3; hosts:number; parts:number; label:string; cachedAsset?:SiteAsset }
export function releaseConstruction(scene:Group){
  const geometries=new Set<BufferGeometry>(),materials=new Set<MeshStandardMaterial>()
  scene.traverse(node=>{
    if(node instanceof Mesh){
      geometries.add(node.geometry)
      for(const m of Array.isArray(node.material)?node.material:[node.material]) materials.add(m)
    }
  })
  geometries.forEach(g=>g.dispose())
  for(const mat of materials){mat.map?.dispose(); mat.dispose()}
}

export async function prepareConstruction(sources:HostSource[],upAxis:'y'|'z',options:ConstructionOptions,skipEdges:number[]){
  if(!sources.length)throw Error('Select one or more IFC elements or individual mesh objects in the viewport.')
  const {mode}=options
  const wallHost=mode==='wall'||mode==='wallForm'
  const expected=mode==='column'||mode==='shutter'?'column':wallHost?'wall':'slab'
  const elements=sources.map(source=>{
    const type=source.ifcType?.toLowerCase()
    if(type && !type.includes(expected) && /ifc(slab|wall|column|beam|door|window)/.test(type))
      throw Error(source.name+' is a '+source.ifcType+'. Select a '+expected+' for this layout.')
    try{return readConstructionHost(source.name,source.object,upAxis,mode==='wallForm'?'wallForm':wallHost)}
    catch(e){throw Error(source.name+': '+(e instanceof Error?e.message:e))}
  })
  const root=new Group(),base=elements[0].origin
  const kit=mode==='deck'?await loadPropKit():[]
  // Previews own their materials; the small authored prop kit is shared between previews.
  const finishes=new Map<MeshStandardMaterial,MeshStandardMaterial>()
  const pieces=kit.map(p=>{
    if(!finishes.has(p.material))finishes.set(p.material,p.material.clone())
    return {...p,material:finishes.get(p.material)!}
  })
  const runs=mode==='screen'?perimeterRuns(elements):undefined
  let parts=0
  try{
    for(const [i,host] of elements.entries()){
      const edges=mode==='screen'?constructionEdges(host):[]
      if(skipEdges.some(n=>n>edges.length))throw Error(host.name+' has '+edges.length+' exterior edges.')
      const excludedEdges=new Set(skipEdges.map(n=>edges[n-1].id))
      const screenRuns=runs?.[i]
      if(screenRuns && screenRuns.every(run=>excludedEdges.has(run.edge.id)))continue
      const model=buildConstruction(host,{...options,excludedEdges,screenRuns},pieces)
      model.rotation.y=-host.angle
      model.position.copy(host.origin).sub(base)
      model.children.forEach(g=>{
        g.userData.prosotaSourceFile=g.name
        g.userData.constructionHost=sources[i].backupRef || sources[i].id
      })
      parts+=model.children.length
      root.add(model)
    }
    if(!parts)throw Error('No exposed edges remain for the perimeter screens.')
    root.updateMatrixWorld(true)
    const bounds=new Box3().setFromObject(root)
    const anchor=bounds.getCenter(new Vector3());anchor.y=bounds.min.y;anchor.add(base)
    if(upAxis==='z')anchor.applyMatrix4(new Matrix4().makeRotationX(Math.PI/2))
    const label=constructionModes[mode]+' - '+(elements.length===1?elements[0].name:elements.length+' hosts')
    return {scene:root,anchor,hosts:elements.length,parts,label:label.slice(0,96)} as ConstructionPreview
  }catch(error){releaseConstruction(root);throw error}
}

export async function constructionPlacements(preview:ConstructionPreview,projectId:string,upAxis:'y'|'z',separate:boolean){
  if(!preview.cachedAsset){
    const bytes=await new GLTFExporter().parseAsync(preview.scene,{binary:true,onlyVisible:false}) as ArrayBuffer
    const file=new File([bytes],preview.label+'.glb',{type:'model/gltf-binary'})
    preview.cachedAsset=await importSiteAsset(projectId,file,'Other',()=>{},preview.label)
    window.dispatchEvent(new Event('prosota-site-assets-changed'))
  }
  const asset=preview.cachedAsset,{x,y,z}=preview.anchor
  const item:SiteItem={id:crypto.randomUUID(),name:preview.label,kind:'asset',asset_id:asset.id,...asset.dimensions,
    up_axis:upAxis,position:{x,y,z},yaw:0,units:'m',generator_version:1,locked:false,color:'#ffffff',activity_id:null,
    path_id:null,points:[],closed:false,module_length:2,gate_start:0,gate_width:0,animation_playing:false}
  return separate&&preview.parts>1?splitSiteAsset(item,await loadSiteAsset(asset.id)):[item]
}
