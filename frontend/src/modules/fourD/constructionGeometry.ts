import { Box2, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, ExtrudeGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, RepeatWrapping, Shape, ShapeUtils, Vector2, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { contains, faceShapes, isExterior, rowPositions, spans, type ConstructionHost } from './constructionHost'

export const constructionModes = {
  deck: 'Slab formwork', shutter: 'Column shutters', wallForm: 'Wall formwork', screen: 'Perimeter screens',
  mat: 'Slab reinforcement mat', column: 'Column reinforcement cage', wall: 'Wall reinforcement cage',
} as const
export type ConstructionMode = keyof typeof constructionModes
export interface ConstructionOptions {
  mode:ConstructionMode
  spacing:number
  clearance:number
  autoClearance?:boolean
  bearingSurfaces?:Vector2[][][]
  screenHeight:number
  bayWidth:number
  cover:number
  diameter:number
  doubleMat:boolean
  panelWidth?:number
  braceSide?:'near'|'far'|'both'
  excludedEdges?:ReadonlySet<string>
  screenRuns?:ScreenRun[]
}
export interface PropPiece {geometry:BufferGeometry; material:MeshStandardMaterial; tripod:boolean}
const v=(x:number,y:number,z:number)=>new Vector3(x,y,z)
const up=v(0,1,0)
const cube=new BoxGeometry(1,1,1), tube=new CylinderGeometry(.5,.5,1,8)
const identity=new Quaternion()
const finishes={
  wood:'#a77943', sheet:'#75624f', beam:'#cec264', red:'#9c392d', steel:'#879397',
  facing:'#37302a', frame:'#cf632d', galvanised:'#bfc5c8',
  bar:'#675649', link:'#766557', rail:'#a64a30', mesh:'#707f89', board:'#cf922f',
}
type Finish=keyof typeof finishes
export function constructionEdges(host:ConstructionHost){
  return host.rings.flatMap((ring,r)=>isExterior(ring,host.rings)?ring.map((a,i)=>{
    const b=ring[(i+1)%ring.length], d=b.clone().sub(a).normalize()
    const n=new Vector2(d.y,-d.x).multiplyScalar(ShapeUtils.area(ring)>0?1:-1)
    return {a,b,d,n,length:a.distanceTo(b),id:r+'-'+i}
  }):[])
}

type ScreenEdge=ReturnType<typeof constructionEdges>[number]
interface ScreenRun {edge:ScreenEdge; edgeNumber:number; start:number; length:number}

/** Remove shared portions of coplanar slab edges before dividing the exterior into liftable bays. */
export function perimeterRuns(hosts:ConstructionHost[]):ScreenRun[][]{
  const origin=new Vector2()
  const outlines=hosts.map((host,index)=>constructionEdges(host).map((edge,i)=>{
    const offset=new Vector2(host.origin.x,host.origin.z)
    const world=(p:Vector2)=>p.clone().rotateAround(origin,host.angle).add(offset)
    return {edge,edgeNumber:i+1,host:index,elevation:host.origin.y+host.height,start:world(edge.a),end:world(edge.b),
      normal:edge.n.clone().rotateAround(origin,host.angle)}
  }))
  const all=outlines.flat(),eps=.001
  return outlines.map(edges=>edges.flatMap(current=>{
    const {edge,edgeNumber,start}=current
    const direction=current.end.clone().sub(start).normalize()
    const covered:[number,number][]=[]
    for(const other of all){
      if(other.host===current.host || Math.abs(other.elevation-current.elevation)>eps || current.normal.dot(other.normal)>-.99999)continue
      const a=other.start.clone().sub(start),b=other.end.clone().sub(start)
      if(Math.abs(direction.cross(a))>eps || Math.abs(direction.cross(b))>eps)continue
      const x=a.dot(direction),y=b.dot(direction)
      const from=Math.max(0,Math.min(x,y)),to=Math.min(edge.length,Math.max(x,y))
      if(to-from>eps)covered.push([from,to])
    }
    let cursor=0
    const runs:ScreenRun[]=[]
    for(const [from,to] of covered.sort((a,b)=>a[0]-b[0])){
      if(from-cursor>eps)runs.push({edge,edgeNumber,start:cursor,length:from-cursor})
      cursor=Math.max(cursor,to)
    }
    if(edge.length-cursor>eps)runs.push({edge,edgeNumber,start:cursor,length:edge.length-cursor})
    return runs
  }))
}

function meshMaterial(){
  const size=16, data=new Uint8Array(size*size*4)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=4*(y*size+x);data[i]=data[i+1]=data[i+2]=255
    data[i+3]=(x-7.5)**2+(y-7.5)**2<31?0:255
  }
  const texture=new DataTexture(data,size,size)
  texture.wrapS=texture.wrapT=RepeatWrapping
  texture.needsUpdate=true
  return new MeshStandardMaterial({color:finishes.mesh,map:texture,alphaTest:.5,side:DoubleSide,roughness:.78,metalness:.4})
}

