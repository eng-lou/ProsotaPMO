import { Vector3 } from 'three'

// Earcut can omit a collinear vertex on a cap which a neighbouring depth step
// needs on its wall. Split only the affected triangles at those shared vertices.
export function matchGroundSeams(values:number[]) {
  const vertices=new Float32Array(values),points=new Map<string,Vector3>(),ids:string[]=[]
  for(let i=0;i<vertices.length;i+=3){
    const id=vertices[i]+','+vertices[i+1]+','+vertices[i+2]
    ids.push(id)
    if(!points.has(id))points.set(id,new Vector3(vertices[i],vertices[i+1],vertices[i+2]))
  }
  const unmatched=new Map<string,number>()
  for(let i=0;i<ids.length;i+=3)for(let k=0;k<3;k++){
    const a=ids[i+k],b=ids[i+(k+1)%3],key=a<b?a+'|'+b:b+'|'+a
    if(!unmatched.delete(key))unmatched.set(key,i+k)
  }
  if(!unmatched.size)return orientSeams(vertices)
  const next=(edge:number)=>edge-edge%3+(edge+1)%3
  const ends=new Set<Vector3>()
  for(const edge of unmatched.values()){
    ends.add(points.get(ids[edge])!);ends.add(points.get(ids[next(edge)])!)
  }
  const axes=['x','y','z'] as const
  const sorted=axes.map(axis=>[...ends].sort((a,b)=>a[axis]-b[axis]))
  const splits=new Map<number,Vector3[]>(),delta=new Vector3(),offset=new Vector3()
  for(const edge of unmatched.values()){
    const a=points.get(ids[edge])!,b=points.get(ids[next(edge)])!
    delta.subVectors(b,a)
    const length=delta.length()
    if(length<=2e-5)continue
    delta.divideScalar(length)
    // Search the longest axis of the finite edge, then test distance to its line.
    const axis=Math.abs(delta.x)>=Math.abs(delta.y)&&Math.abs(delta.x)>=Math.abs(delta.z)?0:Math.abs(delta.y)>=Math.abs(delta.z)?1:2
    const coord=axes[axis],list=sorted[axis],lo=Math.min(a[coord],b[coord]),hi=Math.max(a[coord],b[coord])
    let left=0,right=list.length
    while(left<right){const mid=(left+right)>>>1;if(list[mid][coord]<lo)left=mid+1;else right=mid}
    const inside:{p:Vector3;t:number}[]=[]
    for(let j=left;j<list.length&&list[j][coord]<=hi;j++){
      const p=list[j],t=offset.subVectors(p,a).dot(delta)
      if(t>1e-5&&t<length-1e-5&&offset.addScaledVector(delta,-t).lengthSq()<=1e-10)inside.push({p,t})
    }
    if(inside.length)splits.set(edge,inside.sort((u,v)=>u.t-v.t).map(hit=>hit.p))
  }
  if(!splits.size)return orientSeams(vertices)
  const result:number[]=[]
  for(let i=0;i<ids.length;i+=3){
    if(!splits.has(i)&&!splits.has(i+1)&&!splits.has(i+2)){for(let j=i*3;j<i*3+9;j++)result.push(vertices[j]);continue}
    const boundary:Vector3[]=[],centre=new Vector3()
    for(let k=0;k<3;k++){
      const p=points.get(ids[i+k])!
      centre.add(p);boundary.push(p,...(splits.get(i+k)??[]))
    }
    centre.divideScalar(3)
    for(let k=0;k<boundary.length;k++){
      const a=boundary[k],b=boundary[(k+1)%boundary.length]
      result.push(centre.x,centre.y,centre.z,a.x,a.y,a.z,b.x,b.y,b.z)
    }
  }
  return orientSeams(new Float32Array(result))
}


// Thin cap triangles around touching holes can wind the same way as the face
// across their edge. Orient each connected shell consistently for later cuts.
function orientSeams(vertices:Float32Array){
  const count=vertices.length/9,links=new Int32Array(count*3),edges=new Map<string,number>()
  let inconsistent=false
  for(let t=0;t<count;t++){
    const ids=[0,1,2].map(k=>{const i=9*t+3*k;return vertices[i]+','+vertices[i+1]+','+vertices[i+2]})
    for(let k=0;k<3;k++){
      const a=ids[k],b=ids[(k+1)%3]
      if(a===b)continue
      const key=a<b?a+'|'+b:b+'|'+a,sign=a<b?1:-1,edge=3*t+k,other=edges.get(key)
      if(other===undefined){edges.set(key,sign*(edge+1));continue}
      const neighbour=Math.abs(other)-1,same=Math.sign(other)===sign
      links[edge]=(same?-1:1)*(Math.floor(neighbour/3)+1)
      links[neighbour]=(same?-1:1)*(t+1)
      inconsistent||=same;edges.delete(key)
    }
  }
  if(!inconsistent)return vertices
  const state=new Int8Array(count)
  for(let first=0;first<count;first++){
    if(state[first])continue
    const connected=[first];state[first]=1
    for(let i=0;i<connected.length;i++){
      const t=connected[i]
      for(let k=0;k<3;k++){
        const link=links[3*t+k],other=Math.abs(link)-1
        if(link && !state[other]){state[other]=state[t]*Math.sign(link);connected.push(other)}
      }
    }
    const keep=connected.reduce((sum,t)=>sum+state[t],0)>=0?1:-1
    for(const t of connected)if(state[t]!==keep){
      const j=9*t+3
      for(let k=0;k<3;k++){const v=vertices[j+k];vertices[j+k]=vertices[j+3+k];vertices[j+3+k]=v}
    }
  }
  return vertices
}
