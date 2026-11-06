import * as T from 'three'
import { mapLayers, type GeographicContext, type MapFeature } from './geographicContext'
import { createRealisticModelInfo } from './realisticMaterials'
export interface FeatureRange { featureId:string;surface:string;start:number;count:number }
export const seedFor=(s:string)=>[...s].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))|0,17)>>>0
export function random(seed:number){return()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296)}
function inside(p:number[],ring:number[][]){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes}
/** Derived woodland trees have stable identities. Editing one materialises only that record. */
export function editableMapFeatures(data:GeographicContext):MapFeature[]{
  const ids=new Set(data.features.map(f=>f.id)),out=[...data.features]
  for(const f of data.features.filter(f=>f.kind==='wood')){
    const rand=random(seedFor(f.id)),xs=f.points.map(p=>p[0]),ys=f.points.map(p=>p[1]),minx=Math.min(...xs),miny=Math.min(...ys),w=Math.max(...xs)-minx,d=Math.max(...ys)-miny
    for(let i=0;i<Math.min(180,w*d/40);i++){const p:[number,number]=[minx+rand()*w,miny+rand()*d];if(!inside(p,f.points)||f.holes.some(h=>inside(p,h)))continue;const height=5+rand()*4,id=f.id+'~tree-'+i;if(!ids.has(id))out.push({...f,id,name:f.name+' · tree '+(i+1),kind:'tree',points:[p],holes:[],height,height_basis:'user',replacement:null,surfaces:{}})}
  }
  return out
}
export function updateMapFeatures(data:GeographicContext,updates:MapFeature[]){const byId=new Map(data.features.map(f=>[f.id,f]));updates.forEach(f=>byId.set(f.id,f));return {...data,features:[...byId.values()]}}
export function geographicHit(object:T.Object3D,faceIndex?:number|null,instanceId?:number){
  const ids=object.userData.featureInstances as string[]|undefined
  if(ids&&instanceId!==undefined)return {featureId:ids[instanceId],surface:'surface'}
  const range=(object.userData.featureRanges as FeatureRange[]|undefined)?.find(r=>faceIndex!=null&&faceIndex*3>=r.start&&faceIndex*3<r.start+r.count)
  return range?{featureId:range.featureId,surface:range.surface}:null
}
export function geographicMaterialKey(itemId:string,kind:string,surface:string){return `site-geo|${itemId}|${kind}|${surface}`}
export function geographicMaterialInfo(itemId:string,data:GeographicContext){
  const info=createRealisticModelInfo()
  for(const kind of Object.keys(mapLayers) as MapFeature['kind'][]){const count=data.features.filter(f=>f.kind===kind).length;if(!count)continue
    for(const surface of kind==='building'?['walls','roof']:['surface']){const key=geographicMaterialKey(itemId,kind,surface);info.entries.set(key,{key,label:`${mapLayers[kind]} — ${surface}`,detail:'Reconstruction category · individual surfaces in 3D Site tools',autoClass:null,candidates:[],count})}}
  return info
}
