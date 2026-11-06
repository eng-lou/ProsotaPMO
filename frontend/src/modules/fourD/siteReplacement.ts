import type { SiteItem } from './siteScene'
import type { SiteAsset } from './siteAssets'
import { editableMapFeatures, updateMapFeatures } from './geographicSelection'
import type { MapFeature, FeatureReplacement } from './geographicContext'
export interface ReplacementSelection {itemId:string;featureId?:string;instanceIndex?:number}
function templateKey(item:SiteItem,index?:number){const override=index!==undefined?item.instance_overrides?.[index]:null;return override?'asset:'+override.asset_id:item.asset_id?'asset:'+item.asset_id+(item.asset_part?':part:'+item.asset_part.path.join('.'):''):'primitive:'+(item.kind==='array'||item.kind==='scatter'?item.placement_kind:item.kind)}
function featureKey(f:MapFeature){return f.replacement?'asset:'+f.replacement.asset_id:f.kind==='tree'?'context-tree':f.kind+':'+f.category}
export function featureAnchor(f:MapFeature):[number,number,number]{if(f.replacement)return f.replacement.anchor;const xs=f.points.map(p=>p[0]),ys=f.points.map(p=>p[1]);return [(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2,.14]}
export function replacementSurfaces(f:MapFeature,assetId:string){return f.replacement?.asset_id===assetId?f.surfaces:Object.fromEntries(Object.entries(f.surfaces||{}).filter(([key])=>!key.startsWith('material:')))}
export function featureReplacement(f:MapFeature,asset:SiteAsset,fit:boolean):FeatureReplacement{
  const scale=fit?f.height/asset.dimensions.height:1
  return {asset_id:asset.id,width:asset.dimensions.width*scale,depth:asset.dimensions.depth*scale,height:asset.dimensions.height*scale,anchor:featureAnchor(f),yaw:f.replacement?.yaw||0}
}
/** Replacement is a single scene command. Never transfer animation, pivots or equipment rigs. */
export function replaceSiteObjects(items:SiteItem[],selection:ReplacementSelection,asset:SiteAsset,all:boolean,fit:boolean){
  const selected=items.find(i=>i.id===selection.itemId);if(!selected||selected.locked)throw Error('Select an unlocked object first')
  const feature=selected.geographic&&editableMapFeatures(selected.geographic).find(f=>f.id===selection.featureId)
  if(selected.kind==='geographic'&&!feature)throw Error('Select an individual reconstructed feature first')
  const key=feature?featureKey(feature):templateKey(selected,selection.instanceIndex);let count=0,locked=0
  const next=items.map(item=>{
    if(item.geographic){const targets=editableMapFeatures(item.geographic).filter(f=>all?featureKey(f)===key:item.id===selected.id&&f.id===feature?.id);if(item.locked){locked+=targets.length;return item}count+=targets.length;return targets.length?{...item,geographic:updateMapFeatures(item.geographic,targets.map(f=>({...f,surfaces:replacementSurfaces(f,asset.id),replacement:featureReplacement(f,asset,fit)})))}:item}
    if(feature&&!all)return item
    if(item.kind==='array'||item.kind==='scatter'){
      const matches=(item.layout?.placements||[]).map((_,i)=>i).filter(i=>all?templateKey(item,i)===key:item.id===selected.id&&(selection.instanceIndex===undefined||selection.instanceIndex===i))
      if(item.locked){locked+=matches.length;return item}if(!matches.length)return item
      const overrides={...item.instance_overrides};for(const i of matches){const previous=overrides[i],h=previous?.height||item.height,scale=fit?h/asset.dimensions.height:1;overrides[i]={asset_id:asset.id,width:asset.dimensions.width*scale,depth:asset.dimensions.depth*scale,height:asset.dimensions.height*scale,yaw:0,anchor:[0,0,0]}}count+=matches.length
      return {...item,instance_overrides:overrides,rig_disabled:true}
    }
    if(item.kind==='geographic'||!(all?templateKey(item)===key:item.id===selected.id))return item
    if(item.locked){locked++;return item}count++
    return {...item,kind:'asset' as const,asset_id:asset.id,asset_part:null,name:asset.name,geographic:null,...(fit?{}:asset.dimensions),color:'#ffffff',object_state:null,path_motion:null,motion_actions:[],attachment:null,animation_playing:false,animation_clip:0,animation_speed:1,rig_disabled:true,instance_overrides:{},path_id:null,zone_id:null,points:[],closed:false}
  })
  const replaced=new Set(next.filter((n,i)=>n.asset_id!==items[i].asset_id).map(i=>i.id))
  return {items:next.map(i=>i.attachment&&replaced.has(i.attachment.parent_id)?{...i,attachment:null}:i),count,locked}
}
