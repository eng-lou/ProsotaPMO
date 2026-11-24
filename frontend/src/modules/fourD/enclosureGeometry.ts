import * as T from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { gateTrack } from './gatePose'
import {defaultScaffold,type PosterTitle} from './enclosureOptions'
import type { FenceOpening, SiteItem } from './siteScene'
import type { PathPoint } from './paths'

type Pivot = { origin: T.Matrix4; station: number; sign: number; meshes: T.InstancedMesh[]; lastAngle: number }
type Batch = { pivot?: Pivot; geometry:T.BufferGeometry; material:T.MeshStandardMaterial; matrices:T.Matrix4[]; owners:string[] }
type Finish = 'paint'|'zinc'|'dark'|'board'|'amber'|'white'|'trafficRed'|'blanket'|'net'
const finishes: Record<Exclude<Finish,'paint'>, string> = {zinc:'#adbbbc',dark:'#354249',board:'#d6a641',amber:'#ff9b14',white:'#eeefed',trafficRed:'#d62e39',blanket:'#213963',net:'#446f62'}

function grille(columns:number, rows:number, wireWidth:number, wireHeight:number) {
  // A complete welded infill is one reusable mesh. Thin rectangular wires have
  // depth, so the infill remains visible in oblique views and shadow passes.
  const bars:T.BufferGeometry[] = []
  for(let i=0;i<=columns;i++) bars.push(new T.BoxGeometry(wireWidth,1,.55).translate(i/columns-.5,0,.2))
  for(let i=0;i<=rows;i++) bars.push(new T.BoxGeometry(1,wireHeight,.55).translate(0,i/rows-.5,-.2))
  const mesh=mergeGeometries(bars)
  bars.forEach(b=>b.dispose())
  return mesh
}

function entranceBoard(brand:string, pedestrian:boolean) {
  const canvas=document.createElement('canvas')
  canvas.width=768; canvas.height=448
  const ctx=canvas.getContext('2d')!
  ctx.fillStyle='#f8faf7';ctx.fillRect(0,0,768,448)
  ctx.fillStyle='#142e42';ctx.fillRect(0,0,768,108)
  ctx.fillStyle='white';ctx.font='bold 57px Arial';ctx.fillText('SITE ENTRANCE',32,77)
  ctx.fillStyle='#1d433e';ctx.font='bold 55px Arial';ctx.fillText(brand,32,198,705)
  ctx.fillStyle='#f4b43d';ctx.fillRect(32,229,704,11)
  ctx.fillStyle='#223543';ctx.font='bold 39px Arial';ctx.fillText(pedestrian?'PEDESTRIAN ACCESS':'VEHICLE ACCESS',32,306)
  ctx.font='31px Arial';ctx.fillText('Report to site reception',32,371)
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace
  return new T.MeshStandardMaterial({map:texture,roughness:.84})
}

