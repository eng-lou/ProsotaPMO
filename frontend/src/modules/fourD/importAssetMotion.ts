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

/** Compatible skeleton transfer, not automatic retargeting between different rigs. */
export function transferMotion(source: THREE.Object3D, target: THREE.Object3D): THREE.AnimationClip[] {
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
  return source.animations.map((clip,index) => {
    const tracks = clip.tracks.flatMap(track => {
      const binding=THREE.PropertyBinding.parseTrackName(track.name)
      const node=THREE.PropertyBinding.findNode(source,binding.nodeName)
      if (!(node instanceof THREE.Bone)) { const size=track.getValueSize(); if (["position","quaternion","scale"].includes(binding.propertyName) && Array.from(track.values).every((v,i)=>Math.abs(v-track.values[i%size])<1e-6)) return []; throw Error(`Motion track ${track.name} animates a non-bone object. Export skeletal motion only.`) }
      const dest=to.get(boneKey(node.name))
      if (!dest) throw Error(`Incompatible skeleton: missing bone ${node.name}. Export motion for this character's skeleton.`)
      const a=sourceRest(node),b=targetRest(dest)
      const parentKey=(n:THREE.Object3D)=>n.parent && (n.parent instanceof THREE.Bone || n.parent.userData.prosotaBindPose)?boneKey(n.parent.name):''
      if(parentKey(node)!==parentKey(dest) || a.q.angleTo(b.q)>.02 || a.s.distanceTo(b.s)>.01)
        throw Error(`Incompatible rest skeleton at ${node.name}. Retarget this motion to the character before importing.`)
      if(!['position','quaternion','scale'].includes(binding.propertyName)) throw Error(`Unsupported motion track: ${track.name}`)
      const copy=track.clone();copy.name=`${dest.uuid}.${binding.propertyName}`
      if(binding.propertyName==='position') {
        // Same rig coordinates are required; proportions may differ, but moving
        // translation tracks need explicit retargeting rather than guessed units.
        for(let i=0;i<copy.values.length;i+=3){copy.values[i]+=b.p.x-a.p.x;copy.values[i+1]+=b.p.y-a.p.y;copy.values[i+2]+=b.p.z-a.p.z}
        if(a.p.length()>.01 && Math.abs(b.p.length()/a.p.length()-1)>.05)
          throw Error(`Different skeleton proportions/units at ${node.name}. Export motion using the character's scale.`)
      }
      return [copy]
    })
    if(!tracks.length)throw Error('This clip contains no skeletal motion tracks.')
    return new THREE.AnimationClip(clip.name || `Imported motion ${index+1}`,clip.duration,tracks)
  })
}

export async function addAssetMotion(targetBytes: ArrayBuffer, file: File) {
  if(!/\.fbx$/i.test(file.name))throw Error('Choose an FBX motion file.')
  // Motion only: ignore referenced textures and never load network resources.
  const manager=new THREE.LoadingManager()
  manager.setURLModifier(()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZYQAAAAASUVORK5CYII=')
  const source=new FBXLoader(manager).parse(await file.arrayBuffer(),'')
  captureAssetBindPose(source)
  try {
    const target=await new GLTFLoader().parseAsync(targetBytes,'')
    const incoming=transferMotion(source,target.scene)
    const label=file.name.replace(/\.fbx$/i,'')
    incoming.forEach((clip,i)=>{clip.name=incoming.length===1?label:`${label} · ${clip.name || i+1}`})
    const firstClip=target.animations.length
    const names=new Set(target.animations.map(c=>c.name))
    for(const clip of incoming){const base=clip.name;let n=2;while(names.has(clip.name))clip.name=`${base} (${n++})`;names.add(clip.name)}
    const bytes=await new GLTFExporter().parseAsync(target.scene,{binary:true,onlyVisible:false,animations:[...target.animations,...incoming]}) as ArrayBuffer
    return {file:new File([bytes],'character-with-motion.glb',{type:'model/gltf-binary'}),firstClip,names:incoming.map(c=>c.name)}
  } finally {
    source.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])m.dispose()}})
  }
}



