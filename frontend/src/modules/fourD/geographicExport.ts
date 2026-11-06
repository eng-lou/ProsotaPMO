import * as T from 'three'
import type { GeographicContext } from './geographicContext'
import { editableMapFeatures, type FeatureRange } from './geographicSelection'
import { arraySourceSnapshot } from './arraySourceSnapshot'
export function findGeographicRoot(source:T.Object3D){let root:T.Object3D|undefined;source.traverse(o=>{if(o.userData.geographicData)root=o});return root}
/** Split render batches into type → stable feature → named surface for editing/export. */
export function geographicSnapshot(source:T.Object3D,data:GeographicContext,ids?:Set<string>,recenter=false){
  const unavailable=(source.userData.unavailableFeatures||[]) as string[]
  if(unavailable.some(id=>!ids||ids.has(id)))throw Error('A replacement asset has not loaded. Wait for it to finish or restore its library file before exporting.')
  const root=new T.Group();root.name='Prosota geographic reconstruction';root.userData={source:data.source,attribution:data.attribution,lat:data.lat,lon:data.lon,units:'metres'}
  const features=new Map(editableMapFeatures(data).map(f=>[f.id,f])),layers=new Map<string,T.Group>(),groups=new Map<string,T.Group>()
  function target(id:string){const f=features.get(id);if(!f)return root;let layer=layers.get(f.kind);if(!layer){layer=new T.Group();layer.name=f.kind;layers.set(f.kind,layer);root.add(layer)}let g=groups.get(id);if(!g){g=new T.Group();g.name=f.name+' ['+id+']';g.userData={prosotaFeatureId:id,kind:f.kind,category:f.category};groups.set(id,g);layer.add(g)}return g}
  function material(m:T.Material){const copy=m.clone();copy.clippingPlanes=null;copy.userData={};return copy}
  source.updateWorldMatrix(true,true);const inverse=source.matrixWorld.clone().invert()
  source.traverse(node=>{if(!(node instanceof T.Mesh))return
    const transform=inverse.clone().multiply(node.matrixWorld)
    if(node instanceof T.InstancedMesh){const names=node.userData.featureInstances as string[]||[];for(let i=0;i<node.count;i++){const id=names[i];if(!id||ids&&!ids.has(id))continue;const matrix=new T.Matrix4();node.getMatrixAt(i,matrix);const mesh=new T.Mesh(node.geometry.clone().applyMatrix4(transform.clone().multiply(matrix)),Array.isArray(node.material)?node.material.map(material):material(node.material));if(node.instanceColor){const tint=new T.Color();node.getColorAt(i,tint);for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(m instanceof T.MeshStandardMaterial)m.color.multiply(tint)}mesh.name='tree';target(id).add(mesh)}return}
    const ranges=(node.userData.featureRanges||[]) as FeatureRange[]
    if(!ids&&!ranges.length){const mesh=new T.Mesh(node.geometry.clone().applyMatrix4(transform),Array.isArray(node.material)?node.material.map(material):material(node.material));mesh.name=node.name;root.add(mesh)}
    for(const range of ranges){if(ids&&!ids.has(range.featureId))continue;const geo=new T.BufferGeometry();for(const [key,attribute] of Object.entries(node.geometry.attributes) as [string,T.BufferAttribute|T.InterleavedBufferAttribute][]){const values=new Float32Array(range.count*attribute.itemSize);for(let i=0;i<range.count;i++)for(let c=0;c<attribute.itemSize;c++)values[i*attribute.itemSize+c]=attribute.getComponent(range.start+i,c);geo.setAttribute(key,new T.BufferAttribute(values,attribute.itemSize))}geo.applyMatrix4(transform)
      const mesh=new T.Mesh(geo,Array.isArray(node.material)?node.material.map(material):material(node.material));mesh.name=range.surface;mesh.userData={prosotaSurface:range.surface};target(range.featureId).add(mesh)}
  })
  if(!root.children.length)throw Error('No visible geometry selected. Wait for assets to load or show the feature first.')
  const bounds=new T.Box3().setFromObject(root),anchor=new T.Vector3((bounds.min.x+bounds.max.x)/2,(bounds.min.y+bounds.max.y)/2,bounds.min.z)
  if(recenter)root.traverse(o=>{if(o instanceof T.Mesh)o.geometry.translate(-anchor.x,-anchor.y,-anchor.z)})
  root.userData.prosotaAnchorENU=anchor.toArray();root.rotation.x=-Math.PI/2;root.updateMatrixWorld(true)
  return {root,anchor}
}
export async function downloadObjectGlb(source:T.Object3D,name:string,upAxis:'y'|'z'){
  const geo=findGeographicRoot(source),snapshot=geo?geographicSnapshot(geo,geo.userData.geographicData).root:arraySourceSnapshot(source,upAxis,name)
  try{await downloadGlb(snapshot,name)}finally{disposeSnapshot(snapshot)}
}
export function disposeSnapshot(root:T.Object3D){root.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}})}
export async function downloadGlb(root:T.Object3D,name:string){
  const {GLTFExporter}=await import('three/examples/jsm/exporters/GLTFExporter.js'),bytes=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:true}) as ArrayBuffer
  const url=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'})),a=document.createElement('a');a.href=url;a.download=name.replace(/[^\w .-]/g,'_').replace(/\.glb$/i,'')+'.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
