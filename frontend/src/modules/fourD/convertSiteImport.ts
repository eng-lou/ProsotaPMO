import { fbxSourceSettings } from './fbxSourceSettings'
import { exportMorphTracks } from './exportMorphTracks'
import { dataUriToBlob } from './dataUriBlob'
import { prepareImportedOpacity } from './importOpacity'
import { applyInitialAssetPose, captureAssetBindPose } from './assetPose'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { convertMeshesToStandardMaterial } from './import3d'
export interface ImportOptions { upAxis:'auto'|'y'|'z'; unitScale:number; includeAnimation:boolean }
export async function convertSiteImport(file:File, companions:File[], options:ImportOptions):Promise<File> {
 const ext=file.name.split('.').pop()?.toLowerCase()
 if(!['glb','gltf','fbx','obj'].includes(ext || ''))throw Error('Choose a GLB, glTF, FBX or OBJ model.')
 if(ext==='glb' && (options.upAxis==='y'||options.upAxis==='auto') && (options.unitScale===1||options.unitScale===0) && options.includeAnimation)return file
 const manager=new THREE.LoadingManager(),urls:string[]=[],missing:string[]=[]
 manager.addHandler(/\.tga$/i,new TGALoader(manager))
 const normal=(name:string)=>decodeURIComponent(name).replace(/\\/g,'/').replace(/^\.\//,'').toLowerCase()
 const files=[file,...companions]
 manager.setURLModifier(url=>{
  if(/^blob:/i.test(url))return url
  if(/^data:/i.test(url)){const blob=URL.createObjectURL(dataUriToBlob(url));urls.push(blob);return blob}
  const path=normal(url),base=path.split('/').pop()
  const exact=files.filter(f=>normal(f.webkitRelativePath || f.name)===path)
  const candidates=exact.length?exact:files.filter(f=>normal(f.name)===base)
  if(candidates.length!==1)throw Error(candidates.length?'Several files are named '+base+'. Use unique texture filenames.':'Missing companion file: '+base+'. Select it together with the model.')
  const blob=URL.createObjectURL(candidates[0]);urls.push(blob);return blob
 })
 let finish!:()=>void
 const loaded=new Promise<void>(resolve=>{finish=resolve})
 manager.onLoad=finish;manager.onError=url=>missing.push(url)
 manager.itemStart('prosota-import')
 try {
  let object:THREE.Object3D
  const bytes=await file.arrayBuffer()
  const detected=ext==='fbx' && (options.upAxis==='auto' || options.unitScale===0) ? fbxSourceSettings(bytes) : {upAxis:'y' as const,unitScale:1}
  const upAxis=options.upAxis==='auto'?detected.upAxis:options.upAxis
  const unitScale=options.unitScale || detected.unitScale
  if(ext==='fbx')object=new FBXLoader(manager).parse(bytes,'')
  else if(ext==='obj'){
   const text=await file.text(),loader=new OBJLoader(manager)
   const libraries=[...text.matchAll(/^mtllib\s+(.+)$/gm)].map(m=>m[1].trim())
   if(libraries.length>1)throw Error('Combine OBJ material libraries into one MTL before importing.')
   const mtlName=libraries[0]
   if(mtlName){const mtl=companions.find(f=>normal(f.name)===normal(mtlName).split('/').pop());if(!mtl)throw Error('Select '+mtlName+' and its textures alongside the OBJ.');const materials=new MTLLoader(manager).parse(await mtl.text(),'');materials.preload();loader.setMaterials(materials)}
   object=loader.parse(text)
  }else{const gltf=await new GLTFLoader(manager).parseAsync(bytes,'');object=gltf.scene;object.animations=gltf.animations}
  manager.itemEnd('prosota-import');await loaded
  if(missing.length)throw Error('Some textures could not be read. Include the model’s MTL and texture files.')
  convertMeshesToStandardMaterial(object)
  // glTF stores opacity in the colour image. Preserve FBX/MTL alpha maps
  // explicitly because GLTFExporter does not export a separate alphaMap.
  const materials=new Set<THREE.MeshStandardMaterial>()
  object.traverse(node=>{if(node instanceof THREE.Mesh)for(const material of Array.isArray(node.material)?node.material:[node.material])if(material instanceof THREE.MeshStandardMaterial)materials.add(material)})
  for(const material of materials){
    const alpha=material.alphaMap;if(!alpha)continue
    const base=material.map
    if(base){base.updateMatrix();alpha.updateMatrix();if(base.channel!==alpha.channel || !base.matrix.equals(alpha.matrix) || base.flipY!==alpha.flipY)throw Error('Material '+material.name+' uses different colour and opacity coordinates. Bake its opacity into the colour texture before importing.')}
    const image=(base?.image || alpha.image) as HTMLImageElement
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height)
    if(base)ctx.drawImage(base.image as CanvasImageSource,0,0,canvas.width,canvas.height)
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height)
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(alpha.image as CanvasImageSource,0,0,canvas.width,canvas.height)
    const mask=ctx.getImageData(0,0,canvas.width,canvas.height)
    for(let i=0;i<pixels.data.length;i+=4)pixels.data[i+3]=Math.round(pixels.data[i+3]*mask.data[i+1]/255)
    ctx.putImageData(pixels,0,0)
    const texture=new THREE.CanvasTexture(canvas),source=base || alpha
    texture.flipY=source.flipY;texture.colorSpace=THREE.SRGBColorSpace;texture.offset.copy(source.offset);texture.repeat.copy(source.repeat);texture.center.copy(source.center);texture.rotation=source.rotation;texture.wrapS=source.wrapS;texture.wrapT=source.wrapT
    material.map=texture;material.alphaMap=null
    prepareImportedOpacity(material,pixels.data)
  }
  const root=new THREE.Group();root.name='Prosota import';root.scale.setScalar(unitScale)
  if(upAxis==='z')root.rotation.x=-Math.PI/2
  root.add(object)
  const animations=options.includeAnimation?exportMorphTracks(root,object.animations):[]
  if(ext==='fbx'){captureAssetBindPose(object);applyInitialAssetPose(object)}
  const bytesOut=await new GLTFExporter().parseAsync(root,{binary:true,animations,onlyVisible:false})
  return new File([bytesOut as ArrayBuffer],file.name.replace(/\.[^.]+$/,'.glb'),{type:'model/gltf-binary'})
 } finally {urls.forEach(url=>URL.revokeObjectURL(url))}
}

