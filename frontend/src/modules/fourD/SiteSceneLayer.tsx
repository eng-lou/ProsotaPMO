import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import { applySitePath } from './sitePathMotion'
import { buildPathCurve } from './pathCurve'
import type { Path } from './paths'
import * as THREE from 'three'
import type { Activity } from '@/modules/scheduling/types'
import type { SiteItem } from './siteScene'
import { presentAt } from './siteSceneTime'
import { restoreSiteObjectState } from './siteObjectTransform'
import { applyCustomMaterial, captureMaterialChannels, hasCustomTextures } from './customMaterial'
import type { CustomTextureSet } from './customTextures'
import { SiteAssetModel } from './SiteAssetModel'
import type { PathPoint } from './paths'
import type { ModelElementLink } from './modelElementLinks'
import type { AnimationProfile } from './animationProfiles'
import { resolveSiteLinks } from './siteAnimation'
import { useSiteAnimation } from './useSiteAnimation'
import { disposeRealisticVariant, type RealisticMaterialMap } from './realisticMaterials'
import { primitiveMaterialKey, siteMaterialLook } from './siteAssetMaterials'

function ShapeMaterial({ item, mapping, transmission, preview, colour, textures, opacity, slot = 'surface' }: {
  textures?: CustomTextureSet; opacity?: number
  item: SiteItem; mapping?: RealisticMaterialMap; transmission?: boolean; preview: boolean; colour: string; slot?: string
}) {
  const source = useMemo(() => { const material=new THREE.MeshStandardMaterial({ color: colour, roughness: .8, transparent: preview, opacity: preview ? .45 : 1 }); material.color.set(slot==='trunk'?'#795548':slot==='windows'?'#334155':item.color); captureMaterialChannels(material); material.color.set(colour); return applyCustomMaterial(material,textures,opacity) }, [colour, preview, textures, opacity, item.color, slot])
  const material = useMemo(() => {
    // Tint overrides must not mutate the authored colour across finish changes.
    if(!textures?.map)source.color.set(colour)
    source.userData.exportColour=textures?.map?'#ffffff':item.kind==='fence'?'#ffffff':slot==='trunk'?'#795548':slot==='windows'?'#334155':item.color
    const result = mapping && !hasCustomTextures(textures) ? siteMaterialLook(source, primitiveMaterialKey(item.id, slot), item.finish==='water'?{[primitiveMaterialKey(item.id,slot)]:'water',...mapping}:mapping, !!transmission) : source
    result.userData.exportColour=source.userData.exportColour
    if(item.kind==='fence')result.userData.exportInstanceColour=item.color
    return result
  }, [source, colour, mapping, item.id, item.finish, slot, transmission, textures])
  useEffect(() => () => { disposeRealisticVariant(source); source.dispose() }, [source])
  return <primitive object={material} attach="material" />
}