// Centre lines keep subpixel bars legible in the creator. Keyed by geometry so
// the preview data follows its lifetime and stays out of the exported GLB.
export const previewBarLines = new WeakMap<BufferGeometry, Float32Array>()

/** Geometry is batched per moving part and finish. Exported GLBs need no instancing extensions. */
class Parts {
  root=new Group()
  private meshes=new Map<Group,Map<MeshStandardMaterial,BufferGeometry[]>>()
  private materials=new Map<Finish,MeshStandardMaterial>()
  private barLines=new Map<Group, Map<Finish, number[]>>()
  private pieces=0
  private vertices=0
  constructor(private prefix:string){}
  part(label:string){
    const g=new Group()
    g.name=(this.prefix+' - '+label)
    this.root.add(g)
    return g
  }
  add(g:Group,finish:Finish|MeshStandardMaterial,geometry:BufferGeometry){
    this.vertices+=geometry.getAttribute('position').count
    if(++this.pieces>24000 || this.vertices>2000000){geometry.dispose();throw Error('This selection is too dense. Increase spacing or generate a smaller zone.')}
    let mat:MeshStandardMaterial
    if(typeof finish==='string'){
      if(!this.materials.has(finish)){
        const created=finish==='mesh'?meshMaterial():new MeshStandardMaterial({color:new Color(finishes[finish]),roughness:.76,metalness:['steel','bar','link','rail','frame','galvanised'].includes(finish)?.45:.08})
        created.name=finish;this.materials.set(finish,created)
      }
      mat=this.materials.get(finish)!
    }else mat=finish
    if(!this.meshes.has(g))this.meshes.set(g,new Map())
    const group=this.meshes.get(g)!
    if(!group.has(mat))group.set(mat,[])
    group.get(mat)!.push(geometry)
  }
  box(g:Group,m:Finish,x:number,y:number,z:number,w:number,h:number,d:number){
    this.add(g,m,cube.clone().scale(w,h,d).translate(x,y,z))
  }
  member(g:Group,m:Finish,a:Vector3,b:Vector3,w:number,d=w,round=false){
    const dir=b.clone().sub(a),length=dir.length()
    if(length<1e-5)return
    if (m === 'bar' || m === 'link') {
      const byFinish = this.barLines.get(g) ?? new Map<Finish, number[]>()
      const positions = byFinish.get(m) ?? []
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      byFinish.set(m, positions)
      this.barLines.set(g, byFinish)
    }
    // For horizontal rectangular members the depth is vertical, regardless of heading.
    const matrix=new Matrix4()
    if(!round && Math.abs(dir.y)<1e-8){
      const longitudinal=dir.normalize(), lateral=longitudinal.clone().cross(up)
      matrix.makeBasis(longitudinal,up,lateral).scale(v(length,d,w)).setPosition(a.clone().lerp(b,.5))
    }else matrix.compose(a.clone().lerp(b,.5),new Quaternion().setFromUnitVectors(up,dir.normalize()),v(w,length,d))
    this.add(g,m,(round?tube:cube).clone().applyMatrix4(matrix))
  }
  finish(){
    for(const [part,groups] of this.meshes)for(const [mat,geos] of groups){
      // Retain the kit's indexed geometry. Expanding each repeated prop into
      // triangle corners exhausted the vertex budget on a single storey.
      if(geos.some(g=>g.index)) for(const geometry of geos) {
        if(!geometry.index) geometry.setIndex(Array.from({length:geometry.getAttribute('position').count},(_,i)=>i))
      }
      const merged=mergeGeometries(geos)
      geos.forEach(g=>g.dispose())
      if(!merged)throw Error('Could not assemble '+part.name)
      const lines=this.barLines.get(part)?.get(mat.name as Finish)
      if(lines)previewBarLines.set(merged,new Float32Array(lines))
      const mesh=new Mesh(merged,mat);mesh.name=part.name+' '+mat.name
      mesh.castShadow=mesh.receiveShadow=true;part.add(mesh)
    }
    this.root.children.filter(g=>!g.children.length).forEach(g=>this.root.remove(g))
    if(!this.root.children.length)throw Error('No components fit this selection.')
    return this.root
  }
}

