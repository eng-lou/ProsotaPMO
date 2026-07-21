import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { Activity } from '@/modules/scheduling/types'
import type { Annotation, AnnotationIcon } from './annotations'
import type { AnimationProfile } from './animationProfiles'
import { DEFAULT_ANIMATION_CONFIG } from './animationProfiles'
import type { ElementKeyframe } from './elementKeyframes'
import type { ModelElementLink } from './modelElementLinks'
import { computeAppliedAnimationStateAt, interpolateKeyframeTrack, pickActiveLink, type ResolvedTimelineLink } from './timelinePlayback'

const ICON_GLYPH: Record<AnnotationIcon, string> = { pin: '📍', flag: '🚩', comment: '💬', warning: '⚠️' }
// Fixed world-unit height of a Footnote/Comment's callout box above its own
// anchor point (2026-07-12, redo per Maro's fuller Navisworks reference —
// the "Area:"/"Length:" boxes float above the point they describe,
// connected by a straight stem/leader line, not a hover-only tooltip
// sitting right on top of it).
const BOX_STEM_HEIGHT = 0.6

export interface AnnotationDragPoint {
  x: number
  y: number
  z: number
}

// One Placemark/Footnote/Comment in the 4D viewport (2026-07-12, redone
// per Maro's fuller Navisworks "3D Notations" reference — the first pass's
// small hover-only badge "wasn't nice"; this instead renders an always-
// visible styled marker matching that reference's own look:
//
// - Placemark: a Google-Maps-style balloon pin at its own point, no leader.
// - Footnote/Comment: an always-visible callout box (background/border/
//   text colour, font size — all from the annotation's own style fields)
//   floating a fixed height above its anchor point, connected to it by a
//   real 3D "stem" line — plus, if bound to a mesh element
//   (leaderTargetObject), a second leader line out to that element's own
//   *live* position, so it keeps pointing at a moving/animated target.
//
// See annotation.py's own docstring for the backend shape this mirrors,
// and this session's plan file for why this resolves its own Mode A/B
// animation state independently — its own small useFrame, entirely
// decoupled from Viewport3D's central TimelinePlayback resolver, since a
// marker is an Html overlay + a plain unwrapped mesh (no up-axis-
// correction group, no material system for that resolver's own machinery
// to touch).
//
// Position keyframes (Mode B) win over an Activity+AnimationProfile link
// (Mode A) exactly like TimelinePlayback's own targetsRef precedence for
// meshes — see that component's own header. Everything here is applied by
// directly mutating refs every frame (position, material opacity, DOM
// style, the leader lines' own geometry), never through React state, so a
// busy timeline doesn't turn into another render-churn bug the way this
// session's own Follow Path debugging already found twice elsewhere in
// this module. Distance culling (hide_closer_than/hide_farther_than) is
// applied the same way, every frame, ANDed into the same `shown` boolean
// Mode A/B visibility already resolves.
export function AnnotationMarker({
  annotation, dateRef, activities, modelElementLinks, animationProfiles, elementKeyframes,
  leaderTargetObject, selected, onSelect, onDragStart, onDragMove, onDragEnd,
}: {
  annotation: Annotation
  dateRef: React.MutableRefObject<Date | null>
  activities: Activity[]
  modelElementLinks: ModelElementLink[]
  animationProfiles: AnimationProfile[]
  elementKeyframes: ElementKeyframe[]
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
}) {
  const { camera } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshBasicMaterial>(null)
  const htmlRef = useRef<HTMLDivElement>(null)
  const stemGeometryRef = useRef<THREE.BufferGeometry>(null)
  const leaderGeometryRef = useRef<THREE.BufferGeometry>(null)
  const dragRef = useRef<{ plane: THREE.Plane; offset: THREE.Vector3; startClientPos: THREE.Vector2; moved: boolean } | null>(null)

  const isBox = annotation.kind === 'footnote' || annotation.kind === 'comment'

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

  const links = useMemo((): ResolvedTimelineLink[] => {
    const activityById = new Map(activities.map(a => [a.id, a]))
    const profileById = new Map(animationProfiles.map(p => [p.id, p]))
    const resolved: ResolvedTimelineLink[] = []
    for (const link of modelElementLinks) {
      if (link.source_kind !== 'annotation' || link.element_ref !== annotation.id) continue
      const activity = activityById.get(link.activity_id)
      if (!activity || !activity.start || !activity.finish) continue
      const profile = link.animation_profile_id ? profileById.get(link.animation_profile_id)?.config : DEFAULT_ANIMATION_CONFIG
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
        const state = activeLink ? computeAppliedAnimationStateAt(activeLink, now) : null
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
    groupRef.current.visible = shown
    if (meshRef.current) meshRef.current.scale.setScalar(selected ? 1.4 : 1)
    if (materialRef.current) materialRef.current.opacity = opacity
    if (htmlRef.current) {
      // Resolved Comments render dimmed (2026-07-12, per Maro's "so what's
      // the difference" question) — folded into this same per-frame
      // opacity write rather than a separate static style, since useFrame
      // already owns style.opacity every frame and would otherwise stomp
      // a JSX-set value right back to the Mode A/B-resolved one.
      const isResolvedComment = annotation.kind === 'comment' && annotation.status === 'resolved'
      htmlRef.current.style.opacity = String(opacity * (isResolvedComment ? 0.5 : 1))
      htmlRef.current.style.display = shown ? 'flex' : 'none'
    }

    if (isBox && stemGeometryRef.current) {
      stemGeometryRef.current.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, BOX_STEM_HEIGHT, 0)])
    }
    if (isBox && leaderTargetObject && leaderGeometryRef.current) {
      const targetWorld = new THREE.Vector3()
      leaderTargetObject.getWorldPosition(targetWorld)
      const targetLocal = groupRef.current.worldToLocal(targetWorld)
      leaderGeometryRef.current.setFromPoints([new THREE.Vector3(0, 0, 0), targetLocal])
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

  const borderWidth = annotation.thick_border ? 3 : 1
  // Comment gets a rounded speech-bubble look, Footnote a sharper
  // technical-callout one (2026-07-12, per Maro: "so what's the
  // difference [between Comment and Footnote]") — on top of the default-
  // icon and resolvable-status differences, this is the one purely visual
  // distinction between the two box kinds.
  const boxBorderRadius = annotation.kind === 'comment' ? 14 : 3
  const isResolvedComment = annotation.kind === 'comment' && annotation.status === 'resolved'

  return (
    <group ref={groupRef} position={[annotation.position_x, annotation.position_y, annotation.position_z]}>
      {isBox && (
        <line>
          <bufferGeometry ref={stemGeometryRef} />
          <lineBasicMaterial color={annotation.border_color} />
        </line>
      )}
      {isBox && leaderTargetObject && (
        <line>
          <bufferGeometry ref={leaderGeometryRef} />
          <lineBasicMaterial color={annotation.border_color} />
        </line>
      )}
      {/* Anchor point — the actual thing being drag/click hit-tested.
          Placemark's real visual is the balloon pin below; a box kind
          keeps this as a small tick mark at the true anchor, since the
          text box itself floats BOX_STEM_HEIGHT above it. */}
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <sphereGeometry args={[isBox ? 0.06 : 0.15, 12, 12]} />
        <meshBasicMaterial ref={materialRef} color={annotation.background_color} transparent depthTest={false} />
      </mesh>
      {annotation.kind === 'placemark' ? (
        <Html center distanceFactor={8} style={{ pointerEvents: 'none' }}>
          <div
            ref={htmlRef}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, transform: 'translateY(-16px) rotate(-45deg)',
              background: annotation.has_background ? annotation.background_color : 'transparent',
              border: `${borderWidth}px solid ${selected ? '#0ea5e9' : annotation.border_color}`,
              borderRadius: '50% 50% 50% 0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ transform: 'rotate(45deg)', fontSize: 14, lineHeight: 1 }}>{ICON_GLYPH[annotation.icon]}</span>
          </div>
        </Html>
      ) : (
        <Html center distanceFactor={8} position={[0, BOX_STEM_HEIGHT, 0]} style={{ pointerEvents: 'none' }}>
          <div
            ref={htmlRef}
            style={{
              display: 'flex', flexDirection: 'column', gap: 2, minWidth: 80, maxWidth: 240,
              transform: 'translateY(-100%)',
              background: annotation.has_background ? annotation.background_color : 'transparent',
              border: `${borderWidth}px solid ${selected ? '#0ea5e9' : annotation.border_color}`,
              borderRadius: boxBorderRadius, padding: '6px 8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            }}
          >
            <span style={{ fontSize: 11, opacity: 0.7, color: annotation.text_color }}>
              {ICON_GLYPH[annotation.icon]} {annotation.kind}{isResolvedComment ? ' — resolved' : ''}
            </span>
            <span style={{
              fontSize: annotation.font_size, color: annotation.text_color, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              textDecoration: isResolvedComment ? 'line-through' : 'none',
            }}>
              {annotation.text || '(empty)'}
            </span>
          </div>
        </Html>
      )}
    </group>
  )
}
