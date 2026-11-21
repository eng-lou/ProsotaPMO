import * as T from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { gateTrack } from './gatePose'
import type { FenceOpening, SiteItem } from './siteScene'
import type { PathPoint } from './paths'

type Pivot = { origin: T.Matrix4; station: number; sign: number; meshes: T.InstancedMesh[]; lastAngle: number }
type Batch = { pivot?: Pivot; geometry:T.BufferGeometry; material:T.MeshStandardMaterial; matrices:T.Matrix4[]; owners:string[] }
type Finish = 'paint'|'zinc'|'dark'|'board'|'amber'|'white'
const finishes: Record<Exclude<Finish,'paint'>, string> = {zinc:'#adbbbc',dark:'#354249',board:'#d6a641',amber:'#ff9b14',white:'#eeeccf'}

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
  const height=item.height
  for(const [index,panel] of (item.layout?.panels??[]).entries()) {
    owner=panel.id
    const span=frame(panel.a,panel.b),mid=span/2
    if(config.style==='plain') {
      box('paint',mid,height/2,0,span,height,.08)
      continue
    }
    const edge=config.style==='edge', mesh=config.style==='mesh'
    // Inset each edge-protection shoe. Both ends of an interrupted run stay supported.
    const inset=edge?Math.min(.105,span*.22):0
    support(inset,height+.035,edge,mesh);support(span-inset,height+.035,edge,mesh)
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
        if(i===0)addEntranceBoard(gate.board,leaves===1,centre,1.3,.078,Math.min(width*.83,1.15))
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
