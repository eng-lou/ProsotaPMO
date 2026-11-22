import { createCoreDisplay } from './coreRig'
import type { CorePose } from './coreCycle'
import { Suspense } from 'react'
import { TowerWrap } from './TowerWrap'
import type { TowerCover } from './siteScene'
import { useContextDetail } from './useContextDetail'
import { setImportedLightsEnabled } from './importedLights'
import { bindAnimationShadows } from './animationRendering'
import { prepareCutoutRendering } from './cutoutRendering'
import { applyFootprintEdges } from './footprintEdges'
import { footprintEdgesForKey, inheritCutFinish } from './realisticMaterials'
import { animatedAssetBounds } from './animatedAssetBounds'
import { WorkerActionPlayer, type WorkerAction } from './workerActions'
import { clipPathAnchor } from './clipPathAnchor'
import { useFrame } from '@react-three/fiber'
import { markRenderActivity } from './IdleRenderDriver'
import { isObjectRendered } from './visibleAnimation'
import { waterExportTime } from './WaterSurface'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, useBounds } from '@react-three/drei'
import { applyCustomMaterial, captureMaterialChannels, hasCustomTextures } from './customMaterial'
import type { CustomTextureSet } from './customTextures'
import { loadSiteAssetWithRecovery } from './siteAssetRecovery'
import type { AssetPart } from './assetParts'
import { applySiteTextureCutout, applySiteSurfaceOpacity, siteMaterialSlots, siteMaterialLook } from './siteAssetMaterials'
import { disposeRealisticVariant, type RealisticMaterialMap } from './realisticMaterials'

