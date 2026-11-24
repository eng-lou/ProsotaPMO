import {Box3,BoxGeometry,ExtrudeGeometry,Group,Mesh,MeshStandardMaterial,ShapeUtils,Vector2,Vector3} from 'three'
import {faceShapes,isExterior} from './constructionHost'
import {arraySourceSnapshot,disposeArraySnapshot} from './arraySourceSnapshot'
import {computeShapeBoolean,disposeBooleanResults,type BooleanResult} from './shapeBoolean'
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
export function phasedFoundations(cuts:GroundCut[],base:HostSource|null,axis:'y'|'z',options:GroundOptions,space:number,blind:number){
  if(!cuts.length||!(space>=0&&space<=10&&blind>0&&blind<=1))throw Error('Enter working space of 0–10 m and a blinding thickness up to 1 m.')
  const bounds=new Box3()
  for(const cut of cuts)for(const r of cut.rings)for(const p of r){bounds.expandByPoint(new Vector3(p.x,cut.bottom-blind,p.y));bounds.expandByPoint(new Vector3(p.x,cut.top,p.y))}
  const origin=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3())
  const inputs:Group[]=[],owned=new Set<BooleanResult>(),pieces:GroundPiece[]=[]
  const group=()=>{const g=new Group();inputs.push(g);return g}
  function snapshot(s:HostSource){
    const g=arraySourceSnapshot(s.object,axis,s.name,false);inputs.push(g)
    g.children.forEach(n=>(n as Mesh).geometry.translate(-origin.x,-origin.y,-origin.z))
    return g
  }
  function prism(g:Group,cut:GroundCut,low:number,high:number,offset:number,color:string){
    if(high<=low)return
    const rings=cut.rings.map(r=>offsetRing(r,isExterior(r,cut.rings)?offset:-offset).map(p=>new Vector2(p.x-origin.x,p.y-origin.z)))
    for(const shape of faceShapes(rings)){
      const geo=new ExtrudeGeometry(shape,{depth:high-low,bevelEnabled:false}).rotateX(Math.PI/2).translate(0,high-origin.y,0)
      g.add(new Mesh(geo,new MeshStandardMaterial({color})))
    }
  }
  function boolean(a:Group|Mesh,b:Group|Mesh,op:'excavate'|'intersect'|'subtract'|'union'){
    const results=computeShapeBoolean(a,b,'y',op,true)
    for(const r of results){owned.add(r);r.mesh.position.copy(r.position)}
    return results
  }
  function output(r:BooleanResult,phase:GroundPiece['phase'],label:string,color:string){
    const scene=new Group(),mesh=r.mesh.clone();mesh.position.set(0,0,0)
    mesh.geometry=r.mesh.geometry.clone();mesh.material=new MeshStandardMaterial({color});mesh.geometry.clearGroups();scene.add(mesh)
    const anchor=r.position.clone().add(origin)
    if(axis==='z')anchor.applyAxisAngle(new Vector3(1,0,0),Math.PI/2)
    pieces.push({phase,preview:{scene,anchor,label,hosts:cuts.length,parts:1,sourceRefs:cuts.map(c=>c.id)}})
  }
  try{
    const soil=base?snapshot(base):group()
    if(!base){
      const top=options.top??bounds.max.y,bottom=options.bottom??bounds.min.y-1
      if(!(options.margin>0&&top>bottom))throw Error('Check the site margin and ground elevations.')
      soil.add(new Mesh(new BoxGeometry(size.x+2*(options.margin+space),top-bottom,size.z+2*(options.margin+space)).translate(0,(top+bottom)/2-origin.y,0),new MeshStandardMaterial()))
    }
    const top=new Box3().setFromObject(soil).max.y+origin.y
    const excavation=group(),blinding=group(),concrete=group()
    for(const cut of cuts){
      prism(excavation,cut,cut.bottom-blind,top+.02,space,'#865f44')
      prism(blinding,cut,cut.bottom-blind,cut.bottom,0,'#b5b0a2')
      const s=snapshot(cut.source);concrete.add(...s.children.slice())
    }
    const result=boolean(soil,excavation,'excavate')
    const remaining=result.find(r=>r.mesh.userData.prosotaShapeOperation.role==='result')
    const voidVolume=result.find(r=>r.mesh.userData.prosotaShapeOperation.role==='removed')
    if(!remaining||!voidVolume)throw Error('Foundations must partially intersect the site base.')
    output(remaining,undefined,'Ground · remaining soil','#896349')
    output(voidVolume,'excavation','Excavation · combined foundations','#996b49')
    const foundation=boolean(voidVolume.mesh,concrete,'intersect')[0]
    if(!foundation)throw Error('No foundation concrete lies inside the excavation.')
    const bedding=boolean(voidVolume.mesh,blinding,'intersect')[0]
    const cleanBedding=bedding&&boolean(bedding.mesh,concrete,'subtract')[0]
    if(cleanBedding)output(cleanBedding,'blinding','Foundation blinding','#b6b2a7')
    // The staged concrete also includes upstands above grade. The soil cut is only
    // used to calculate excavation, blinding and backfill volumes.
    const full=boolean(concrete,foundation.mesh,'union')[0]
    if(!full)throw Error('Cannot reconstruct the selected foundation solids.')
    output(full,'concrete','Foundation concrete','#aba9a4')
    const free=boolean(voidVolume.mesh,concrete,'subtract')[0]
    const fill=free&&boolean(free.mesh,blinding,'subtract')[0]
    if(fill)output(fill,'backfill','Backfill around foundations','#9c7755')
    return {pieces,skipped:[] as string[]}
  }catch(e){pieces.forEach(p=>disposeArraySnapshot(p.preview.scene));throw e}
  finally{disposeBooleanResults([...owned]);inputs.forEach(disposeArraySnapshot)}
}
