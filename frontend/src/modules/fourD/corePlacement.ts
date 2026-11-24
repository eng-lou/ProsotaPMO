import { Box2, Object3D, Vector2, Vector3 } from 'three'
import { constructionTriangles } from './constructionHost'
import type { HostSource } from './constructionLayout'
import { coreFrame } from './coreRig'

/** Footprint and elevations in glTF metres, independent of the project up axis. */
export function readCoreLift(sources:HostSource[],axis:'y'|'z'){
  if(!sources.length)throw Error('Select the first core lift or its walls in the viewport.')
  const zero=new Vector2(),points:Vector2[]=[],headings=new Set<number>()
  let top=-Infinity,base=Infinity,minTop=Infinity
  for(const source of sources){
    if(source.ifcType&&!/^Ifc(Wall|BuildingElementPart|BuildingElementProxy|ElementAssembly)/i.test(source.ifcType))
      throw Error('Select core walls from one lift. '+source.name+' is '+source.ifcType+'.')
    const {triangles,worldBounds}=constructionTriangles(source.object,axis)
    const elevation=worldBounds.max.y
    if(worldBounds.isEmpty()||elevation-worldBounds.min.y<.0001)throw Error(source.name+' has no measurable lift height.')
    base=Math.min(base,worldBounds.min.y);top=Math.max(top,elevation);minTop=Math.min(minTop,elevation)
    let hasTop=false
    // A whole lift can contain touching walls with T-junctions in their top faces.
    // Use the actual top triangles, so no stitched ring around the assembly is required.
    const vertices=new Set<Vector3>()
    for(const triangle of triangles){
      if(!triangle.every(p=>Math.abs(p.y-elevation)<.0001))continue
      hasTop=true
      for(const [i,p] of triangle.entries()){
        vertices.add(p)
        const q=triangle[(i+1)%3],angle=Math.atan2(q.z-p.z,q.x-p.x)
        headings.add(Math.round((((angle%Math.PI)+Math.PI)%(Math.PI/2))*1e7)/1e7)
      }
    }
    if(!hasTop)throw Error(source.name+' needs a level top face for the first lift.')
    for(const p of vertices)points.push(new Vector2(p.x,p.z))
  }
  if(top-minTop>.02)throw Error('The selected core tops have different elevations. Select a single lift.')
  let area=Infinity,heading=0,box=new Box2()
  for(const angle of [...headings].sort((a,b)=>a-b)){
    const candidate=new Box2().setFromPoints(points.map(p=>p.clone().rotateAround(zero,-angle)))
    const size=candidate.getSize(new Vector2())
    if(size.x*size.y<area-1e-7){box=candidate;area=size.x*size.y;heading=angle}
  }
  const centre=box.getCenter(new Vector2()).rotateAround(zero,heading),size=box.getSize(new Vector2())
  if(!(area>0&&Number.isFinite(area)))throw Error('The selected core has no measurable footprint.')
  if(size.y>size.x){heading+=Math.PI/2;size.set(size.y,size.x)}
  return {centre,size,heading,base,top,refs:sources.map(s=>s.backupRef??s.id)}
}

export function fitCoreRig(lift:ReturnType<typeof readCoreLift>,normalized:Object3D,
  dimensions:{width:number;height:number;depth:number},axis:'y'|'z'){
  const frame=coreFrame(normalized)
  const opening=frame?.userData.clear_opening_m
  if(!frame||!Array.isArray(opening)||!(opening[0]>0&&opening[1]>0))throw Error('The core rig has no opening dimensions.')
  const width=dimensions.width*lift.size.x/opening[0],depth=dimensions.depth*lift.size.y/opening[1]
  // Assets are normalized around their full bounds, including the hanging platform.
  // The authored frame origin is the shutter base, not the GLB bounding-box base.
  const offset=frame.getWorldPosition(new Vector3()).multiply(new Vector3(width,dimensions.height,depth))
  const position=new Vector3(lift.centre.x,lift.base,lift.centre.y)
    .sub(offset.applyAxisAngle(new Vector3(0,1,0),-lift.heading))
  if(axis==='z')position.applyAxisAngle(new Vector3(1,0,0),Math.PI/2)
  return {width,depth,height:dimensions.height,yaw:-lift.heading*180/Math.PI,
    position:{x:position.x,y:position.y,z:position.z}}
}