function posterMaterial(title:PosterTitle){
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=440
  const c=canvas.getContext('2d')!
  c.fillStyle='#f8faf4';c.fillRect(0,0,320,440)
  const color=title==='Fire exit'?'#197844':title==='Site access'?'#b8262e':title==='Site contacts'?'#334b59':'#185c9e'
  c.fillStyle=color;c.fillRect(10,12,300,62)
  c.fillStyle='white';c.font='bold 31px Arial';c.textAlign='center';c.fillText('SITE NOTICE',160,55)
  c.fillStyle=color;c.beginPath();c.arc(160,175,78,0,Math.PI*2);c.fill()
  c.fillStyle='white';c.font='bold 65px Arial'
  if(title==='Hearing protection'){
    c.strokeStyle='white';c.lineWidth=10;c.beginPath();c.arc(160,175,40,Math.PI,2*Math.PI);c.stroke()
    c.fillRect(115,174,15,38);c.fillRect(190,174,15,38)
  }else c.fillText(title==='PPE'?'PPE':title==='Fire exit'?'➜':title==='Site contacts'?'i':'!',160,197)
  c.fillStyle=color;c.fillRect(10,275,300,80);c.fillStyle='white';c.font='bold 29px Arial';c.fillText(title.toUpperCase(),160,325,284)
  c.fillStyle='#374450';c.font='18px Arial';c.fillText(title==='Site contacts'?'Report to site reception':'Construction site',160,403)
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace
  return new T.MeshStandardMaterial({map,roughness:.9})
}
export function buildEnclosure(item:SiteItem) {
  const config=item.enclosure!
  const root=new T.Group()
  root.name='Site enclosure'
  const geometries:Record<string,T.BufferGeometry>={box:new T.BoxGeometry(),round:new T.CylinderGeometry(.5,.5,1,12),bolt:new T.CylinderGeometry(.5,.5,1,6),face:new T.PlaneGeometry()}
  const materials=new Map<string,T.MeshStandardMaterial>()
  for(const [id,colour] of Object.entries({paint:item.color,...finishes})) {
    materials.set(id,new T.MeshStandardMaterial({color:colour,metalness:id==='zinc'?.55:.16,roughness:id==='amber'?.29:.62}))
  }
  materials.get('amber')!.emissive.set('#ee840c');materials.get('amber')!.emissiveIntensity=.24
  const boardMaps=new Set<T.Texture>()
  const batches=new Map<string,Batch>()
  const worldUp=new T.Vector3(0,item.up_axis==='y'?1:0,item.up_axis==='z'?1:0)
  const basis=new T.Matrix4(), local=new T.Matrix4(), position=new T.Vector3(), size=new T.Vector3()
  const quaternion=new T.Quaternion(), identity=new T.Quaternion(), hinge=new T.Matrix4(), base=new T.Matrix4()
  const point=(p:PathPoint)=>new T.Vector3(p.x,p.y,p.z)
  const pivots: Pivot[] = []
  let moving: Pivot | undefined
  function startPivot(station: number, x: number, sign: number) {
    moving = {origin: new T.Matrix4().multiplyMatrices(basis, hinge.makeTranslation(x,0,0)),
      station, sign, meshes: [], lastAngle: NaN}
    pivots.push(moving)
    base.identity()
  }
  function endPivot() { moving = undefined; base.copy(basis) }
  let owner=item.id
  function frame(a:PathPoint,b:PathPoint) {
    const from=point(a),delta=point(b).sub(from),length=delta.length()
    const x=delta.normalize()
    basis.makeBasis(x,worldUp,x.clone().cross(worldUp)).setPosition(from)
    base.copy(basis)
    return length
  }
  function part(g:keyof typeof geometries,finish:string,x:number,y:number,z:number,w:number,h:number,d:number,q=identity) {
    if(Math.min(w,h,d)<=0) return
    const key=(moving ? 'hinge-'+pivots.length+'|' : '')+g+'|'+finish
    let batch=batches.get(key)
    if(!batch) {
      batch={pivot:moving,geometry:geometries[g],material:materials.get(finish)!,matrices:[],owners:[]}
      batches.set(key,batch)
    }
    local.compose(position.set(x,y,z),q,size.set(w,h,d))
    batch.matrices.push(new T.Matrix4().multiplyMatrices(base,local))
    batch.owners.push(owner)
  }
  function box(f:Finish,x:number,y:number,z:number,w:number,h:number,d:number) {part('box',f,x,y,z,w,h,d)}
  function beam(f:Finish,x1:number,y1:number,x2:number,y2:number,z:number,thick:number) {
    quaternion.setFromAxisAngle(new T.Vector3(0,0,1),Math.atan2(y2-y1,x2-x1))
    part('box',f,(x1+x2)/2,(y1+y2)/2,z,Math.hypot(x2-x1,y2-y1),thick,thick,quaternion)
  }
  function lamp(x:number,y:number) {
    part('round','dark',x,y+.026,0,.11,.052,.11)
    part('round','amber',x,y+.096,0,.095,.095,.095)
    part('round','amber',x,y+.15,0,.077,.018,.077)
  }
  const postLocations=new Set<string>()
  function support(x:number,h:number,edge:boolean,perimeter:boolean) {
    const p=new T.Vector3(x,0,0).applyMatrix4(base)
    const key=p.toArray().map(n=>n.toFixed(5)).join('|')
    if(postLocations.has(key))return
    postLocations.add(key)
    if(edge) {
      box('zinc',x,.011,.045,.15,.022,.23)
      box('zinc',x,.118,.025,.073,.20,.073)
      for(const side of [-1,1])part('bolt','dark',x+side*.045,.029,.122,.024,.014,.024)
    } else if(perimeter) {
      box('dark',x,.065,.02,.24,.13,.58)
      box('zinc',x,.145,0,.093,.07,.095)
    }
    const thickness=edge?.046:.056
    if(perimeter)part('round','zinc',x,h/2,0,thickness,h,thickness)
    else box(edge?'zinc':'dark',x,h/2,0,thickness,h,thickness)
    box('dark',x,h,0,thickness+.008,.018,thickness+.008)
  }
  function framedMesh(center:number, bottom:number, top:number, width:number, finish:Finish, z:number, gauge:number) {
    const h=top-bottom
    box(finish,center,top-gauge/2,z,width,gauge,gauge)
    box(finish,center,bottom+gauge/2,z,width,gauge,gauge)
    for(const side of [-1,1])box(finish,center+side*(width-gauge)/2,(bottom+top)/2,z,gauge,h,gauge)
    const w=width-2*gauge, clearH=h-2*gauge
    if(w<=0 || clearH<=0)return
    const pitchX=config.style==='edge'?.085:.105,pitchY=config.style==='edge'?.13:.15
    const cols=Math.max(1,Math.min(192,Math.round(w/pitchX))),rows=Math.max(1,Math.min(64,Math.round(clearH/pitchY)))
    const key='infill-'+cols+'x'+rows
    geometries[key]??=grille(cols,rows,.006/(cols*pitchX),.006/(rows*pitchY))
    part(key,finish,center,(bottom+top)/2,z,w,clearH,.009)
  }
  function scaffoldBay(span:number,stairs:boolean,rise=item.height,lifts=config.scaffold?.lifts??3,flightOffset=0){
    const sc=config.scaffold??defaultScaffold,sign=sc.slabs?.length||sc.side==='right'?1:-1,w=sc.width*sign,h=rise
    const far=w+sign*.90,landing=Math.min(.47,span*.19)
    for(const x of [.022,span-.022])for(const z of stairs?[0,w,far]:[0,w]){
      const high=lifts*h+1
      part('round','zinc',x,high/2,z,.048,high,.048)
      box('dark',x,.02,z,.16,.04,.16)
    }
    for(let level=1;level<=lifts;level++){
      const y=h*level,y0=y-h,mid=span/2
      for(const x of [.04,span-.04])box('zinc',x,y-.1,w/2,.055,.07,Math.abs(w)+.09)
      for(const z of [0,w])box('zinc',mid,y-.13,z,span,.055,.05)
      const boards=Math.ceil(sc.width/.25)
      for(let n=0;n<boards;n++)box('board',mid,y-.035,w*(n+.5)/boards,span-.01,.07,sc.width/boards-.008)
      const forward=(level+flightOffset)%2===1,doorStart=stairs&&!forward?landing:0,doorEnd=stairs&&forward?span-landing:span
      const railLength=doorEnd-doorStart,railX=(doorStart+doorEnd)/2
      for(const lift of [.5,1])box('zinc',railX,y+lift,w,railLength,.045,.045)
      box('board',railX,y+.08,w,railLength,.16,.032)
      if(sc.netted){
        const lo=level===1?0:y0+1,hi=y+1
        // Keep the access landing clear on both sides of each alternating flight.
        const inset=stairs?landing:0,nw=span-2*inset
        if(nw>0){geometries.scaffoldNet??=grille(28,30,.009,.009);part('scaffoldNet','net',mid,(lo+hi)/2,w+sign*.035,nw,hi-lo,.012)}
      }
      if(!stairs){beam('zinc',0,y0,span,y,w,.044);continue}
      const start=forward?landing:span-landing,end=forward?span-landing:landing
      const steps=Math.max(4,Math.ceil(h/.18))
      const stairZ=(w+far)/2
      for(let n=1;n<=steps;n++)box('zinc',start+(end-start)*(n-.5)/steps,y0+h*n/steps-.025,stairZ,Math.abs(end-start)/steps+.015,.05,.87)
      for(const z of [w,far]){
        beam('zinc',start,y0,end,y,z,.075)
        beam('zinc',start,y0+.91,end,y+.91,z,.04)
        for(const f of [.05,.5,.95])box('zinc',start+(end-start)*f,y0+h*f+.45,z,.035,.9,.035)
      }
      const endX=forward?span-landing/2:landing/2
      box('zinc',endX,y-.035,stairZ,landing,.07,.90)
      box('zinc',endX,y+.98,far,landing,.04,.04)
      box('zinc',forward?span:0,y+.98,stairZ,.04,.04,.90)
    }
  }
  function roadBase(span:number,index:number){
    const blocks=Math.max(1,Math.round(span/1.6)),w=span/blocks
    const low=config.barrier_base==='low'
    for(let n=0;n<blocks;n++){
      const x=(n+.5)*w,color=(index*blocks+n)%2?'white':'trafficRed'
      const key=low?'barrierFoot':'ballast'
      if(!geometries[key]){
        const outline=new T.Shape()
        outline.moveTo(-.5,0);outline.lineTo(.5,0);outline.lineTo(.48,.20);outline.lineTo(.25,.68);outline.lineTo(.23,1);outline.lineTo(-.23,1);outline.lineTo(-.25,.68);outline.lineTo(-.48,.20);outline.closePath()
        geometries[key]=new T.ExtrudeGeometry(outline,{depth:1,bevelEnabled:false}).translate(0,0,-.5).rotateY(Math.PI/2)
      }
      part(key,color,x,0,0,w-.015,low?.28:.52,low?.48:.6)
    }
  }
  const height=item.height
  for(const [index,panel] of (item.layout?.panels??[]).entries()) {
    owner=panel.id
    const span=frame(panel.a,panel.b),mid=span/2
    if(config.style==='scaffold'){scaffoldBay(span,!!panel.stairs,panel.rise,panel.lifts,panel.flight_offset);continue}
    if(config.style==='plain') {
      box('paint',mid,height/2,0,span,height,.08)
      continue
    }
    const edge=config.style==='edge', mesh=config.style==='mesh'||config.style==='street'
    // Inset each edge-protection shoe. Both ends of an interrupted run stay supported.
    const inset=edge?Math.min(.105,span*.22):0
    support(inset,height+.035,edge,mesh);support(span-inset,height+.035,edge,mesh)
    if(mesh){
      if(config.barrier_base==='low'||config.barrier_base==='ballast')roadBase(span,index)
      if(config.reflective){const count=Math.max(2,Math.round(span/.30));for(let n=0;n<count;n++)box(n%2?'white':'trafficRed',(n+.5)*span/count,height*.55,.057,span/count,.145,.012)}
      if(config.blanket && (!config.blanket_bays||config.blanket_bays.includes(index+1))){
        if(!geometries.blanket){
          const g=new T.PlaneGeometry(1,1,24,12),p=g.getAttribute('position')
          for(let n=0;n<p.count;n++){const x=p.getX(n),y=p.getY(n),s=Math.sin(Math.PI*(x+.5));p.setXYZ(n,x,y-.042*s*(.5+y),.04*s*Math.cos(15*x+2*y))}
          g.computeVertexNormals();geometries.blanket=g;materials.get('blanket')!.side=T.DoubleSide
        }
        part('blanket','blanket',mid,height*.55,-.045,Math.max(.01,span-.12),height*.82,1)
        for(const x of [.09,mid,span-.09])box('zinc',x,height*.95,-.027,.018,.11,.018)
      }
    }
    if(config.style==='hoarding') {
      const width=Math.max(.001,span-.012)
      box('paint',mid,height/2,0,width,height,.055)
      box('zinc',mid,height+.016,0,span,.037,.083)
      box('dark',mid,.055,-.005,width,.11,.071)
      for(const y of [.25*height,.79*height])box('zinc',mid,y,-.055,width,.046,.043)
      // Stand the posts proud of the rear rails; pin the panel on the street face.
      for(const x of [Math.min(.065,mid),span-Math.min(.065,mid)]) {
        for(const y of [.25*height,.79*height])box('zinc',x,y,.03,.016,.016,.008)
      }
      if(config.perimeter_lights && index%3===0)lamp(inset,height+.035)
    } else {
      const gap=Math.min(.04,span*.1),bottom=Math.min(edge?.15:.12,height*.16)
      framedMesh(mid,bottom,height,span-gap,'paint',.042,Math.min(edge?.029:.034,span*.12,height*.12))
      if(edge){
        box('paint',mid,bottom*.62,.051,span-gap,bottom*1.15,.026)
        box('paint',mid,bottom*1.15,.06,span-gap,.022,.036)
        box('paint',mid,height*.51,.046,span-gap,.024,.024)
        for(const x of [inset,span-inset])box('zinc',x,height*.73,.018,.07,.045,.095)
      }
    }
  }
  function addEntranceBoard(brand:string, pedestrian:boolean, x:number, y:number, z:number, width:number) {
    if(!brand.trim())return
    const key=(pedestrian?'pedestrian':'vehicle')+' board '+brand
    if(!materials.has(key)){
      const board=entranceBoard(brand.trim(),pedestrian)
      materials.set(key,board)
      boardMaps.add(board.map!)
    }
    const h=width*448/768
    box('white',x,y,z,width+.02,h+.02,.028)
    part('face',key,x,y,z+.015,width,h,1)
  }
  for(const corner of item.layout?.scaffold_corners??[]){
    const [p,q,r,s]=corner.points
    owner=corner.id
    frame(p,q)
    const inverse=basis.clone().invert()
    const corners=[p,q,r,s].map(v=>point(v).applyMatrix4(inverse))
    const key='corner'+corners.flatMap(v=>[v.x.toFixed(4),v.z.toFixed(4)]).join('/')
    if(!geometries[key]){
      const shape=new T.Shape(corners.map(v=>new T.Vector2(v.x,-v.z)))
      geometries[key]=new T.ExtrudeGeometry(shape,{depth:.07,bevelEnabled:false}).rotateX(-Math.PI/2)
    }
    part(key,'board',0,-.07,0,1,1,1)
    for(const [a,b] of [[q,r],[r,s]]){
      const length=frame(a,b)
      for(const h of [.5,1])box('zinc',length/2,h,0,length,.045,.045)
      box('board',length/2,.08,0,length,.16,.032)
    }
  }
  for(const gate of item.layout?.openings??[]) {
    if(gate.kind==='gap')continue
    owner=item.id
    const span=frame(gate.a,gate.b),top=Math.max(1.9,Math.min(height,3.2))
    for(const x of [.065,span-.065]) {
      box('zinc',x,.018,0,.13,.036,.25)
      box('dark',x,top/2,0,.095,top,.095)
      if(gate.lights)lamp(x,top)
    }
    if(gate.kind==='turnstile') {
      const mid=span/2,rad=Math.min(.56,mid-.12),depth=1.4
      box('zinc',mid,.025,0,span,.05,depth)
      box('dark',mid,2.28,0,span,.14,depth)
      box('paint',mid,2.37,0,span+.08,.045,depth+.08)
      for(const x of [.065,span-.065]){
        for(const z of [-.62,.62])box('zinc',x,1.13,z,.045,2.24,.045)
        for(const z of [-.45,-.25,0,.25,.45])part('round','zinc',x,1.12,z,.019,2.2,.019)
      }
      part('round','zinc',mid,1.1,0,.11,2.18,.11)
      startPivot(gate.start,mid,1)
      for(let arm=0;arm<3;arm++){
        const angle=arm*2*Math.PI/3
        quaternion.setFromAxisAngle(new T.Vector3(0,1,0),angle)
        for(let row=0;row<7;row++)part('box','zinc',Math.cos(angle)*rad/2,.34+row*.235,-Math.sin(angle)*rad/2,rad,.028,.033,quaternion)
      }
      endPivot()
      box('dark',.09,1.05,.67,.13,.24,.09);box('amber',.09,1.1,.721,.065,.025,.009)
      addEntranceBoard(gate.board,true,mid,2.42,.695,Math.min(span-.1,.94))
    } else {
      const leaves=gate.kind==='vehicle'?2:1
      const width=(span-.25)/leaves-.016
      for(let i=0;i<leaves;i++) {
        const right=i===1,sign=right?-1:1,pivot=right?span-.125:.125
        startPivot(gate.start,pivot,right?1:-1)
        const centre=sign*width/2
        framedMesh(centre,.13,top-.045,width,'paint',0,.048)
        if(config.style==='hoarding') {
          box('paint',centre,.83,.015,width-.085,1.28,.035)
          box('zinc',centre,1.48,.028,width-.075,.028,.045)
        }
        const posters=gate.kind==='pedestrian'?gate.posters??[]:[]
        if(i===0)addEntranceBoard(gate.board,leaves===1,centre,posters.length?top-.26:1.3,.078,Math.min(width*.83,posters.length?.5:1.15))
        posters.forEach((title,n)=>{
          const key='poster '+title
          if(!materials.has(key)){const m=posterMaterial(title);materials.set(key,m);boardMaps.add(m.map!)}
          const w=Math.min(.3,width*.41),h=w*1.375,x=centre+(n%2-.5)*(w+.025),y=1.45-Math.floor(n/2)*(h+.025)
          box('white',x,y,.07,w+.012,h+.012,.016);part('face',key,x,y,.081,w,h,1)
        })
        beam('zinc',0,.20,sign*width,top-.15,-.032,.034)
        for(const h of [.34,top-.34])part('round','zinc',0,h,0,.071,.12,.071)
        box('zinc',sign*(width-.12),.99,.048,.16,.025,.045)
        if(leaves===2)box('dark',sign*(width-.06),.21,-.04,.024,.31,.024)
      }
      endPivot()
    }
  }
  for(const [key,batch] of batches){
    const mesh=new T.InstancedMesh(batch.geometry,batch.material,batch.matrices.length)
    mesh.name=key;mesh.userData.enclosureOwners=batch.owners
    if(batch.pivot) { batch.pivot.meshes.push(mesh); mesh.matrixAutoUpdate=false }
    batch.matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix))
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere()
    // Static exports should retain authored finishes when a panel is highlighted.
    batch.material.userData.exportInstanceColour='#ffffff'
    root.add(mesh)
  }
  let lastOpenings: FenceOpening[] | undefined
  let lastTime: number | null | undefined
  const tracks = new Map<number, {travel: number; angle: number; sample: ReturnType<typeof gateTrack>}>()
  let animated = false
  function setPose(openings: FenceOpening[], time: number | null) {
    if (openings === lastOpenings && (!animated || lastTime === time)) return
    if (openings !== lastOpenings) {
      tracks.clear()
      animated = openings.some(gate => gate.pose_keys?.length)
      for (const gate of openings) {
        if (gate.kind !== 'gap') tracks.set(gate.start, {
          travel: (gate.kind === 'turnstile' ? 120 : gate.angle || 90) * Math.PI / 180, angle: 0, sample: gateTrack(gate),
        })
      }
      lastOpenings = openings
    }
    lastTime = time
    for (const track of tracks.values()) track.angle = track.travel * track.sample(time)
    for (const pivot of pivots) {
      const track = tracks.get(pivot.station)
      if (!track) continue
      const angle = pivot.sign * track.angle
      if (pivot.lastAngle === angle) continue
      pivot.lastAngle = angle
      hinge.makeRotationY(angle)
      for (const mesh of pivot.meshes) {
        mesh.matrix.multiplyMatrices(pivot.origin,hinge)
        mesh.matrixWorldNeedsUpdate=true
      }
    }
  }
  setPose(config.openings,null)
  return {root,setPose,dispose(){
    for(const mesh of root.children as T.InstancedMesh[])mesh.dispose()
    Object.values(geometries).forEach(g=>g.dispose())
    boardMaps.forEach(texture=>texture.dispose())
    for(const material of materials.values())material.dispose()
  }}
}
