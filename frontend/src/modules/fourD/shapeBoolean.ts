
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Brush, Evaluator, HalfEdgeMap, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg'
import { arraySourceSnapshot, disposeArraySnapshot } from './arraySourceSnapshot'
export type ShapeOperation = 'subtract' | 'excavate' | 'union' | 'intersect'
export interface BooleanResult { name: string; mesh: THREE.Mesh; position: THREE.Vector3 }
export function volume(g: THREE.BufferGeometry) {
  const p=g.getAttribute('position'), index=g.index, a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3()
  const end=Math.min(index?.count ?? p.count,g.drawRange.start+g.drawRange.count)
  let value=0
  for(let i=g.drawRange.start;i<end;i+=3){a.fromBufferAttribute(p,index?index.getX(i):i);b.fromBufferAttribute(p,index?index.getX(i+1):i+1);c.fromBufferAttribute(p,index?index.getX(i+2):i+2);value+=a.dot(b.cross(c))/6}
  return Math.abs(value)
}
export function checkSolid(g: THREE.BufferGeometry) {
  const p=g.getAttribute('position'), idx=g.index, edges=new Map<string,number>()
  const key=(i:number)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',')
  for(let i=0;i<(idx?.count ?? p.count);i+=3){
    const v=[0,1,2].map(j=>key(idx?idx.getX(i+j):i+j))
    if(new Set(v).size<3)continue
    for(let j=0;j<3;j++){const edge=[v[j],v[(j+1)%3]].sort().join('|');edges.set(edge,(edges.get(edge)||0)+1)}
  }
  const topology = new HalfEdgeMap() as HalfEdgeMap & { matchDisjointEdges:boolean; unmatchedEdges:number;degenerateEpsilon:number;unmatchedDisjointEdges?:Map<THREE.Ray,{forward:{start:number;end:number}[];reverse:{start:number;end:number}[]}> }
  // Match the 10 µm vertex tolerance above. Float32 CSG intersections may
  // leave micrometre-length edge fragments on otherwise closed roof seams.
  topology.matchDisjointEdges = true; topology.degenerateEpsilon = 1e-5; topology.updateFrom(g)
  // Near-parallel seams can fail the library's infinite-ray origin comparison:
  // compare the actual finite fragments at the same 10 µm tolerance instead.
  let unmatched=topology.unmatchedEdges>0
  if(unmatched&&topology.unmatchedEdges<=256&&topology.unmatchedDisjointEdges){
    const segments:{a:THREE.Vector3;b:THREE.Vector3}[]=[]
    for(const [ray,info] of topology.unmatchedDisjointEdges)for(const [direction,parts] of [[1,info.forward],[-1,info.reverse]] as const)for(const part of parts){const a=ray.at(direction===1?part.start:part.end,new THREE.Vector3()),b=ray.at(direction===1?part.end:part.start,new THREE.Vector3());if(a.distanceTo(b)>1e-5)segments.push({a,b})}
    unmatched=segments.some((segment,i)=>{
      const delta=segment.b.clone().sub(segment.a),length=delta.length(),unit=delta.divideScalar(length),intervals:number[][]=[]
      for(const [j,other] of segments.entries())if(j!==i&&other.b.clone().sub(other.a).normalize().dot(unit)<-.999999){
        const a=other.a.clone().sub(segment.a),b=other.b.clone().sub(segment.a),start=a.dot(unit),end=b.dot(unit)
        if(a.addScaledVector(unit,-start).length()<=1e-5&&b.addScaledVector(unit,-end).length()<=1e-5)intervals.push([Math.min(start,end),Math.max(start,end)])
      }
      let covered=0;for(const [start,end] of intervals.sort((a,b)=>a[0]-b[0])){if(start>covered+1e-5)break;covered=Math.max(covered,end)}return covered<length-1e-5
    })
  }
  if(!edges.size || [...edges.values()].some(n=>n>2) || unmatched || volume(g)<1e-8)throw Error('Choose closed solids. This input has open or non-manifold surfaces; repair it before cutting.')
}
function compact(g: THREE.BufferGeometry, weld=false) {
  const result=new THREE.BufferGeometry(), index=g.index, start=g.drawRange.start
  const count=Math.min((index?.count ?? g.getAttribute('position').count)-start,g.drawRange.count)
  const position=g.getAttribute('position'),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),vertices:number[]=[],groups:{start:number;count:number;materialIndex:number}[]=[]
  const canonical=new Map<number,THREE.Vector3>(),buckets=new Map<string,THREE.Vector3[]>()
  const point=(i:number)=>{
    if(!weld)return new THREE.Vector3().fromBufferAttribute(position,i)
    if(canonical.has(i))return canonical.get(i)!
    const v=new THREE.Vector3().fromBufferAttribute(position,i),cell=v.toArray().map(n=>Math.floor(n/1e-5))
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const p of buckets.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))||[])if(p.distanceToSquared(v)<1e-10){canonical.set(i,p);return p}
    const key=cell.join(',');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key)!.push(v);canonical.set(i,v);return v
  }
  // CSG can emit zero-area slivers at coplanar roof/courtyard intersections.
  // They have no surface but confuse half-edge matching on subsequent cuts.
  for(let i=start;i<start+count;i+=3){
    const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j)
    a.copy(point(ids[0]));b.copy(point(ids[1]));c.copy(point(ids[2]))
    if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-16)continue
    const materialIndex=g.groups.find(group=>i>=group.start&&i<group.start+group.count)?.materialIndex??0,last=groups[groups.length-1]
    if(last?.materialIndex===materialIndex)last.count+=3;else groups.push({start:vertices.length,count:3,materialIndex})
    vertices.push(...ids)
  }
  for(const name of ['position','normal','uv']){
    const source=g.getAttribute(name); if(!source)continue
    const values=new Float32Array(vertices.length*source.itemSize)
    for(let i=0;i<vertices.length;i++)for(let j=0;j<source.itemSize;j++)values[i*source.itemSize+j]=weld&&name==='position'?point(vertices[i]).getComponent(j):source.getComponent(vertices[i],j)
    result.setAttribute(name,new THREE.BufferAttribute(values,source.itemSize))
  }
  for(const group of groups)result.addGroup(group.start,group.count,group.materialIndex)
  return result
}
export function computeShapeBoolean(base: THREE.Object3D, tool: THREE.Object3D, upAxis:'y'|'z', operation:ShapeOperation): BooleanResult[] {
  const inputs:THREE.Group[]=[], brushes:Brush[]=[], results:BooleanResult[]=[]
  const evaluator=new Evaluator(); evaluator.attributes=['position','normal','uv']
  let triangleCount=0
  try {
    const collect=(source:THREE.Object3D)=>{
      const snapshot=arraySourceSnapshot(source,upAxis,'Boolean input',false);inputs.push(snapshot)
      let combined:Brush|null=null
      let pieces = snapshot.children as THREE.Mesh[]
      // glTF splits a multi-material solid into surface primitives. Validate their
      // combined shell before treating each primitive as a separate solid.
      if (pieces.length > 1 && pieces.some(mesh => { try { checkSolid(mesh.geometry); return false } catch { return true } })) {
        const count=pieces.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.getAttribute('position').count)/3,0)
        if(triangleCount+count>20000)throw Error('Use individual solids under 20,000 triangles in total, rather than a whole detailed model.')
        const parts:THREE.BufferGeometry[]=[], materials:THREE.Material[]=[], groups:{start:number;count:number;materialIndex:number}[]=[]
        let offset=0
        try {
          for(const mesh of pieces){
            const g=compact(mesh.geometry);parts.push(g)
            if(!g.getAttribute('normal'))g.computeVertexNormals()
            if(!g.getAttribute('uv'))g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count*2),2))
            const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material],base=materials.length;materials.push(...mats)
            const size=g.getAttribute('position').count
            for(const group of g.groups.length?g.groups:[{start:0,count:size,materialIndex:0}])groups.push({start:offset+group.start,count:group.count,materialIndex:base+(group.materialIndex??0)})
            offset+=size
          }
          const joined=mergeGeometries(parts,false)
          if(!joined)throw Error('Cannot combine the material surfaces of this solid.')
          try {checkSolid(joined)}catch(e){joined.dispose();throw e}
          for(const g of groups)joined.addGroup(g.start,g.count,g.materialIndex)
          const brush=new Brush(joined,materials);brush.updateMatrixWorld();brushes.push(brush)
          triangleCount+=count
          return brush
        } finally {parts.forEach(g=>g.dispose())}
      }
      for(const node of pieces){
        const mesh=node as THREE.Mesh,g=mesh.geometry
        triangleCount+=(g.index?.count ?? g.getAttribute('position').count)/3
        if(triangleCount>20000)throw Error('Use individual solids under 20,000 triangles in total, rather than a whole detailed model.')
        checkSolid(g)
        if(!g.getAttribute('normal'))g.computeVertexNormals()
        if(!g.getAttribute('uv'))g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count*2),2))
        const brush=new Brush(g,mesh.material);brush.updateMatrixWorld();brushes.push(brush)
        if(combined){combined=evaluator.evaluate(combined,brush,ADDITION);combined.updateMatrixWorld();brushes.push(combined)}else combined=brush
      }
      if(!combined)throw Error('No solid geometry in input')
      return combined
    }
    const a=collect(base),b=collect(tool)
    const operations=operation==='excavate'?[SUBTRACTION,INTERSECTION]:[operation==='union'?ADDITION:operation==='intersect'?INTERSECTION:SUBTRACTION]
    for(let i=0;i<operations.length;i++){
      const brush=evaluator.evaluate(a,b,operations[i]);brushes.push(brush)
      const g=compact(brush.geometry,true)
      if(!g.getAttribute('position').count || volume(g)<1e-8){g.dispose();throw Error(operation==='excavate'?'Excavation needs a partial overlap: both remaining and removed volumes must exist.':'The operation produced no solid. Check the overlap of your inputs.')}
      g.computeBoundingBox(); const box=g.boundingBox!, centre=box.getCenter(new THREE.Vector3()),anchor=new THREE.Vector3(centre.x,box.min.y,centre.z)
      g.translate(-anchor.x,-anchor.y,-anchor.z)
      const mats=Array.isArray(brush.material)?brush.material:[brush.material]
      const material=operation==='excavate'&&i===1?new THREE.MeshStandardMaterial({color:'#dc2626',roughness:.8}):mats.map(m=>m.clone())
      if(!Array.isArray(material))g.clearGroups()
      const mesh=new THREE.Mesh(g,material);mesh.name=i===1?'Excavated section':'Result'
      results.push({name:mesh.name,mesh,position:anchor.clone().applyAxisAngle(new THREE.Vector3(1,0,0),upAxis==='z'?Math.PI/2:0)})
    }
    return results
  } catch(error){disposeBooleanResults(results);throw error}
  finally {
    const geometries=new Set(brushes.map(b=>b.geometry));for(const g of geometries)g.dispose()
    for(const input of inputs)disposeArraySnapshot(input)
  }
}
export function disposeBooleanResults(results:BooleanResult[]) {
  for(const {mesh} of results){mesh.geometry.dispose();for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.dispose()}
}
