import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { Environment, Grid, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Activity, UserDefinedFieldDefinition, UserDefinedFieldValue } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'
import type { Collection } from './collections'
import { applyPaneIsolationVisibility, type PaneConfig, type PaneContentMode } from './comparisonPane'
import type { ElementKeyframe } from './elementKeyframes'
import type { IfcModelHandle } from './ifcModel'
import type { ResolvedIsolationTarget } from './linkedElements'
import type { ModelElementLink } from './modelElementLinks'
import type { Path } from './paths'
import type { PathFollower } from './pathFollowers'
import { ScopeFilterFields } from './ScopeFilterFields'
import { cloneSceneHierarchy } from './sceneClone'
import { axisCorrectionRotation, type UpAxis } from './upAxis'
import {
  CameraSync, computeModelBounds, computeSunPosition, DEFAULT_ENVIRONMENT_URL,
  ShadowFrustumSync, TimelinePlayback, type CameraSyncState, type ImportedObject, type TimelineSceneObject,
} from './Viewport3D'

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
  cameraSyncRef: React.MutableRefObject<CameraSyncState | null>
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>
  dprMultiplier?: number | null
  environmentUrl: string | null
  environmentBackground: boolean
  whiteBackground: boolean
  shadows: boolean
  sunAzimuth: number
  sunElevation: number
  captureBackgroundOverride: boolean | null
  // Same "drop to frameloop='never' while the 4D tab itself is hidden"
  // gating the primary Viewport3D already has (2026-08-03 fix — this pane
  // used to unconditionally run frameloop="always" regardless of tab
  // visibility, a real gap that only gets worse the more of these panes
  // can be open at once).
  active: boolean
  // null = 'baseline' mode's own meaning (show the whole model, no
  // filtering) — see comparisonPane.ts's own applyPaneIsolationVisibility
  // header for exactly how a non-null target gets applied post-clone.
  isolation: ResolvedIsolationTarget | null
  // Was hardcoded "baseline" — now follows the pane's own content mode:
  // 'live' for collection/scope modes (current dates, matching the main
  // viewport — same 'live' literal TimelinePlayback's own dateField prop
  // already uses), 'baseline' only for baseline mode.
  dateField: 'live' | 'baseline'
  // This pane's own config + the setter FourD.tsx uses to persist it
  // (localStorage-backed, see FourD.tsx's own paneConfigs state) — the
  // header controls below read/write this directly rather than the pane
  // owning any config state of its own.
  config: PaneConfig
  onConfigChange: (config: PaneConfig) => void
  onClose: () => void
  collections: Collection[]
  udfDefinitions: UserDefinedFieldDefinition[]
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined
}