type Interval = [number, number]

/** At this bearer, find centre positions where the entire rectangular envelope
 * of the feet fits. Each boundary edge swept across that envelope excludes a
 * range, including slanted edges and holes wholly enclosed by the tripod. */
function supportedSpans(rings:Vector2[][], x:number, feet:Box2):Interval[] {
  let valid=spans(rings,false,x)
  const left=x+feet.min.x, right=x+feet.max.x
  for(const ring of rings) for(const [i,a] of ring.entries()) {
    const b=ring[(i+1)%ring.length]
    if(Math.max(a.x,b.x)<=left || Math.min(a.x,b.x)>=right) continue
    let z1=a.y, z2=b.y
    if(a.x!==b.x) {
      const at=(t:number)=>a.y+(b.y-a.y)*Math.max(0,Math.min(1,t))
      z1=at((left-a.x)/(b.x-a.x))
      z2=at((right-a.x)/(b.x-a.x))
    }
    const lo=Math.min(z1,z2)-feet.max.y, hi=Math.max(z1,z2)-feet.min.y
    valid=valid.flatMap(([start,end]):Interval[]=>{
      if(hi<=start || lo>=end) return [[start,end]]
      const pieces:Interval[]=[]
      if(lo>start) pieces.push([start,lo])
      if(hi<end) pieces.push([hi,end])
      return pieces
    })
  }
  return valid
}

function propFootprint(prop:PropPiece[]) {
  const feet=new Box2()
  for(const piece of prop) {
    const pos=piece.geometry.getAttribute('position')
    for(let i=0;i<pos.count;i++) if(pos.getY(i)<=.002)
      feet.expandByPoint(new Vector2(pos.getX(i),pos.getZ(i)))
  }
  if(feet.isEmpty()) throw Error('The prop kit has no base contact geometry.')
  return feet.expandByScalar(.002)
}

