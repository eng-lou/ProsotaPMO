import * as THREE from 'three'
import type { Vec3 } from './equipmentRig'
import type { SoilCycleRecipe } from './equipmentCycle'

/** Authored bucket coordinates are local to the selected rigid part. Piles are
 * anchored in project metres, so they do not travel with the machine. */
export interface SoilDefinition {
  material?: 'soil' | 'sand' | 'gravel' | 'rocks'
  mode?: 'excavate' | 'preloaded'
  initial_fill?: number
  /** Discharge point as fractions of the calibrated volume's size. */
  outlet?: Vec3 | null
  cycle?: SoilCycleRecipe | null
  enabled: boolean; show_guide: boolean; bucket_node: string; center: Vec3; size: Vec3; rotation: Vec3
  /** Mouth direction in bucket-part coordinates, independent of the fitted box. */
  opening_direction?: Vec3 | null
  capacity: number; dump_angle: number; pour_seconds: number
  source: Vec3; radius: number; height: number; up_axis: 'y' | 'z'
  start: string; end: string; duration_seconds: number; steps: number; color: string
}
export function validateSoil(s: SoilDefinition) {
  const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7)
  if (!s.bucket_node || !vector(s.center) || !vector(s.size) || s.size.some(n => n <= 0) || !vector(s.rotation) || !vector(s.source)) throw Error('Choose a bucket part and valid bucket/pile dimensions')
  if (s.opening_direction != null && (!vector(s.opening_direction) || new THREE.Vector3(...s.opening_direction).lengthSq() < 1e-12)) throw Error('Bucket opening direction must be a non-zero finite vector')
  if (s.material != null && !['soil','sand','gravel','rocks'].includes(s.material) || s.mode != null && !['excavate','preloaded'].includes(s.mode)) throw Error('Choose a supported bulk material and loading mode')
  if(s.initial_fill!=null&&(!Number.isFinite(s.initial_fill)||s.initial_fill<0||s.initial_fill>1))throw Error('Starting load must be between 0 and 100%')
  if(s.outlet!=null&&(!vector(s.outlet)||s.outlet.some(n=>Math.abs(n)>.5)))throw Error('Discharge edge must be within the calibrated volume')
  for (const [n, min, max] of [[s.capacity,.001,100], [s.radius,.2,50], [s.height,.05,20], [s.dump_angle,s.mode==='preloaded'?10:45,170], [s.pour_seconds,.2,30], [s.duration_seconds,1,300], [s.steps,60,600]]) if (!Number.isFinite(n) || n < min || n > max) throw Error('Soil settings are outside their supported range')
  if (!Number.isInteger(s.steps) || !['y','z'].includes(s.up_axis) || !/^#[0-9a-f]{6}$/i.test(s.color) || !Number.isFinite(Date.parse(s.start)) || !Number.isFinite(Date.parse(s.end)) || Date.parse(s.end) <= Date.parse(s.start)) throw Error('Choose a valid soil simulation time range and colour')
}
export const soilBasis = (s: SoilDefinition) => new THREE.Matrix4().makeRotationX(s.up_axis === 'y' ? -Math.PI / 2 : 0)
export const bucketFrame = (s: SoilDefinition) => new THREE.Matrix4().compose(new THREE.Vector3(...s.center), new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation)), new THREE.Vector3(1,1,1))
export function bucketOpeningInFrame(s: SoilDefinition) {
  return s.opening_direction
    ? new THREE.Vector3(...s.opening_direction).transformDirection(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...s.rotation)).invert())
    : new THREE.Vector3(0,1,0)
}
export function bucketOpeningAngle(s: SoilDefinition, bucketWorld: THREE.Matrix4) {
  const direction=bucketOpeningInFrame(s).transformDirection(bucketWorld.clone().multiply(bucketFrame(s)))
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(direction[s.up_axis],-1,1)))
}
/** Explicitly mark the shown mouth-up pose. Never refit the volume or move the pile. */
export function calibrateBucketOpening(s: SoilDefinition, bucketWorld: THREE.Matrix4): Vec3 {
  if(!bucketWorld.elements.every(Number.isFinite)||Math.abs(bucketWorld.determinant())<1e-12)throw Error('Give the equipment a non-zero scale before calibrating its opening.')
  return new THREE.Vector3(0,s.up_axis==='y'?1:0,s.up_axis==='z'?1:0).transformDirection(bucketWorld.clone().invert()).toArray() as Vec3
}
export function bucketOpeningLip(s: SoilDefinition) {
  if(s.outlet)return new THREE.Vector3(...s.outlet).multiply(new THREE.Vector3(...s.size))
  const direction=bucketOpeningInFrame(s)
  const distance=Math.min(...s.size.map((size,i)=>Math.abs(direction.getComponent(i))>1e-9?size/2/Math.abs(direction.getComponent(i)):Infinity))
  return direction.multiplyScalar(distance)
}
export interface SoilGrid { n: number; x: number; y: number; cell: number; base: number }
export interface SoilFall { from: Vec3; to: Vec3; begin: number; land: number; volume: number }
export interface SoilFrame { source: Float32Array; deposit: Float32Array; fill: number; inAir: number; deposited: number }
export interface SoilBake { frames: SoilFrame[]; sourceGrid: SoilGrid; depositGrid: SoilGrid; falls: SoilFall[]; initialVolume: number; config: SoilDefinition }
const volume = (h: Float32Array, cell: number) => h.reduce((a,b)=>a+b,0)*cell*cell
export function soilHeightAt(g: SoilGrid, h: Float32Array, x:number, y:number) {
  const u=(x-g.x)/g.cell-.5,v=(y-g.y)/g.cell-.5,ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy
  const sample=(a:number,b:number)=>a>=0&&b>=0&&a<g.n&&b<g.n?h[b*g.n+a]:0
  return sample(ix,iy)*(1-fx)*(1-fy)+sample(ix+1,iy)*fx*(1-fy)+sample(ix,iy+1)*(1-fx)*fy+sample(ix+1,iy+1)*fx*fy
}

