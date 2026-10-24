import * as THREE from 'three'
import type { CustomTextureSet, TextureSlot } from './customTextures'

// Apply to an owned material only. Rebuilt from its authored source on every edit,
// so clearing a slot restores the original rather than retaining an old override.
export function applyCustomMaterial(material: THREE.MeshStandardMaterial, textures?: CustomTextureSet, opacity?: number) {
  if (textures?.map) { material.map=textures.map.texture; material.color.set(0xffffff) }
  if (textures?.metalnessMap) { material.metalnessMap=textures.metalnessMap.texture; material.metalness=1 }
  if (textures?.roughnessMap) { material.roughnessMap=textures.roughnessMap.texture; material.roughness=1 }
  for (const slot of ['normalMap','aoMap','displacementMap'] as const) if(textures?.[slot])material[slot]=textures[slot]!.texture
  if(opacity !== undefined) {material.opacity=opacity;material.transparent=opacity<1 || material.transparent;material.depthWrite=opacity<1?false:material.depthWrite}
  material.needsUpdate=true
  return material
}
export const hasCustomTextures=(textures?:CustomTextureSet)=>!!textures && Object.values(textures).some(Boolean)

export function matchingObjectChannels(sourceId:string,slot:TextureSlot,objects:{id:string;object:THREE.Object3D}[],overrides:Record<string,CustomTextureSet>) {
 const signature=(entry:{id:string;object:THREE.Object3D})=>{
  const override=overrides[entry.id]?.[slot];if(override)return 'custom:'+override.dataUri
  const values=new Set<string>()
  entry.object.traverse(node=>{if(!(node instanceof THREE.Mesh))return
   for(const material of Array.isArray(node.material)?node.material:[node.material]) {
    if(!(material instanceof THREE.MeshStandardMaterial))continue
    const authored=material.userData.channelSignature as Record<string,string>|undefined
    values.add(authored?.[slot] ?? (slot==='map' ? 'colour:'+material.color.getHexString() : 'none'))
   }
  });return JSON.stringify([...values].sort())
 }
 const source=objects.find(o=>o.id===sourceId);if(!source)return []
 const value=signature(source);return objects.filter(o=>signature(o)===value).map(o=>o.id)
}
export function captureMaterialChannels(material:THREE.MeshStandardMaterial) {
 const result:Record<string,string>={}
 for(const slot of ['map','metalnessMap','roughnessMap','normalMap','aoMap','displacementMap'] as const){
  const texture=material[slot]
  result[slot]=texture ? 'texture:'+(texture.name || (texture.image as {src?:string}|undefined)?.src || texture.uuid) : slot==='map'?'colour:'+material.color.getHexString():'none'
 }
 material.userData.channelSignature=result
}
