import { Box2, Box3, InstancedMesh, Matrix4, Mesh, Object3D, Path, Shape, ShapeUtils, Vector2, Vector3 } from 'three'
import { fullDetailGeometry } from './contextGeometry'

/** Work in metres around each host. Plan coordinates are X/Z in glTF's Y-up space. */
export interface ConstructionHost {
  name: string
  origin: Vector3
  angle: number
  height: number
  rings: Vector2[][]
  bounds: Box2
  wallFace: Vector2[][]
}
type Triangle = [Vector3, Vector3, Vector3]
const tolerance = .0001
const key = (v: Vector2) => Math.round(v.x/tolerance)+','+Math.round(v.y/tolerance)

function flatFace(triangles: Triangle[], axis: 'y'|'z', elevation: number): Vector2[][] {
  const vertices = new Map<string, Vector2>()
  const edges = new Map<string, [string,string]>()
  const faces = new Set<string>()
  for (const triangle of triangles) {
    if (triangle.some(p => Math.abs(p[axis]-elevation)>tolerance)) continue
    const points=triangle.map(p=>new Vector2(p.x,axis==='y'?p.z:p.y))
    const ids=points.map(key)
    const face=[...ids].sort().join('|')
    if (new Set(ids).size<3 || faces.has(face)) continue
    faces.add(face)
    ids.forEach((a,i)=>{
      const b=ids[(i+1)%3], edge=a<b?a+'|'+b:b+'|'+a
      vertices.set(a,points[i])
      if(edges.has(edge)) edges.delete(edge)
      else edges.set(edge,[a,b])
    })
  }
  const adjacent=new Map<string,string[]>()
  for(const [a,b] of edges.values()){
    if(!adjacent.has(a)) adjacent.set(a,[])
    if(!adjacent.has(b)) adjacent.set(b,[])
    adjacent.get(a)!.push(b)
    adjacent.get(b)!.push(a)
  }
  const rings:Vector2[][]=[]
  while(adjacent.size){
    const first=adjacent.keys().next().value!
    let next=first, previous=''
    const ring:Vector2[]=[]
    do {
      const neighbours=adjacent.get(next)
      if(neighbours?.length!==2) throw Error('The selected face has an open or intersecting boundary.')
      ring.push(vertices.get(next)!)
      adjacent.delete(next)
      const following=neighbours[0]===previous?neighbours[1]:neighbours[0]
      previous=next; next=following
    } while(next!==first)
    const corners=ring.filter((b,i)=>{
      const a=ring[(i+ring.length-1)%ring.length], c=ring[(i+1)%ring.length]
      const ab=b.clone().sub(a),bc=c.clone().sub(b)
      return Math.abs(ab.cross(bc))>tolerance*(ab.length()+bc.length())
    })
    if(corners.length>=3) rings.push(corners)
  }
  return rings.sort((a,b)=>Math.abs(ShapeUtils.area(b))-Math.abs(ShapeUtils.area(a)))
}

