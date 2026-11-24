import { Box3, BoxGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Vector2, Vector3 } from 'three'
import { faceShapes, readConstructionHost } from './constructionHost'
import type { ConstructionPreview, HostSource } from './constructionLayout'
import { computeShapeBoolean, disposeBooleanResults, type BooleanResult } from './shapeBoolean'
import { arraySourceSnapshot, disposeArraySnapshot } from './arraySourceSnapshot'

type Axis='y'|'z'
export interface GroundPiece { preview:ConstructionPreview; sourceId?:string; phase?:'excavation'|'blinding'|'concrete'|'backfill' }
export interface GroundOptions { margin:number; top?:number; bottom?:number }
const east=new Vector3(1,0,0)
const soil=()=>new MeshStandardMaterial({color:'#866449',roughness:.96})
export function groundCutSource(source:HostSource,axis:Axis){
  if(source.ifcType&&!/^Ifc(Pile|Footing|Slab|Beam|BuildingElementProxy|BuildingElementPart)/i.test(source.ifcType))
    throw Error('Select piles, pile caps, slabs or beams. '+source.name+' is '+source.ifcType+'.')
  // A pile with a pointed toe has no horizontal bottom face. Its head defines the bore.
  const host=readConstructionHost(source.name,source.object,axis,/^IfcPile/i.test(source.ifcType??'')?'slabTop':false)
  const rings=host.rings.map(r=>r.map(p=>p.clone().rotateAround(new Vector2(),host.angle).add(new Vector2(host.origin.x,host.origin.z))))
  return {source, id:source.backupRef??source.id,name:source.name,rings,bottom:host.origin.y,top:host.origin.y+host.height}
}
export type GroundCut=ReturnType<typeof groundCutSource>
export function makeGround(cuts:GroundCut[],base:HostSource|null,axis:Axis,options:GroundOptions){
  if(!cuts.length)throw Error('Add at least one excavation object.')
  if(!base&&(!Number.isFinite(options.margin)||options.margin<=0))throw Error('Enter a positive site margin.')
  const bounds=new Box3()
  for(const cut of cuts)for(const ring of cut.rings)for(const p of ring){
    bounds.expandByPoint(new Vector3(p.x,cut.bottom,p.y));bounds.expandByPoint(new Vector3(p.x,cut.top,p.y))
  }
  const centre=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3())
  // Keep CSG vertices near a local origin even when the IFC uses large site coordinates.
  const origin=new Vector3(centre.x,bounds.min.y,centre.z)
  let initial:Group
  if(base){
    initial=arraySourceSnapshot(base.object,axis,'Site base',false)
    initial.children.forEach(n=>(n as Mesh).geometry.translate(-origin.x,-origin.y,-origin.z))
  }else{
    const top=options.top??bounds.max.y,bottom=options.bottom??Math.min(bounds.min.y-1,top-1)
    if(!Number.isFinite(top)||!Number.isFinite(bottom)||bottom>=top)throw Error('Site base elevation must be below ground level.')
    initial=new Group()
    const geom=new BoxGeometry(size.x+2*options.margin,top-bottom,size.z+2*options.margin)
    initial.add(new Mesh(geom.translate(0,(top+bottom)/2-origin.y,0),soil()))
  }
  const top=new Box3().setFromObject(initial).max.y
  let current:Group|Mesh=initial
  const pieces:GroundPiece[]=[],skipped:string[]=[]
  const owned=new Set<BooleanResult>()
  function piece(result:BooleanResult,label:string,sourceId?:string){
    const scene=new Group()
    scene.add(result.mesh)
    // Result geometry is already centred horizontally and anchored at its lowest point.
    result.mesh.position.set(0,0,0)
    const anchor=result.position.clone().add(origin)
    if(axis==='z')anchor.applyAxisAngle(east,Math.PI/2)
    return {sourceId,preview:{scene,anchor,hosts:1,parts:1,label:label.slice(0,95)}}
  }
  let remaining:BooleanResult|undefined
  try{
    for(const cut of cuts){
      const bottom=cut.bottom-origin.y
      if(top-bottom<=.0001){skipped.push(cut.name);continue}
      const rings=cut.rings.map(r=>r.map(p=>new Vector2(p.x-origin.x,p.y-origin.z)))
      const cutter=new Group(),material=soil()
      for(const shape of faceShapes(rings)){
        const geometry=new ExtrudeGeometry(shape,{depth:top-bottom+.05,bevelEnabled:false}).rotateX(Math.PI/2)
        cutter.add(new Mesh(geometry.translate(0,top+.05,0),material))
      }
      let result:BooleanResult[]
      try{result=computeShapeBoolean(current,cutter,'y','excavate',true)}
      catch(error){throw Error(cut.name+' · '+(error as Error).message)}
      finally{disposeArraySnapshot(cutter)}
      result.forEach(r=>owned.add(r))
      const removed=result.find(r=>r.mesh.userData.prosotaShapeOperation.role==='removed')
      const rest=result.find(r=>r.mesh.userData.prosotaShapeOperation.role==='result')
      if(!removed){
        if(rest){disposeBooleanResults([rest]);owned.delete(rest)}
        skipped.push(cut.name);continue
      }
      if(!rest)throw Error(cut.name+' removes the entire remaining site. Enlarge the base or review the selection.')
      if(remaining){disposeBooleanResults([remaining]);owned.delete(remaining)}
      remaining=rest;current=rest.mesh;current.position.copy(rest.position)
      const materials=Array.isArray(removed.mesh.material)?removed.mesh.material:[removed.mesh.material]
      materials.forEach(m=>m.dispose())
      removed.mesh.material=soil()
      pieces.push(piece(removed,'Excavation · '+cut.name,cut.id))
    }
    if(!remaining)throw Error('The selected exclusions do not intersect the ground base.')
    pieces.unshift(piece(remaining,'Ground · remaining soil'))
    return {pieces,skipped}
  }catch(error){disposeBooleanResults([...owned]);throw error}
  finally{disposeArraySnapshot(initial)}
}