/** Convert parts in their authored coordinate system; centre only the finished asset. */
export async function convertSiteImportSet(files: File[], options: ImportOptions, name: string): Promise<File> {
 const models=files.filter(f=>/\.(glb|gltf|fbx|obj)$/i.test(f.name))
 if(!models.length)throw Error('Select at least one GLB, glTF, FBX or OBJ model.')
 if(models.length===1)return convertSiteImport(models[0],files.filter(f=>f!==models[0]),options)
 const root=new THREE.Group();root.name=name || 'Assembly'
 const clips:THREE.AnimationClip[]=[]
 for(const model of models){
  try {
   const converted=await convertSiteImport(model,files.filter(f=>f!==model),options)
   const gltf=await new GLTFLoader().parseAsync(await converted.arrayBuffer(),'')
   // UUID track targets survive name collisions between separate source files.
   for(const clip of gltf.animations){
    for(const track of clip.tracks){const binding=THREE.PropertyBinding.parseTrackName(track.name);const node=THREE.PropertyBinding.findNode(gltf.scene,binding.nodeName);if(node)track.name=(node as THREE.Object3D).uuid+track.name.slice(binding.nodeName.length)}
    clip.name=model.name+' · '+clip.name;clips.push(clip)
   }
   gltf.scene.name=model.name;gltf.scene.userData.prosotaSourceFile=model.name;root.add(gltf.scene)
  }catch(e){throw Error(model.name+': '+(e instanceof Error?e.message:String(e)))}
  // Yield between files so a large equipment set does not lock the UI.
  await new Promise(resolve=>setTimeout(resolve,0))
 }
 let meshes=0;root.traverse(n=>{if((n as THREE.Mesh).isMesh)meshes++})
 if(!meshes)throw Error('The selected files contain no mesh geometry.')
 const bytes=await new GLTFExporter().parseAsync(root,{binary:true,animations:clips,onlyVisible:false})
 return new File([bytes as ArrayBuffer],(name.trim()||'Assembly').replace(/\.glb$/i,'')+'.glb',{type:'model/gltf-binary'})
}
