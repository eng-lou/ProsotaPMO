import { Box2, Group, Matrix4, Mesh, Vector2 } from 'three'
import { readIfcClashMeshes } from './clashMeshCapture'
import { getExpressIdWorldBounds } from './elementBatching'
import type { IfcModelHandle } from './ifcModel'
import { readConstructionHost, spans, type ConstructionHost } from './constructionHost'
import type { ConstructionOptions } from './constructionGeometry'

export interface SlabLookup { handle: IfcModelHandle; expressID: number }
const zero = new Vector2()

// Test for common floor area, including openings, before choosing a bearing elevation.
function overlaps(a: Vector2[][], b: Vector2[][]) {
  const xs = [...new Set([...a.flat(), ...b.flat()].map(p => p.x))].sort((l,r) => l-r)
  for (let i=1; i<xs.length; i++) {
    const x=(xs[i-1]+xs[i])/2
    const left=spans(a,false,x), right=spans(b,false,x)
    if (left.some(([lo,hi])=>right.some(([l,h])=>Math.min(hi,h)-Math.max(lo,l)>.0001))) return true
  }
  // Thin angled strips can cross between two sampled sections.
  for (const ar of a) for (const br of b) for (const [i,p] of ar.entries()) {
    const d=ar[(i+1)%ar.length].clone().sub(p)
    for (const [j,q] of br.entries()) {
      const e=br[(j+1)%br.length].clone().sub(q), det=d.cross(e)
      if (Math.abs(det)<1e-12) continue
      const delta=q.clone().sub(p), t=delta.cross(e)/det, u=delta.cross(d)/det
      if (t>0 && t<1 && u>0 && u<1) return true
    }
  }
  return false
}

export async function findDeckBearing(host:ConstructionHost, {handle,expressID}:SlabLookup, upAxis:'y'|'z', options:ConstructionOptions) {
  const {IFCSLAB}=await import('web-ifc')
  const toYUp=new Matrix4().makeRotationX(upAxis==='z'?-Math.PI/2:0)
  const hostOrigin=new Vector2(host.origin.x,host.origin.z)
  const planBounds=new Box2().setFromPoints(host.rings.flat().map(p=>p.clone().rotateAround(zero,host.angle).add(hostOrigin)))
  const candidates:{ id:number; clearance:number }[]=[]
  handle.object.updateWorldMatrix(true,false)
  const ids=handle.api.GetLineIDsWithType(handle.ifcModelID,IFCSLAB,true)
  for(let i=0;i<ids.size();i++) {
    const id=ids.get(i)
    if(id===expressID) continue
    const box=getExpressIdWorldBounds(handle.object,id)?.applyMatrix4(toYUp)
    if(!box || box.max.x<=planBounds.min.x || box.min.x>=planBounds.max.x || box.max.z<=planBounds.min.y || box.min.z>=planBounds.max.y) continue
    const clearance=host.origin.y-box.max.y
    if(clearance<.75 || clearance>10 || (!options.autoClearance && Math.abs(clearance-options.clearance)>.005)) continue
    candidates.push({id,clearance})
  }
  const bearingSurfaces:Vector2[][][]=[]
  let clearance:number|undefined
  for(const candidate of candidates.sort((a,b)=>a.clearance-b.clearance)) {
    if(clearance!==undefined && candidate.clearance-clearance>.001) break
    const group=new Group()
    for(const mesh of readIfcClashMeshes(handle.object,candidate.id)) {
      mesh.updateWorldMatrix(true,false)
      const proxy=new Mesh(mesh.geometry,mesh.material)
      proxy.matrixAutoUpdate=false
      proxy.matrix.copy(mesh.matrixWorld)
      group.add(proxy)
    }
    const floor=readConstructionHost('Bearing slab',group,upAxis,'slabTop')
    const delta=new Vector2(floor.origin.x,floor.origin.z).sub(hostOrigin)
    const rings=floor.rings.map(r=>r.map(p=>p.clone().rotateAround(zero,floor.angle).add(delta).rotateAround(zero,-host.angle)))
    if(overlaps(host.rings,rings)) {
      bearingSurfaces.push(rings)
      clearance??=candidate.clearance
    }
  }
  return clearance===undefined ? undefined : {bearingSurfaces,clearance}
}
