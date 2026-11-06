import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { captureAssetBindPose } from './assetPose'

const boneKey = (name: string) => name.split(':').pop()!
function bones(root: THREE.Object3D) {
  const result = new Map<string, THREE.Object3D>()
  root.traverse(n => {
    if (!(n instanceof THREE.Bone) && !n.userData.prosotaBindPose) return
    const key = boneKey(n.name)
    if (result.has(key)) throw Error(`Ambiguous bone name: ${key}. Use a single character skeleton.`)
    result.set(key, n)
  })
  return result
}

/** Shared CC rigs adapt bind axes/proportions automatically; unrelated rigs stay strict. */
export function transferMotion(source: THREE.Object3D, target: THREE.Object3D, notices=new Set<string>()): THREE.AnimationClip[] {
  const from = bones(source), to = bones(target)
  if (!from.size || !to.size) throw Error('Both the character and motion need a bone skeleton.')
  if (!source.animations.length) throw Error('This file contains no animation clips.')
  // Bind transforms, rather than the displayed first-frame pose, define compatibility.
  const rest = (root: THREE.Object3D) => {
    const map = new Map<THREE.Bone, THREE.Matrix4>()
    root.traverse(n => { if (n instanceof THREE.SkinnedMesh) n.skeleton.bones.forEach((b,i) => map.set(b,n.skeleton.boneInverses[i].clone().invert())) })
    return (b: THREE.Object3D) => {
      const saved=b.userData.prosotaBindPose
      if(saved)return {p:new THREE.Vector3().fromArray(saved.position),q:new THREE.Quaternion().fromArray(saved.quaternion),s:new THREE.Vector3().fromArray(saved.scale)}
      const world = map.get(b as THREE.Bone)
      if (!world) return {p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()}
      const parent = b.parent instanceof THREE.Bone ? map.get(b.parent) : b.parent?.matrixWorld
      const local = parent ? parent.clone().invert().multiply(world) : world.clone()
      const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();local.decompose(p,q,s)
      return {p,q,s}
    }
  }
  source.updateMatrixWorld(true);target.updateMatrixWorld(true)
  const sourceRest=rest(source),targetRest=rest(target)
  const parentKey=(n:THREE.Object3D)=>n.parent && (n.parent instanceof THREE.Bone || n.parent.userData.prosotaBindPose)?boneKey(n.parent.name):''
  const core=['RL_BoneRoot','CC_Base_Hip','CC_Base_Pelvis','CC_Base_Spine01','CC_Base_Head',...['L','R'].flatMap(s=>['Thigh','Calf','Foot','Upperarm','Forearm','Hand'].map(b=>`CC_Base_${s}_${b}`))]
  const sharedCC=core.every(k=>from.has(k)&&to.has(k)&&parentKey(from.get(k)!)===parentKey(to.get(k)!))
  const worldRest=(nodes:Map<string,THREE.Object3D>,get:ReturnType<typeof rest>)=>{
    const cache=new Map<string,THREE.Quaternion>()
    const world=(key:string):THREE.Quaternion=>{if(!key)return new THREE.Quaternion();const known=cache.get(key);if(known)return known;const n=nodes.get(key);if(!n)return new THREE.Quaternion();const q=world(parentKey(n)).clone().multiply(get(n).q);cache.set(key,q);return q}
    return world
  }
  const sourceWorld=worldRest(from,sourceRest),targetWorld=worldRest(to,targetRest)
  const bodyScale=sharedCC?targetRest(to.get('CC_Base_Hip')!).p.length()/sourceRest(from.get('CC_Base_Hip')!).p.length():1
  if(sharedCC&&(!Number.isFinite(bodyScale)||bodyScale<.01||bodyScale>100))throw Error('Unsupported character scale. Use a consistent FBX unit setting.')
  return source.animations.map((clip,index) => {
    const tracks = clip.tracks.flatMap(track => {
      const binding=THREE.PropertyBinding.parseTrackName(track.name)
      const node=THREE.PropertyBinding.findNode(source,binding.nodeName)
      if(binding.propertyName==='morphTargetInfluences'){
        // A body-motion import must not reject an otherwise compatible walk
        // because iClone also exported facial expression channels.
        notices.add('Facial expression tracks were omitted; this imports skeletal body motion.')
        return []
      }
      if (!(node instanceof THREE.Bone)) { const size=track.getValueSize(); if (["position","quaternion","scale"].includes(binding.propertyName) && Array.from(track.values).every((v,i)=>Math.abs(v-track.values[i%size])<1e-6)) return []; throw Error(`Motion track ${track.name} animates a non-bone object. Export skeletal motion only.`) }
      const dest=to.get(boneKey(node.name))
      if (!dest) throw Error(`Incompatible skeleton: missing bone ${node.name}. Export motion for this character's skeleton.`)
      const a=sourceRest(node),b=targetRest(dest)
      if(parentKey(node)!==parentKey(dest) || a.s.distanceTo(b.s)>.01 || (!sharedCC&&a.q.angleTo(b.q)>.02))
        throw Error(`Incompatible rest skeleton at ${node.name}. This rig needs a matching skeleton or a separate mapping.`)
      if(!['position','quaternion','scale'].includes(binding.propertyName)) throw Error(`Unsupported motion track: ${track.name}`)
      const copy=track.clone();copy.name=`${dest.uuid}.${binding.propertyName}`
      const parentCorrection=targetWorld(parentKey(dest)).clone().invert().multiply(sourceWorld(parentKey(node)))
      if(sharedCC&&binding.propertyName==='quaternion'){
        const correction=sourceWorld(boneKey(node.name)).clone().invert().multiply(targetWorld(boneKey(dest.name)))
        for(let i=0;i<copy.values.length;i+=4)new THREE.Quaternion().fromArray(copy.values,i).premultiply(parentCorrection).multiply(correction).normalize().toArray(copy.values,i)
      }
      if(binding.propertyName==='position') {
        const ratio=sharedCC?(a.p.length()>.01?b.p.length()/a.p.length():bodyScale):1
        // iClone exports can retain the actor's placement in its source scene.
        // Import motion relative to this character, keeping the travelled delta
        // and vertical motion rather than moving it to that other scene's origin.
        const origin=new THREE.Vector3()
        if(sharedCC&&boneKey(node.name)==='RL_BoneRoot'){
          const up=sourceRest(from.get('CC_Base_Hip')!).p.clone().normalize()
          origin.fromArray(copy.values,0).sub(a.p);origin.addScaledVector(up,-origin.dot(up))
        }
        for(let i=0;i<copy.values.length;i+=3){const p=new THREE.Vector3().fromArray(copy.values,i).sub(a.p).sub(origin);if(sharedCC)p.applyQuaternion(parentCorrection).multiplyScalar(ratio);p.add(b.p).toArray(copy.values,i)}
        if(!sharedCC&&a.p.length()>.01 && Math.abs(b.p.length()/a.p.length()-1)>.05)
          throw Error(`Different skeleton proportions/units at ${node.name}. Export motion using the character's scale.`)
      }
      return [copy]
    })
    if(!tracks.length)throw Error('This clip contains no skeletal motion tracks.')
    return new THREE.AnimationClip(clip.name || `Imported motion ${index+1}`,clip.duration,tracks)
  })
}

