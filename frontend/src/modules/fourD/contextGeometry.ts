import type { BufferGeometry } from 'three'
const fullDetail = new WeakMap<BufferGeometry, BufferGeometry>()
export function registerContextGeometry(coarse: BufferGeometry, source: BufferGeometry) { fullDetail.set(coarse, source) }
export function fullDetailGeometry(geometry: BufferGeometry) { return fullDetail.get(geometry) ?? geometry }

export interface ContextGeometryData { position: Float32Array; normal?: Float32Array; uv?: Float32Array; index: Uint32Array }

// Vertex clustering for distant, static context assets. Quantised normals and
// UVs keep cutout leaf seams separate. The original geometry is never mutated.
export function simplifyContextGeometry(source: ContextGeometryData, cells = 12): ContextGeometryData {
  const {position, normal, uv} = source
  const index = thinSmallComponents(source)
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity]
  for(let i=0;i<position.length;i+=3) for(let a=0;a<3;a++){min[a]=Math.min(min[a],position[i+a]);max[a]=Math.max(max[a],position[i+a])}
  const scale = max.map((v,a)=>cells/Math.max(v-min[a],1e-6))
  const map = new Map<string,number>(), remap = new Uint32Array(position.length/3)
  const positions:number[]=[], normals:number[]=[], uvs:number[]=[]
  for(let i=0;i<remap.length;i++) {
    const p=i*3,u=i*2
    let key = `${Math.round((position[p]-min[0])*scale[0])},${Math.round((position[p+1]-min[1])*scale[1])},${Math.round((position[p+2]-min[2])*scale[2])}`
    if(normal) key+=`/${Math.round(normal[p])},${Math.round(normal[p+1])},${Math.round(normal[p+2])}`
    if(uv) key+=`/${Math.round(uv[u]*2)},${Math.round(uv[u+1]*2)}`
    let id=map.get(key)
    if(id===undefined) {
      id=positions.length/3;map.set(key,id)
      positions.push(position[p],position[p+1],position[p+2])
      if(normal)normals.push(normal[p],normal[p+1],normal[p+2])
      if(uv)uvs.push(uv[u],uv[u+1])
    }
    remap[i]=id
  }
  const triangles:number[]=[],seen=new Set<string>()
  for(let i=0;i<index.length;i+=3) {
    const a=remap[index[i]],b=remap[index[i+1]],c=remap[index[i+2]]
    if(a===b||b===c||a===c)continue
    const key=`${a},${b},${c}`
    if(seen.has(key))continue
    seen.add(key);triangles.push(a,b,c)
  }
  return {position:new Float32Array(positions),normal:normal?new Float32Array(normals):undefined,uv:uv?new Float32Array(uvs):undefined,index:new Uint32Array(triangles)}
}

// Trees often consist of thousands of disconnected leaf/twig components. A
// vertex-only reducer cannot simplify them without welding texture seams.
// At distant detail, retain the two largest small components in each spatial
// cell, plus EVERY larger component. Whole leaves keep their original UVs and
// topology; source data remains available for close views and exports.
function thinSmallComponents({position,index}: ContextGeometryData): Uint32Array {
  if(index.length<150000)return index
  const parent=Uint32Array.from({length:position.length/3},(_,i)=>i)
  const find=(start:number)=>{let at=start;while(parent[at]!==at){parent[at]=parent[parent[at]];at=parent[at]}return at}
  for(let i=0;i<index.length;i+=3){parent[find(index[i+1])]=find(index[i]);parent[find(index[i+2])]=find(index[i])}
  type Component={id:number;count:number;min:number[];max:number[]}
  const parts=new Map<number,Component>(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
  for(let i=0;i<position.length;i+=3)for(let a=0;a<3;a++){min[a]=Math.min(min[a],position[i+a]);max[a]=Math.max(max[a],position[i+a])}
  for(let i=0;i<index.length;i++){
    const vertex=index[i],id=find(vertex)
    let part=parts.get(id)
    if(!part){part={id,count:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};parts.set(id,part)}
    part.count++
    for(let a=0;a<3;a++){const value=position[vertex*3+a];part.min[a]=Math.min(part.min[a],value);part.max[a]=Math.max(part.max[a],value)}
  }
  const extent=Math.max(...max.map((v,a)=>v-min[a])),keep=new Set<number>(),cells=new Map<string,Component[]>()
  const size=(p:Component)=>p.max.reduce((sum,v,a)=>sum+(v-p.min[a])**2,0)
  for(const part of parts.values()){
    if(part.count>384 || part.max.some((v,a)=>v-part.min[a]>extent/12)){keep.add(part.id);continue}
    const key=part.min.map((v,a)=>Math.floor(((v+part.max[a])/2-min[a])*16/Math.max(max[a]-min[a],1e-6))).join(',')
    const cell=cells.get(key)??[];cell.push(part);cell.sort((a,b)=>size(b)-size(a)||a.id-b.id);if(cell.length>2)cell.pop();cells.set(key,cell)
  }
  for(const cell of cells.values())for(const part of cell)keep.add(part.id)
  const result:number[]=[]
  for(let i=0;i<index.length;i+=3)if(keep.has(find(index[i])))result.push(index[i],index[i+1],index[i+2])
  return new Uint32Array(result)
}