/** Fixed steps, absolute poses and conserved bulk volume. Rendering never mutates
 * the simulation: seeking, loops and video capture read the same baked states. */
export function bakeSoil(s: SoilDefinition, poseAt: (time: number) => THREE.Matrix4): SoilBake {
  validateSoil(s)
  const basis = soilBasis(s), toGround = basis.clone().invert()
  const sourcePos = new THREE.Vector3(...s.source).applyMatrix4(toGround)
  const n = 48, cell = 2*s.radius/n
  const sourceGrid: SoilGrid = { n, x:sourcePos.x-s.radius, y:sourcePos.y-s.radius, cell, base:sourcePos.z }
  const source = new Float32Array(n*n)
  for (let i=0;i<n*n;i++) {
    const x=((i%n+.5)/n*2-1), y=((Math.floor(i/n)+.5)/n*2-1)
    source[i]=s.mode==='preloaded'?0:s.height*Math.pow(Math.max(0,1-x*x-y*y),1.35)*(1+.025*Math.sin(x*14+y*3)*Math.cos(y*11-x*2))
  }
  const startingLoad=s.mode==='preloaded'?s.capacity*(s.initial_fill??1):0
  const initialVolume = volume(source,cell)+startingLoad, start=Date.parse(s.start), span=Date.parse(s.end)-start
  const frames: SoilFrame[] = [], falls: SoilFall[] = []
  const poses = Array.from({length:s.steps+1},(_,i)=>toGround.clone().multiply(poseAt(start+span*i/s.steps)).multiply(bucketFrame(s)))
  const bounds = new THREE.Box3()
  for (const pose of poses) {
    if(!pose.elements.every(Number.isFinite)||Math.abs(pose.determinant())<1e-12)throw Error('Bucket transform is singular; give the equipment a non-zero scale before setting up soil.')
    for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])bounds.expandByPoint(new THREE.Vector3(x*s.size[0],y*s.size[1],z*s.size[2]).applyMatrix4(pose))
  }
  const side=Math.max(bounds.max.x-bounds.min.x,bounds.max.y-bounds.min.y)+Math.max(4,s.radius)
  if (!Number.isFinite(side) || side>200) throw Error('Soil cycle covers more than 200 m. Use a shorter work cycle.')
  if(bounds.max.z-sourcePos.z>100)throw Error('Soil cycle supports bucket drops up to 100 m above the pile base.')
  const depositGrid: SoilGrid={n:64,x:(bounds.max.x+bounds.min.x-side)/2,y:(bounds.max.y+bounds.min.y-side)/2,cell:side/64,base:sourcePos.z}
  const deposit=new Float32Array(64*64), dt=s.duration_seconds/s.steps
  let fill=startingLoad, inAir=0, deposited=0
  let sourceChanged=true,depositChanged=true,sourceSnapshot=source,depositSnapshot=deposit
  const snapshot=()=>{
    if(sourceChanged){sourceSnapshot=source.slice();sourceChanged=false}
    if(depositChanged){depositSnapshot=deposit.slice();depositChanged=false}
    frames.push({source:sourceSnapshot,deposit:depositSnapshot,fill,inAir:Math.max(0,inAir),deposited})
  }
  const pending: SoilFall[]=[]
  const settleDeposit=()=>{
    const g=depositGrid,slope=Math.tan(THREE.MathUtils.degToRad(s.material==='sand'?32:s.material==='rocks'?42:37))
    const floor=Float32Array.from(deposit,(_,i)=>soilHeightAt(sourceGrid,source,g.x+(i%g.n+.5)*g.cell,g.y+(Math.floor(i/g.n)+.5)*g.cell))
    // Conservative height-field relaxation: spread an over-steep deposit into
    // neighbouring cells. This is a visual repose model, not per-grain physics.
    for(let pass=0;pass<24;pass++){
      let moved=0
      for(let k=0;k<g.n*g.n;k++){
        const i=pass%2?g.n*g.n-1-k:k,x=i%g.n,y=Math.floor(i/g.n)
        for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]]){
          if(x+dx<0||x+dx>=g.n||y+dy>=g.n)continue
          const j=i+dx+dy*g.n,d=deposit[i]+floor[i]-deposit[j]-floor[j],excess=Math.abs(d)-slope*g.cell*Math.hypot(dx,dy)
          if(excess<=1e-5)continue
          const high=d>0?i:j,low=d>0?j:i,amount=Math.min(deposit[high],excess*.5)
          deposit[high]-=amount;deposit[low]+=amount;moved=Math.max(moved,amount)
        }
      }
      if(moved<1e-5)break
    }
  }
  const land = (fall: SoilFall) => {
    const g=depositGrid, radius=Math.max(g.cell*1.6,Math.cbrt(s.capacity)*.7)
    const weights: [number,number][]=[]; let sum=0
    for(let y=Math.max(0,Math.floor((fall.to[1]-radius-g.y)/g.cell)); y<Math.min(g.n,Math.ceil((fall.to[1]+radius-g.y)/g.cell));y++) for(let x=Math.max(0,Math.floor((fall.to[0]-radius-g.x)/g.cell));x<Math.min(g.n,Math.ceil((fall.to[0]+radius-g.x)/g.cell));x++) {
      const d=Math.hypot(g.x+(x+.5)*g.cell-fall.to[0],g.y+(y+.5)*g.cell-fall.to[1]), w=Math.max(0,1-d/radius)
      if(w>0){weights.push([y*g.n+x,w]);sum+=w}
    }
    for(const [i,w] of weights)deposit[i]+=fall.volume*w/sum/(g.cell*g.cell)
    settleDeposit()
    depositChanged=true
    deposited+=fall.volume;inAir-=fall.volume
  }
  for(let step=0;step<=s.steps;step++) {
    const t=step*dt, pose=poses[step], inverse=pose.clone().invert()
    for(let i=pending.length-1;i>=0;i--)if(pending[i].land<=t){land(pending[i]);pending.splice(i,1)}
    const opening=bucketOpeningInFrame(s).transformDirection(pose)
    const pouring=opening.z<Math.cos(THREE.MathUtils.degToRad(s.dump_angle))
    if(step && s.mode!=='preloaded' && !pouring && fill<s.capacity) {
      // Intersect each vertical soil column with the oriented bucket box (slab
      // interval). Only remove exposed top soil: no invisible tunnels or mining
      // from below a pile. A limited capacity scales the entire bite uniformly.
      const removed: [number,number][]=[];let bite=0
      const dir=new THREE.Vector3(0,0,1).transformDirection(inverse)
      const scale=new THREE.Vector3(0,0,1).applyMatrix4(inverse).sub(new THREE.Vector3().applyMatrix4(inverse)).length()
      dir.multiplyScalar(scale)
      for(let i=0;i<n*n;i++) {
        if(source[i]<=0)continue
        const p=new THREE.Vector3(sourceGrid.x+(i%n+.5)*cell,sourceGrid.y+(Math.floor(i/n)+.5)*cell,sourceGrid.base).applyMatrix4(inverse)
        let low=0, high=source[i]
        for(let a=0;a<3;a++) {
          const h=s.size[a]/2, q=p.getComponent(a), d=dir.getComponent(a)
          if(Math.abs(d)<1e-10){if(Math.abs(q)>h){high=-1;break}}
          else {const x=(-h-q)/d,y=(h-q)/d;low=Math.max(low,Math.min(x,y));high=Math.min(high,Math.max(x,y))}
        }
        if(high>=source[i]-1e-6 && high>low){const amount=(high-low)*cell*cell;removed.push([i,amount]);bite+=amount}
      }
      const factor=bite>0?Math.min(1,(s.capacity-fill)/bite):0
      for(const [i,amount] of removed)source[i]=Math.max(0,source[i]-amount*factor/(cell*cell))
      if(bite*factor>0)sourceChanged=true
      fill+=bite*factor
    }
    if(step && pouring && fill>1e-8) {
      const amount=Math.min(fill,s.capacity*dt/s.pour_seconds)
      const lip=bucketOpeningLip(s).applyMatrix4(pose)
      const g=depositGrid, ix=Math.max(0,Math.min(g.n-1,Math.floor((lip.x-g.x)/g.cell))), iy=Math.max(0,Math.min(g.n-1,Math.floor((lip.y-g.y)/g.cell)))
      const floor=g.base+deposit[iy*g.n+ix]+soilHeightAt(sourceGrid,source,lip.x,lip.y), height=Math.max(.02,lip.z-floor)
      const fall:SoilFall={from:[lip.x,lip.y,Math.max(lip.z,floor+.02)],to:[lip.x,lip.y,floor],begin:t,land:t+Math.sqrt(2*height/9.81),volume:amount}
      falls.push(fall);pending.push(fall);fill-=amount;inAir+=amount
    }
    snapshot()
  }
  // Continue falling after the last equipment key; the machine holds its pose.
  for(let step=s.steps+1;pending.length&&step<=s.steps+Math.ceil(20/dt);step++){
    for(let i=pending.length-1;i>=0;i--)if(pending[i].land<=step*dt){land(pending[i]);pending.splice(i,1)}
    snapshot()
  }
  return {frames,sourceGrid,depositGrid,falls,initialVolume,config:s}
}
export function soilFrameAt(bake: SoilBake, time: number|null) {
  const s=bake.config, u=time===null?0:(time-Date.parse(s.start))/(Date.parse(s.end)-Date.parse(s.start))
  return bake.frames[Math.max(0,Math.min(bake.frames.length-1,Math.floor(u*s.steps+1e-7)))]
}