function buildDeck(host:ConstructionHost,o:ConstructionOptions,p:Parts,prop:PropPiece[]){
  const {rings,bounds}=host
  const props=p.part('Props'),bearers=p.part('Primary bearers'),joists=p.part('Secondary joists'),deck=p.part('Plywood')
  const top=-.024, primaryTop=top-.20, propTop=primaryTop-.20
  function beam(group:Group,xDir:boolean,at:number,start:number,end:number,y:number){
    const point=(u:number,h:number)=>xDir?v(u,h,at):v(at,h,u)
    for(const offset of [-.02,-.18])p.member(group,'beam',point(start,y+offset),point(end,y+offset),.080,.04)
    p.member(group,'beam',point(start,y-.10),point(end,y-.10),.028,.12)
  }
  const feet=propFootprint(prop)
  const supports=o.bearingSurfaces??[rings]
  const bearingBounds=new Box2().setFromPoints(supports.flat(2))
  const minX=Math.max(bounds.min.x,bearingBounds.min.x)-feet.min.x+.0001
  const maxX=Math.min(bounds.max.x,bearingBounds.max.x)-feet.max.x-.0001
  const noFit='The prop and tripod feet do not fit on the available slab footprint.'
  if(maxX<minX) throw Error(noFit)
  let propCount=0
  for(const x of rowPositions(minX,maxX,o.spacing,0)){
    const upper=supportedSpans(rings,x,feet)
    const lower=o.bearingSurfaces ? supports.flatMap(face=>supportedSpans(face,x,feet)) : upper
    const runs:Interval[]=[]
    for(const [lo,hi] of upper) for(const [l,h] of lower) {
      const start=Math.max(l,lo), end=Math.min(h,hi)
      if(end>=start) runs.push([start,end])
    }
    // Coplanar IFC slabs can overlap. Distribute each row of props only once.
    const merged:Interval[]=[]
    for(const run of runs.sort((a,b)=>a[0]-b[0])) {
      const last=merged[merged.length-1]
      if(last && run[0]<=last[1]) last[1]=Math.max(last[1],run[1])
      else merged.push(run)
    }
    for(const [a,b] of spans(rings,false,x)) beam(bearers,false,x,a,b,primaryTop)
    for(const [lo,hi] of merged) for(const z of rowPositions(lo,hi,o.spacing,0)){
      const h=o.clearance+propTop
      const transform=new Matrix4()
      for(const piece of prop){
        const sy=piece.tripod?Math.min(1,h/1.3):h/3.0
        transform.compose(v(x,-o.clearance,z),identity,v(1,sy,1))
        p.add(props,piece.material,piece.geometry.clone().applyMatrix4(transform))
      }
      propCount++
    }
  }
  if(!propCount) throw Error(noFit)
  for(const z of rowPositions(bounds.min.y,bounds.max.y,.50,.12))
    for(const [a,b] of spans(rings,true,z))beam(joists,true,z,a,b,top)
  for(const shape of faceShapes(rings)){
    p.add(deck,'sheet',new ExtrudeGeometry(shape,{depth:.024,bevelEnabled:false}).rotateX(Math.PI/2))
  }
  // Sheet joints also stop at recesses and floor openings.
  for(const alongX of [true,false]){
    const dim=alongX?'y':'x',pitch=alongX?2.4:1.2
    for(let at=bounds.min[dim]+pitch;at<bounds.max[dim];at+=pitch){
      for(const [a,b] of spans(rings,alongX,at)){
        const start=alongX?v(a,.0005,at):v(at,.0005,a),end=alongX?v(b,.0005,at):v(at,.0005,b)
        p.member(deck,'wood',start,end,.003,.001)
      }
    }
  }
}

function shutters(host:ConstructionHost,p:Parts){
  const edges=constructionEdges(host)
  for(const [i,{a,d,n,length}] of edges.entries()){
    const g=p.part('Shutter '+(i+1))
    const at=(s:number,out:number,y:number)=>v(a.x+d.x*s+n.x*out,y,a.y+d.y*s+n.y*out)
    p.member(g,'sheet',at(0,.011,host.height/2),at(length,.011,host.height/2),.022,host.height)
    for(const s of rowPositions(0,length,.30,.075))p.member(g,'wood',at(s,.050,0),at(s,.050,host.height),.065)
    for(const y of rowPositions(0,host.height,.65,.17))p.member(g,'wood',at(-.06,.118,y),at(length+.06,.118,y),.072,.09)
    if(length>.32){
      const reach=Math.min(1.55,host.height*.48)
      p.member(g,'wood',at(length/2,.15,host.height*.72),at(length/2,reach,.03),.075)
      const foot=at(length/2,reach,.023)
      p.box(g,'wood',foot.x,foot.y,foot.z,.2,.046,.2)
    }
  }
}

