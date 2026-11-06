import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as T from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildGeographicContext, disposeGeographicContext } from './geographicGeometry'
import type { GeographicContext } from './geographicContext'
import { loadSiteAsset } from './siteAssets'
import { geographicHit, type FeatureRange } from './geographicSelection'
import type { RealisticMaterialMap } from './realisticMaterials'

let treePromise: Promise<T.Group> | null=null
export function loadContextTree() {
  return treePromise ||= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL || '/'}context/tree-small.glb`).then(g=>g.scene).catch(e=>{treePromise=null;throw e})
}
export function GeographicModel({data,onLoaded,itemId,mapping,selected,onSelect}:{data:GeographicContext;onLoaded():void;itemId?:string;mapping?:RealisticMaterialMap;selected?:string;onSelect?(featureId:string,surface:string):void}) {
  const [tree,setTree]=useState<T.Group|null>(null),invalidate=useThree(s=>s.invalidate)
  const [assets,setAssets]=useState(new Map<string,T.Object3D>())
  const assetIds=JSON.stringify([...new Set(data.features.flatMap(f=>f.replacement?[f.replacement.asset_id]:[]))].sort())
  useEffect(()=>{let live=true;void Promise.allSettled((JSON.parse(assetIds) as string[]).map(async id=>[id,await loadSiteAsset(id)] as const)).then(results=>{const loaded=new Map<string,T.Object3D>();for(const result of results){if(result.status==='fulfilled')loaded.set(...result.value);else console.error('Reconstruction replacement unavailable',result.reason)}if(live)setAssets(loaded)});return()=>{live=false}},[assetIds])
  useEffect(()=>{let current=true;loadContextTree().then(t=>{if(current)setTree(t)}).catch(e=>console.warn('Context vegetation unavailable',e));return()=>{current=false}},[])
  const root=useMemo(()=>{const value=buildGeographicContext(data,tree,{itemId,mapping,assets});value.userData.geographicData=data;value.userData.replacementSources=assets;value.userData.unavailableFeatures=data.features.filter(f=>!f.hidden&&!data.hidden_layers.includes(f.kind)&&f.replacement&&!assets.has(f.replacement.asset_id)).map(f=>f.id);return value},[data,tree,itemId,mapping,assets])
  const highlight=useMemo(()=>{
    if(!selected)return null
    const box=new T.Box3(),point=new T.Vector3(),matrix=new T.Matrix4()
    root.traverse(node=>{if(!(node instanceof T.Mesh))return;const positions=node.geometry.attributes.position
      if(node instanceof T.InstancedMesh){const ids=node.userData.featureInstances as string[]||[];ids.forEach((id,i)=>{if(id!==selected)return;node.getMatrixAt(i,matrix);node.geometry.computeBoundingBox();box.union(node.geometry.boundingBox!.clone().applyMatrix4(matrix))})}
      else for(const r of (node.userData.featureRanges||[]) as FeatureRange[])if(r.featureId===selected)for(let i=r.start;i<r.start+r.count;i++)box.expandByPoint(point.fromBufferAttribute(positions,i))})
    if(box.isEmpty())return null
    return new T.Box3Helper(box,new T.Color('#35bdf8'))
  },[root,selected])
  useEffect(()=>()=>{highlight?.geometry.dispose();if(highlight) (highlight.material as T.Material).dispose()},[highlight])
  useEffect(()=>{onLoaded();invalidate()},[root,onLoaded,invalidate])
  useEffect(()=>()=>disposeGeographicContext(root),[root])
  const last=useMemo(()=>new T.Matrix4().makeScale(0,0,0),[root])
  useFrame(()=>{
    if(root.matrixWorld.equals(last))return
    last.copy(root.matrixWorld)
    const planes=(root.userData.studyPlanes as T.Plane[]).map(p=>p.clone().applyMatrix4(root.matrixWorld))
    root.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.clippingPlanes=planes;m.clipIntersection=false;m.clipShadows=true}})
  })
  return <group onClick={e=>{if(e.delta>4)return;const hit=geographicHit(e.object,e.faceIndex,e.instanceId);if(hit&&onSelect){e.stopPropagation();onSelect(hit.featureId,hit.surface)}}}><primitive object={root}/>{highlight&&<primitive object={highlight} raycast={()=>null}/>}</group>
}
