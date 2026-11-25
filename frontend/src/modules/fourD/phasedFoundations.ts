import {Box3,ExtrudeGeometry,Group,Mesh,MeshStandardMaterial,ShapeUtils,Vector2,Vector3} from 'three'
import {partitionGround,type GroundPrism, type FoundationPrisms} from './groundPrisms'
import {sameOutline,verifiedSlabProfile} from './slabPourProfile'
import {volume} from './shapeBoolean'
import {overlaps as footprintsOverlap} from './deckBearing'
import {faceShapes,isExterior} from './constructionHost'
import {arraySourceSnapshot,disposeArraySnapshot} from './arraySourceSnapshot'
import type {IfcAPI} from 'web-ifc'
import {GroundBooleans,readGroundSolid,solidGeometry,type GroundSolid} from './groundSolids'
import type {GroundCut,GroundOptions,GroundPiece} from './groundFromObjects'
import type {HostSource} from './constructionLayout'

function offsetRing(ring:Vector2[],distance:number){
  if(!distance)return ring
  const sign=ShapeUtils.area(ring)>0?1:-1
  return ring.map((p,i)=>{
    const before=p.clone().sub(ring[(i+ring.length-1)%ring.length]).normalize(),after=ring[(i+1)%ring.length].clone().sub(p).normalize()
    const a=new Vector2(before.y,-before.x).multiplyScalar(sign),b=new Vector2(after.y,-after.x).multiplyScalar(sign)
    const d=1+a.dot(b)
    if(d<.01)throw Error('Working space cannot offset this sharp corner. Reduce the allowance or split the foundation selection.')
    return p.clone().addScaledVector(a.add(b),distance/d)
  })
}
export function phasedFoundations(cuts:GroundCut[],base:HostSource|null,axis:'y'|'z',options:GroundOptions,space:number,blind:number,api:IfcAPI,progress?:(message:string)=>void){
  if(!cuts.length)throw Error('Add at least one excavation object.')
  if(!(space>=0&&space<=10&&blind>0&&blind<=1))throw Error('Enter working space of 0–10 m and a blinding thickness up to 1 m.')
  const bounds=new Box3()
  for(const cut of cuts)for(const r of cut.rings)for(const p of r){bounds.expandByPoint(new Vector3(p.x,cut.bottom-blind,p.y));bounds.expandByPoint(new Vector3(p.x,cut.top,p.y))}
  const origin=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3())
  const ops=new GroundBooleans(api),pieces:GroundPiece[]=[],refs:string[]=[],skipped:string[]=[]
  function snapshot(s:HostSource){
    const group=arraySourceSnapshot(s.object,axis,s.name,false)
    try{
      group.children.forEach(n=>(n as Mesh).geometry.translate(-origin.x,-origin.y,-origin.z))
      let profile
      try {profile=verifiedSlabProfile(group,1e-5)} catch { /* Non-prismatic solids use their closed 3D meshes. */ }
      if(profile){
        const prism={rings:profile.outline,low:profile.bottom,high:profile.top}
        return {shape:prism,solid:()=>extrude(prism)}
      }
      const solid=ops.source(group,s.name)
      return {shape:null,solid:()=>solid}
    } finally {disposeArraySnapshot(group)}
  }
  function prism(cut:GroundCut,low:number,high:number,offset:number){
    const rings=cut.rings.map(r=>offsetRing(r,isExterior(r,cut.rings)?offset:-offset).map(p=>new Vector2(p.x-origin.x,p.y-origin.z)))
    return {rings,low:low-origin.y,high:high-origin.y}
  }
  function extrude(p:GroundPrism){
    const geometry=new ExtrudeGeometry(faceShapes(p.rings),{depth:p.high-p.low,bevelEnabled:false}).rotateX(Math.PI/2).translate(0,p.high,0)
    try{return readGroundSolid(geometry)}finally{geometry.dispose()}
  }
  function output(s:GroundSolid,phase:GroundPiece['phase'],label:string,color:string){
    if(!s.vertices.length)return
    const scene=new Group(),anchor=s.bounds.getCenter(new Vector3())
    anchor.y=s.bounds.min.y
    const geometry=solidGeometry(s)
    // Outputs can share an operand after a disjoint subtraction.
    const centred=geometry.clone().translate(-anchor.x,-anchor.y,-anchor.z)
    geometry.dispose()
    centred.computeVertexNormals()
    scene.add(new Mesh(centred,new MeshStandardMaterial({color})))
    anchor.add(origin)
    if(axis==='z')anchor.applyAxisAngle(new Vector3(1,0,0),Math.PI/2)
    pieces.push({phase,preview:{scene,anchor,label,hosts:refs.length,parts:1,sourceRefs:refs}})
  }
  try{
    let site:ReturnType<typeof snapshot>
    if(base)site=snapshot(base)
    else{
      const top=options.top??bounds.max.y,bottom=options.bottom??bounds.min.y-1
      if(!(Number.isFinite(options.margin)&&options.margin>0&&Number.isFinite(top)&&Number.isFinite(bottom)&&top>bottom))throw Error('Check the site margin and ground elevations.')
      const x=size.x/2+options.margin+space,z=size.z/2+options.margin+space
      const shape={rings:[[new Vector2(-x,-z),new Vector2(x,-z),new Vector2(x,z),new Vector2(-x,z)]],low:bottom-origin.y,high:top-origin.y}
      site={shape,solid:()=>extrude(shape)}
    }
    const soil=site.solid(),top=soil.bounds.max.y+origin.y
    const shapes:FoundationPrisms[]=[]
    const cuts3d:{excavation:GroundPrism;bed:GroundPrism;concrete:()=>GroundSolid}[]=[]
    for(const cut of cuts){
      if(cut.bottom-blind>=top-1e-5){skipped.push(cut.name);continue}
      const excavation=prism(cut,cut.bottom-blind,top,space)
      const overlaps=excavation.rings.some(ring=>{
        const box=new Box3()
        for(const p of ring){box.expandByPoint(new Vector3(p.x,excavation.low,p.y));box.expandByPoint(new Vector3(p.x,excavation.high,p.y))}
        return box.intersectsBox(soil.bounds)
      })
      if(!overlaps || (site.shape && !footprintsOverlap(site.shape.rings,excavation.rings))){skipped.push(cut.name);continue}
      const bed=prism(cut,cut.bottom-blind,cut.bottom,0),concrete=snapshot(cut.source)
      if(concrete.shape){
        // The measured host and its baked mesh pass through Float32 at different
        // points. Use the same boundary for a verified shared bedding interface.
        const c=concrete.shape
        const sameBase=Math.abs(c.low-bed.high)<1e-4 && sameOutline(c.rings,bed.rings)
        shapes.push({excavation,bed,concrete:sameBase?{rings:bed.rings,low:bed.high,high:cut.top-origin.y}:c})
      }
      cuts3d.push({excavation,bed,concrete:concrete.solid})
      refs.push(cut.id)
    }
    if(!cuts3d.length)throw Error('The selected exclusions do not reach the ground base. Check their elevations and positions.')
    progress?.('Building excavation and foundation phases…')
    let remaining:GroundSolid,removed:GroundSolid,blinding:GroundSolid,concrete:GroundSolid,fill:GroundSolid
    if(site.shape && shapes.length===cuts3d.length){
      ;[remaining,removed,blinding,concrete,fill]=partitionGround(site.shape,shapes)
    }else{
      const cutters=ops.union(cuts3d.map(p=>extrude({...p.excavation,high:p.excavation.high+.02})))
      remaining=ops.subtract(soil,cutters)
      removed=ops.subtract(soil,remaining)
      concrete=ops.union(cuts3d.map(p=>p.concrete()))
      const beds=ops.union(cuts3d.map(p=>extrude(p.bed)))
      blinding=ops.subtract(ops.intersect(beds,removed),concrete)
      fill=ops.subtract(ops.subtract(removed,concrete),blinding)
      const measure=(s:GroundSolid)=>{const g=solidGeometry(s);try{return volume(g)}finally{g.dispose()}}
      const total=measure(soil)
      if(Math.abs(total-measure(remaining)-measure(removed))>Math.max(1e-6,total*1e-5))throw Error('The ground cut could not preserve the site volume. Check the selected foundation solids and their overlap with the site.')
    }
    if(!remaining.vertices.length)throw Error('The exclusions remove the entire site. Enlarge the base or review the selection.')
    if(!removed.vertices.length)throw Error('The selected exclusions do not intersect the ground base.')
    output(remaining,undefined,'Ground · remaining soil','#896349')
    output(removed,'excavation','Excavation · combined foundations','#996b49')
    output(blinding,'blinding','Foundation blinding','#b6b2a7')
    output(concrete,'concrete','Foundation concrete','#aba9a4')
    output(fill,'backfill','Backfill around foundations','#9c7755')
    return {pieces,skipped}
  }catch(e){pieces.forEach(p=>disposeArraySnapshot(p.preview.scene));throw e}
}