function wallFormwork(host:ConstructionHost,o:ConstructionOptions,p:Parts){
  const profile=host.wallFace
  if(!profile.length)throw Error('Select a straight wall with a planar face.')
  const panelWidth=o.panelWidth??1.2
  if(!Number.isFinite(panelWidth)||panelWidth<.4||panelWidth>3)throw Error('Max wall panel width must be between 0.4 and 3 m.')
  const faceBounds=new Box2().setFromPoints(profile.flat())
  const length=faceBounds.max.x-faceBounds.min.x,height=host.height
  const count=Math.ceil(length/panelWidth),width=length/count
  const zMin=host.bounds.min.y,zMax=host.bounds.max.y
  const skin=.021,frameDepth=.09,frameWidth=.052,back=skin+frameDepth
  const shapes=faceShapes(profile)
  const stopEnds=p.part('Stop ends and opening forms'),ties=p.part('Through ties and plates')

  // Follow the cut boundaries for the stop ends, door jambs, lintels and window sills.
  for(const ring of profile){
    const exterior=isExterior(ring,profile)
    const winding=Math.sign(ShapeUtils.area(ring))*(exterior?1:-1)
    ring.forEach((a,i)=>{
      const b=ring[(i+1)%ring.length]
      if(exterior && (Math.max(a.y,b.y)<.0001||Math.min(a.y,b.y)>height-.0001))return
      const normal=new Vector2(b.y-a.y,a.x-b.x).normalize().multiplyScalar(winding)
      const offset=normal.clone().multiplyScalar(skin)
      const edge=new Shape([a,b,b.clone().add(offset),a.clone().add(offset)])
      p.add(stopEnds,'sheet',new ExtrudeGeometry(edge,{depth:zMax-zMin,bevelEnabled:false}).translate(0,0,zMin))
      if(exterior && Math.abs(a.x-b.x)<.0001){
        const x=a.x+normal.x*(skin+.027)
        const lo=Math.min(a.y,b.y),hi=Math.max(a.y,b.y)
        const inset=Math.min((zMax-zMin)/4,.028)
        for(const z of [zMin+inset,zMax-inset])p.box(stopEnds,'frame',x,(lo+hi)/2,z,.054,hi-lo,inset*2)
        for(const y of rowPositions(lo,hi,.68,.04))p.box(stopEnds,'frame',x,y,(zMin+zMax)/2,.054,.045,zMax-zMin)
      }
    })
  }
  for(const sign of [1,-1]){
    const face=sign===1?'Face A':'Face B',z=sign===1?zMax:zMin
    const braced=o.braceSide==='both'||(o.braceSide??'near')===(sign===1?'near':'far')
    const panels=p.part(face+' panels'),braces=p.part(face+' push-pull props')
    const outward=(x:number,y:number,d:number)=>v(x,y,z+sign*d)
    for(const shape of shapes){
      p.add(panels,'facing',new ExtrudeGeometry(shape,{depth:skin,bevelEnabled:false}).translate(0,0,z+(sign===1?0:-skin)))
    }
    // Outline the panel gangs, including the exposed edges around openings.
    for(const ring of profile)ring.forEach((a,i)=>{
      const b=ring[(i+1)%ring.length],along=b.clone().sub(a)
      const inset=new Vector2(-along.y,along.x).normalize()
        .multiplyScalar(Math.sign(ShapeUtils.area(ring))*(isExterior(ring,profile)?1:-1)*frameWidth)
      const rim=new Shape([a,b,b.clone().add(inset),a.clone().add(inset)])
      p.add(panels,'frame',new ExtrudeGeometry(rim,{depth:frameDepth,bevelEnabled:false})
        .translate(0,0,z+sign*skin+(sign===1?0:-frameDepth)))
    })
    const frameZ=z+sign*(skin+frameDepth/2)
    for(let bay=0;bay<count;bay++){
      const centre=faceBounds.min.x+(bay+.5)*width
      const solid=spans(profile,false,centre)
      for(const [lo,hi] of solid){
        p.box(panels,'frame',centre,(lo+hi)/2,frameZ,frameWidth,hi-lo,frameDepth)
        if(sign===1 && hi-lo>.25)for(const y of rowPositions(lo,hi,1.25,Math.min(.36,(hi-lo)/3))){
          p.member(ties,'galvanised',v(centre,y,zMin-back-.065),v(centre,y,zMax+back+.065),.021,.021,true)
          for(const plateZ of [zMin-back-.008,zMax+back+.008]){
            p.box(ties,'galvanised',centre,y,plateZ,.13,.085,.016)
            p.box(ties,'steel',centre,y,plateZ+(plateZ<zMin?-.02:.02),.075,.031,.035)
          }
        }
      }
      if(bay>0){
        // Adjacent panel rails share a seam; clamps bridge the pair.
        const seam=centre-width/2
        for(const [lo,hi] of spans(profile,false,seam)){
          for(const x of [seam-.027,seam+.027])p.box(panels,'frame',x,(lo+hi)/2,frameZ,.045,hi-lo,frameDepth)
          if(hi-lo>.22)for(const y of rowPositions(lo,hi,1.25,Math.min(.38,(hi-lo)/3))){
            p.box(panels,'galvanised',seam,y,z+sign*(back+.012),.16,.034,.024)
          }
        }
      }
      if(!braced || (bay%2!==0 && bay!==count-1))continue
      // Mount to a solid upright. A tall opening can split this upright into two pieces.
      const target=Math.min(height*.74,2.7)
      const anchor=solid.filter(([lo,hi])=>hi-lo>.16 && hi>.38)
        .map(([lo,hi])=>Math.min(Math.max(target,lo+.08),hi-.08))
        .sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0]
      if(anchor===undefined)continue
      const foot=outward(centre,.06,back+Math.min(1.65,anchor*.52)),head=outward(centre,anchor,back+.04)
      const sleeve=foot.clone().lerp(head,.62)
      p.box(braces,'galvanised',foot.x,.022,foot.z,.21,.044,.30)
      p.box(braces,'steel',foot.x,.065,foot.z,.085,.09,.10)
      p.member(braces,'galvanised',foot,sleeve,.074,.074,true)
      p.member(braces,'steel',sleeve,head,.046,.046,true)
      p.member(braces,'galvanised',sleeve,foot.clone().lerp(head,.66),.087,.087,true)
      p.box(braces,'galvanised',head.x,head.y,head.z,.092,.14,.08)
    }
    const rows=Math.ceil(height/.68)
    for(let r=1;r<rows;r++){
      const y=r*height/rows
      for(const [a,b] of spans(profile,true,y))p.box(panels,'frame',(a+b)/2,y,z+sign*(skin+.034),b-a,.045,.068)
    }
  }
}

