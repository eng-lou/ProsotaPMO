import * as T from 'three'
import { applyRealisticToBatch, clearRealisticFromBatch, createRealisticModelInfo, addRealisticPiece } from '../../src/modules/fourD/realisticMaterials'
import { getGouraudVariant } from '../../src/modules/fourD/renderModeMaterials'
import type { BatchState } from '../../src/modules/fourD/elementBatching'
import { setBatchAnimation, clearBatchAnimation, bindBatchAnimationMirror, bindBatchAnimationEdges } from '../../src/modules/fourD/batchAnimationShader'

export function run() {
  const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
  renderer.setSize(256, 256); renderer.setClearColor(0xffffff)
  renderer.localClippingEnabled = true
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap
  const scene = new T.Scene(), camera = new T.OrthographicCamera(-3, 3, 3, -3, .1, 100)
  camera.position.set(4, 5, 6); camera.lookAt(0, 0, 0)
  const light = new T.DirectionalLight(0xffffff, 3); light.position.set(-3, 6, 3)
  light.castShadow = true; scene.add(light, new T.AmbientLight(0xffffff, 1))
  const geometry = new T.BoxGeometry(1, 2, 1), material = new T.MeshStandardMaterial({ color: 0xaa2222 })
  const batch = new T.BatchedMesh(2, 24, 36, material), shape = batch.addGeometry(geometry)
  const ids = [batch.addInstance(shape), batch.addInstance(shape)]
  batch.setMatrixAt(ids[0], new T.Matrix4().makeTranslation(-1, 0, 0))
  batch.setMatrixAt(ids[1], new T.Matrix4().makeTranslation(1, 0, 0))
  batch.castShadow = true; scene.add(batch)
  const pixels = () => {
    renderer.render(scene, camera)
    const gl = renderer.getContext(), data = new Uint8Array(256 * 256 * 4)
    gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, data)
    return data
  }
  const red = (data: Uint8Array) => { let n=0; for(let i=0;i<data.length;i+=4) if(data[i]>data[i+1]*1.2 && data[i+1]<220)n++; return n }
  const errors: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'))
  const baseline = red(pixels())
  setBatchAnimation(batch, 0, 1); setBatchAnimation(batch, 1, 1)
  const start = red(pixels())
  setBatchAnimation(batch, 0, 1, new T.Plane(new T.Vector3(0, 1, 0), 0))
  const half = red(pixels())
  setBatchAnimation(batch, 0, 0); setBatchAnimation(batch, 1, 0)
  const removed = red(pixels())
  setBatchAnimation(batch, 0, .5); setBatchAnimation(batch, 1, .5)
  const faded = red(pixels())
  clearBatchAnimation(batch, ids)
  const restored = red(pixels())
  // Normal override (AO), basic and Phong passes must all obey clipping/fading.
  const occupied = (data: Uint8Array) => { let n=0; for(let i=0;i<data.length;i+=4) if(data[i]<248 || data[i+1]<248 || data[i+2]<248)n++; return n }
  const modes: Record<string,number[]> = {}
  const state:BatchState={mesh:batch,byExpressId:new Map(),expressIdByInstanceId:new Map(),geometryByIfcId:new Map([[1,{geometry,geometryId:shape}]]),geometryById:new Map([[shape,geometry]])}
  const realisticInfo=createRealisticModelInfo()
  for(const id of ids){
    batch.setColorAt(id,new T.Color('white'))
    state.byExpressId.set(id+1,[{instanceId:id,geometryId:shape,ifcGeometryId:1,matrix:batch.getMatrixAt(id,new T.Matrix4()),color:new T.Color('white'),colorAlpha:1}])
    state.expressIdByInstanceId.set(id,id+1)
    addRealisticPiece(realisticInfo,id+1,1,{styleName:'Concrete',materialNames:['Concrete'],layered:false,ifcType:'IFCWALL',transparent:false,sourceOpacity:1})
  }
  const realistic=applyRealisticToBatch(state,material,realisticInfo,{},false,false,true)
  for (const mode of [new T.MeshNormalMaterial(), new T.MeshBasicMaterial({color:0xaa2222}), new T.MeshPhongMaterial({color:0xaa2222}), getGouraudVariant(material,true), realistic]) {
    scene.overrideMaterial=mode
    clearBatchAnimation(batch,ids);const full=occupied(pixels())
    setBatchAnimation(batch,0,.5);setBatchAnimation(batch,1,.5);const partial=occupied(pixels())
    setBatchAnimation(batch,0,0);setBatchAnimation(batch,1,0);const hidden=occupied(pixels())
    modes[mode.type]=[full,partial,hidden]
    scene.overrideMaterial=null
  }
  clearRealisticFromBatch(state)
  clearBatchAnimation(batch,ids)
  // Remapped translucent instances must follow the SOURCE slot, not their own.
  const mirror = new T.BatchedMesh(1, 24, 36, new T.MeshBasicMaterial({color:0xaa2222,transparent:true,opacity:.7,depthWrite:false}))
  mirror.addInstance(mirror.addGeometry(geometry)); scene.add(mirror)
  bindBatchAnimationMirror(batch, mirror, new Int32Array([1]))
  batch.visible=false; setBatchAnimation(batch,1,0)
  const mirrorHidden=red(pixels()); setBatchAnimation(batch,1,1); const mirrorShown=red(pixels())
  scene.remove(mirror); batch.visible=true
  const edges=new T.InstancedMesh(new T.BoxGeometry(),new T.MeshBasicMaterial({color:0xaa2222}),1)
  bindBatchAnimationEdges(batch,edges,[0]); scene.add(edges); pixels(); scene.remove(edges)
  // A receiver makes shadow visibility observable, not just shader compilation.
  const floor=new T.Mesh(new T.PlaneGeometry(20,20),new T.ShadowMaterial({opacity:1}))
  floor.rotation.x=-Math.PI/2;floor.position.y=-1.05;floor.receiveShadow=true;scene.add(floor)
  material.colorWrite=false; material.depthWrite=false
  const shadows:number[]=[]
  for(const opacity of [1,.5,0,1]) {
    setBatchAnimation(batch,0,opacity);setBatchAnimation(batch,1,opacity)
    const data=pixels();let dark=0
    for(let i=0;i<data.length;i+=4)if(data[i]<220&&Math.abs(data[i]-data[i+1])<3)dark++
    shadows.push(dark)
  }
  material.colorWrite=true; material.depthWrite=true; scene.remove(floor)
  // A large linked population stays one batch in each colour/shadow pass.
  const large=new T.BatchedMesh(37000,24,36,material.clone()), g=large.addGeometry(geometry)
  for(let i=0;i<37000;i++) { const id=large.addInstance(g); large.setMatrixAt(id,new T.Matrix4().makeTranslation(i%100,Math.floor(i/100)*3,0)); setBatchAnimation(large,id,1) }
  scene.remove(batch);scene.add(large);large.castShadow=true; renderer.info.autoReset=false; renderer.info.reset(); pixels()
  const draws=renderer.info.render.calls
  const passesAgree=Object.values(modes).every(([full,partial,hidden])=>full>partial&&partial>0&&hidden===0) && shadows[0]>shadows[1]&&shadows[1]>0&&shadows[2]===0&&shadows[3]===shadows[0]
  const passed = passesAgree && !errors.length && baseline===start && half>0 && half<start && removed===0 && faded>0 && faded<start && restored===start && mirrorHidden===0 && mirrorShown>0 && draws<10
  renderer.dispose()
  return {passed,baseline,start,half,removed,faded,restored,mirrorHidden,mirrorShown,draws,modes,shadows,errors}
}