export interface SiteLayerState {
  paths?: Path[]; daysPerSecond?: number
  pathDateRef?: React.MutableRefObject<Date | null>
  customTextures?: Record<string, CustomTextureSet>; customOpacity?: Record<string, number>
  selectedIds?: Set<string>; hiddenIds?: Set<string>; isolatedIds?: Set<string>; isolate?: boolean; boxSelecting?: boolean
  objects?: { id: string; name: string; object: THREE.Object3D; sourceUpAxis: 'y' | 'z'; kind: 'mesh'; visible: boolean }[]
  onSourceRegister?(id: string, object: THREE.Group | null): void
  onRegister?(id: string, object: THREE.Group | null): void
  onGeometryReady?(): void
  materialMapping?: RealisticMaterialMap; glassTransmission?: boolean
  items: SiteItem[]; preview: SiteItem | null; selected: string | null
  onSelect(id: string, additive?: boolean): void
  placing?: boolean; onPlace?(point: PathPoint): void; onMove?(point: PathPoint): void
}
function Fence({ item, selected, preview, select, state }: { state: SiteLayerState; item: SiteItem; selected: string | null; preview: boolean; select(id: string): void }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const panels = item.layout?.panels || []
  useLayoutEffect(() => {
    if (!mesh.current) return
    const up = new THREE.Vector3(0, item.up_axis === 'y' ? 1 : 0, item.up_axis === 'z' ? 1 : 0)
    panels.forEach((panel, index) => {
      const a = new THREE.Vector3(panel.a.x, panel.a.y, panel.a.z), b = new THREE.Vector3(panel.b.x, panel.b.y, panel.b.z)
      const x = b.clone().sub(a).normalize(), z = x.clone().cross(up).normalize()
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z))
      const position = a.clone().add(b).multiplyScalar(.5).addScaledVector(up, item.height / 2)
      mesh.current!.setMatrixAt(index, new THREE.Matrix4().compose(position, q, new THREE.Vector3(a.distanceTo(b), item.height, .08)))
      mesh.current!.setColorAt(index, new THREE.Color(!preview && (selected === item.id || selected === panel.id) ? '#38bdf8' : item.color))
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    mesh.current.computeBoundingSphere()
  }, [item, selected, preview])
  return <instancedMesh ref={mesh} args={[undefined, undefined, panels.length]} castShadow receiveShadow
    onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (!preview && event.delta <= 4 && event.instanceId !== undefined) select(panels[event.instanceId].id) }}>
    <boxGeometry args={[1, 1, 1]} /><ShapeMaterial textures={state.customTextures?.["site:"+item.id]} opacity={state.customOpacity?.["site:"+item.id]} item={item} mapping={state.materialMapping} transmission={state.glassTransmission} preview={preview} colour="#ffffff" />
  </instancedMesh>
}
function FootprintGeometry({item}:{item:SiteItem}) {
  const geometry=useMemo(()=>{
    const points=item.layout?.footprint || []
    const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x,item.up_axis==='z'?p.y:-p.z)))
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:item.height,bevelEnabled:false,steps:1})
    if(item.up_axis==='y')geometry.rotateX(-Math.PI/2)
    const elevation=points[0]?.[item.up_axis] || 0
    geometry.translate(0,item.up_axis==='y'?elevation:0,item.up_axis==='z'?elevation:0)
    return geometry
  },[item.layout,item.height,item.up_axis])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  return <primitive object={geometry} attach="geometry" />
}
function Item({ item, state, preview, activity, dateRef, links, activities, profiles, instance = false }: { instance?: boolean; item: SiteItem; state: SiteLayerState; preview: boolean; activity?: Activity; dateRef: React.MutableRefObject<Date | null>; links: ModelElementLink[]; activities: Activity[]; profiles: AnimationProfile[] }) {
  const motionRoot = useRef<THREE.Group>(null)
  const motionTime = useRef<number | null>(null)
  const sourcePath = state.paths?.find(p => p.id === item.path_motion?.path_id)
  const curve = useMemo(() => sourcePath ? buildPathCurve(sourcePath.points, sourcePath.closed, sourcePath.curve_mode) : null, [sourcePath])
  useFrame(() => {
    const parent = motionRoot.current
    if (!parent) return
    if (!preview && !instance && curve && item.path_motion) {
      const pathDate = (state.pathDateRef || dateRef).current
      const seconds = pathDate ? (pathDate.getTime() - Date.parse(item.path_motion.start)) / (86400000 * (state.daysPerSecond || 1)) : 0
      motionTime.current = applySitePath(parent, curve, item.path_motion, seconds, item.up_axis, new THREE.Vector3(item.position.x,item.position.y,item.position.z)).animationTime
    } else { parent.position.set(0,0,0); parent.quaternion.identity(); motionTime.current=null }
  }, -1)
  const root = useRef<THREE.Group>(null)
  const selectable = useRef<THREE.Group>(null)
  const registered = !preview && !instance
  useLayoutEffect(() => { if (selectable.current) restoreSiteObjectState(selectable.current, item.object_state) }, [item.object_state])
  const geometryReady = useCallback(() => { if (registered) state.onGeometryReady?.() }, [registered, state.onGeometryReady])
  const selected = registered && state.selectedIds ? state.selectedIds.has('site:' + item.id) : state.selected === item.id
  useLayoutEffect(() => {
    if (!registered) return
    state.onRegister?.(item.id, selectable.current)
    return () => state.onRegister?.(item.id, null)
  }, [registered, item.id, state.onRegister])
  useLayoutEffect(()=>{
    if(preview || instance)return
    state.onSourceRegister?.(item.id,selectable.current)
    return ()=>state.onSourceRegister?.(item.id,null)
  },[preview,instance,item.id,state.onSourceRegister])
  const resolved = useMemo(() => resolveSiteLinks(item.id, links, activities, profiles, state.items), [item.id, links, activities, profiles, state.items])
  const animationBase = useMemo(() => new THREE.Vector3(), [])
  useSiteAnimation(root, animationBase, resolved, links.some(l => l.source_kind === 'site' && l.element_ref === item.id), dateRef, preview,
    () => !item.activity_id || presentAt(activity, dateRef.current))
  const rotation = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), item.up_axis === 'z' ? Math.PI / 2 : 0)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), item.yaw * Math.PI / 180)), [item.up_axis, item.yaw])
  const colour = !preview && state.selected === item.id ? '#38bdf8' : item.color
  const arrowShape = useMemo(() => new THREE.Shape([
    new THREE.Vector2(-item.width / 2, item.depth * .1),
    new THREE.Vector2(item.width / 2, item.depth * .1),
    new THREE.Vector2(0, item.depth * .5),
  ]), [item.width, item.depth])
  const material = <ShapeMaterial textures={state.customTextures?.["site:"+item.id]} opacity={state.customOpacity?.["site:"+item.id]} item={item} mapping={state.materialMapping} transmission={state.glassTransmission} preview={preview} colour={colour} />
  return <group ref={motionRoot}><group ref={selectable} position={[item.position.x, item.position.y, item.position.z]}
    rotation={[item.rotation?.x || 0, item.rotation?.y || 0, item.rotation?.z || 0]}
    scale={[item.scale?.x ?? 1, item.scale?.y ?? 1, item.scale?.z ?? 1]}
    visible={!registered || (!state.hiddenIds?.has('site:' + item.id) && (!state.isolate || !!state.isolatedIds?.has('site:' + item.id)))}>
    <group>
    <group ref={root} userData={{ isSitePreview: preview }} visible={preview || !item.activity_id || presentAt(activity, dateRef.current)}>
    <group key={item.color + ':' + state.selected + ':' + preview}>
    {item.kind === 'shape' ? <mesh castShadow receiveShadow onClick={e=>{e.stopPropagation();if(!preview)state.onSelect(item.id,e.shiftKey||e.ctrlKey||e.metaKey)}}><FootprintGeometry item={item}/>{material}</mesh> :
    (item.kind==='array'||item.kind==='scatter') ? <group>{item.layout?.placements?.map((placement,index)=><Item key={index} instance item={{...item,kind:item.placement_kind || 'tree',position:placement.position,yaw:placement.yaw+item.yaw,layout:null,activity_id:null,object_state:null,rotation:undefined,scale:undefined}} state={state} preview={preview} dateRef={dateRef} links={[]} activities={[]} profiles={[]} />)}</group> :
    item.kind === 'fence' ? <group><Fence state={state} item={item} selected={state.selected} preview={preview} select={state.onSelect} /></group> :
      <group quaternion={rotation}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (!state.boxSelecting && !preview && e.delta <= 4) state.onSelect(item.id, e.ctrlKey || e.metaKey || e.shiftKey) }}>
        {item.kind === 'asset' && item.asset_id && <group scale={[item.width, item.height, item.depth]}><SiteAssetModel pathBound={!!item.path_motion && !!curve && !preview && !instance} motionTime={motionTime} playing={item.animation_playing??true} clip={item.animation_clip??0} speed={item.animation_speed??1} textures={state.customTextures?.["site:"+item.id]} opacity={state.customOpacity?.["site:"+item.id]} id={item.asset_id} mapping={state.materialMapping} transmission={state.glassTransmission} preview={preview} selected={selected} onLoaded={geometryReady} /></group>}
        {(item.kind === 'context' || item.kind === 'cabin') && <>
          <mesh position={[0, item.height / 2, 0]} castShadow receiveShadow><boxGeometry args={[item.width, item.height, item.depth]} />{material}</mesh>
          {item.kind === 'cabin' && <mesh position={[0, item.height * .6, item.depth / 2 + .005]}><planeGeometry args={[item.width * .65, item.height * .3]} /><ShapeMaterial textures={state.customTextures?.["site:"+item.id]} opacity={state.customOpacity?.["site:"+item.id]} item={item} slot="windows" mapping={state.materialMapping} transmission={state.glassTransmission} preview={preview} colour="#334155" /></mesh>}
        </>}
        {item.kind === 'tree' && <>
          <mesh position={[0, item.height * .25, 0]} castShadow><cylinderGeometry args={[item.width * .035, item.width * .05, item.height * .5, 8]} /><ShapeMaterial textures={state.customTextures?.["site:"+item.id]} opacity={state.customOpacity?.["site:"+item.id]} item={item} slot="trunk" mapping={state.materialMapping} transmission={state.glassTransmission} preview={preview} colour="#795548" /></mesh>
          <mesh position={[0, item.height * .65, 0]} scale={[item.width / 2, item.height * .35, item.depth / 2]} castShadow><sphereGeometry args={[1, 12, 8]} />{material}</mesh>
        </>}
        {item.kind === 'person' && <>
          <mesh position={[0, item.height * .55, 0]} castShadow><boxGeometry args={[item.width, item.height * .45, item.depth]} />{material}</mesh>
          <mesh position={[0, item.height * .9, 0]} castShadow><sphereGeometry args={[item.height * .1, 10, 8]} />{material}</mesh>
          {[-1, 1].map(sign => <mesh key={sign} position={[sign * item.width * .23, item.height * .17, 0]} castShadow><boxGeometry args={[item.width * .3, item.height * .34, item.depth * .8]} />{material}</mesh>)}
        </>}
        {item.kind === 'arrow' && <>
          <mesh position={[0, item.height / 2, item.depth * .1]}><boxGeometry args={[item.width * .3, item.height, item.depth * .7]} />{material}</mesh>
          <mesh position={[0, item.height, 0]} rotation={[-Math.PI / 2, 0, 0]}><shapeGeometry args={[arrowShape]} />{material}</mesh>
        </>}
      </group>}
    </group>
  </group></group></group></group>
}
export function SiteSceneLayer({ state, activities, links, profiles, dateRef, rendering }: { state: SiteLayerState; activities: Activity[]; links: ModelElementLink[]; profiles: AnimationProfile[]; dateRef: React.MutableRefObject<Date | null>; rendering: boolean }) {
  const items = state.items.filter(i => rendering || i.id !== state.preview?.id)
  return <group name="Prosota site objects">
    {items.map(item => <Item key={item.id} item={item} state={rendering ? { ...state, selected: null, selectedIds: new Set() } : state} preview={false} activity={activities.find(a => a.id === item.activity_id)} dateRef={dateRef} links={links} profiles={profiles} activities={activities} />)}
    {!rendering && state.preview && <Item key={'preview:' + state.preview.id} item={state.preview} state={state} preview dateRef={dateRef} links={links} profiles={profiles} activities={activities} />}
  </group>
}