function screens(host:ConstructionHost,o:ConstructionOptions,p:Parts){
  const bayCounts=new Map<number,number>()
  for(const {edge,edgeNumber,start,length} of o.screenRuns??perimeterRuns([host])[0]){
    if(o.excludedEdges?.has(edge.id))continue
    const count=Math.ceil(length/o.bayWidth),width=length/count
    for(let i=0;i<count;i++){
      const bay=(bayCounts.get(edgeNumber)??0)+1
      bayCounts.set(edgeNumber,bay)
      const label='Edge '+edgeNumber+' bay '+bay
      const g=p.part(label+' screen'),shoes=p.part(label+' shoes')
      const top=host.height+1.6,bottom=top-o.screenHeight
      const at=(s:number,out:number,y:number)=>v(edge.a.x+edge.d.x*(start+i*width+s)+edge.n.x*out,y,edge.a.y+edge.d.y*(start+i*width+s)+edge.n.y*out)
      const face=new PlaneGeometry(width-.008,o.screenHeight)
      const pos=face.getAttribute('position'),uv=face.getAttribute('uv')
      for(let j=0;j<pos.count;j++){
        const q=at(pos.getX(j)+width/2,.76,pos.getY(j)+(top+bottom)/2)
        pos.setXYZ(j,q.x,q.y,q.z);uv.setXY(j,uv.getX(j)*width/.045,uv.getY(j)*o.screenHeight/.045)
      }
      face.computeVertexNormals();p.add(g,'mesh',face)
      for(const s of [.05*width,.95*width]){
        p.member(g,'rail',at(s,.13,bottom),at(s,.13,top),.075)
        p.member(g,'steel',at(s,.745,bottom),at(s,.745,top),.045)
        for(const y of [host.height-.10,top-o.screenHeight*.70]){
          p.member(shoes,'steel',at(s,0,y),at(s,.13,y),.15,.16)
          p.member(g,'steel',at(s,.13,y),at(s,.74,y),.055)
          p.member(g,'steel',at(s,.13,y-.38),at(s,.74,y),.04)
        }
        const eye=at(s,.13,top+.035)
        for(let j=0;j<12;j++){
          const ring=(t:number)=>eye.clone().add(v(edge.d.x*.055*Math.cos(t),.072*Math.sin(t),edge.d.y*.055*Math.cos(t)))
          p.member(g,'rail',ring(j*Math.PI/6),ring((j+1)*Math.PI/6),.013,.013,true)
        }
      }
      for(const y of rowPositions(bottom,top,1.6,.035))p.member(g,'steel',at(0,.75,y),at(width,.75,y),.04,.05)
      for(const y of [host.height-.10,top-o.screenHeight*.70]){
        p.member(g,'steel',at(0,.43,y),at(width,.43,y),.60,.045)
        p.member(g,'board',at(0,.71,y+.095),at(width,.71,y+.095),.024,.15)
      }
    }
  }
}

