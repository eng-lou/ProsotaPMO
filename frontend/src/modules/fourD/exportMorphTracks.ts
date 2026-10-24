import { AnimationClip, Mesh, Object3D, PropertyBinding } from 'three'

/** FBXLoader addresses blend shapes by index; GLTFExporter expects their names. */
export function exportMorphTracks(root: Object3D, clips: AnimationClip[]): AnimationClip[] {
  return clips.map(source => {
    const clip = source.clone()
    for (const track of clip.tracks) {
      const binding = PropertyBinding.parseTrackName(track.name)
      if (binding.propertyName !== 'morphTargetInfluences' || binding.propertyIndex === undefined) continue
      const mesh = PropertyBinding.findNode(root, binding.nodeName) as Mesh | null
      const index = binding.propertyIndex
      // Named bindings already understood by the exporter must retain their meaning,
      // including a shape whose actual name happens to be a number.
      if (mesh?.morphTargetDictionary?.[index] !== undefined) continue
      const numeric = /^\d+$/.test(index) ? Number(index) : -1
      const name = Object.entries(mesh?.morphTargetDictionary ?? {}).find(([, value]) => value === numeric)?.[0]
      if (!mesh || !name || numeric < 0 || numeric >= (mesh.morphTargetInfluences?.length ?? 0)) {
        throw new Error(`Animation "${clip.name}" references missing morph target "${index}" on "${binding.nodeName}".`)
      }
      track.name = `${mesh.uuid}.morphTargetInfluences[${name}]`
    }
    return clip
  })
}
