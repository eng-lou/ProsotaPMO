import * as THREE from 'three'
import {convertSiteImportSet} from '../../frontend/src/modules/fourD/convertSiteImport'
import {parseAsset} from '../../frontend/src/modules/fourD/siteAssets'
import {inspectAssetParts,siteAssetPlacement,extractAssetPart,splitSiteAsset} from '../../frontend/src/modules/fourD/assetParts'
const w=window as any
w.checkEmptyImport=async()=>{
 const file=new File(['{"asset":{"version":"2.0"},"scenes":[{}]}'],'Empty.gltf')
 try{await convertSiteImportSet([file],{upAxis:'auto',unitScale:0,includeAnimation:true},'');throw Error('Empty import accepted')}
 catch(error){if(!String(error).includes('no mesh geometry'))throw error;return String(error)}
}
w.reviewDataCentre=async(input:string|ArrayBuffer)=>{
 const file=new File([typeof input==='string'?Uint8Array.from(atob(input),c=>c.charCodeAt(0)):input],'Data-Centre-Completed-Parts.glb')
 console.log('DATA_CENTRE_CHECK converting',file.size)
 const converted=await convertSiteImportSet([file],{upAxis:'auto',unitScale:0,includeAnimation:true},'Data Centre')
 console.log('DATA_CENTRE_CHECK converted',converted.size)
 const parsed=await parseAsset(await converted.arrayBuffer()),parts=inspectAssetParts(parsed.object)
 console.log('DATA_CENTRE_CHECK parsed',parts.length)
 const item:any={id:crypto.randomUUID(),asset_id:crypto.randomUUID(),kind:'asset',name:'Data centre',...parsed.dimensions,position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},up_axis:'z',yaw:0}
 const model=new THREE.Group();model.matrixAutoUpdate=false;model.matrix.copy(siteAssetPlacement(item));model.add(parsed.object);model.updateMatrixWorld(true)
 const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),target=bounds.getCenter(new THREE.Vector3())
 let meshes=0,vertices=0,triangles=0;const materials=new Set<THREE.Material>(),names:string[]=[]
 model.traverse(node=>{if(node instanceof THREE.Mesh){meshes++;vertices+=node.geometry.attributes.position.count;triangles+=(node.geometry.index?.count||node.geometry.attributes.position.count)/3;names.push(node.name);for(const mat of Array.isArray(node.material)?node.material:[node.material])materials.add(mat);node.castShadow=true;node.receiveShadow=true}})
 // Split the entire imported campus, then rebuild from persisted recipes exactly
 // as independently selectable site objects are reconstructed after reopening.
 model.remove(parsed.object)
 const splitStart=performance.now(),saved=JSON.parse(JSON.stringify(splitSiteAsset(item,parsed.object))),splitMs=performance.now()-splitStart
 w.independentParts=saved
 console.log('DATA_CENTRE_CHECK split',saved.length)
 const rebuilt=new THREE.Group()
 for(const part of saved){const placement=new THREE.Group();placement.matrixAutoUpdate=false;placement.matrix.copy(siteAssetPlacement(part));placement.add(extractAssetPart(parsed.object,part.asset_part));rebuilt.add(placement)}
 rebuilt.updateMatrixWorld(true)
 console.log('DATA_CENTRE_CHECK rebuilt')
 const rebuiltBounds=new THREE.Box3().setFromObject(rebuilt)
 let rebuiltMeshes=0;const rebuiltMaterials=new Set<THREE.Material>()
 rebuilt.traverse(node=>{if(node instanceof THREE.Mesh){rebuiltMeshes++;node.castShadow=true;node.receiveShadow=true;for(const mat of Array.isArray(node.material)?node.material:[node.material])rebuiltMaterials.add(mat)}})
 if(rebuiltBounds.min.distanceTo(bounds.min)>1e-5||rebuiltBounds.max.distanceTo(bounds.max)>1e-5)throw Error('Independent part placement changed the campus bounds')
 if(rebuiltMeshes!==meshes||rebuiltMaterials.size!==materials.size)throw Error('Independent part extraction lost meshes or materials')
 const scene=new THREE.Scene();scene.background=new THREE.Color('#e8edf2');scene.add(rebuilt)
 scene.add(new THREE.HemisphereLight('#e9f3ff','#5b5c55',2))
 const sun=new THREE.DirectionalLight('#fff5e6',3);sun.position.copy(target).add(new THREE.Vector3(-100,-100,250));sun.target.position.copy(target);sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-170,right:170,top:170,bottom:-170,near:1,far:650});sun.shadow.bias=-.0005;sun.shadow.normalBias=.12;scene.add(sun,sun.target)
 const camera=new THREE.PerspectiveCamera(35,1440/1000,.1,3000);camera.up.set(0,0,1);camera.position.copy(target).add(new THREE.Vector3(220,-270,210));camera.lookAt(target)
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1440,1000);renderer.setPixelRatio(2);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;document.body.append(renderer.domElement);renderer.render(scene,camera)
 return {parts:parts.length,independentParts:saved.length,splitMs,rebuiltMeshes,meshes,vertices,triangles,materialCount:materials.size,materials:[...materials].map(m=>m.name),texturedMaterials:[...materials].filter(m=>(m as THREE.MeshStandardMaterial).map).map(m=>m.name),normalMappedMaterials:[...materials].filter(m=>(m as THREE.MeshStandardMaterial).normalMap).map(m=>m.name),size:size.toArray(),bounds:[...bounds.min.toArray(),...bounds.max.toArray()],namedObjects:names.length,sourceMetadata:parts.filter(p=>{let n:THREE.Object3D=parsed.object;for(const i of p.path)n=n.children[i];return !!n.userData.dc_id}).length,names}
}
