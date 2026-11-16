import * as T from 'three'
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {arraySourceSnapshot} from '../../src/modules/fourD/arraySourceSnapshot'
import {prepareCutoutRendering} from '../../src/modules/fourD/cutoutRendering'
import {applySiteTextureCutout} from '../../src/modules/fourD/siteAssetMaterials'
export async function run(){
 const image=document.createElement('canvas');image.width=image.height=32
 const ctx=image.getContext('2d')!;ctx.fillStyle='#00ff00';ctx.fillRect(8,8,16,16)
 const texture=new T.CanvasTexture(image);texture.colorSpace=T.SRGBColorSpace
 const material=new T.MeshStandardMaterial({map:texture,alphaTest:.5,side:T.DoubleSide})
 const source=new T.Mesh(new T.PlaneGeometry(2,2),material)
 prepareCutoutRendering(source)
 const snapshot=arraySourceSnapshot(source,'y','Beech',false)
 const binary=await new GLTFExporter().parseAsync(snapshot,{binary:true}) as ArrayBuffer
 const loaded=await new GLTFLoader().parseAsync(binary,'')
 let leaf!:T.Mesh;loaded.scene.traverse(o=>{if(o instanceof T.Mesh)leaf=o})
 const roundtripMask=(leaf.material as T.MeshStandardMaterial).alphaTest===.5
 prepareCutoutRendering(loaded.scene)
 const renderer=new T.WebGLRenderer({antialias:false});renderer.setSize(64,64)
 const target=new T.WebGLRenderTarget(64,64),scene=new T.Scene();scene.background=new T.Color('#ff00ff')
 scene.add(loaded.scene,new T.AmbientLight('white',3))
 const camera=new T.OrthographicCamera(-1.1,1.1,1.1,-1.1,.1,10);camera.position.z=3
 const pixels=new Uint8Array(64*64*4)
 const count=()=>{renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,64,64,pixels);let n=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>5 || pixels[i]<240 || pixels[i+2]<240)n++;return n}
 const cutout=count(),mat=leaf.material as T.MeshStandardMaterial
 mat.alphaHash=false;mat.alphaTest=0;mat.needsUpdate=true
 const broken=count()
 applySiteTextureCutout(mat,'site|beech|0',{'cutout:site|beech|0':'texture'} as any)
 const repaired=count()
 const opaqueImage=document.createElement('canvas');opaqueImage.width=opaqueImage.height=32
 const opaqueCtx=opaqueImage.getContext('2d')!;opaqueCtx.fillStyle='#78905c';opaqueCtx.fillRect(0,0,32,32);opaqueCtx.fillStyle='#004400';opaqueCtx.fillRect(8,8,16,16)
 const originalTexture=new T.CanvasTexture(opaqueImage)
 mat.map=originalTexture;mat.alphaHash=false;mat.needsUpdate=true
 const opaqueBackground=count()
 applySiteTextureCutout(mat,'site|beech|0',{'cutout:site|beech|0':'background'} as any)
 const backgroundRemoved=count()
 if(backgroundRemoved>=opaqueBackground/2 || mat.opacity!==1 || mat.map===originalTexture || originalTexture.image!==opaqueImage)throw Error('Background cutout failed')
 target.dispose();renderer.dispose();renderer.forceContextLoss()
 if(!roundtripMask||broken<cutout*2||Math.abs(cutout-repaired)>8)throw Error(JSON.stringify({roundtripMask,cutout,broken,repaired}))
 return {passed:true,roundtripMask,cutout,broken,repaired,leafOpacity:mat.opacity,opaqueBackground,backgroundRemoved}
}
