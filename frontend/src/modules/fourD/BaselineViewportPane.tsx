import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'
import type { ElementKeyframe } from './elementKeyframes'
import type { IfcModelHandle } from './ifcModel'
import type { ModelElementLink } from './modelElementLinks'
import type { Path } from './paths'
import type { PathFollower } from './pathFollowers'
import { cloneSceneHierarchy } from './sceneClone'
import { axisCorrectionRotation, type UpAxis } from './upAxis'
import { CameraSync, TimelinePlayback, type CameraSyncState, type ImportedObject, type TimelineSceneObject } from './Viewport3D'

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
  // Orbit camera sync with the primary Viewport3D (2026-07-24) — see
  // Viewport3D.tsx's own CameraSync header for the full mechanism.
  cameraSyncRef: React.MutableRefObject<CameraSyncState | null>
  // Include Baseline (2026-07-24, per Maro: "an option to include the
  // baseline 3d while capturing still and video. so side by side") —
  // baselineCanvasRef is written by CaptureCanvas just below (same
  // useThree()-inside-the-Canvas idiom as CaptureCamera) so Viewport3D.tsx's
  // own handleCaptureImage/handleExportVideo can read this pane's real
  // rendered canvas and composite it alongside the main one.
  // dprMultiplier mirrors Viewport3D.tsx's own captureDprMultiplier out to
  // this pane (relayed through FourD.tsx, see its own onCaptureQualityChange
  // prop) so a boosted-resolution capture boosts both canvases together,
  // not just the primary one — null/undefined means "native resolution,"
  // same as the primary viewport's own default.
  baselineCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>
  dprMultiplier?: number | null
}

// Mirrors Viewport3D.tsx's own private CameraCapture — this pane's camera
// object only exists once React-three-fiber's own Canvas has mounted it,
// so CameraSync (which needs a live reference, not the Canvas `camera`
// prop's initial config) reads it out via this same useThree()-inside-the-
// Canvas trick.
function CaptureCamera({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const { camera } = useThree()
  useEffect(() => { cameraRef.current = camera }, [camera, cameraRef])
  return null
}

// Same idiom as CaptureCamera just above, for this pane's own real WebGL
// canvas element (2026-07-24) — see baselineCanvasRef's own header.
function CaptureCanvas({ canvasRef }: { canvasRef: React.MutableRefObject<HTMLCanvasElement | null> }) {
  const { gl } = useThree()
  useEffect(() => { canvasRef.current = gl.domElement }, [gl, canvasRef])
  return null
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
  activities, links, profiles, elementKeyframes, paths, pathFollowers, cameraSyncRef, baselineCanvasRef, dprMultiplier,
}: Props) {
  const zUp = upAxis === 'z'
  const cameraRef = useRef<THREE.Camera | null>(null)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const dpr = Math.min(window.devicePixelRatio * (dprMultiplier ?? 1), 4)

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
        dpr={dpr}
        camera={{ position: [8, 8, 8], up: [0, zUp ? 0 : 1, zUp ? 1 : 0], fov: fieldOfView, near: clipStart, far: clipEnd }}
      >
        <CaptureCamera cameraRef={cameraRef} />
        <CaptureCanvas canvasRef={baselineCanvasRef} />
        <CameraSync syncRef={cameraSyncRef} cameraRef={cameraRef} controlsRef={controlsRef} />
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
            // Always null (2026-07-22) — this pane is a read-only cloned
            // snapshot with no click/selection interaction of its own, so
            // it can never trigger the live pane's own materialize-on-click
            // migration this prop exists to catch (see TimelinePlayback's
            // own selectedExpressId header).
            selectedExpressId={null}
            // Constant (2026-07-22) — same reasoning as selectedExpressId
            // just above: this pane has no Select All button of its own, so
            // there's never a bulk materializeAll to react to.
            materializeVersion={0}
          />
          <group rotation={axisCorrectionRotation('y', upAxis)}>
            <Grid args={[40, 40]} cellColor="#d1d5db" sectionColor="#9ca3af" fadeDistance={40} infiniteGrid />
          </group>
        </Suspense>
        <OrbitControls ref={controlsRef} makeDefault up={[0, zUp ? 0 : 1, zUp ? 1 : 0]} />
      </Canvas>
    </div>
  )
}
