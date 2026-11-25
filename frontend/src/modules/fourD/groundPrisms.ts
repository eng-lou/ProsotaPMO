import { ShapeUtils, Vector2 } from 'three'
import { contains } from './constructionHost'
import { matchGroundSeams } from './groundSeams'
import { groundSolid } from './groundSolids'

export type GroundPrism = { rings:Vector2[][]; low:number; high:number }
export type FoundationPrisms = { excavation:GroundPrism; bed:GroundPrism; concrete:GroundPrism }
type Edge = {left:Vector2; right:Vector2; shape:number}
const remainingSoil=1,excavation=2,blinding=4,foundationConcrete=8,backfill=16
type Band = {lo:number; hi:number; mask:Uint8Array}
type Boundary = Map<string, Map<string,Vector2>>
const snap=(x:number)=>Math.round(x*1e6)/1e6
const unique=(values:number[])=>[...new Set(values.map(snap))].sort((a,b)=>a-b)
const heightAt=(e:Edge,x:number)=>e.left.y+(x-e.left.x)*(e.right.y-e.left.y)/(e.right.x-e.left.x)
const key=(p:Vector2)=>p.x+','+p.y

function addEdge(edges:Boundary,a:Vector2,b:Vector2){
  a=new Vector2(snap(a.x),snap(a.y));b=new Vector2(snap(b.x),snap(b.y))
  const start=key(a),end=key(b)
  if(start===end)return
  const reverse=edges.get(end)
  if(reverse?.delete(start)){if(!reverse.size)edges.delete(end);return}
  if(!edges.has(start))edges.set(start,new Map())
  edges.get(start)!.set(end,b)
}

// A sweep can introduce several nearly coincident vertices around a real
// corner. Bound the error across the whole removed run so the corner survives.
function simplifyRing(ring:Vector2[]){
  const points=[...ring,ring[0]],keep=new Set([0,ring.length]),stack=[[0,ring.length]]
  while(stack.length){
    const [first,last]=stack.pop()!,a=points[first],b=points[last]
    const dx=b.x-a.x,dz=b.y-a.y,length=dx*dx+dz*dz
    let furthest=-1,error=1e-12
    for(let i=first+1;i<last;i++){
      const px=points[i].x-a.x,pz=points[i].y-a.y
      const t=length?Math.max(0,Math.min(1,(px*dx+pz*dz)/length)):0
      const d=(px-t*dx)**2+(pz-t*dz)**2
      if(d>error){error=d;furthest=i}
    }
    if(furthest>0){keep.add(furthest);stack.push([first,furthest],[furthest,last])}
  }
  return ring.filter((_,i)=>keep.has(i))
}

function ringsFromEdges(edges:Boundary){
  const rings:Vector2[][]=[]
  while(edges.size){
    const [first,starts]=edges.entries().next().value!
    let at=first,next=starts.values().next().value!
    const ring:Vector2[]=[]
    do{
      const options=edges.get(at)
      if(!options?.size)throw Error('Could not close the combined ground outline. Review the working space at touching edges.')
      if(options.size===1)next=options.values().next().value!
      else if(ring.length){
        // At a shared corner follow the same filled region, which is on the left.
        const pivot=ring[ring.length-1],prev=ring[ring.length-2]
        if(prev){
          const dx=pivot.x-prev.x,dz=pivot.y-prev.y
          let best=-Infinity
          for(const candidate of options.values()){
            const x=candidate.x-pivot.x,z=candidate.y-pivot.y,turn=Math.atan2(dx*z-dz*x,dx*x+dz*z)
            if(turn>best){best=turn;next=candidate}
          }
        }else next=options.values().next().value!
      }
      const end=key(next)
      options.delete(end)
      if(!options.size)edges.delete(at)
      ring.push(next);at=end
    }while(at!==first)
    const corners=simplifyRing(ring)
    if(corners.length>=3)rings.push(corners)
  }
  return rings
}

function cap(rings:Vector2[][],y:number,up:boolean,out:number[]){
  const regions=rings.filter(r=>ShapeUtils.area(r)>0).map(outer=>({outer,holes:[] as Vector2[][]})).sort((a,b)=>ShapeUtils.area(a.outer)-ShapeUtils.area(b.outer))
  for(const hole of rings.filter(r=>ShapeUtils.area(r)<0)){
    const region=regions.find(r=>contains(r.outer,hole[0]))
    if(!region)throw Error('Could not resolve an opening in the combined ground outline.')
    region.holes.push(hole)
  }
  for(const {outer,holes} of regions){
    const vertices=[...outer,...holes.flat()]
    for(const [a,b,c] of ShapeUtils.triangulateShape(outer,holes)){
      for(const i of up?[a,c,b]:[a,b,c])out.push(vertices[i].x,y,vertices[i].y)
    }
  }
}

