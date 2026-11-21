import { useEffect, useLayoutEffect, useMemo } from 'react'
import { type ThreeEvent } from '@react-three/fiber'
import * as T from 'three'
import type { SiteItem } from './siteScene'
import type { SiteLayerState } from './SiteSceneLayer'
import { materialScope } from './materialScope'
import { applyCustomMaterial, captureMaterialChannels, hasCustomTextures } from './customMaterial'
import { primitiveMaterialKey, applySiteSurfaceOpacity, siteMaterialLook } from './siteAssetMaterials'
import { disposeRealisticVariant } from './realisticMaterials'
import { buildEnclosure } from './enclosureGeometry'

export function EnclosureMesh({item,state,preview}:{item:SiteItem;state:SiteLayerState;preview:boolean}) {
  const scope='site:'+item.id, textures=state.customTextures?.[scope]
  const opacity=state.customOpacity?.[scope] ?? 1
  const assembly=useMemo(()=>{
    const model=buildEnclosure(item)
    const mapping=materialScope(state.materialMapping ?? {},scope), key=primitiveMaterialKey(item.id)
    const looks=new Map<T.MeshStandardMaterial,T.MeshStandardMaterial>()
    for(const mesh of model.root.children as T.InstancedMesh<T.BufferGeometry,T.MeshStandardMaterial>[]){
      const source=mesh.material
      let look=looks.get(source)
      if(!look){
        captureMaterialChannels(source)
        const painted=mesh.name.endsWith('|paint')
        if(painted)applyCustomMaterial(source,textures)
        applySiteSurfaceOpacity(source,key,painted?mapping:{},preview?.5:opacity)
        look=painted&&!hasCustomTextures(textures)?siteMaterialLook(source,key,mapping,!!state.glassTransmission):source
        look.userData.exportInstanceColour='#ffffff'
        looks.set(source,look)
      }
      mesh.material=look
    }
    return {root:model.root,dispose(){
      looks.forEach((_,source)=>disposeRealisticVariant(source))
      model.dispose()
    }}
  },[item.layout,item.enclosure,item.height,item.color,item.up_axis,item.id,scope,textures,opacity,preview,state.materialMapping,state.glassTransmission])
  useEffect(()=>()=>assembly.dispose(),[assembly])
  useLayoutEffect(()=>{
    const white=new T.Color('white'),active=new T.Color('#4ac7ff')
    for(const mesh of assembly.root.children as T.InstancedMesh<T.BufferGeometry,T.MeshStandardMaterial>[]){
      const owners=mesh.userData.enclosureOwners as string[]
      for(let i=0;i<owners.length;i++)mesh.setColorAt(i,!preview&&(state.selected===item.id||state.selected===owners[i])?active:white)
      if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true
    }
  },[assembly,state.selected,item.id,preview])
  function select(event:ThreeEvent<MouseEvent>){
    event.stopPropagation()
    if(preview||state.boxSelecting||event.delta>4||event.instanceId===undefined)return
    const owners=event.object.userData.enclosureOwners as string[]
    state.onSelect(owners[event.instanceId],event.ctrlKey||event.metaKey||event.shiftKey)
  }
  return <primitive object={assembly.root} onClick={select} dispose={null}/>
}
