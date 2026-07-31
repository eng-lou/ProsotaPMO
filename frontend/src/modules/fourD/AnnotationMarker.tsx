import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { Activity } from '@/modules/scheduling/types'
import type { Annotation, AnnotationIcon } from './annotations'
import type { ExportLabelRegistry } from './exportLabels'
import type { AnimationProfile } from './animationProfiles'
import { DEFAULT_ANIMATION_CONFIG } from './animationProfiles'
import type { ElementKeyframe } from './elementKeyframes'
import type { ModelElementLink } from './modelElementLinks'
import { computeAppliedAnimationStateAt, computeRevealProgress, interpolateKeyframeTrack, pickActiveLink, type ResolvedTimelineLink } from './timelinePlayback'
// densifyBorderForReveal/sliceRevealVectors (2026-08-06) — pure point-array
// math, nothing Zone-specific despite the filename (zoneGeometry.ts's own
// header on the first of the two already says as much) — reused here
// verbatim for the leader's own reveal instead of duplicating the same
// arc-length-sampling logic a third time.
import { densifyBorderForReveal, sliceRevealVectors } from './zoneGeometry'
import type { UpAxis } from './upAxis'

const ICON_GLYPH: Record<AnnotationIcon, string> = { pin: '📍', flag: '🚩', comment: '💬', warning: '⚠️' }

// background_opacity (2026-07-30, per Maro: "opacity controls for the
// background fill") — background_color is stored as a plain #rrggbb hex
// string (has been since this table's original `color` field was renamed —
// see annotation.py's own Style-fields header), so applying an opacity
// multiplier means converting to rgba() here rather than a CSS `opacity`
// on the whole box, which would also fade the border/text (both meant to
// stay fully opaque regardless of the fill's own opacity, same split
// Zone's own fill_opacity/border_color already keep independent).
function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

// The leader's own elbow rise needs to go along whichever axis the *scene*
// currently treats as vertical, not always literal world Y (2026-08-06 fix,
// per Maro: "elevation of leader is using wrong up axis" — confirmed: this
// was hardcoded to world Y regardless of upAxis, so in the app's own
// default Z-up mode the "rise" actually ran sideways along Y — a
// horizontal direction in that mode — instead of upward). Matches the same
// (0,0,1)/(0,1,0) convention CameraSettings/zonePlane already use for the
// same question elsewhere in this app.
//
// leader_offset_x/y/z are stored as *semantic* components, not literal
// world x/y/z (annotations otherwise store raw world position — see this
// component's own header — but a "rise vs. horizontal run" split has no
// meaning without picking a rise axis, so unlike position_x/y/z these
// three are deliberately display-style fields, same spirit as
// upAxis.ts's own resolveDisplayAxis just without that function's own
// rotation-sign-flip baggage, which only applies to imported content
// sitting inside an axisCorrectionRotation wrapper — annotations have no
// such wrapper):
//   x -> always world X (X never swaps in this app's own upAxis convention)
//   y -> magnitude along upVector(upAxis) — the "Elevation" field
//   z -> magnitude along the *other* horizontal axis (world Z when
//        upAxis='y', world Y when upAxis='z')
// This keeps the stored default (2.0, 0.0, 0.0) meaning exactly the same
// thing — "2.0 sideways, no rise" — regardless of which upAxis a project
// uses.
function upVector(upAxis: UpAxis): THREE.Vector3 {
  return upAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
}
function otherHorizontalVector(upAxis: UpAxis): THREE.Vector3 {
  return upAxis === 'z' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
}
function offsetToLocalDelta(offset: { x: number; y: number; z: number }, upAxis: UpAxis): THREE.Vector3 {
  return new THREE.Vector3(offset.x, 0, 0)
    .addScaledVector(upVector(upAxis), offset.y)
    .addScaledVector(otherHorizontalVector(upAxis), offset.z)
}
function localDeltaToOffset(delta: THREE.Vector3, upAxis: UpAxis): { x: number; y: number; z: number } {
  return { x: delta.x, y: delta.dot(upVector(upAxis)), z: delta.dot(otherHorizontalVector(upAxis)) }
}