export async function addAssetMotion(targetBytes: ArrayBuffer, file: File) {
 return addAssetMotions(targetBytes,[file])
}

export async function addAssetMotions(targetBytes:ArrayBuffer,files:File[],progress?:(done:number,total:number)=>void){
  if(!files.length||files.length>100)throw Error('Choose between 1 and 100 FBX motion files.')
  const target=await new GLTFLoader().parseAsync(targetBytes,'')
  const firstClip=target.animations.length,names=new Set(target.animations.map(c=>c.name)),incoming:THREE.AnimationClip[]=[],notices=new Set<string>()
  for(const file of files){
  if(!/\.fbx$/i.test(file.name))throw Error('Choose an FBX motion file.')
  // Motion only: ignore referenced textures and never load network resources.
  const manager=new THREE.LoadingManager()
  manager.setURLModifier(()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZYQAAAAASUVORK5CYII=')
  const source=new FBXLoader(manager).parse(await file.arrayBuffer(),'')
  captureAssetBindPose(source)
  try {
    const clips=transferMotion(source,target.scene,notices)
    const label=file.name.replace(/\.fbx$/i,'')
    clips.forEach((clip,i)=>{clip.name=clips.length===1?label:`${label} · ${clip.name || i+1}`})
    for(const clip of clips){const base=clip.name;let n=2;while(names.has(clip.name))clip.name=`${base} (${n++})`;names.add(clip.name)}
    incoming.push(...clips)
  } catch(e){throw Error(`${file.name}: ${e instanceof Error?e.message:String(e)}`)
  } finally {
    source.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])m.dispose()}})
  }
  progress?.(files.indexOf(file)+1,files.length);await new Promise(resolve=>setTimeout(resolve,0))
  }
  const bytes=await new GLTFExporter().parseAsync(target.scene,{binary:true,onlyVisible:false,animations:[...target.animations,...incoming]}) as ArrayBuffer
  return {file:new File([bytes],'character-with-motion.glb',{type:'model/gltf-binary'}),firstClip,names:incoming.map(c=>c.name),notices:[...notices]}
}