// Between consecutive edge crossings every boundary is straight. Sweep in plan,
// keeping only edges where phase membership changes. Triangulate each resulting
// face once, including its holes, so a large site stays lightweight in the viewer.
export function partitionGround(site:GroundPrism,foundations:FoundationPrisms[]){
  const shapes=[site,...foundations.flatMap(f=>[f.excavation,f.bed,f.concrete])]
  const levels=unique(shapes.flatMap(s=>[s.low,s.high])).filter((y,i,all)=>!i||y-all[i-1]>1e-5)
  const edges:Edge[]=[],xs:number[]=[]
  for(const [shape,s] of shapes.entries())for(const ring of s.rings)for(let i=0;i<ring.length;i++){
    const vertex=(p:Vector2)=>new Vector2(snap(p.x),snap(p.y))
    const a=vertex(ring[i]),b=vertex(ring[(i+1)%ring.length])
    xs.push(a.x)
    if(a.x!==b.x)edges.push({left:a.x<b.x?a:b,right:a.x<b.x?b:a,shape})
  }
  edges.sort((a,b)=>a.left.x-b.left.x)
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
    const a=edges[i],b=edges[j],left=b.left.x,right=Math.min(a.right.x,b.right.x)
    if(left>=a.right.x)break
    const dl=heightAt(a,left)-heightAt(b,left),dr=heightAt(a,right)-heightAt(b,right)
    if(dl*dr<0)xs.push(left+(right-left)*dl/(dl-dr))
  }
  const breaks=[...new Set(xs)].sort((a,b)=>a-b),empty=new Uint8Array(levels.length-1)
  // For each height interval store its side perimeter, then its exposed top
  // and bottom perimeters at the lower elevation.
  const layers=levels.map(()=>Array.from({length:3},()=>Array.from({length:5},()=>new Map() as Boundary)))
  function boundary(left:Uint8Array,right:Uint8Array,a:Vector2,b:Vector2){
    function record(l:number,r:number,sets:Boundary[]){
      const change=l^r
      if(!change)return
      for(let i=0;i<5;i++)if(change&(1<<i)){
        if(l&(1<<i))addEdge(sets[i],a,b)
        else addEdge(sets[i],b,a)
      }
    }
    for(let k=0;k<levels.length;k++){
      const l=left[k]??0,r=right[k]??0,lb=left[k-1]??0,rb=right[k-1]??0
      record(l,r,layers[k][0])
      record(lb&~l,rb&~r,layers[k][1])
      record(l&~lb,r&~rb,layers[k][2])
    }
  }
  function maskAt(active:Set<number>){
    const masks=new Uint8Array(levels.length-1)
    for(let k=0;k<masks.length;k++){
      const y=(levels[k]+levels[k+1])/2
      let soil=false,voided=false,bed=false,concrete=false
      for(const id of active){
        const s=shapes[id]
        if(y<=s.low||y>=s.high)continue
        if(id===0)soil=true
        else if(id%3===1)voided=true
        else if(id%3===2)bed=true
        else concrete=true
      }
      let mask=concrete?foundationConcrete:0
      if(soil && !voided)mask|=remainingSoil
      if(soil && voided){
        mask|=excavation
        if(!concrete)mask|=bed?blinding:backfill
      }
      masks[k]=mask
    }
    return masks
  }
  function seam(x:number,left:Band[],right:Band[]){
    const ends=unique([...left,...right].flatMap(b=>[b.lo,b.hi]))
    let l=0,r=0
    for(let i=1;i<ends.length;i++){
      const lo=ends[i-1],hi=ends[i],mid=(lo+hi)/2
      while(l<left.length&&left[l].hi<mid)l++
      while(r<right.length&&right[r].hi<mid)r++
      const a=left[l]&&left[l].lo<mid?left[l].mask:empty,b=right[r]&&right[r].lo<mid?right[r].mask:empty
      boundary(a,b,new Vector2(x,lo),new Vector2(x,hi))
    }
  }
  let previous:Band[]=[]
  for(let i=1;i<breaks.length;i++){
    const x0=breaks[i-1],x1=breaks[i],mid=(x0+x1)/2
    const crossings=edges.filter(e=>e.left.x<mid&&e.right.x>mid).map(e=>({e,z:heightAt(e,mid)})).sort((a,b)=>a.z-b.z)
    const active=new Set<number>(),left:Band[]=[],right:Band[]=[]
    let before=empty
    for(let j=0;j<crossings.length;){
      const low=crossings[j],z0=snap(heightAt(low.e,x0)),z1=snap(heightAt(low.e,x1))
      do{
        const id=crossings[j++].e.shape
        if(active.has(id))active.delete(id);else active.add(id)
      }while(j<crossings.length&&snap(heightAt(crossings[j].e,x0))===z0&&snap(heightAt(crossings[j].e,x1))===z1)
      const after=maskAt(active)
      boundary(after,before,new Vector2(x0,z0),new Vector2(x1,z1))
      if(j<crossings.length){
        const high=crossings[j].e,h0=snap(heightAt(high,x0)),h1=snap(heightAt(high,x1))
        if(h0>z0)left.push({lo:z0,hi:h0,mask:after})
        if(h1>z1)right.push({lo:z1,hi:h1,mask:after})
      }
      before=after
    }
    seam(x0,previous,left);previous=right
  }
  seam(breaks[breaks.length-1],previous,[])
  const faces:number[][]=Array.from({length:5},()=>[])
  for(let k=0;k<layers.length;k++)for(let part=0;part<5;part++){
    const out=faces[part],y=levels[k],top=levels[k+1]
    for(const ring of ringsFromEdges(layers[k][0][part]))for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length]
      out.push(a.x,y,a.y,a.x,top,a.y,b.x,top,b.y,a.x,y,a.y,b.x,top,b.y,b.x,y,b.y)
    }
    cap(ringsFromEdges(layers[k][1][part]),y,true,out)
    cap(ringsFromEdges(layers[k][2][part]),y,false,out)
  }
  return faces.map(v=>groundSolid(matchGroundSeams(v)))
}