export interface AnnotationDragPoint {
  x: number
  y: number
  z: number
}

// One Placemark/Comment in the 4D viewport (2026-07-12, redone per Maro's
// fuller Navisworks "3D Notations" reference; leader reworked 2026-08-06,
// per Maro: "how the leader works and how its animated which should also
// have the ability to be animated independent of tasks"):
//
// - Placemark: a Google-Maps-style balloon pin at its own point, no leader.
// - Comment: an always-visible callout box (background/border/text colour,
//   font size — all from the annotation's own style fields) connected to
//   its *effective target* by a real bent, CAD-style leader — a short
//   vertical rise (leader_offset_y) to an elbow, then a horizontal run
//   (leader_offset_x/z, draggable in the viewport) to the callout. The
//   effective target is whatever mesh element it's bound to
//   (leaderTargetObject, tracked live every frame) if any, else the
//   annotation's own anchor point — one consistent leader shape either
//   way, replacing the old fixed-vertical-stem-plus-separate-bound-line
//   pair with a single line.
//
// See annotation.py's own docstring for the backend shape this mirrors.
// Resolves its own Mode A/B position animation *and* its own independent
// whole-annotation reveal animation (animate/animation_loop, resolved via
// animationStart/animationEnd exactly like Path/Zone's own anim_start/
// anim_end) in one small per-marker useFrame, entirely decoupled from
// Viewport3D's central TimelinePlayback resolver, since a marker is an
// Html overlay + a plain unwrapped mesh (no up-axis-correction group, no
// material system for that resolver's own machinery to touch).
//
// Position keyframes (Mode B) win over an Activity+AnimationProfile link
// (Mode A) exactly like TimelinePlayback's own targetsRef precedence for
// meshes — see that component's own header. Everything here is applied by
// directly mutating refs every frame (position, material opacity, DOM
// style, the leader line's own geometry), never through React state, so a
// busy timeline doesn't turn into another render-churn bug the way this
// session's own Follow Path debugging already found twice elsewhere in
// this module. Distance culling (hide_closer_than/hide_farther_than) is
// applied the same way, every frame, ANDed into the same `shown` boolean
// Mode A/B visibility already resolves — the reveal window is a second,
// independent gate on top of that (2026-07-30 scope fix, per Maro: "the
// animate leader feature is not just about the leader its the whole
// thing" — this used to hide only the line, leaving the box and dot
// always visible, which is what he was actually objecting to): while the
// reveal is active the connecting line draws in progressively, but the
// box and dot are gated as a flat visible/hidden pair with everything
// else, same as `shown` itself (see annotation.py's own matching header).
export function AnnotationMarker({
  annotation, dateRef, activities, modelElementLinks, animationProfiles, elementKeyframes, upAxis,
  animationStart, animationEnd,
  leaderTargetObject, selected, onSelect, onDragStart, onDragMove, onDragEnd,
  onLeaderDragStart, onLeaderDragMove, onLeaderDragEnd,
  exportLabelsRef,
}: {
  annotation: Annotation
  dateRef: React.MutableRefObject<Date | null>
  activities: Activity[]
  modelElementLinks: ModelElementLink[]
  animationProfiles: AnimationProfile[]
  elementKeyframes: ElementKeyframe[]
  // Needed only for the leader's own elbow rise direction (2026-08-06) —
  // see this file's own upVector header for the full "why".
  upAxis: UpAxis
  // Resolved out of ElementKeyframe rows (source_kind "annotation", field
  // "anim_start"/"anim_end") by FourD.tsx — see PathGizmo.tsx's own
  // matching animationStart/animationEnd header for the full rationale;
  // identical convention here.
  animationStart: Date | null
  animationEnd: Date | null
  // Resolved once per frame by the caller (Viewport3D already has the
  // scene-object list in scope) — mesh-only in v1, same "no stable
  // sub-element identity yet" scope every other IFC-adjacent feature this
  // session has (Follow Path, manual keyframing).
  leaderTargetObject: THREE.Object3D | null
  selected: boolean
  onSelect: (id: string) => void
  onDragStart: () => void
  onDragMove: (id: string, point: AnnotationDragPoint) => void
  onDragEnd: (id: string, point: AnnotationDragPoint) => void
  // Leader-offset handle drag (2026-08-06) — same local-preview-then-
  // persist-on-release convention as onDragStart/Move/End above, just for
  // leader_offset_x/y/z instead of position_x/y/z. y is included so a
  // drag can't silently zero out the elbow height, but the handle itself
  // is only ever dragged within the horizontal plane at the *current*
  // leader_offset_y (see handleLeaderPointerDown below) — only x/z
  // actually change from a drag.
  onLeaderDragStart: () => void
  onLeaderDragMove: (id: string, offset: AnnotationDragPoint) => void
  onLeaderDragEnd: (id: string, offset: AnnotationDragPoint) => void
  // Capture/Export Video text visibility (2026-07-30, per Maro: "the text
  // boxes and texts dont show up in the captured renders") — see
  // exportLabels.ts's own header for the full story; this component writes
  // its own current-frame resolved position/content into the shared
  // registry every useFrame tick below, instead of Viewport3D trying to
  // re-derive the same Mode A/B/reveal math independently.
  exportLabelsRef: React.MutableRefObject<ExportLabelRegistry>
}) {
  const { camera } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const calloutGroupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshBasicMaterial>(null)
  const htmlRef = useRef<HTMLDivElement>(null)
  const leaderLineRef = useRef<THREE.Group>(null)
  const leaderGeometryRef = useRef<THREE.BufferGeometry>(null)
  const dragRef = useRef<{ plane: THREE.Plane; offset: THREE.Vector3; startClientPos: THREE.Vector2; moved: boolean } | null>(null)
  const leaderDragRef = useRef<{ plane: THREE.Plane; startClientPos: THREE.Vector2; moved: boolean } | null>(null)
  // Cached every frame in useFrame below, read back by handleLeaderPointerUp
  // (2026-08-06) — the leader's *effective target* in groupRef's own local
  // space (the bound element's live position if any, else the origin).
  // Needed to convert calloutGroupRef's absolute dragged-to local position
  // back into a true leader_offset_x/z *relative to that target* before
  // persisting — skipping this would double-count the target's own
  // position for a bound annotation the next time it re-renders (the
  // callout would jump away from where it was just dragged to).
  const targetLocalRef = useRef(new THREE.Vector3())

  const isBox = annotation.kind === 'comment'
  // Hoisted above useFrame (2026-07-30) so both it (export-label registry
  // writes) and the JSX return below can read the same values — used to
  // live only just above the return.
  const borderWidth = annotation.thick_border ? 3 : 1
  // box_shape (2026-07-30, per Maro: "allow me to pick a standard
  // rectangle shape") — 'rounded' keeps the original fixed 14px radius,
  // 'rectangle' is sharp corners. Only isBox (kind="comment") ever renders
  // this; Placemark's balloon pin uses its own hardcoded radius below.
  const boxBorderRadius = annotation.box_shape === 'rectangle' ? 0 : 14

  // Recomputed only when the underlying data actually changes, not every
  // frame — pickActiveLink/interpolateKeyframeTrack themselves still run
  // per-frame inside useFrame below (they're cheap, and `now` genuinely
  // does change every frame during Play), but the *lists* they walk don't
  // need rebuilding that often.
  const positionTracks = useMemo(() => {
    const px: { date: Date; value: number }[] = []
    const py: { date: Date; value: number }[] = []
    const pz: { date: Date; value: number }[] = []
    const vis: { date: Date; value: number }[] = []
    for (const k of elementKeyframes) {
      if (k.source_kind !== 'annotation' || k.element_ref !== annotation.id) continue
      const point = { date: new Date(k.date), value: k.value }
      if (k.field === 'pos_x') px.push(point)
      else if (k.field === 'pos_y') py.push(point)
      else if (k.field === 'pos_z') pz.push(point)
      else if (k.field === 'visible') vis.push(point)
    }
    return { px, py, pz, vis }
  }, [elementKeyframes, annotation.id])

  // Removes this annotation's own export-label entries on unmount
  // (2026-07-30) — e.g. deletion — so a Capture/Export Video taken shortly
  // after doesn't still draw a ghost label for something that's no longer
  // in the scene at all (useFrame simply stops running once unmounted, it
  // never gets a chance to write a final "gone" state into the registry).
  useEffect(() => {
    return () => {
      exportLabelsRef.current.delete(`${annotation.id}-box`)
      exportLabelsRef.current.delete(`${annotation.id}-pin`)
    }
  }, [annotation.id, exportLabelsRef])

  const links = useMemo((): ResolvedTimelineLink[] => {
    const activityById = new Map(activities.map(a => [a.id, a]))
    const profileById = new Map(animationProfiles.map(p => [p.id, p]))
    const resolved: ResolvedTimelineLink[] = []
    for (const link of modelElementLinks) {
      if (link.source_kind !== 'annotation' || link.element_ref !== annotation.id) continue
      const activity = activityById.get(link.activity_id)
      if (!activity || !activity.start || !activity.finish) continue
      // Link's own override wins, else the activity's own profile, else the
      // default — same cascade Viewport3D.tsx's own Mode A resolution uses,
      // see its header for the full story.
      const profileId = link.animation_profile_id ?? activity.animation_profile_id
      const profile = profileId ? profileById.get(profileId)?.config : DEFAULT_ANIMATION_CONFIG
      if (!profile) continue
      // Parsed once here, not per frame — see timelinePlayback.ts's own
      // pickActiveLink header for why (2026-07-21 perf fix).
      resolved.push({
        activity, startMs: new Date(activity.start).getTime(), finishMs: new Date(activity.finish).getTime(),
        profile, axis: profile.axis,
      })
    }
    return resolved
  }, [modelElementLinks, activities, animationProfiles, annotation.id])

  useFrame(() => {
    if (!groupRef.current) return
    const now = dateRef.current

    let x = annotation.position_x
    let y = annotation.position_y
    let z = annotation.position_z
    let opacity = 1
    let visible = annotation.visible

    if (now) {
      const hasPositionTracks = positionTracks.px.length > 0 || positionTracks.py.length > 0 || positionTracks.pz.length > 0
      if (hasPositionTracks) {
        const vx = positionTracks.px.length > 0 ? interpolateKeyframeTrack(positionTracks.px, now) : null
        const vy = positionTracks.py.length > 0 ? interpolateKeyframeTrack(positionTracks.py, now) : null
        const vz = positionTracks.pz.length > 0 ? interpolateKeyframeTrack(positionTracks.pz, now) : null
        if (vx !== null) x = vx
        if (vy !== null) y = vy
        if (vz !== null) z = vz
      } else {
        const activeLink = pickActiveLink(links, now)
        // 'y' — no remap (2026-07-26, see computeAppliedAnimationStateAt's
        // own upAxis header) — unlike imported mesh/IFC content, an
        // annotation is never wrapped in a sourceUpAxis-vs-display
        // axisCorrectionRotation group (placed directly via a world-space
        // raycast click), so its own profile axis already means exactly
        // what it says with no conversion needed either way.
        const state = activeLink ? computeAppliedAnimationStateAt(activeLink, now, 'y') : null
        if (state) {
          x += state.positionOffset[0]
          y += state.positionOffset[1]
          z += state.positionOffset[2]
          opacity = state.opacity
        }
      }
      if (positionTracks.vis.length > 0) {
        const vv = interpolateKeyframeTrack(positionTracks.vis, now)
        visible = vv !== null ? vv >= 0.5 : annotation.visible
      }
    }

    // Live drag preview (2026-07-12) wins over everything above while
    // actively dragging — matches Path's own "local state during drag,
    // persisted only on release" convention (see PathGizmo.tsx).
    const drag = dragRef.current
    if (!drag) groupRef.current.position.set(x, y, z)

    // Distance culling (2026-07-12) — camera.position is world space,
    // groupRef.current.position is already world space too (this marker
    // has no parent group of its own, unlike an imported model's up-axis-
    // correction wrapper), so no local/world conversion needed here.
    const distance = camera.position.distanceTo(groupRef.current.position)
    const withinDistance =
      (annotation.hide_closer_than === null || distance >= annotation.hide_closer_than) &&
      (annotation.hide_farther_than === null || distance <= annotation.hide_farther_than)

    const shown = annotation.visible && visible && opacity > 0.01 && withinDistance
    if (meshRef.current) meshRef.current.scale.setScalar(selected ? 1.4 : 1)
    if (materialRef.current) materialRef.current.opacity = opacity
    if (htmlRef.current) htmlRef.current.style.opacity = String(opacity)

    // Bent leader — target -> elbow -> callout (2026-08-06, see this
    // component's own header for the full "why"). Computed in *local*
    // space (relative to groupRef, which sits at the annotation's own
    // anchor) so a leaderDrag preview or a live bound-target position both
    // just work through the same worldToLocal conversion PathGizmo.tsx's
    // own toLocalPoint precedent already established.
    //
    // `revealShown` (2026-07-30 scope fix) starts as plain `shown` and is
    // only narrowed further when animate is on and the reveal hasn't
    // started yet — it, not `shown`, is what actually gates the group and
    // the html box below, so the whole annotation (not just the line)
    // disappears before the reveal window starts.
    let revealShown = shown
    if (isBox) {
      const targetLocal = leaderTargetObject
        ? (() => {
          const worldPos = new THREE.Vector3()
          leaderTargetObject.getWorldPosition(worldPos)
          return groupRef.current!.worldToLocal(worldPos)
        })()
        : new THREE.Vector3(0, 0, 0)
      targetLocalRef.current.copy(targetLocal)
      const elbowLocal = targetLocal.clone().addScaledVector(upVector(upAxis), annotation.leader_offset_y)
      // While actively dragging the leader handle, calloutGroupRef's own
      // position IS the live, being-dragged local position (set directly
      // by handleLeaderPointerMove below) — read it back rather than
      // recomputing from the *persisted* annotation.leader_offset_x/z,
      // which hasn't caught up yet (only PATCHed on release). Otherwise
      // (the common case) derive it from the persisted offset, so a bound
      // annotation's callout still correctly follows elbowLocal as the
      // live target moves.
      const calloutLocal = leaderDragRef.current && calloutGroupRef.current
        ? calloutGroupRef.current.position.clone()
        : targetLocal.clone().add(offsetToLocalDelta(
          { x: annotation.leader_offset_x, y: annotation.leader_offset_y, z: annotation.leader_offset_z }, upAxis,
        ))

      if (calloutGroupRef.current && !leaderDragRef.current) calloutGroupRef.current.position.copy(calloutLocal)

      let leaderPoints: THREE.Vector3[] = [targetLocal, elbowLocal, calloutLocal]
      let leaderVisible = shown
      if (annotation.animate) {
        const revealNow = now ?? new Date()
        const progress = computeRevealProgress(revealNow, animationStart, animationEnd, annotation.animation_loop)
        const sliced = sliceRevealVectors(densifyBorderForReveal(leaderPoints), progress)
        leaderPoints = sliced ?? []
        leaderVisible = shown && sliced !== null
        revealShown = leaderVisible
      }
      // leader_visible (2026-07-30, per Maro: "hide the leader completely
      // to show just the text box if i want") — ANDed in only here, not
      // into revealShown, since it's deliberately independent of the
      // animate/reveal gate above: this hides just the line's own group,
      // leaving the box/dot (revealShown, set below) untouched either way.
      if (leaderLineRef.current) leaderLineRef.current.visible = leaderVisible && annotation.leader_visible
      if (leaderGeometryRef.current) {
        leaderGeometryRef.current.setFromPoints(leaderPoints.length >= 2 ? leaderPoints : [targetLocal, targetLocal])
      }
    }

    groupRef.current.visible = revealShown
    if (htmlRef.current) htmlRef.current.style.display = revealShown ? 'flex' : 'none'

    // Capture/Export Video text visibility (2026-07-30, per Maro: "the
    // text boxes and texts dont show up in the captured renders") — see
    // exportLabels.ts's own header. Written every frame so a moving/
    // animated annotation's exported label always matches wherever it
    // actually is right now, not a stale snapshot from mount time.
    if (isBox) {
      exportLabelsRef.current.set(`${annotation.id}-box`, {
        kind: 'annotation-box',
        visible: revealShown,
        worldPos: groupRef.current.localToWorld(calloutGroupRef.current ? calloutGroupRef.current.position.clone() : new THREE.Vector3()),
        text: annotation.text || '(empty)',
        backgroundColor: annotation.has_background ? hexToRgba(annotation.background_color, annotation.background_opacity) : null,
        borderColor: annotation.border_color,
        textColor: annotation.text_color,
        fontSize: annotation.font_size,
        borderRadius: boxBorderRadius,
        bold: false,
        anchor: 'bottom-left',
      })
    } else {
      exportLabelsRef.current.set(`${annotation.id}-pin`, {
        kind: 'annotation-placemark',
        visible: revealShown,
        worldPos: groupRef.current.position.clone(),
        text: ICON_GLYPH[annotation.icon],
        backgroundColor: annotation.has_background ? hexToRgba(annotation.background_color, annotation.background_opacity) : null,
        borderColor: annotation.border_color,
        textColor: annotation.text_color,
        fontSize: 14,
        borderRadius: 0,
        bold: false,
        anchor: 'center',
      })
    }
  })

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const group = groupRef.current
    if (!group) return
    onDragStart()

    const worldPos = group.position.clone()
    const cameraDir = new THREE.Vector3()
    camera.getWorldDirection(cameraDir)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDir, worldPos)
    const hit = new THREE.Vector3()
    e.ray.intersectPlane(plane, hit)

    dragRef.current = {
      plane, offset: worldPos.clone().sub(hit),
      startClientPos: new THREE.Vector2(e.clientX, e.clientY),
      moved: false,
    }
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    const group = groupRef.current
    if (!drag || !group) return
    e.stopPropagation()
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(drag.plane, hit)) return
    const next = hit.add(drag.offset)
    group.position.copy(next)
    if (!drag.moved && new THREE.Vector2(e.clientX, e.clientY).distanceTo(drag.startClientPos) > 3) drag.moved = true
    if (drag.moved) onDragMove(annotation.id, { x: next.x, y: next.y, z: next.z })
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    if (drag.moved && groupRef.current) {
      const p = groupRef.current.position
      onDragEnd(annotation.id, { x: p.x, y: p.y, z: p.z })
    } else {
      onSelect(annotation.id)
    }
  }

  // Leader-offset handle drag (2026-08-06) — constrained to the horizontal
  // plane at the elbow's own current height (leader_offset_y along
  // upVector(upAxis) — see this file's own header for why it's not always
  // literal world Y), same fixed-plane convention ZoneGizmo.tsx's own
  // vertex drag uses (zoneGeometry.ts's zonePlane) rather than PathGizmo's
  // camera-facing one: a leader is meant to stay level, so a drag should
  // never accidentally lift/drop the callout. The plane's own world
  // position/normal is computed once at drag-start from the *current*
  // elbow (groupRef's own world matrix + calloutGroupRef's own rise
  // component), so subsequent pointer moves land exactly on that same
  // level regardless of camera angle.
  const handleLeaderPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const group = groupRef.current
    const calloutGroup = calloutGroupRef.current
    if (!group || !calloutGroup) return
    onLeaderDragStart()

    const up = upVector(upAxis)
    const currentRise = calloutGroup.position.dot(up)
    const elbowWorld = up.clone().multiplyScalar(currentRise)
    group.localToWorld(elbowWorld)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(up, elbowWorld)

    leaderDragRef.current = { plane, startClientPos: new THREE.Vector2(e.clientX, e.clientY), moved: false }
  }

  const handleLeaderPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = leaderDragRef.current
    const group = groupRef.current
    const calloutGroup = calloutGroupRef.current
    if (!drag || !group || !calloutGroup) return
    e.stopPropagation()
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(drag.plane, hit)) return
    // group has no rotation (annotations are never wrapped in an
    // axisCorrectionRotation group — see this file's own header), so
    // worldToLocal here is a pure translation and the plane's own
    // up-axis constraint survives the conversion exactly, no need to
    // re-snap the rise component.
    calloutGroup.position.copy(group.worldToLocal(hit.clone()))
    if (!drag.moved && new THREE.Vector2(e.clientX, e.clientY).distanceTo(drag.startClientPos) > 3) drag.moved = true
    if (drag.moved) {
      const offset = localDeltaToOffset(calloutGroup.position.clone().sub(targetLocalRef.current), upAxis)
      onLeaderDragMove(annotation.id, offset)
    }
  }

  const handleLeaderPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const drag = leaderDragRef.current
    leaderDragRef.current = null
    if (!drag) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    if (drag.moved && calloutGroupRef.current) {
      // Subtract the effective target's own local position, then convert
      // back to semantic (x, rise-along-up, other-horizontal) components
      // (2026-08-06, see targetLocalRef's own header and this file's own
      // localDeltaToOffset) — calloutGroupRef.position is an *absolute*
      // local position in real xyz, but leader_offset_x/y/z is stored
      // relative to the target *and* in display-style semantic axes, both
      // of which matter the moment this annotation is bound to a
      // live-moving element or the project isn't Y-up.
      const delta = calloutGroupRef.current.position.clone().sub(targetLocalRef.current)
      onLeaderDragEnd(annotation.id, localDeltaToOffset(delta, upAxis))
    }
  }

  return (
    <group ref={groupRef} position={[annotation.position_x, annotation.position_y, annotation.position_z]}>
      {isBox && (
        // Visibility toggled via a wrapping <group>, not a ref directly on
        // <line> (2026-08-06) — TS resolves a ref-typed <line> JSX element
        // against the DOM's own SVGLineElement instead of three.js's Line
        // here, for reasons not worth fighting; a group ref sidesteps the
        // ambiguity entirely and is exactly as cheap.
        <group ref={leaderLineRef}>
          <line>
            <bufferGeometry ref={leaderGeometryRef} />
            <lineBasicMaterial color={annotation.leader_color} />
          </line>
        </group>
      )}
      {/* Anchor point — the actual thing being drag/click hit-tested.
          Placemark's real visual is the balloon pin below; a box kind
          keeps this as a small tick mark at the true anchor/leader target,
          since the callout itself floats at the far end of the leader.
          Radius is leader_dot_radius for a comment (2026-07-30, per Maro's
          Blender reference's own "Ball Radius") — Placemark keeps its own
          fixed 0.15, unrelated to that field. */}
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <sphereGeometry args={[isBox ? annotation.leader_dot_radius : 0.15, 12, 12]} />
        <meshBasicMaterial ref={materialRef} color={annotation.background_color} transparent depthTest={false} />
      </mesh>
      {annotation.kind === 'placemark' ? (
        // The balloon is a 32x32 square with border-radius 50/50/50/0 —
        // the sharp (radius-0) corner is bottom-left, and rotate(-45deg)
        // swings that corner to point straight down at the 3D anchor
        // (classic CSS map-pin trick). placemark_scale/placemark_rotation
        // (2026-07-30, per Maro: "and the pin and flag and warning" — same
        // Blender-reference request extended from the comment box to the
        // balloon) ride in the same transform, pivoting around that exact
        // corner via transformOrigin — same technique this component's
        // leader_rotation/leader_scale use on the comment box, just
        // applied to a rotated teardrop instead of an axis-aligned
        // rectangle. The base rotate(-45deg) used a plain center-pivot
        // translateY(-16px) before this fix, which only *approximately*
        // (not exactly) touched the anchor; pivoting on the true corner is
        // both more accurate at rotation=0 and the only way an added
        // rotation can turn the balloon without it drifting off the point.
        <Html center distanceFactor={8} style={{ pointerEvents: 'none' }}>
          <div
            ref={htmlRef}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32,
              transform: `translate(16px, -16px) rotate(${-45 + annotation.placemark_rotation}deg) scale(${annotation.placemark_scale})`,
              transformOrigin: '0% 100%',
              background: annotation.has_background ? hexToRgba(annotation.background_color, annotation.background_opacity) : 'transparent',
              border: `${borderWidth}px solid ${selected ? '#0ea5e9' : annotation.border_color}`,
              borderRadius: '50% 50% 50% 0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ transform: `rotate(${45 - annotation.placemark_rotation}deg)`, fontSize: 14, lineHeight: 1 }}>{ICON_GLYPH[annotation.icon]}</span>
          </div>
        </Html>
      ) : (
        // position left at the origin — useFrame above sets the real,
        // upAxis-aware local position unconditionally every frame
        // (including the first), so this JSX value is only ever visible
        // for a transient instant before the very first paint.
        <group ref={calloutGroupRef} position={[0, 0, 0]}>
          {/* No `center` prop here (2026-07-30 fix, per Maro: "the leader is
              not even connecting to the comment body") — Html's own `center`
              already centers this box on the 3D anchor, so stacking our own
              translateY(-100%) on top of that doubled up and left the box
              floating half its own height above where the leader line
              actually ends. Anchored at the box's bottom-left corner instead
              (Html's default, uncentered origin IS the anchor point; the
              translateY(-100%) alone lifts the box up from there), so the
              line always touches it exactly regardless of box height.
              leader_rotation/leader_scale (2026-07-30, Blender reference's
              own "Rotate/Scale Callout") ride in the same transform, after
              translateY so composition order works out right — see this
              component's own leader_rotation header for the full "why" —
              and transformOrigin is pinned to that same bottom-left corner
              so rotating/scaling never moves the point touching the line. */}
          <Html distanceFactor={8} style={{ pointerEvents: 'none' }}>
            <div
              ref={htmlRef}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                // width: 'max-content' (2026-07-30 fix, per Maro: "adaptable
                // textbox width" — a screenshot showed "SENSITIVE" broken
                // mid-word into "SENSITIV"/"E") — without an explicit width,
                // this flex item could render narrower than its own text's
                // natural width, and wordBreak: 'break-word' (below) would
                // then force a break *inside* a word that would easily have
                // fit a slightly wider box. max-content makes the box hug
                // its text exactly, from minWidth up to maxWidth, so a short
                // note never wraps at all and a long one only wraps at
                // actual word boundaries.
                width: 'max-content', minWidth: 80, maxWidth: 240,
                transform: `translateY(-100%) rotate(${annotation.leader_rotation}deg) scale(${annotation.leader_scale})`,
                transformOrigin: '0% 100%',
                background: annotation.has_background ? hexToRgba(annotation.background_color, annotation.background_opacity) : 'transparent',
                border: `${borderWidth}px solid ${selected ? '#0ea5e9' : annotation.border_color}`,
                borderRadius: boxBorderRadius, padding: '6px 8px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              }}
            >
              <span style={{
                fontSize: annotation.font_size, color: annotation.text_color, whiteSpace: 'pre-wrap',
                // overflowWrap (not wordBreak: 'break-word', see the box's
                // own header above) — only breaks a word mid-character as a
                // last resort, once the box is genuinely already at
                // maxWidth and normal space-wrapping alone isn't enough.
                overflowWrap: 'break-word',
              }}>
                {annotation.text || '(empty)'}
              </span>
            </div>
          </Html>
          {/* Leader-offset drag handle (2026-08-06) — a small invisible-
              until-selected hit target at the callout's own anchor, so
              dragging the box moves leader_offset_x/z instead of the
              annotation's own position. */}
          <mesh
            onPointerDown={handleLeaderPointerDown}
            onPointerMove={handleLeaderPointerMove}
            onPointerUp={handleLeaderPointerUp}
          >
            <sphereGeometry args={[0.08, 10, 10]} />
            <meshBasicMaterial color="#0ea5e9" transparent opacity={selected ? 0.9 : 0} depthTest={false} />
          </mesh>
        </group>
      )}
    </group>
  )
}
