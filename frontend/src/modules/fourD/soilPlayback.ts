import * as THREE from 'three'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'
import { bakeSoil, bucketFrame, bucketOpeningInFrame, soilBasis, soilFrameAt, soilHeightAt, type SoilGrid, type SoilDefinition } from './soilSimulation'

function surface(g: SoilGrid, material: THREE.Material) {
  const geometry=new THREE.PlaneGeometry(g.n*g.cell,g.n*g.cell,g.n,g.n)
  geometry.translate(g.x+g.n*g.cell/2,g.y+g.n*g.cell/2,g.base+.002)
  const colours=new Float32Array((g.n+1)**2*3)
  let seed=17
  for(let i=0;i<colours.length/3;i++) { seed=(Math.imul(seed,1664525)+1013904223)>>>0;const shade=.92+.08*(seed/4294967296);colours.set([shade,shade,shade],i*3) }
  geometry.setAttribute('color',new THREE.BufferAttribute(colours,3))
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false
  return mesh
}
function updateSurface(mesh: THREE.Mesh, g: SoilGrid, heights: Float32Array, foundation?:{grid:SoilGrid;heights:Float32Array}) {
  const position=mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  for(let y=0;y<=g.n;y++)for(let x=0;x<=g.n;x++) {
    let sum=0,count=0
    for(let dy=-1;dy<=0;dy++)for(let dx=-1;dx<=0;dx++)if(x+dx>=0&&x+dx<g.n&&y+dy>=0&&y+dy<g.n){sum+=heights[(y+dy)*g.n+x+dx];count++}
    // PlaneGeometry emits rows from positive Y to negative Y.
    const base=foundation?soilHeightAt(foundation.grid,foundation.heights,g.x+x*g.cell,g.y+y*g.cell):0
    position.setZ((g.n-y)*(g.n+1)+x,g.base+.002+base+(count?sum/count:0))
  }
  position.needsUpdate=true
  const indices:number[]=[]
  for(let y=0;y<g.n;y++)for(let x=0;x<g.n;x++)if(heights[y*g.n+x]>.00001){const a=(g.n-y)*(g.n+1)+x,b=a+1,c=a-(g.n+1),d=c+1;indices.push(a,b,c,b,d,c)}
  mesh.geometry.setIndex(indices);mesh.geometry.computeVertexNormals()
}

/** One small height field per pile, one bucket fill, at most 96 falling clods
 * and 1,216 instanced surface stones for coarse aggregate.
 * All geometry is owned here and released on rig/project changes. */
