import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as T from 'three'
import type { TowerCover } from './siteScene'
import nettedUrl from './covers/Netted.glb?url'
import sheetedUrl from './covers/Sheeted.glb?url'

export function TowerWrap({cover,asset,onLoaded,opacity=1}:{cover:TowerCover;asset:T.Object3D;onLoaded?:()=>void;opacity?:number}) {
  const {scene}=useGLTF(cover.style==='netted'?nettedUrl:sheetedUrl)
  const wrap=useMemo(()=>{
    const value=scene.clone(true)
    const owned:T.Material[]=[]
    value.traverse(node=>{
      if(node instanceof T.Mesh){
        // The knitted cloth transmits daylight. Opaque hems and sheet panels cast shadows.
        const clothTransmitsLight=node.material.transparent
        node.material=node.material.clone()
        node.material.opacity*=opacity
        node.material.transparent=clothTransmitsLight || opacity<1
        if(node.material.transparent)node.material.depthWrite=false
        owned.push(node.material)
        node.castShadow=!clothTransmitsLight
        node.receiveShadow=true
      }
    })
    return {value,owned}
  },[scene,opacity])
  useEffect(()=>()=>wrap.owned.forEach(material=>material.dispose()),[wrap])
  useEffect(()=>{onLoaded?.()},[wrap,onLoaded])
  // parseAsset normalises imports around the base of the *whole* model, including
  // the two cages and projecting rear bridges. Use the same authored-origin offset.
  return <group scale={asset.scale}><group position={asset.children[0]?.position}>
    <group position={[cover.offset.x,cover.offset.y+.25,cover.offset.z]} scale={[cover.width/3.16,cover.height/19.2,cover.depth/2.86]}>
      <group position={[0,-.25,0]}><primitive object={wrap.value} dispose={null}/></group>
    </group>
  </group></group>
}
