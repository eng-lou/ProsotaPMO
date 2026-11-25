import * as T from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { groundCutSource } from '../../src/modules/fourD/groundFromObjects'
import { previewGround } from '../../src/modules/fourD/groundPreview'
import { parseAsset } from '../../src/modules/fourD/siteAssets'
import { siteMaterialLook } from '../../src/modules/fourD/siteAssetMaterials'

export async function run() {
  const inputs = new T.Group()
  inputs.rotation.x = Math.PI / 2
  function source(id:string, geometry:T.BufferGeometry, x:number, height:number, z:number) {
    const object = new T.Mesh(geometry,new T.MeshStandardMaterial())
    object.position.set(x,height,z)
    inputs.add(object)
    return {id,name:id,object}
  }
  const base = source('Site',new T.BoxGeometry(32,8,32),0,-4,0)
  const sources = []
  for (const x of [-10,-5,0,5,10]) for (const z of [-10,-5,0,5,10]) {
    sources.push(source('Cap '+x+'/'+z,new T.BoxGeometry(2.4,1,1.6),x,-.5,z))
    sources.push(source('Pile '+x+'/'+z,new T.CylinderGeometry(.24,.19,4,16),x,-3,z))
  }
  sources.push(source('Through cut',new T.BoxGeometry(1,9,1),13,-4.5,0))
  const cuts = sources.map(s=>groundCutSource(s,'z'))
  const result = await previewGround(cuts,base,'z',{margin:0},true,.4,.05,new AbortController().signal,()=>{})
  const soil = result.pieces.find(p=>!p.phase)!.preview
  const glb = await new GLTFExporter().parseAsync(soil.scene,{binary:true}) as ArrayBuffer
  const {object,dimensions} = await parseAsset(glb)
  const placed = new T.Group()
  placed.position.copy(soil.anchor)
  placed.rotation.x = Math.PI / 2
  placed.scale.set(dimensions.width,dimensions.height,dimensions.depth)
  placed.add(object)
  object.traverse(node=>{
    if (node instanceof T.Mesh) node.material = siteMaterialLook(node.material,'ground',{ground:'soil'},false)
  })
  const scene = new T.Scene()
  scene.add(placed,new T.AmbientLight('white',2))
  scene.updateMatrixWorld(true)
  function hit(x:number,start:number,direction:number,expected?:number) {
    const ray = new T.Raycaster(new T.Vector3(x,0,start),new T.Vector3(0,0,direction))
    const height = ray.intersectObject(placed)[0]?.point.z
    if (expected===undefined ? height!==undefined : height===undefined || Math.abs(height-expected)>.0001)
      throw Error('Ground at '+x+' from '+start+' expected '+expected+', got '+height)
  }
  for(const x of [-10,-5,0,5,10]) {
    hit(x,2,-1,-5.05); hit(x+1,2,-1,-1.05); hit(x,-9,1,-8)
  }
  hit(13,2,-1); hit(13,-9,1); hit(15,2,-1,0)

  const renderer = new T.WebGLRenderer({antialias:false,logarithmicDepthBuffer:true})
  renderer.setSize(48,48)
  const camera = new T.PerspectiveCamera(35,1,.1,100)
  function pixel(x:number,from:T.Vector3,colour:number) {
    scene.background = new T.Color(colour)
    camera.position.copy(from)
    camera.lookAt(x,0,-3)
    renderer.render(scene,camera)
    const gl=renderer.getContext(), rgba=new Uint8Array(4)
    gl.readPixels(24,24,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba)
    return rgba.slice(0,3).join(',')
  }
  try {
    // A shallow pit keeps its colour under two different backdrops. A true
    // through-cut samples the backdrop, proving the test detects an open face.
    for(const [x,from,open] of [[1,new T.Vector3(1,-.15,4),false],
      [0,new T.Vector3(0,0,-12),false],[13,new T.Vector3(13,0,4),true]] as const) {
      if ((pixel(x,from,0xff00ff)!==pixel(x,from,0x00ff00))!==open)
        throw Error('Unexpected background visibility at '+x+' viewed from '+from.toArray())
    }
    return {passed:true,shallowCaps:25,deepPiles:25,throughCuts:1}
  } finally { renderer.dispose() }
}
