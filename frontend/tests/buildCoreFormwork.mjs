// Regenerate the portable example from the original Prosota 12 x 8 m climbing-formwork GLB.
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
const withoutBoom=process.argv[4]==='--without-boom'
if(process.argv.length!==4 && !(process.argv.length===5 && withoutBoom)) throw Error('Usage: node tests/buildCoreFormwork.mjs source.glb output.glb [--without-boom]')
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/coreRig';export * from './src/modules/fourD/coreRigGeometry';export * from './src/modules/fourD/coreRigConnections';export * from 'three';export {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';export {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js'`,resolveDir:process.cwd()},bundle:true,format:'esm',write:false})
const lib=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
globalThis.FileReader=class {async readAsArrayBuffer(blob){this.result=await blob.arrayBuffer();this.onloadend?.()}}
const bytes=await fs.readFile(process.argv[2])
const {scene}=await new lib.GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
const frame=lib.coreFrame(scene)
if(!frame)throw Error('Expected a Prosota core assembly')
if(!frame.userData.coreRigVersion)lib.articulateLegacy(frame)
else if(!withoutBoom)throw Error('Expected the original Prosota core assembly')
if(withoutBoom){
 const hardware=frame.children.find(n=>n.userData.coreRigPart==='hardware')
 if(!hardware)throw Error('Expected the upper core hardware')
 hardware.removeFromParent()
 lib.addCoreHardware(frame,false)
 frame.userData.coreRigVersion=1
 lib.installCoreConnections(frame)
 frame.userData.hasPlacingBoom=false
}
frame.userData.coreRigRest=frame.position.toArray()
const apply=lib.bindCoreRig(frame)
const nodes=[frame]
frame.traverse(n=>{if(n.userData.coreRigPart){n.userData.coreRigRest=n.position.toArray();n.name='Core_'+n.userData.coreRigPart+'_'+nodes.length;nodes.push(n)}})
const controls={upper:0,lower:0,panels:0,deployment:0,slew:0}
function animation(name,times,sample){
 const tracks=[]
 const poses=times.map(t=>{
   const values=sample(t);frame.position.y=values.upper;apply(values)
   return nodes.map(n=>[n.position.toArray(),n.quaternion.toArray(),n.scale.toArray()])
 })
 for(const [i,n] of nodes.entries())for(const [j,prop] of ['position','quaternion','scale'].entries()){
   const values=poses.map(p=>p[i][j])
   if(values.every(v=>v.every((x,k)=>Math.abs(x-values[0][k])<1e-7)))continue
   const Track=j===1?lib.QuaternionKeyframeTrack:lib.VectorKeyframeTrack
   tracks.push(new Track(n.uuid+'.'+prop,times,values.flat()))
 }
 return new lib.AnimationClip(name,times.at(-1),tracks)
}
const clamp=n=>Math.min(1,Math.max(0,n))
const climb=animation('Core climb - 3 m',[0,.12,.57,1,1.15],t=>({...controls,upper:3*clamp((t-.12)/.45),lower:3*clamp((t-.57)/.43),panels:t<1?clamp(t/.12):clamp(1-(t-1)/.15)}))
const boom=animation('Placing boom - deploy',[0,.25,.5,.75,1],t=>({...controls,deployment:t}))
frame.position.y=0;apply(controls)
const glb=await new lib.GLTFExporter().parseAsync(scene,{binary:true,animations:withoutBoom?[climb]:[climb,boom]})
const target=path.resolve(process.argv[3]);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,Buffer.from(glb))
console.log(target,glb.byteLength,'bytes;',climb.tracks.length,'climb tracks;',boom.tracks.length,'boom tracks')
