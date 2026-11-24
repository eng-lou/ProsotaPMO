import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const V=(x:number,y:number,z:number)=>new Vector3(x,y,z)
const up=V(0,1,0)
const colours={frame:0x9e3026,steel:0xbac0c4,grip:0x43464a,deck:0xac865d,boom:0xe29a28,hydraulic:0x5c8052,mesh:0xc98443}
export type Finish=keyof typeof colours

// Batch fixed hardware by finish under each pivot. All geometry is in authored glTF metres.
export function coreHardwareBuilder(materials:Record<Finish,MeshStandardMaterial>) {
  const batches=new Map<Object3D,Map<Finish,BufferGeometry[]>>()
  const add=(parent:Object3D,finish:Finish,geo:BufferGeometry)=>{
    let group=batches.get(parent);if(!group){group=new Map();batches.set(parent,group)}
    const geometries=group.get(finish)??[];geometries.push(geo);group.set(finish,geometries)
  }
  function box(p:Object3D,m:Finish,x:number,y:number,z:number,w:number,h:number,d:number){
    add(p,m,new BoxGeometry(w,h,d).translate(x,y,z))
  }
  function member(p:Object3D,m:Finish,a:Vector3,b:Vector3,w:number,round=false){
    const dir=b.clone().sub(a), length=dir.length()
    const g=round?new CylinderGeometry(w/2,w/2,length,10):new BoxGeometry(w,length,w)
    const q=new Quaternion().setFromUnitVectors(up,dir.normalize())
    add(p,m,g.applyMatrix4(new Matrix4().compose(a.clone().lerp(b,.5),q,V(1,1,1))))
  }
  function finish() {
    for(const [parent,group] of batches)for(const [finish,geometries] of group){
      const merged=mergeGeometries(geometries)!
      const mesh=new Mesh(merged,materials[finish]);mesh.name=parent.name+'_'+finish
      mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh)
      geometries.forEach(g=>g.dispose())
    }
  }
  return {box,member,finish}
}