export function SiteAssetModel({ corePose, climbAxis, cover, showStatus = true, adaptiveDetail = false, captureDetail = false, id, part, preview = false, selected = false, fit = false, mapping, importedLights = true, transmission = false, onLoaded, textures, opacity, playing=true, clip=0, speed=1, motionTime, pathBound=false, actions=[], actionDateRef, daysPerSecond=1 }: { corePose?:React.RefObject<CorePose|null>; climbAxis?:"y"|"z"; cover?: TowerCover | null; showStatus?: boolean; adaptiveDetail?: boolean; captureDetail?: boolean; actions?:WorkerAction[]; actionDateRef?:React.MutableRefObject<Date|null>; daysPerSecond?:number; part?: AssetPart | null; pathBound?: boolean; motionTime?: React.MutableRefObject<number|null>; playing?:boolean; clip?:number; speed?:number; textures?:CustomTextureSet; opacity?:number; id: string; preview?: boolean; selected?: boolean; fit?: boolean; mapping?: RealisticMaterialMap; importedLights?: boolean; transmission?: boolean; onLoaded?(): void }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null)
  useLayoutEffect(() => {
    if (!object || importedLights) return
    setImportedLightsEnabled(object, false)
    return () => setImportedLightsEnabled(object, true)
  }, [object, importedLights])
  const articulated=!!corePose
  const rig=useMemo(()=>object && articulated ? createCoreDisplay(object) : null,[object,articulated])
  useEffect(()=>()=>rig?.dispose(),[rig])
  const display=rig?.object??object
  const lastRig=useRef<{rig:typeof rig;pose:CorePose;matrix:THREE.Matrix4;axis:typeof climbAxis}|null>(null)
  useFrame(()=>{
    const pose=corePose?.current
    if(!rig || !pose || !display)return
    for(let p:THREE.Object3D|null=display;p;p=p.parent)if(p.userData.simulatorOwnsPose)return
    display.updateWorldMatrix(true,false)
    const last=lastRig.current
    if(last?.rig===rig && last.pose===pose && last.axis===climbAxis && last.matrix.equals(display.matrixWorld))return
    rig.apply(pose,climbAxis)
    lastRig.current={rig,pose,axis:climbAxis,matrix:display.matrixWorld.clone()}
  },-.4)
  useContextDetail(display, adaptiveDetail, selected || preview || captureDetail)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const retryAsset = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) setRetry(value => value + 1)
    }
    window.addEventListener('prosota-retry-site-asset', retryAsset)
    return () => window.removeEventListener('prosota-retry-site-asset', retryAsset)
  }, [id])
  const pathAnchor=useMemo(()=>object && pathBound && object.animations.length ? clipPathAnchor(object,object.animations[Math.min(clip,object.animations.length-1)]) : new THREE.Vector3(),[object,pathBound,clip])
  const invalidateBounds=useMemo(()=>object ? animatedAssetBounds(object) : ()=>{},[object])
  const mixer=useRef<THREE.AnimationMixer>(),elapsed=useRef(0),lastPoseTime=useRef<number|null>(null)
  const actionPlayer=useRef<WorkerActionPlayer>()
  const lastAction=useRef<{date:number;base:number;sequence:WorkerAction[];days:number}|null>(null)
  useEffect(()=>{
    if(!object?.animations.length || articulated)return
    elapsed.current=0
    if(actions.length){const player=new WorkerActionPlayer(object);actionPlayer.current=player;lastAction.current=null;return()=>{player.dispose();actionPlayer.current=undefined}}
    const value=new THREE.AnimationMixer(object);mixer.current=value
    value.clipAction(object.animations[Math.min(clip,object.animations.length-1)]).play();value.setTime(elapsed.current);lastPoseTime.current=elapsed.current;invalidateBounds()
    return ()=>{value.stopAllAction();value.uncacheRoot(object);mixer.current=undefined}
  },[object,clip,invalidateBounds,!!actions.length,articulated])
  useFrame((_,delta)=>{
    for(let n:THREE.Object3D|null=object;n;n=n.parent)if(n.userData.simulatorOwnsPose){lastAction.current=null;lastPoseTime.current=null;return}
    if(actionPlayer.current){
      const date=actionDateRef?.current?.getTime()??Date.parse(actions[0].start)
      if(!Number.isFinite(date))return
      const base=(playing?(motionTime?.current??(date-Date.parse(actions[0].start))/(86400000*daysPerSecond)):0)*speed
      const last=lastAction.current
      if(!last||last.date!==date||last.base!==base||last.sequence!==actions||last.days!==daysPerSecond){
        actionPlayer.current.evaluate(actions,date,daysPerSecond,clip,base)
        lastAction.current={date,base,sequence:actions,days:daysPerSecond};invalidateBounds()
      }
      return
    }
    if(!mixer.current)return
    let time: number
    if(motionTime?.current != null) time=playing?motionTime.current*speed:0
    else if(waterExportTime.current!==null) time=playing?waterExportTime.current*speed:elapsed.current
    else {
      if(playing && speed>0){elapsed.current+=delta*speed;if(isObjectRendered(object))markRenderActivity()}
      time=elapsed.current
    }
    if(time!==lastPoseTime.current){
      mixer.current.setTime(time);lastPoseTime.current=time;invalidateBounds()
    }
  }, -.5)
  useEffect(() => { if (object) onLoaded?.() }, [object, onLoaded])
  useEffect(() => {
    let active = true
    const materials: THREE.Material[] = []
    setObject(null); setError('')
    void loadSiteAssetWithRecovery(id,part).then(value => {
      if (!active) return
      const slots = siteMaterialSlots(value,id)
      value.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return
        node.castShadow = true; node.receiveShadow = true
        const copy = (source: THREE.Material) => {
          const key = slots.get(source)!
          const baseSlot = source.userData.prosotaCutBaseSlot
          const finish = mapping && Number.isInteger(baseSlot) ? inheritCutFinish(mapping, key, `site|${id}|${baseSlot}`) : mapping
          const mat = source.clone(); materials.push(mat)
          if(mat instanceof THREE.MeshStandardMaterial){captureMaterialChannels(mat);applyCustomMaterial(mat,textures);applySiteSurfaceOpacity(mat,key,finish ?? {},opacity ?? 1)}
          if (mat instanceof THREE.MeshStandardMaterial) applySiteTextureCutout(mat, key, finish ?? {})
          if (preview) { mat.transparent = true; mat.opacity *= .65; mat.depthWrite = false }
          if(mat instanceof THREE.MeshStandardMaterial){mat.userData.exportEmissive=mat.emissive.getHex();mat.userData.exportEmissiveIntensity=mat.emissiveIntensity}
          if (selected && mat instanceof THREE.MeshStandardMaterial) { mat.emissive.set('#0c4a6e'); mat.emissiveIntensity = .4 }
          const result=finish && !hasCustomTextures(textures) && mat instanceof THREE.MeshStandardMaterial ? siteMaterialLook(mat,key,finish,transmission) : mat
          if(finish) applyFootprintEdges(result,footprintEdgesForKey(key,finish))
          if(source instanceof THREE.MeshStandardMaterial){result.userData.exportEmissive=source.emissive.getHex();result.userData.exportEmissiveIntensity=source.emissiveIntensity}
          return result
        }
        node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material)
        bindAnimationShadows(node)
      })
      // SkeletonUtils clones meshes but omits their custom shadow materials.
      prepareCutoutRendering(value)
      setObject(value)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Asset unavailable') })
    return () => { active = false; materials.forEach(material => { disposeRealisticVariant(material); material.dispose() }) }
  }, [id, JSON.stringify(part), preview, selected, mapping, transmission, textures, opacity, retry])
  return object ? <><group position={pathAnchor}><primitive object={display!} dispose={null} />{cover && !part && <Suspense fallback={null}><TowerWrap cover={cover} asset={object} opacity={preview ? .45 : opacity} onLoaded={onLoaded}/></Suspense>}</group>{fit && <FitAsset object={object} />}</> : <group>
    <mesh position={[0, .5, 0]}><boxGeometry /><meshBasicMaterial color={error ? '#ef4444' : '#94a3b8'} wireframe /></mesh>
    {showStatus && (selected || preview || fit) && <Html center position={[0, 1.1, 0]}>
      <div className="bg-white text-slate-800 px-2 py-1 text-xs rounded shadow max-w-64" onPointerDown={event => event.stopPropagation()}>
        <div>{error ? 'Asset could not load' : 'Loading asset…'}</div>
        {error && <><div className="break-words mt-1">{error}</div><button className="underline mt-1" onClick={event => {
          event.stopPropagation()
          window.dispatchEvent(new CustomEvent('prosota-retry-site-asset', { detail: id }))
        }}>Retry this asset and its copies</button></>}
      </div>
    </Html>}
  </group>
}

function FitAsset({ object }: { object: THREE.Object3D }) {
  const bounds = useBounds()
  useEffect(() => { bounds.refresh().clip().fit() }, [bounds, object])
  return null
}
