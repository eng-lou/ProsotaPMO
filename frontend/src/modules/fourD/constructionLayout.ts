import { Box3, BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, Vector2, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { splitSiteAsset } from './assetParts'
import { buildConstruction, constructionEdges, constructionModes, exposedShutterRuns, perimeterRuns, type ConstructionOptions, type PropPiece } from './constructionGeometry'
import { readConstructionHost, type ConstructionHost } from './constructionHost'
import { importSiteAsset, loadSiteAsset, type SiteAsset } from './siteAssets'
import { findDeckBearing, hasBearingGap, overlaps, type SlabLookup } from './deckBearing'
import type { SiteItem } from './siteScene'

export interface HostSource {id:string; name:string; object:Object3D; ifcType?:string; backupRef?:string; slabLookup?:SlabLookup}
export function readPropKit(scene:Object3D){
  scene.updateWorldMatrix(true,true)
  const prop=scene.getObjectByName('Prop_-125_-19'),tripod=scene.getObjectByName('Tripod_-125_-19')
  if(!prop || !tripod)throw Error('The slab formwork asset is missing its prop or tripod.')
  const box=new Box3().setFromObject(prop),origin=box.getCenter(new Vector3())
  const tripodBase=new Box3().setFromObject(tripod,true).min.y
  const pieces:PropPiece[]=[]
  for(const node of [prop,tripod]) node.traverse(child=>{
    if(child instanceof Mesh && child.material instanceof MeshStandardMaterial){
      const geo=child.geometry.clone().applyMatrix4(child.matrixWorld).translate(-origin.x,node===tripod?-tripodBase:-box.min.y,-origin.z)
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

export interface ConstructionPreview { scene: Group; anchor:Vector3; hosts:number; parts:number; label:string; bearingSummary?:string; mode?:ConstructionOptions['mode']; measuredBearing?:boolean; sourceRefs?:string[]; cachedAsset?:SiteAsset }
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

export function selectedDeckBearing(host:ConstructionHost,floors:ConstructionHost[]){
  const candidates=floors.map(floor=>({floor,height:host.origin.y-floor.origin.y-floor.height})).filter(c=>c.height>.001 && c.height<=10)
  const nearest=Math.min(...candidates.map(c=>c.height))
  if(nearest<.75)throw Error(host.name+' has less than 0.75 m clear above the next slab. Review the support layout.')
  const zero=new Vector2()
  const surfaces=candidates.filter(c=>c.height<=nearest+.001).map(({floor})=>{
    const offset=new Vector2(floor.origin.x-host.origin.x,floor.origin.z-host.origin.z)
    return floor.rings.map(r=>r.map(p=>p.clone().rotateAround(zero,floor.angle).add(offset).rotateAround(zero,-host.angle)))
  }).filter(rings=>overlaps(host.rings,rings))
  if(!surfaces.length)throw Error(host.name+' has no overlapping slab at the bearing level immediately below.')
  return {clearance:nearest,bearingSurfaces:surfaces}
}

export async function prepareConstruction(sources:HostSource[],upAxis:'y'|'z',options:ConstructionOptions,skipEdges:number[],supportSources:HostSource[]=[]){
  if(!sources.length)throw Error('Select one or more IFC elements or individual mesh objects in the viewport.')
  const {mode}=options
  const wallHost=mode==='wall'||mode==='wallForm'
  const supported=mode==='deck'||mode==='beam'
  const expected=mode==='beam'||mode==='groundBeam'?'beam':mode==='column'||mode==='shutter'?'column':wallHost?'wall':'slab'
  const elements=sources.map(source=>{
    const type=source.ifcType?.toLowerCase()
    if(type && !type.includes(expected) && /ifc(slab|wall|column|beam|door|window)/.test(type))
      throw Error(source.name+' is a '+source.ifcType+'. Select a '+expected+' for this layout.')
    try{return readConstructionHost(source.name,source.object,upAxis,mode==='wallForm'?'wallForm':wallHost)}
    catch(e){throw Error(source.name+': '+(e instanceof Error?e.message:e))}
  })
  const floors=supported||mode==='screen'?supportSources.map(s=>readConstructionHost(s.name,s.object,upAxis,'slabTop')):[]
  const root=new Group(),base=elements[0].origin
  const kit=supported?await loadPropKit():[]
  // Previews own their materials; the small authored prop kit is shared between previews.
  const finishes=new Map<MeshStandardMaterial,MeshStandardMaterial>()
  const pieces=kit.map(p=>{
    if(!finishes.has(p.material))finishes.set(p.material,p.material.clone())
    return {...p,material:finishes.get(p.material)!}
  })
  const runs=mode==='screen'?perimeterRuns(elements):undefined
  const shutterRuns=['slabEdge','groundBeam','beam'].includes(mode)?exposedShutterRuns(elements):undefined
  const omittedScreens:string[]=[]
  let parts=0
  const deckHeights:number[]=[]
  let matchedSlabs=0
  const partialBearing:string[]=[]
  try{
    for(const [i,host] of elements.entries()){
      const edges=mode==='screen'?constructionEdges(host):[]
      if(skipEdges.some(n=>n>edges.length))throw Error(host.name+' has '+edges.length+' exterior edges.')
      const excludedEdges=new Set(skipEdges.map(n=>edges[n-1].id))
      const screenRuns=runs?.[i]
      if(mode==='screen' && screenRuns && screenRuns.every(run=>excludedEdges.has(run.edge.id)))continue
      const lookup=sources[i].slabLookup
      let bearing=supported && lookup && !floors.length ? await findDeckBearing(host,lookup,upAxis,options) : undefined
      if(floors.length)bearing=selectedDeckBearing(host,floors)
      if(supported && !bearing && (lookup || options.requireBearing))throw Error('No supporting slab found. Pick the bearing slab below, then reselect the host. Check openings and setbacks.')
      if(supported){
        deckHeights.push(bearing?.clearance??options.clearance)
        if(bearing){
          matchedSlabs++
          if(hasBearingGap(host.rings,bearing.bearingSurfaces))partialBearing.push(host.name)
        }
      }
      const lowerShoe=bearing&&mode==='screen'?{rings:bearing.bearingSurfaces,shoeElevation:-bearing.clearance-Math.min(.1,...floors.filter(f=>Math.abs(host.origin.y-f.origin.y-f.height-bearing!.clearance)<.001).map(f=>f.height/2)),omitted:omittedScreens}:undefined
      const model=buildConstruction(host,{...options,excludedEdges,screenRuns,screenBearing:lowerShoe,shutterRuns:shutterRuns?.[i],...bearing},pieces)
      model.rotation.y=-host.angle
      model.position.copy(host.origin).sub(base)
      model.children.forEach(g=>{
        g.userData.prosotaSourceFile=floors.length>1&&elements.length>1?host.name+' · '+g.name:g.name
        g.userData.constructionHost=sources[i].backupRef || sources[i].id
      })
      parts+=model.children.length
      root.add(model)
    }
    if(!parts)throw Error(omittedScreens.length?'No screen bays fit both slab edges at this screen height. Review setbacks and lift height.':'No exposed edges remain for the perimeter screens.')
    root.updateMatrixWorld(true)
    const bounds=new Box3().setFromObject(root)
    const anchor=bounds.getCenter(new Vector3());anchor.y=bounds.min.y;anchor.add(base)
    if(upAxis==='z')anchor.applyMatrix4(new Matrix4().makeRotationX(Math.PI/2))
    const label=constructionModes[mode]+' - '+(elements.length===1?elements[0].name:elements.length+' hosts')
    let bearingSummary:string|undefined
    if(deckHeights.length) {
      const min=Math.min(...deckHeights).toFixed(3), max=Math.max(...deckHeights).toFixed(3)
      const height=(min===max ? min : min+' to '+max)+' m below soffit'
      const support=matchedSlabs===deckHeights.length ? 'Measured bearing slab' : matchedSlabs ? 'IFC slabs and projected support planes' : 'Projected support plane'
      bearingSummary=support+' / '+height+(matchedSlabs?' · Prop feet are fitted inside the lower slab and clear of its openings.':'')
    }
    if(partialBearing.length)bearingSummary+=' Review the uncovered soffit at '+partialBearing.slice(0,3).join(', ')+(partialBearing.length>3?' and '+(partialBearing.length-3)+' more hosts.':'.')
    if(mode==='screen'&&floors.length)bearingSummary=omittedScreens.length?omittedScreens.length+' screen bay(s) excluded. Check setbacks or screen height. '+omittedScreens.slice(0,3).join(', '):'Screen shoes fit the upper and lower slab edges.'
    return {scene:root,anchor,mode,measuredBearing:supported && matchedSlabs===elements.length,sourceRefs:sources.map(s=>s.backupRef??s.id),hosts:elements.length,parts,label:label.slice(0,96),bearingSummary} as ConstructionPreview
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
  const item:SiteItem={id:crypto.randomUUID(),name:preview.label,kind:'asset',construction_mode:preview.mode,measured_bearing:preview.measuredBearing,construction_sources:preview.sourceRefs,asset_id:asset.id,...asset.dimensions,
    up_axis:upAxis,position:{x,y,z},yaw:0,units:'m',generator_version:1,locked:false,color:'#ffffff',activity_id:null,
    path_id:null,points:[],closed:false,module_length:2,gate_start:0,gate_width:0,animation_playing:false}
  return separate&&preview.parts>1?splitSiteAsset(item,await loadSiteAsset(asset.id)):[item]
}