export function addCoreHardware(frame:Object3D, withBoom=true) {
  const materials = Object.fromEntries(Object.entries(colours).map(([name,color])=>{
    const material=new MeshStandardMaterial({color,metalness:name==='deck'?.03:.44,roughness:name==='deck'?.83:.48})
    material.name='Core rig '+name
    return [name,material]
  })) as Record<Finish,MeshStandardMaterial>
  const {box,member,finish}=coreHardwareBuilder(materials)
  function pivot(parent:Object3D,name:string,x=0,y=0,z=0){
    const g=new Group();g.name='CoreRig_'+name;g.userData.coreRigPart=name;g.position.set(x,y,z);parent.add(g);return g
  }
  const top=pivot(frame,'hardware')
  // Upper placing deck spans the core opening; outside galleries belong to the original formwork.
  for(let x=-6.75;x<=6.75;x+=1.5){
    box(top,'frame',x,3.77,0,.18,.34,10.2)
    box(top,'frame',x,3.57,0,.28,.055,10.2)
  }
  for(let i=0;i<40;i++) {
    const z=-4.875+i*.25
    if(z>=-3.5 && z<=-2.25) {
      box(top,'deck',-6.25,4.01,z,1.3,.13,.245)
      box(top,'deck',1.95,4.01,z,9.9,.13,.245)
    } else box(top,'deck',0,4.01,z,13.8,.13,.245)
  }
  for(const z of [-3.5,-2.25]){
    member(top,'frame',V(-5.58,2.25,z),V(-3,3.95,z),.085)
    for(const x of [-5.58,-3.05])member(top,'frame',V(x,3.95,z),V(x,5.04,z),.045,true)
    member(top,'frame',V(-5.58,5.04,z),V(-3.05,5.04,z),.045,true)
  }
  for(let i=0;i<9;i++)box(top,'steel',-5.48+i*.29,2.38+i*.19,-2.875,.31,.065,1.18)
  for(const side of [-1,1]){
    box(top,'frame',side*6.96,3.83,0,.19,.36,10.2)
    box(top,'frame',0,3.83,side*5.03,14,.36,.19)
    for(const x of [-5,-2,2,5]){
      box(top,'frame',x,1.92,side*4.86,.16,3.84,.16)
      member(top,'frame',V(x,2.73,side*4.86),V(x+.8,3.64,side*4.86),.085)
      // Cylinder body travels with the upper frame. The polished piston extends down to the lower shoe.
      const ram=pivot(top,'ram',x,-.6,side*4.97)
      member(ram,'steel',V(0,0,0),V(0,-1,0),.073,true)
      member(top,'hydraulic',V(x,.16,side*4.97),V(x,-.64,side*4.97),.14,true)
      const shoe=pivot(top,'lower',x,-2.4,side*4.97)
      box(shoe,'boom',0,.02,0,.38,.18,.25)
    }
  }
  for(const [ax,az,bx,bz] of [[-6.9,-5,6.9,-5],[6.9,-5,6.9,5],[6.9,5,-6.9,5],[-6.9,5,-6.9,-5]]){
    const n=Math.ceil(Math.hypot(bx-ax,bz-az)/1.9)
    for(let i=0;i<n;i++) {
      const t=i/n,x=ax+(bx-ax)*t,z=az+(bz-az)*t
      member(top,'frame',V(x,4.05,z),V(x,5.31,z),.057)
    }
    for(let i=0;i<=8;i++) member(top,i===8?'frame':'mesh',V(ax,4.19+i*.135,az),V(bx,4.19+i*.135,bz),i===8?.05:.014,true)
    const wires=Math.ceil(Math.hypot(bx-ax,bz-az)/.23)
    for(let i=1;i<wires;i++){
      const t=i/wires,x=ax+(bx-ax)*t,z=az+(bz-az)*t
      member(top,'mesh',V(x,4.18,z),V(x,5.25,z),.012,true)
    }
    member(top,'frame',V(ax,4.14,az),V(bx,4.14,bz),.14)
  }
  if (!withBoom) { finish(); return top }
  // The boom is a folded serial linkage. Each delivery pipe turns about the same pin as its arm.
  box(top,'grip',0,4.15,0,1.25,.16,1.25)
  for(const s of [-1,1])for(const z of [-1,1]){
    member(top,'boom',V(.85*s,4.22,.85*z),V(.26*s,4.95,.26*z),.14)
    box(top,'steel',s*.83,4.15,z*.83,.32,.12,.32)
  }
  member(top,'boom',V(0,4.2,0),V(0,5.86,0),.52,true)
  const turret=pivot(top,'slew',0,5.86,0)
  member(turret,'grip',V(0,-.08,0),V(0,.08,0),.64,true)
  const shoulder=pivot(turret,'shoulder',0,.17,0)
  const elbow=pivot(shoulder,'elbow',5.1,0,0)
  const tip=pivot(elbow,'tip',4.52,0,0)
  const hose=pivot(tip,'hose',3.82,0,0)
  for(const [arm,len] of [[shoulder,5.1],[elbow,4.52],[tip,3.82]] as const){
    member(arm,'boom',V(0,0,0),V(len,0,0),arm===shoulder?.23:.16)
    member(arm,'grip',V(.04,.04,.19),V(len-.04,.04,.19),.105,true)
    for(const t of [.12,.45,.8])box(arm,'steel',len*t,.04,.14,.052,.16,.2)
    for(const z of [-.135,.135]) {
      member(arm,'boom',V(-.06,-.13,z),V(.48,.04,z),.09)
      member(arm,'boom',V(len-.46,.035,z),V(len+.02,-.07,z),.085)
    }
    member(arm,'steel',V(0,0,-.19),V(0,0,.27),.2,true)
    member(arm,'hydraulic',V(.12,-.16,0),V(len*.38,-.29,0),.11,true)
    member(arm,'steel',V(len*.38,-.29,0),V(len*.53,-.13,0),.07,true)
  }
  member(hose,'grip',V(0,0,.18),V(.07,-.86,.18),.105,true)
  member(hose,'grip',V(.07,-.86,.18),V(.22,-1.66,.16),.10,true)
  finish()
  return top
}
