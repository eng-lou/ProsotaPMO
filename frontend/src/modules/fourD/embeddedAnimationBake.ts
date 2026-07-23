import * as THREE from 'three'
import { resolveDisplayAxis, type UpAxis } from './upAxis'
import type { KeyframeField } from './elementKeyframes'

// Converts a mesh import's own baked-in animation (FBX/GLTF "Include this
// file's animation" — ImportModelDialog.tsx) into real ElementKeyframe rows
// (2026-07-23, per Maro: "we discussed normal 3d animation before, being
// able to animate the keyframes independent of schedule activities. the
// same thing") — NOT a separate always-looping preview (that was this
// feature's first cut; scrapped once Maro clarified he wanted the file's
// own animation to become ordinary, editable Location/Rotation/Scale
// keyframes on the Animation Timeline, same as hand-keying those fields
// ever produces, see FourD.tsx's own keyframeSupport/onToggle). This module
// only computes the (field, date, value) rows — FourD.tsx's caller does the
// actual elementKeyframes.upsert() calls, since that's async/API-bound and
// this stays a pure, easily-testable function.
export interface BakedKeyframe {
  field: KeyframeField
  date: Date
  value: number
}

const RAD_TO_DEG = THREE.MathUtils.RAD2DEG
const ONE_DAY_MS = 86_400_000
// Below this, a sampled delta is "the file's own floating-point noise,"
// not real animation — same intent as every other epsilon-guard in this
// codebase (e.g. elementSplitTargets.ts's own), just scoped to this one
// function: skips creating a whole field's worth of keyframes (Location Z,
// say) when the source track technically exists but never actually moves.
const EPSILON = 1e-6

function unionSampleTimes(tracks: THREE.KeyframeTrack[]): number[] {
  const times = new Set<number>()
  for (const track of tracks) for (const t of track.times) times.add(t)
  return [...times].sort((a, b) => a - b)
}

// Only ever bakes the case Maro actually has — one rigid object animated as
// a whole ("a simple animation," his own words on car2.fbx) — by requiring
// every track in the clip to target the exact same node. A real multi-bone
// skeletal rig would need a different value per bone, which this app's own
// ElementKeyframe schema has no way to express at all (one position/
// rotation/scale per *element*, not per node within it — same "mesh-kind,
// no stable per-sub-element identity yet" scope every other Mode B feature
// in this file already draws, e.g. Path Progress's own header,
// timelinePlayback.ts). Returns null in that case — the caller's own job to
// decide what to tell Maro, not this pure function's.
function findSingleAnimatedNode(object: THREE.Object3D, tracks: THREE.KeyframeTrack[]): THREE.Object3D | null {
  const nodeNames = new Set<string>()
  for (const track of tracks) nodeNames.add(THREE.PropertyBinding.parseTrackName(track.name).nodeName ?? '')
  if (nodeNames.size !== 1) return null
  const [nodeName] = nodeNames
  return THREE.PropertyBinding.findNode(object, nodeName) as THREE.Object3D | null
}