export function readConstructionHost(name:string,object:Object3D,upAxis:'y'|'z',needWallFace:boolean|'wallForm'=false):ConstructionHost {
  object.updateWorldMatrix(true,true)
  const triangles:Triangle[]=[]
  const worldBounds=new Box3()
  const yUp=new Matrix4().makeRotationX(upAxis==='z'?-Math.PI/2:0)
  object.traverse(node=>{
    if(!(node instanceof Mesh)) return
    const geometry=fullDetailGeometry(node.geometry)
    const positions=geometry.getAttribute('position')
    if(!positions)return
    const index=geometry.index
    const start=geometry.drawRange.start,end=Math.min(index?.count??positions.count,start+geometry.drawRange.count)
    const count=node instanceof InstancedMesh?node.count:1
    if(triangles.length+count*(end-start)/3>300000) throw Error('Select individual structural elements for this layout.')
    for(let instance=0;instance<count;instance++){
      const transform=yUp.clone().multiply(node.matrixWorld)
      if(node instanceof InstancedMesh){
        const matrix=new Matrix4();node.getMatrixAt(instance,matrix);transform.multiply(matrix)
      }
      const points=new Map<number,Vector3>()
      function point(i:number){
        const id=index?index.getX(i):i
        let p=points.get(id)
        if(!p){
          p=new Vector3().fromBufferAttribute(positions,id).applyMatrix4(transform)
          worldBounds.expandByPoint(p);points.set(id,p)
        }
        return p
      }
      for(let i=start;i+2<end;i+=3)triangles.push([point(i),point(i+1),point(i+2)])
    }
  })
  const origin=worldBounds.getCenter(new Vector3())
  origin.y=worldBounds.min.y
  const height=worldBounds.max.y-origin.y
  if(!Number.isFinite(height)||height<tolerance)throw Error('Select a solid with a base and a measurable thickness.')
  const vertices=new Set(triangles.flat())
  vertices.forEach(v=>v.sub(origin))
  const rings=flatFace(triangles,'y',0)
  if(!rings.length)throw Error('This creator needs a host with a level underside.')
  let angle=0,longest=0
  for(const ring of rings)for(let i=0;i<ring.length;i++){
    const d=ring[(i+1)%ring.length].clone().sub(ring[i])
    if(d.lengthSq()>longest){longest=d.lengthSq();angle=Math.atan2(d.y,d.x)}
  }
  if(needWallFace==='wallForm'){
    // A door can split the underside into short piers. Orient panels from the wall faces.
    const directions=new Map<number,{angle:number;area:number}>()
    for(const [a,b,c] of triangles){
      const normal=b.clone().sub(a).cross(c.clone().sub(a)),area=normal.length()
      if(area<tolerance*tolerance || Math.abs(normal.y)>area*tolerance)continue
      const tangent=Math.atan2(-normal.x,normal.z)
      const key=Math.round(((tangent%Math.PI)+Math.PI)%Math.PI*10000)%Math.round(Math.PI*10000)
      const direction=directions.get(key)
      if(direction)direction.area+=area
      else directions.set(key,{angle:tangent,area})
    }
    let bestArea=0
    for(const direction of directions.values())if(direction.area>bestArea){bestArea=direction.area;angle=direction.angle}
  }
  // Make grid direction independent of triangle winding.
  angle=((angle%Math.PI)+Math.PI)%Math.PI
  const zero=new Vector2()
  rings.forEach(r=>r.forEach(p=>p.rotateAround(zero,-angle)))
  const bounds=new Box2().setFromPoints(rings.flat())
  let wallFace:Vector2[][]=[]
  if(needWallFace){
    const rotation=new Matrix4().makeRotationY(angle)
    vertices.forEach(v=>v.applyMatrix4(rotation))
    if(needWallFace==='wallForm'){
      // A two-sided panel set requires a single straight, constant-thickness wall.
      for(const [a,b,c] of triangles){
        const normal=b.clone().sub(a).cross(c.clone().sub(a))
        if(Math.abs(normal.z)<=tolerance*normal.length())continue
        if(![bounds.min.y,bounds.max.y].some(z=>[a,b,c].every(p=>Math.abs(p.z-z)<tolerance))){
          throw Error('Select each straight, constant-thickness wall separately.')
        }
      }
    }
    wallFace=flatFace(triangles,'z',bounds.min.y)
    if(!wallFace.length)throw Error('Select a straight wall with planar faces.')
  }
  return {name,origin,angle,height,rings,bounds,wallFace}
}

export function contains(ring:Vector2[],p:Vector2){
  let inside=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j]
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside
  }
  return inside
}

export function isExterior(ring:Vector2[],rings:Vector2[][]){
  return rings.filter(other=>other!==ring && contains(other,ring[0])).length%2===0
}

export function faceShapes(rings:Vector2[][]){
  const outers=rings.filter(r=>isExterior(r,rings))
  return outers.map(outer=>{
    const shape=new Shape(outer)
    for(const hole of rings.filter(r=>!isExterior(r,rings))){
      const owner=outers.filter(r=>contains(r,hole[0])).sort((a,b)=>Math.abs(ShapeUtils.area(a))-Math.abs(ShapeUtils.area(b)))[0]
      if(owner===outer)shape.holes.push(new Path(hole))
    }
    return shape
  })
}

/** Intersect a parallel row with every boundary, including interior openings. */
export function spans(rings:Vector2[][],alongX:boolean,at:number):[number,number][]{
  const cross=alongX?'y':'x', along=alongX?'x':'y'
  const hits:number[]=[]
  for(const ring of rings)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length]
    if((a[cross]>at)===(b[cross]>at))continue
    hits.push(a[along]+(at-a[cross])*(b[along]-a[along])/(b[cross]-a[cross]))
  }
  hits.sort((a,b)=>a-b)
  const result:[number,number][]=[]
  for(let i=0;i+1<hits.length;i+=2)if(hits[i+1]-hits[i]>tolerance)result.push([hits[i],hits[i+1]])
  return result
}

/** Evenly spaced centrelines, inset from each end. */
export function rowPositions(lo:number,hi:number,spacing:number,inset:number){
  if(!Number.isFinite(spacing)||spacing<=0)throw Error('Spacing must be a positive distance.')
  if(hi-lo<=2*inset)return [(lo+hi)/2]
  const count=Math.ceil((hi-lo-2*inset)/spacing)
  if(count>4000)throw Error('Use a wider spacing or select a smaller zone.')
  return Array.from({length:count+1},(_,i)=>lo+inset+i*(hi-lo-2*inset)/count)
}
