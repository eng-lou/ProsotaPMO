import * as THREE from 'three'
import { bindAnimationShadows } from './animationRendering'
import { computeAppliedAnimationStateAt, pickActiveLink, type ResolvedTimelineLink } from './timelinePlayback'
export interface SiteMaterialOriginal { opacity: number; transparent: boolean; depthWrite: boolean; visible: boolean; color?: THREE.Color; planes: THREE.Plane[] | null }
const animatedGroups = new WeakSet<THREE.Group>()
export function applySiteAnimation(group: THREE.Group, base: THREE.Vector3, links: ResolvedTimelineLink[], hasLinks: boolean,
  now: Date | null, preview: boolean, legacyVisible: boolean, originals: WeakMap<THREE.Material, SiteMaterialOriginal>) {
    const link = !preview && now ? pickActiveLink(links, now) : null
    // The outer site group lives in world coordinates (no source-axis wrapper).
    // Request world-axis offsets; the model's Y/Z conversion is its child.
    const state = link && now ? computeAppliedAnimationStateAt(link, now, 'y') : null
    group.position.copy(base)
    group.rotation.set(0, 0, 0)
    group.scale.setScalar(state?.scaleMultiplier ?? 1)
    if (state && link) {
      group.position.add(new THREE.Vector3(...state.positionOffset))
      group.rotation[link.profile.axis] = state.rotationOffsetDeg * Math.PI / 180
    }
    group.visible = preview || (hasLinks ? (!now || (!!state && state.opacity > .001)) : legacyVisible)
    // Unlinked site context has no animation material state to reconcile.
    // Restore once on unlink, then leave material ownership to the site renderer.
    if (!hasLinks && !animatedGroups.has(group)) return
    if (hasLinks) animatedGroups.add(group)
    else animatedGroups.delete(group)
    let clip: THREE.Plane | null = null
    // A fully removed group draws neither geometry nor shadows. Computing its
    // entire scatter's bounds on every orbit frame cannot affect the result.
    // Reverse scrubbing makes it visible and recomputes the cut immediately.
    if (group.visible && state?.growProgress != null && state.growProgress < 1 && link) {
      group.updateWorldMatrix(true, true)
      const box = new THREE.Box3().setFromObject(group)
      if (!box.isEmpty()) {
        const axis = link.profile.axis, vector = new THREE.Vector3(); vector[axis] = 1
        const min = box.min[axis], max = box.max[axis]
        clip = link.profile.direction === 1
          ? new THREE.Plane(vector.negate(), min + (max - min) * state.growProgress)
          : new THREE.Plane(vector, -(max - (max - min) * state.growProgress))
      }
    }
    group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      bindAnimationShadows(node)
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
        const colored = mat as THREE.MeshStandardMaterial
        let original = originals.get(mat)
        if (!original) {
          original = { opacity: mat.userData.siteSurfaceState?.opacity ?? mat.opacity, transparent: mat.userData.siteSurfaceState?.transparent ?? mat.transparent, depthWrite: mat.userData.siteSurfaceState?.depthWrite ?? mat.depthWrite, visible: mat.userData.siteSurfaceState?.visible ?? mat.visible,
            color: colored.color?.clone(), planes: mat.clippingPlanes }
          originals.set(mat, original)
        }
        const opacity = state ? original.opacity * state.opacity : original.opacity
        const transparent = original.transparent || opacity < 1
        const planes = clip ? [...(original.planes || []), clip] : original.planes
        if (mat.transparent !== transparent || (mat.clippingPlanes?.length || 0) !== (planes?.length || 0)) mat.needsUpdate = true
        mat.opacity = opacity; mat.transparent = transparent; mat.depthWrite = transparent ? false : original.depthWrite
        // A render-mode/material refresh can hide a faded material. Restore its
        // authored visibility as well as alpha when the timeline runs backwards.
        mat.visible = original.visible && opacity > .001
        mat.clippingPlanes = planes
        mat.clipShadows = true
        if (original.color && colored.color) colored.color.copy(state?.color ? new THREE.Color(state.color) : original.color)
      }
    })
}
