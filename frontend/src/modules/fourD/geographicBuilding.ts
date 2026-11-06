import * as T from 'three'
import type { MapFeature, XY } from './geographicContext'

// A closed shell, separate from decorative windows/gutters. Shared profile cuts keep
// the roof and walls watertight for CSG, including concave footprints and courtyards.
export function buildingProfile(f:MapFeature) {
  let longest=0,angle=0
  for(let i=0;i<f.points.length;i++){const a=f.points[i],b=f.points[(i+1)%f.points.length],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d>longest){longest=d;angle=Math.atan2(b[1]-a[1],b[0]-a[0])}}
  const axis:XY=[Math.cos(angle),Math.sin(angle)],normal:XY=[-axis[1],axis[0]]
  const us=f.points.map(p=>p[0]*axis[0]+p[1]*axis[1]),vs=f.points.map(p=>p[0]*normal[0]+p[1]*normal[1])
  const lo=Math.min(...vs),hi=Math.max(...vs),ulo=Math.min(...us),uhi=Math.max(...us),span=hi-lo,h=Math.max(.5,f.height)
  const industrial=f.roof==='industrial',roofRise=f.roof==='flat'?0:Math.min(industrial?1.3:3,h*.23),eave=h-roofRise
  const bays=industrial?Math.min(32,Math.max(1,Math.round(span/10))):1,bay=span/bays
  const cuts=[lo];for(let n=0;n<bays;n++)cuts.push(lo+(n+.5)*bay,lo+(n+1)*bay)
  const level=(p:XY)=>{if(!roofRise||span<.1)return h+.14;const v=p[0]*normal[0]+p[1]*normal[1],phase=Math.max(0,Math.min(bays,(v-lo)/bay));let rise=roofRise*(1-Math.abs((phase%1)*2-1));if(f.roof==='hipped'){const u=p[0]*axis[0]+p[1]*axis[1];rise=Math.min(rise,Math.max(0,Math.min(u-ulo,uhi-u))*.5)}return eave+.14+rise}
  return {angle,axis,normal,lo,hi,ulo,uhi,span,h,industrial,roofRise,eave,bays,bay,cuts,level}
}
function clip(poly:XY[],n:XY,value:number,greater:boolean):XY[]{
  const out:XY[]=[]
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=a[0]*n[0]+a[1]*n[1]-value,db=b[0]*n[0]+b[1]*n[1]-value
    if(greater?da>=0:da<=0)out.push(a)
    if(da*db<0){const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])}}
  return out
}
function geometry(vertices:number[]) {const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.computeVertexNormals();const uv=[];for(let i=0;i<vertices.length;i+=3)uv.push(vertices[i]/5,vertices[i+1]/5);g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));return g}
export function buildingSurfaces(f:MapFeature):{surface:string;geometry:T.BufferGeometry}[]{
  const p=buildingProfile(f),shape=new T.Shape(f.points.map(v=>new T.Vector2(...v)));shape.holes=f.holes.map(h=>new T.Path(h.map(v=>new T.Vector2(...v))))
  const base=new T.ShapeGeometry(shape),pos=base.attributes.position,ix=base.index!,roof:number[]=[],bottom:number[]=[]
  for(let t=0;t<ix.count;t+=3){const tri:XY[]=[0,1,2].map(k=>[pos.getX(ix.getX(t+k)),pos.getY(ix.getX(t+k))]);for(const q of [...tri].reverse())bottom.push(...q,.14)
    for(let c=1;c<p.cuts.length;c++){
      const poly=clip(clip(tri,p.normal,p.cuts[c-1],true),p.normal,p.cuts[c],false)
      // Hipped roofs are the lower envelope of three planes in each ridge
      // interval. Split at those creases instead of warping a large triangle.
      const slope=(c%2?1:-1)*2*p.roofRise/p.bay
      const atStart=(c%2?0:p.roofRise),vPlane=[p.normal[0]*slope,p.normal[1]*slope,atStart-slope*p.cuts[c-1]]
      const planes=f.roof==='hipped'?[vPlane,[p.axis[0]*.5,p.axis[1]*.5,-p.ulo*.5],[-p.axis[0]*.5,-p.axis[1]*.5,p.uhi*.5]]:[vPlane]
      for(let j=0;j<planes.length;j++){let region=poly;const a=planes[j];for(let k=0;k<planes.length;k++)if(k!==j){const b=planes[k];region=clip(region,[a[0]-b[0],a[1]-b[1]],b[2]-a[2],false)}
        for(let i=1;i<region.length-1;i++)for(const q of [region[0],region[i],region[i+1]])roof.push(...q,p.level(q))}
    }}
  base.dispose()
  const result=[{surface:'roof',geometry:geometry(roof)},{surface:'bottom',geometry:geometry(bottom)}]
  for(const [r,ring] of [f.points,...f.holes].entries()){
    const clockwise=T.ShapeUtils.isClockWise(ring.map(v=>new T.Vector2(...v)))
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],va=a[0]*p.normal[0]+a[1]*p.normal[1],vb=b[0]*p.normal[0]+b[1]*p.normal[1]
      const lengthSq=(b[0]-a[0])**2+(b[1]-a[1])**2,extra:number[]=[]
      for(let v=0;v<roof.length;v+=3){const x=roof[v]-a[0],y=roof[v+1]-a[1],t=(x*(b[0]-a[0])+y*(b[1]-a[1]))/lengthSq;if(t>1e-7&&t<1-1e-7&&Math.abs(x*(b[1]-a[1])-y*(b[0]-a[0]))<1e-5)extra.push(t)}
      const ts=[0,1,...extra,...p.cuts.map(v=>(v-va)/(vb-va)).filter(v=>Number.isFinite(v)&&v>1e-8&&v<1-1e-8)].sort((a,b)=>a-b).filter((v,i,all)=>!i||v-all[i-1]>1e-7),verts:number[]=[]
      for(let j=1;j<ts.length;j++){const at=(t:number):XY=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],u=at(ts[j-1]),v=at(ts[j]);const quad=[[...u,.14],[...v,.14],[...u,p.level(u)],[...u,p.level(u)],[...v,.14],[...v,p.level(v)]];if(clockwise===(r===0))for(let n=0;n<6;n+=3)[quad[n],quad[n+2]]=[quad[n+2],quad[n]];verts.push(...quad.flat())}
      result.push({surface:`wall:${r}:${i}`,geometry:geometry(verts)})
    }
  }
  return result
}
