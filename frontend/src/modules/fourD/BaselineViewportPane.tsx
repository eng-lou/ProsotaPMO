import { Suspense, useMemo } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'
import type { ElementKeyframe } from './elementKeyframes'
import type { IfcModelHandle } from './ifcModel'
import type { ModelElementLink } from './modelElementLinks'
import type { Path } from './paths'
import type { PathFollower } from './pathFollowers'
import { cloneSceneHierarchy } from './sceneClone'
import { axisCorrectionRotation, type UpAxis } from './upAxis'
import { TimelinePlayback, type ImportedObject, type TimelineSceneObject } from './Viewport3D'

interface Props {
  importedObjects: ImportedObject[]
  timelineSceneObjects: TimelineSceneObject[]
  ifcHandles: IfcModelHandle[]
  upAxis: UpAxis
  fieldOfView: number
  clipStart: number
  clipEnd: number
  timelineDateRef: React.MutableRefObject<Date | null>
  activities: Activity[]
  links: ModelElementLink[]
  profiles: AnimationProfile[]
  elementKeyframes: ElementKeyframe[]
  paths: Path[]
  pathFollowers: PathFollower[]
}

// The "planned" half of Maro's baseline-vs-actual compare request
// (2026-07-12, "advanced 4D... baselining and variance analysis" — see
// this session's own plan file for the full "why clone, not re-import"
// reasoning). Docked alongside the real Viewport3D via FourD.tsx's own
// SplitRow (already built for the top/bottom window docks, reused
// verbatim here), sharing the same timelineDateRef so the one Animation
// Timeline scrubs/plays both panes at once — this pane's own
// TimelinePlayback just resolves Mode A from bl_start/bl_finish instead
// of start/finish (dateField="baseline", see Viewport3D.tsx's own header
// on that prop).
//
// Deliberately minimal — no selection, gizmos, section boxes, paths, or
// annotations. This is a read-only comparison view of "where things would
// be if the schedule ran exactly as originally planned," not a second
// editing surface; every interactive feature this module has stays owned
// by the one real Viewport3D.
export function BaselineViewportPane({
  importedObjects, timelineSceneObjects, ifcHandles, upAxis, fieldOfView, clipStart, clipEnd, timelineDateRef,
  activities, links, profiles, elementKeyframes, paths, pathFollowers,
}: Props) {
  const zUp = upAxis === 'z'

  // Cloned once per source-object identity change (2026-07-12) — a plain
  // Map keyed by the *original* Object3D, rebuilt whenever the set of
  // loaded objects changes (import/unload) or any of their own base
  // transforms move, so this pane's placement always mirrors the real
  // scene; only Mode A's own animation timing differs at playback time
  // (see this file's own header). cloneSceneHierarchy is the hand-written
  // safe clone — see sceneClone.ts's own header for why not
  // Object3D.clone().
  //
  // Gated on a content string, not `importedObjects` itself (2026-07-12
  // fix, caught before it shipped) — FourD.tsx's own `viewportObjects` is
  // already a plain `.map()` recomputed fresh every render (same as what
  // the *primary* Viewport3D has always received), so including that
  // ever-fresh array in this useMemo's own dependency list would make it
  // recompute — re-cloning the *entire* scene hierarchy — on literally
  // every render regardless of the string, since React reruns a memo the
  // instant *any one* dependency's identity changes. The string alone
  // already captures every actual composition/transform change (it's
  // built from the same live `importedObjects` each render via closure,
  // just not itself a dependency), so it's sufficient on its own.
  const cloneKey = importedObjects
    .map(o => `${o.id}:${o.object.position.x},${o.object.position.y},${o.object.position.z},${o.object.rotation.x},${o.object.rotation.y},${o.object.rotation.z},${o.object.scale.x},${o.object.scale.y},${o.object.scale.z}`)
    .join('|')
  const clonesByOriginal = useMemo(() => {
    const map = new Map<THREE.Object3D, THREE.Object3D>()
    for (const o of importedObjects) map.set(o.object, cloneSceneHierarchy(o.object))
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloneKey])

  // Cheap re-maps, not memoized — same "recomputed every render, plain
  // .map()" treatment FourD.tsx's own viewportObjects already gets for the
  // primary viewport; only the actual cloning above is expensive enough to
  // need real memoization.
  const clonedImportedObjects = importedObjects.map(o => ({ ...o, object: clonesByOriginal.get(o.object) ?? o.object }))
  const clonedSceneObjects = timelineSceneObjects.map(o => ({ ...o, object: clonesByOriginal.get(o.object) ?? o.object }))
  const clonedIfcHandles = ifcHandles.map(h => ({ ...h, object: (clonesByOriginal.get(h.object) as THREE.Group | undefined) ?? h.object }))

  return (
    <div className="relative flex-1 min-h-0">
      <div className="absolute top-2 left-2 z-10 text-xs font-medium bg-white/90 border border-gray-300 rounded px-2 py-1 text-gray-600 pointer-events-none">
        Baseline (planned)
      </div>
      <Canvas
        frameloop="always"
        camera={{ position: [8, 8, 8], up: [0, zUp ? 0 : 1, zUp ? 1 : 0], fov: fieldOfView, near: clipStart, far: clipEnd }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={zUp ? [10, 10, 15] : [10, 15, 10]} intensity={1} />
        <Suspense fallback={null}>
          {clonedImportedObjects.map(({ id, sourceUpAxis, object, visible }) => (
            <group key={id} rotation={axisCorrectionRotation(sourceUpAxis, upAxis)}>
              <primitive object={object} visible={visible} />
            </group>
          ))}
          <TimelinePlayback
            dateRef={timelineDateRef}
            sceneObjects={clonedSceneObjects}
            activities={activities}
            links={links}
            profiles={profiles}
            elementKeyframes={elementKeyframes}
            upAxis={upAxis}
            ifcHandles={clonedIfcHandles}
            activeObjectId={null}
            onTick={() => {}}
            paths={paths}
            pathFollowers={pathFollowers}
            dateField="baseline"
          />
          <group rotation={axisCorrectionRotation('y', upAxis)}>
            <Grid args={[40, 40]} cellColor="#d1d5db" sectionColor="#9ca3af" fadeDistance={40} infiniteGrid />
          </group>
        </Suspense>
        <OrbitControls makeDefault up={[0, zUp ? 0 : 1, zUp ? 1 : 0]} />
      </Canvas>
    </div>
  )
}