// Mirrors Viewport3D.tsx's own private CameraCapture — this pane's camera
// object only exists once react-three-fiber's own Canvas has mounted it,
// so CameraSync (which needs a live reference, not the Canvas `camera`
// prop's initial config) reads it out via this same useThree()-inside-the-
// Canvas trick.
function CaptureCamera({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const { camera } = useThree()
  useEffect(() => { cameraRef.current = camera }, [camera, cameraRef])
  return null
}

// Same idiom as CaptureCamera just above, for this pane's own real WebGL
// canvas element (2026-07-24) — see canvasRef's own header.
function CaptureCanvas({ canvasRef }: { canvasRef: React.MutableRefObject<HTMLCanvasElement | null> }) {
  const { gl } = useThree()
  useEffect(() => { canvasRef.current = gl.domElement }, [gl, canvasRef])
  return null
}

// A generalized "Compare Baseline" pane (2026-08-03, per Maro: "compare
// baseline goes beyond just the one baseline view" — up to 3 of these can
// be docked at once, see comparisonPane.ts's own module header for the
// full "why"). Started life as BaselineViewportPane.tsx, always showing
// bl_start/bl_finish dates; now also supports isolating to a Collection's
// own membership, or to every element linked to Activities matching a
// UDF-value/WBS-node scope, via the `isolation`/`dateField` props — see
// comparisonPane.ts's own useResolvedPaneIsolation, computed once per pane
// by FourD.tsx and handed down here already-resolved.
//
// Docked alongside the real Viewport3D (and any sibling panes) via
// FourD.tsx's own SplitRow, sharing the same timelineDateRef so the one
// Animation Timeline scrubs/plays every pane at once.
//
// Deliberately minimal — no selection, gizmos, section boxes, paths, or
// annotations beyond what TimelinePlayback itself needs. This is a read-
// only comparison view, not a second editing surface; every interactive
// feature this module has beyond the header controls below stays owned by
// the one real Viewport3D.
export function ComparisonViewportPane({
  importedObjects, timelineSceneObjects, ifcHandles, upAxis, fieldOfView, clipStart, clipEnd, timelineDateRef,
  activities, links, profiles, elementKeyframes, paths, pathFollowers, cameraSyncRef, canvasRef, dprMultiplier,
  environmentUrl, environmentBackground, whiteBackground, shadows, sunAzimuth, sunElevation, captureBackgroundOverride,
  active, isolation, dateField, config, onConfigChange, onClose, collections, udfDefinitions, getUdfValue,
}: Props) {
  const zUp = upAxis === 'z'
  const cameraRef = useRef<THREE.Camera | null>(null)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  // Populated by the directionalLight's own `ref` below — ShadowFrustumSync
  // (shared from Viewport3D.tsx, see its own header) needs direct access to
  // mutate light.shadow.camera every frame.
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null)
  const dpr = Math.min(window.devicePixelRatio * (dprMultiplier ?? 1), 4)
  const activeEnvironmentUrl = environmentUrl ?? DEFAULT_ENVIRONMENT_URL
  // Same "background=false during a capture override, else live setting"
  // logic as Viewport3D.tsx's own showWhiteBackground/Environment
  // background — see that file's own comments for the full reasoning.
  const showWhiteBackground = captureBackgroundOverride === null && whiteBackground
  const showEnvironmentBackground = showWhiteBackground ? false : (captureBackgroundOverride ?? environmentBackground)
  // center-offset sun position + explicit target (2026-08-22, mirrors
  // Viewport3D.tsx's own fix — see computeModelBounds's header there for
  // the full "why": without this, the sun/its shadow frustum always aimed
  // at world origin regardless of where this pane's own model actually
  // sits, same "not well placed" bug as the primary viewport had).
  const modelBounds = useMemo(() => computeModelBounds(importedObjects), [importedObjects])
  const modelRadius = modelBounds.radius
  // Mirrors computeSunPosition's own internal sunRadius — see
  // Viewport3D.tsx's own sunRadius for the full "why" (needed again here
  // for ShadowFrustumSync's shadow-camera-far calc, below).
  const sunRadius = modelRadius * 3
  const sunOffset = computeSunPosition(sunAzimuth, sunElevation, modelRadius, zUp)
  const sunPosition: [number, number, number] = [
    modelBounds.center[0] + sunOffset[0],
    modelBounds.center[1] + sunOffset[1],
    modelBounds.center[2] + sunOffset[2],
  ]
  const [sunTarget] = useState(() => new THREE.Object3D())

  // Cloned once per source-object identity change (2026-07-12) — a plain
  // Map keyed by the *original* Object3D, rebuilt whenever the set of
  // loaded objects changes (import/unload) or any of their own base
  // transforms move, so this pane's placement always mirrors the real
  // scene; only Mode A's own animation timing (and, now, isolation
  // visibility below) differs at playback time. cloneSceneHierarchy is
  // the hand-written safe clone — see sceneClone.ts's own header for why
  // not Object3D.clone().
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

  // cloneSceneHierarchy (sceneClone.ts) never copies castShadow/receiveShadow
  // from the source meshes — those two flags live on the mesh itself, not
  // something the light's own castShadow prop can substitute for — so
  // without this, toggling "shadows" on would light a shadow-casting sun but
  // every cloned mesh would still be flagged as not casting/receiving one.
  // Keyed on the actual clone instances (stable across re-renders via
  // clonesByOriginal's own cloneKey memo above), not the fresh-every-render
  // clonedImportedObjects array, so this only re-traverses when the model
  // set or the shadows setting itself actually changes.
  // THREE.Points too, not just THREE.Mesh (2026-08-22 fix, mirrors
  // Viewport3D.tsx's own — see that file's point-cloud shadow-casting
  // comment for the full "why": a Site Capture point cloud is a
  // THREE.Points object, and three.js's shadow map genuinely does support
  // object.isPoints for casting, this just wasn't being set here either).
  useEffect(() => {
    for (const clone of clonesByOriginal.values()) {
      clone.traverse(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
          child.castShadow = shadows
          child.receiveShadow = shadows
        }
      })
    }
  }, [clonesByOriginal, shadows])

  // Isolation visibility (2026-08-03) — re-applied whenever the clone set
  // or the resolved isolation target itself changes; a fresh clone always
  // starts fully visible (cloneSceneHierarchy copies the *source* object's
  // own current `visible`, not anything isolation-aware), so this has to
  // re-run after every re-clone, not just once.
  useEffect(() => {
    applyPaneIsolationVisibility(clonedImportedObjects, isolation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clonesByOriginal, isolation])

  const collectionOptions = useMemo(() => [...collections].sort((a, b) => a.name.localeCompare(b.name)), [collections])

  return (
    <div className="relative flex-1 min-h-0">
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 max-w-[calc(100%-1rem)]">
        <div className="flex items-center gap-1 text-xs font-medium bg-white/90 border border-gray-300 dark:border-prosota-line rounded px-1.5 py-1 text-gray-600 dark:text-prosota-muted">
          <select
            value={config.contentMode}
            onChange={e => onConfigChange({ ...config, contentMode: e.target.value as PaneContentMode })}
            className="text-xs border-none bg-transparent font-medium focus:outline-none"
          >
            <option value="baseline">Baseline (planned)</option>
            <option value="collection">Collection</option>
            <option value="scope">Scope (UDF / WBS / All)</option>
          </select>
          <button
            onClick={() => onConfigChange({ ...config, cameraDisconnected: !config.cameraDisconnected })}
            title={config.cameraDisconnected ? 'Camera disconnected from the group — click to reconnect' : 'Camera synced with the group — click to disconnect and orbit independently'}
            className="px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-prosota-panel2 shrink-0"
          >
            {config.cameraDisconnected ? '🔓' : '🔗'}
          </button>
          <button onClick={onClose} title="Close this view" className="px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-prosota-panel2 text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
        </div>
        {config.contentMode === 'collection' && (
          <select
            value={config.collectionId ?? ''}
            onChange={e => onConfigChange({ ...config, collectionId: e.target.value || null })}
            className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1 bg-white/90 text-gray-600 dark:text-prosota-muted"
          >
            <option value="">Choose a collection…</option>
            {collectionOptions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {config.contentMode === 'scope' && (
          <div className="bg-white/90 border border-gray-300 dark:border-prosota-line rounded px-1.5 py-1">
            <ScopeFilterFields
              scope={config.scope}
              activities={activities}
              udfDefinitions={udfDefinitions}
              getUdfValue={getUdfValue}
              onChange={scope => onConfigChange({ ...config, scope })}
            />
          </div>
        )}
      </div>
      <Canvas
        frameloop={active ? 'always' : 'never'}
        dpr={dpr}
        camera={{ position: [8, 8, 8], up: [0, zUp ? 0 : 1, zUp ? 1 : 0], fov: fieldOfView, near: clipStart, far: clipEnd }}
      >
        <CaptureCamera cameraRef={cameraRef} />
        <CaptureCanvas canvasRef={canvasRef} />
        <CameraSync syncRef={cameraSyncRef} cameraRef={cameraRef} controlsRef={controlsRef} disconnected={config.cameraDisconnected} />
        <ambientLight intensity={0.6} />
        {/* Settings-driven sun light (2026-07-25), replacing this pane's old
            fixed directionalLight — mirrors Viewport3D.tsx's own
            sunPosition/shadow-frustum setup (see computeSunPosition/
            computeModelBounds, shared from that file) so shadows in this
            pane actually match the live viewport's sun angle instead of a
            constant corner light. Frustum sizing simplified relative to the
            primary viewport's own (no highQuality/normalBias tuning) since
            this is a read-only comparison pane, not the primary editing
            surface. sunTarget (2026-08-22, same fix as Viewport3D.tsx's own)
            — without an explicit target, three.js's DirectionalLight aims
            at a never-added Object3D stuck at world origin, so the light
            (and its shadow frustum) always pointed past this pane's own
            model instead of at it whenever that model wasn't centered on
            (0,0,0).
            2026-08-31 fix (mirrors Viewport3D.tsx's own ShadowFrustumSync,
            per the same "adding a much larger site IFC wipes the shadow/
            lighting effects" report) — frustum size is no longer fixed off
            modelRadius here either, for the same reason: a much-larger
            site import ballooning the combined bounds tanked this pane's
            own shadow texel density exactly like the primary viewport's.
            Shared component, so both panes now resize identically off each
            one's own camera distance. */}
        <primitive object={sunTarget} position={modelBounds.center} />
        <directionalLight
          ref={sunLightRef}
          position={sunPosition} target={sunTarget} intensity={1} castShadow={shadows}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-near={0.5}
        />
        <ShadowFrustumSync lightRef={sunLightRef} controlsRef={controlsRef} modelRadius={modelRadius} sunRadius={sunRadius} />
        <Suspense fallback={null}>
          <Environment
            files={activeEnvironmentUrl}
            background={showEnvironmentBackground}
            backgroundRotation={zUp ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
            environmentRotation={zUp ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
          />
          {showWhiteBackground && <color attach="background" args={['#ffffff']} />}
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
            dateField={dateField}
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