function reinforcementGrid(rings:Vector2[][],offset:number,wall:boolean,o:ConstructionOptions,p:Parts,g:Group){
  const bounds=new Box2().setFromPoints(rings.flat())
  const edge=o.cover+o.diameter/2
  for(const alongX of [true,false]){
    const dim=alongX?'y':'x',layer=offset+(alongX?0:o.diameter)
    for(const at of rowPositions(bounds.min[dim],bounds.max[dim],o.spacing,edge))
      for(const [a,b] of spans(rings,alongX,at)){
        if(b-a<=2*edge)continue
        const point=(u:number)=>{
          const x=alongX?u:at,other=alongX?at:u
          return wall?v(x,other,layer):v(x,layer,other)
        }
        p.member(g,'bar',point(a+edge),point(b-edge),o.diameter,o.diameter,true)
      }
  }
}

function columnCage(host:ConstructionHost,o:ConstructionOptions,p:Parts){
  const bars=p.part('Longitudinal bars'),ties=p.part('Column links')
  for(const ring of host.rings.filter(r=>isExterior(r,host.rings))){
    // Intersection of adjacent offset side lines keeps the links aligned with rotated faces.
    const sign=Math.sign(ShapeUtils.area(ring)),inset=o.cover+o.diameter
    const inside=ring.map((b,i)=>{
      const a=ring[(i+ring.length-1)%ring.length],c=ring[(i+1)%ring.length]
      const normal=(d:Vector2)=>new Vector2(-d.y,d.x).normalize().multiplyScalar(sign)
      const u=normal(b.clone().sub(a)),w=normal(c.clone().sub(b)),bisector=u.add(w).normalize()
      return b.clone().addScaledVector(bisector,inset/Math.max(.15,bisector.dot(w)))
    })
    const folds=inside.some((a,i)=>{
      const next=(i+1)%inside.length
      return inside[next].clone().sub(a).dot(ring[next].clone().sub(ring[i]))<=0
    })
    if(folds || inside.some(pt=>!contains(ring,pt)))throw Error('Reduce cover for this column section.')
    const levels=rowPositions(0,host.height,o.spacing,inset)
    for(let i=0;i<inside.length;i++){
      const a=inside[i],b=inside[(i+1)%inside.length],pieces=Math.ceil(a.distanceTo(b)/o.spacing)
      for(let n=0;n<pieces;n++){
        const pt=a.clone().lerp(b,n/pieces)
        p.member(bars,'bar',v(pt.x,inset,pt.y),v(pt.x,host.height+.36,pt.y),o.diameter,o.diameter,true)
      }
      for(const h of levels)p.member(ties,'link',v(a.x,h,a.y),v(b.x,h,b.y),o.diameter*.62,o.diameter*.62,true)
    }
  }
}

export function buildConstruction(host:ConstructionHost,o:ConstructionOptions,prop:PropPiece[]=[]){
  const p=new Parts(host.name)
  if(o.mode==='deck'){
    if(!prop.length)throw Error('The slab prop kit could not be loaded.')
    buildDeck(host,o,p,prop)
  }else if(o.mode==='shutter')shutters(host,p)
  else if(o.mode==='wallForm')wallFormwork(host,o,p)
  else if(o.mode==='screen')screens(host,o,p)
  else if(o.mode==='column')columnCage(host,o,p)
  else {
    const wall=o.mode==='wall',thickness=wall?host.bounds.max.y-host.bounds.min.y:host.height
    const minimum=wall||o.doubleMat?2*o.cover+4*o.diameter:2*o.cover+2*o.diameter
    if(thickness<minimum)throw Error('The reinforcement layers exceed the host thickness. Reduce cover or bar diameter.')
    const base=wall?host.bounds.min.y:0,edge=o.cover+o.diameter/2
    const layers=wall||o.doubleMat?[base+edge,base+thickness-edge-o.diameter]:[base+edge]
    layers.forEach((level,i)=>reinforcementGrid(wall?host.wallFace:host.rings,level,wall,o,p,p.part((wall?['Near curtain','Far curtain']:['Bottom mat','Top mat'])[i])))
  }
  return p.finish()
}