export function createSoilPlayback(s: SoilDefinition, poseAt: (time:number)=>THREE.Matrix4, bucket?:THREE.Object3D) {
  const bake=bakeSoil(s,poseAt), group=new THREE.Group();group.name='Soil · scoop and pour'
  const ground=new THREE.Group();ground.applyMatrix4(soilBasis(s));group.add(ground)
  const noise=new Uint8Array(128*128);let seed=7321
  for(let i=0;i<noise.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise[i]=80+(seed>>>24)*.6}
  const texture=new THREE.DataTexture(noise,128,128,THREE.RedFormat);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=texture.minFilter=THREE.LinearFilter;texture.repeat.set(4,4);texture.needsUpdate=true
  const material=new THREE.MeshStandardMaterial({color:s.color,roughness:1,vertexColors:true,bumpMap:texture,bumpScale:.012})
  const source=surface(bake.sourceGrid,material),deposit=surface(bake.depositGrid,material)
  source.name='Excavation pile';deposit.name='Deposited soil';ground.add(source,deposit)
  const fillMaterial=material.clone();fillMaterial.vertexColors=false
  const coarse=s.material==='gravel'||s.material==='rocks',grain=s.material==='rocks'?.12:.045
  if(s.material==='sand'){material.bumpScale=.003;fillMaterial.bumpScale=.003;texture.repeat.set(12,12)}
  const stoneGeometry=new THREE.IcosahedronGeometry(1,0),stonePosition=stoneGeometry.getAttribute('position')
  for(let i=0;i<stonePosition.count;i++){const x=stonePosition.getX(i),y=stonePosition.getY(i),z=stonePosition.getZ(i),f=.85+.15*Math.sin(x*17+y*31+z*13);stonePosition.setXYZ(i,x*f,y*f,z*f)}
  stoneGeometry.computeVertexNormals()
  const sourceStones=new THREE.InstancedMesh(stoneGeometry,fillMaterial,512),depositStones=new THREE.InstancedMesh(stoneGeometry,fillMaterial,512),fillStones=new THREE.InstancedMesh(stoneGeometry,fillMaterial,192)
  sourceStones.name='Source aggregate';depositStones.name='Deposited aggregate';fillStones.name='Carried aggregate';fillStones.matrixAutoUpdate=false
  ground.add(sourceStones,depositStones);group.add(fillStones)
  const random=(i:number,salt:number)=>{let n=Math.imul(i+1,2654435761)^Math.imul(salt+1,1597334677);n=Math.imul(n^(n>>>16),2246822507);n=Math.imul(n^(n>>>13),3266489909);return ((n^(n>>>16))>>>0)/4294967296}
  for(const stones of [sourceStones,depositStones,fillStones]){stones.visible=coarse;stones.frustumCulled=false;stones.castShadow=true;stones.receiveShadow=true;for(let i=0;i<stones.instanceMatrix.count;i++)stones.setColorAt(i,new THREE.Color().setScalar(.65+.35*random(i,17)));if(stones.instanceColor)stones.instanceColor.needsUpdate=true}
  const fillGeometry=new THREE.BoxGeometry(1,1,1,12,1,12),fillVertices=fillGeometry.getAttribute('position')
  for(let i=0;i<fillVertices.count;i++) {const x=fillVertices.getX(i),y=fillVertices.getY(i),z=fillVertices.getZ(i);fillVertices.setXYZ(i,x*(y<0?.8:1),y<0?-.5:.4+.18*Math.max(0,1-2*(x*x+z*z))+.015*Math.sin(x*57+z*31),z*(y<0?.8:1))}
  fillGeometry.computeVertexNormals()
  const fillRest=Float32Array.from(fillVertices.array)
  // A conservative convex envelope prevents a box-shaped load protruding through
  // a curved bucket. This is visual containment, not a collision/volume solver.
  let hull:ConvexHull|undefined
  const hullCenter=new THREE.Vector3()
  if(bucket){
    bucket.updateWorldMatrix(true,true);const inverse=bucket.matrixWorld.clone().invert(),points:THREE.Vector3[]=[]
    bucket.traverse(o=>{if(o instanceof THREE.Mesh){const a=o.geometry.getAttribute('position');if(!a)return;const step=Math.max(1,Math.ceil(a.count/1000));for(let i=0;i<a.count;i+=step)points.push(new THREE.Vector3().fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld).applyMatrix4(inverse))}})
    if(points.length>=4){for(const p of points)hullCenter.add(p);hullCenter.divideScalar(points.length);for(const p of points)p.sub(hullCenter).multiplyScalar(.93).add(hullCenter);const candidate=new ConvexHull().setFromPoints(points);if(candidate.faces.length>=4)hull=candidate}
  }
  const fill=new THREE.Mesh(fillGeometry,fillMaterial);fill.name='Bucket contents';fill.castShadow=true;fill.matrixAutoUpdate=false;group.add(fill)
  const clods=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),fillMaterial,96);clods.name='Falling soil';clods.frustumCulled=false;ground.add(clods)
  const helpers=new THREE.Group();helpers.name='Bucket volume guide';helpers.matrixAutoUpdate=false;group.add(helpers)
  const wire=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...s.size)),new THREE.LineBasicMaterial({color:'#fbbf24'}));helpers.add(wire)
  const arrow=new THREE.ArrowHelper(bucketOpeningInFrame(s),new THREE.Vector3(),Math.max(...s.size),0x38bdf8)
  arrow.line.geometry=arrow.line.geometry.clone();arrow.cone.geometry=arrow.cone.geometry.clone();helpers.add(arrow)
  let last:ReturnType<typeof soilFrameAt>|null=null,lastFill=-1
  const dummy=new THREE.Object3D()
  function scatter(stones:THREE.InstancedMesh,g:SoilGrid,h:Float32Array,foundation?:{grid:SoilGrid;heights:Float32Array}) {
    if(!coarse)return
    let index=0
    // A fixed number of surface stones, independent of pile volume. Never create
    // one object per grain; seeking reuses the same instance buffers.
    for(let i=0;i<1536&&index<512;i++){
      const x=g.x+random(i,11)*g.n*g.cell,y=g.y+random(i,139)*g.n*g.cell,height=soilHeightAt(g,h,x,y)
      if(height<grain*.4)continue
      const scale=grain*(.55+random(i,78)*.75),base=foundation?soilHeightAt(foundation.grid,foundation.heights,x,y):0
      dummy.position.set(x,y,g.base+base+height-scale*.2);dummy.rotation.set(random(i,4)*6,random(i,5)*6,random(i,6)*6);dummy.scale.set(scale*(.7+random(i,7)),scale,scale*(.6+random(i,8)*.5));dummy.updateMatrix();stones.setMatrixAt(index++,dummy.matrix)
    }
    stones.count=index;stones.instanceMatrix.needsUpdate=true
  }
  function update(time:number|null,bucketWorld:THREE.Matrix4,showGuide=false) {
    const state=soilFrameAt(bake,time)
    if(last!==state){updateSurface(source,bake.sourceGrid,state.source);updateSurface(deposit,bake.depositGrid,state.deposit,{grid:bake.sourceGrid,heights:state.source});scatter(sourceStones,bake.sourceGrid,state.source);scatter(depositStones,bake.depositGrid,state.deposit,{grid:bake.sourceGrid,heights:state.source});last=state}
    const frame=bucketWorld.clone().multiply(bucketFrame(s))
    helpers.visible=showGuide;helpers.matrix.copy(frame)
    fill.visible=state.fill>1e-7
    const boxVolume=s.size[0]*s.size[1]*s.size[2]*Math.abs(frame.determinant())*.85
    const fraction=Math.min(1,state.fill/Math.max(.000001,boxVolume))
    const local=new THREE.Matrix4().compose(new THREE.Vector3(0,-s.size[1]/2+s.size[1]*fraction*.5,0),new THREE.Quaternion(),new THREE.Vector3(s.size[0]*.94,s.size[1]*fraction,s.size[2]*.94))
    if(hull&&lastFill!==state.fill){
      const volumeFrame=bucketFrame(s).multiply(local),point=new THREE.Vector3(),delta=new THREE.Vector3()
      for(let i=0;i<fillVertices.count;i++){
        point.fromArray(fillRest,i*3).applyMatrix4(volumeFrame);delta.copy(point).sub(hullCenter);let amount=1
        for(const face of hull.faces){const end=face.normal.dot(point)-face.constant;if(end>0){const origin=face.normal.dot(hullCenter)-face.constant;amount=Math.min(amount,-origin/(end-origin))}}
        point.copy(hullCenter).addScaledVector(delta,Math.max(0,amount));fillVertices.setXYZ(i,point.x,point.y,point.z)
      }
      fillVertices.needsUpdate=true;fillGeometry.computeVertexNormals();fillGeometry.computeBoundingSphere()
    }
    if(hull)fill.matrix.copy(bucketWorld)
    else fill.matrix.copy(frame).multiply(local)
    if(coarse&&lastFill!==state.fill){
      const volumeFrame=bucketFrame(s).multiply(local),rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation));let count=0
      for(let i=0;i<192&&state.fill>1e-7;i++){
        const x=(random(i,91)-.5)*.82,z=(random(i,57)-.5)*.82,point=new THREE.Vector3(x,.4+.18*Math.max(0,1-2*(x*x+z*z)),z).applyMatrix4(volumeFrame)
        if(hull&&!hull.containsPoint(point))continue
        dummy.position.copy(point);dummy.quaternion.copy(rotation).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(random(i,3)*6,random(i,4)*6,random(i,5)*6)))
        const scale=Math.min(grain*(.6+random(i,22)*.7),Math.min(...s.size)*.08)*Math.min(1,Math.sqrt(fraction*8));dummy.scale.set(scale,scale*.75,scale*.85);dummy.updateMatrix();fillStones.setMatrixAt(count++,dummy.matrix)
      }
      fillStones.count=count;fillStones.instanceMatrix.needsUpdate=true
    }
    fillStones.matrix.copy(bucketWorld);fillStones.visible=coarse&&fill.visible
    lastFill=state.fill
    const t=time===null?0:(time-Date.parse(s.start))/(Date.parse(s.end)-Date.parse(s.start))*s.duration_seconds
    const active=bake.falls.filter(f=>t>=f.begin&&t<f.land)
    let index=0
    for(let a=active.length-1;a>=0&&index<96;a--) {
      const fall=active[a], age=t-fall.begin, flight=fall.land-fall.begin
      for(let j=0;j<4&&index<96;j++) {
        const phase=a*17+j*41, scatter=Math.min(.14,s.size[0]*.05)
        const x=fall.from[0]+Math.sin(phase)*scatter,y=fall.from[1]+Math.cos(phase)*scatter,z=Math.max(fall.to[2],fall.from[2]-4.905*age*age)
        dummy.position.set(x,y,z);dummy.rotation.set(age*4+phase,phase,age*3)
        dummy.scale.setScalar(Math.max(.015,Math.min(.12,Math.cbrt(fall.volume/4)*.45))*(1-.2*age/flight));dummy.updateMatrix();clods.setMatrixAt(index++,dummy.matrix)
      }
    }
    clods.count=index;clods.instanceMatrix.needsUpdate=true
    group.updateMatrixWorld(true)
    return state
  }
  return {group,bake,update,dispose(){source.geometry.dispose();deposit.geometry.dispose();fill.geometry.dispose();clods.geometry.dispose();clods.dispose();stoneGeometry.dispose();sourceStones.dispose();depositStones.dispose();fillStones.dispose();helpers.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}});material.dispose();fillMaterial.dispose();texture.dispose()}}
}