// null = "couldn't bake this" (multi-node rig — see findSingleAnimatedNode's
// own header); [] = nothing worth keying (no clips, or every track turned
// out to be a no-op within EPSILON).
export function bakeEmbeddedAnimationToKeyframes(
  object: THREE.Object3D, upAxis: UpAxis, startDate: Date,
): BakedKeyframe[] | null {
  const clips = object.animations
  if (!clips || clips.length === 0) return []
  const allTracks = clips.flatMap(clip => clip.tracks)
  if (allTracks.length === 0) return []

  const node = findSingleAnimatedNode(object, allTracks)
  if (!node) return null

  const hasTrack = (propertyName: string) => allTracks.some(
    t => THREE.PropertyBinding.parseTrackName(t.name).propertyName === propertyName,
  )
  const hasPos = hasTrack('position')
  const hasQuat = hasTrack('quaternion')
  const hasScale = hasTrack('scale')

  const times = unionSampleTimes(allTracks)
  if (times.length === 0) return []

  // Sampled via a throwaway AnimationMixer — THREE's own, official way to
  // evaluate a clip at an arbitrary time, rather than hand-rolling
  // per-track interpolant math (three.js's own KeyframeTrack.
  // createInterpolant is a real runtime method but isn't part of its
  // published TS surface, so calling it directly doesn't typecheck here).
  // setTime() is an absolute seek (zeroes internal time then updates by
  // exactly `t`), not a relative advance — see AnimationMixer.js's own
  // comment on that method — so this correctly reads "the node's pose at
  // clip-time t" regardless of sample order.
  const mixer = new THREE.AnimationMixer(object)
  for (const clip of clips) mixer.clipAction(clip).play()

  mixer.setTime(times[0])
  const posBase = node.position.clone()
  const quatBase = node.quaternion.clone()
  const quatBaseInv = quatBase.clone().invert()
  const scaleBase = node.scale.clone()

  const rootBasePos = object.position.clone()
  const rootBaseQuat = new THREE.Quaternion().setFromEuler(object.rotation)
  const rootBaseEuler = object.rotation.clone()
  const rootBaseScale = object.scale.clone()

  let posVaries = false
  let rotVaries = false
  let scaleVaries = false
  const posRows: BakedKeyframe[] = []
  const rotRows: BakedKeyframe[] = []
  const scaleRows: BakedKeyframe[] = []

  for (const t of times) {
    const date = new Date(startDate.getTime() + t * ONE_DAY_MS)
    mixer.setTime(t)

    if (hasPos) {
      const delta = node.position.clone().sub(posBase)
      if (delta.length() > EPSILON) posVaries = true
      const rootPos = rootBasePos.clone().add(delta)
      for (const axis of ['x', 'y', 'z'] as const) {
        const { localAxis, sign } = resolveDisplayAxis(axis, upAxis, 'position')
        posRows.push({ field: `pos_${axis}` as KeyframeField, date, value: sign * rootPos[localAxis] })
      }
    }

    if (hasQuat) {
      // deltaQuat such that quatBase * deltaQuat = node.quaternion (now)
      const deltaQuat = quatBaseInv.clone().multiply(node.quaternion)
      const finalQuat = rootBaseQuat.clone().multiply(deltaQuat)
      const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat, object.rotation.order)
      if (Math.abs(finalEuler.x - rootBaseEuler.x) > EPSILON || Math.abs(finalEuler.y - rootBaseEuler.y) > EPSILON || Math.abs(finalEuler.z - rootBaseEuler.z) > EPSILON) {
        rotVaries = true
      }
      for (const axis of ['x', 'y', 'z'] as const) {
        const { localAxis, sign } = resolveDisplayAxis(axis, upAxis, 'rotation')
        rotRows.push({ field: `rot_${axis}` as KeyframeField, date, value: sign * finalEuler[localAxis] * RAD_TO_DEG })
      }
    }

    if (hasScale) {
      const ratio = {
        x: scaleBase.x > EPSILON ? node.scale.x / scaleBase.x : 1,
        y: scaleBase.y > EPSILON ? node.scale.y / scaleBase.y : 1,
        z: scaleBase.z > EPSILON ? node.scale.z / scaleBase.z : 1,
      }
      if (Math.abs(ratio.x - 1) > EPSILON || Math.abs(ratio.y - 1) > EPSILON || Math.abs(ratio.z - 1) > EPSILON) scaleVaries = true
      for (const axis of ['x', 'y', 'z'] as const) {
        const { localAxis } = resolveDisplayAxis(axis, upAxis, 'scale')
        scaleRows.push({ field: `scale_${axis}` as KeyframeField, date, value: rootBaseScale[localAxis] * ratio[localAxis] })
      }
    }
  }

  // Parks the node back at its own rest pose (2026-07-23) — mirrors exactly
  // what the first baked keyframe (times[0], "today") will show once
  // applyKeyframedTransform (Viewport3D.tsx) takes over driving the root;
  // without this the node would visually sit wherever the very last sample
  // above left it until the Timeline is next scrubbed.
  mixer.setTime(times[0])

  return [
    ...(posVaries ? posRows : []),
    ...(rotVaries ? rotRows : []),
    ...(scaleVaries ? scaleRows : []),
  ]
}
