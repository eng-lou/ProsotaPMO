import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Grid, OrbitControls, Sky } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Activity, UserDefinedFieldDefinition, UserDefinedFieldValue } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'
import type { Collection } from './collections'
import { activitiesForPaneDates, applyPaneIsolationVisibility, type PaneConfig, type PaneContentMode } from './comparisonPane'
import { RadialChartHud } from './RadialChartHud'
import type { RadialChart } from './radialCharts'
import { TimelineStripHud } from './TimelineStripHud'
import type { TimelineStrip } from './timelineStrips'
import { buildEdgesBatch, disposeEdgesBatch, type BatchState, type EdgesBatch } from './elementBatching'
import type { ElementKeyframe } from './elementKeyframes'
import type { IfcModelHandle } from './ifcModel'
import type { ResolvedIsolationTarget } from './linkedElements'
import type { ModelElementLink } from './modelElementLinks'
import type { Path } from './paths'
import type { PathFollower } from './pathFollowers'
import { getGouraudVariant, getHiddenLineMaterial, HIDDEN_LINE_BASE_COLOR } from './renderModeMaterials'
import {
  applyRealisticToBatch, classIndexForMesh, clearRealisticFromBatch, colourOverrideForMesh, disposeRealisticVariant,
  getRealisticVariant, realisticInstanceBase, setRealisticGlassMoving, syncRealisticGlassBatch, type RealisticMaterialMap, type RealisticModelInfo,
} from './realisticMaterials'
import { hideSmallWhileMoving, restoreAfterMoving } from './movingDetail'
import { ScopeFilterFields } from './ScopeFilterFields'
import { cloneSceneHierarchy, disposeClonedBatch } from './sceneClone'
import { axisCorrectionRotation, type UpAxis } from './upAxis'
import { IdleRenderDriver } from './IdleRenderDriver'
import type { RenderMode } from './viewerSettings'
import {
  AmbientOcclusionEffect, CameraSync, computeModelBounds, computeSunPosition, DefaultEnvironment, lightingForRenderMode, RealisticEnvironment,
  ShadowFrustumSync, TimelinePlayback, type CameraSyncState, type ImportedObject, type TimelineSceneObject,
} from './Viewport3D'

interface Props {
  importedObjects: ImportedObject[]
  // Same fix as Viewport3D.tsx's own transformTick prop (2026-09-02) — see
  // that file's Props header for the full "why."
  transformTick: number
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
  // Solid Background's colour (viewerSettings.ts), same as the main view.
  backgroundColor: string
  shadows: boolean
  sunAzimuth: number
  sunElevation: number
  captureBackgroundOverride: boolean | null
  // Full render-mode/effects parity with the primary viewport (2026-09-01,
  // per Maro: "baseline viewport isnt using the the same render mode and
  // effects settings") — a deliberate reversal of this pane's original
  // 2026-07-12 "always real PBR, ignore render mode" design (see
  // sceneClone.ts's own updated header). Variance/clash colours stay out
  // of scope on purpose — those are schedule-status overlays tied to the
  // live selection/date context, not a rendering setting, and this pane
  // has neither.
  renderMode: RenderMode
  // Realistic Materials mode inputs — same values the primary viewport gets.
  realisticMapping: RealisticMaterialMap
  realisticInfoVersion: number
  realisticGlassTransmission: boolean
  // "Simplify while orbiting" — applied here too while the main view's
  // synced orbit drag is in progress (PaneMovingDriver).
  simplifyWhileOrbiting: boolean
  showEdges: boolean
  ambientOcclusion: boolean
  dynamicSky: boolean
  showGrid: boolean
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
  // The main view's Hide (`${objectId}::${expressID}` keys) — a pane honours
  // Hide but never the main view's Isolate (see applyPaneIsolationVisibility).
  hiddenElementKeys: Set<string>
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
  // HUD widgets placed in THIS view (2026-10-03, per Maro: "allow me add
  // radial charts/timeline strips per baseline views") — already filtered
  // to this pane's slot by FourD.tsx; same components and drag-to-place as
  // the main viewport's, positioned relative to this pane's own rect.
  radialCharts: RadialChart[]
  radialChartMatchingIds: Map<string, Set<string>>
  onCommitRadialChartPosition: (chartId: string, positionXPct: number, positionYPct: number) => void
  timelineStrips: TimelineStrip[]
  timelineStripMatchingIds: Map<string, Set<string>>
  onCommitTimelineStripPosition: (stripId: string, positionXPct: number, positionYPct: number) => void
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

// Clip planes in this view (2026-10-03, per Maro: Grow profiles played in
// the main view but not the comparison views, while Fall played in all).
// Grow is a moving clip plane (TimelinePlayback), and three.js ignores
// every material's clippingPlanes unless the renderer's own
// localClippingEnabled is on — the main view sets it (Viewport3D.tsx's
// ClippingSetup), this canvas never did, so every Grow element simply
// showed whole.
//
// Turning it on exposes one thing this view must not inherit: an element
// the main view had already pulled out of its batch before this view
// cloned is cloned onto the SAME material (sceneClone.ts), and the main
// view's Section Box planes sit on that material. For the duration of this
// view's own render (scene.onBeforeRender/onAfterRender, which wrap the
// shadow and AO passes too) those planes are swapped for never-clipping
// stand-ins of the same count, so the shader isn't recompiled, and put
// back straight after, so the main view keeps its box.
const IDLE_PLANE_CONSTANT = 1e9
function PaneClipping() {
  const { gl, scene } = useThree()
  useEffect(() => {
    gl.localClippingEnabled = true
    const isSectionBoxPlane = (p: THREE.Plane) => (p as THREE.Plane & { __clipOwner?: string }).__clipOwner === 'sectionBox'
      && p.constant !== IDLE_PLANE_CONSTANT
    const strippedByOriginal = new WeakMap<THREE.Plane[], THREE.Plane[]>()
    const swapped: { material: THREE.Material; original: THREE.Plane[] }[] = []
    const strip = (material: THREE.Material) => {
      const original = material.clippingPlanes
      if (!original || !original.some(isSectionBoxPlane)) return
      let stripped = strippedByOriginal.get(original)
      if (!stripped) {
        stripped = original.map(p => (isSectionBoxPlane(p) ? new THREE.Plane(new THREE.Vector3(0, 0, 1), IDLE_PLANE_CONSTANT) : p))
        strippedByOriginal.set(original, stripped)
      }
      material.clippingPlanes = stripped
      swapped.push({ material, original })
    }
    scene.onBeforeRender = () => {
      scene.traverseVisible(child => {
        if (!(child instanceof THREE.Mesh)) return
        if (Array.isArray(child.material)) child.material.forEach(strip)
        else strip(child.material)
      })
    }
    scene.onAfterRender = () => {
      for (const { material, original } of swapped) material.clippingPlanes = original
      swapped.length = 0
    }
    return () => {
      scene.onBeforeRender = () => {}
      scene.onAfterRender = () => {}
    }
  }, [gl, scene])
  return null
}

// Same idiom as CaptureCamera just above, for this pane's own real WebGL
// canvas element (2026-07-24) — see canvasRef's own header.
// Realistic Materials mode: each cloned batch's glass-only companion
// mirrors the clone's own per-instance visibility/colour/clipping every
// frame, same as the primary viewport's (realisticMaterials.ts).
function RealisticGlassSync({ clones, enabled }: { clones: Iterable<THREE.Object3D>; enabled: boolean }) {
  useFrame(() => {
    if (!enabled) return
    for (const clone of clones) {
      const batch = clone.userData.batch as BatchState | undefined
      if (batch) syncRealisticGlassBatch(batch)
    }
  })
  return null
}

// The comparison views' half of "Simplify while orbiting" (2026-10-03, per
// Maro: "optimise... less lag" — with three Realistic comparison views open,
// every main-view orbit frame re-rendered each of them at full detail, AO,
// shadows and transmission glass). While the main view's orbit drag is in
// progress (CameraSyncState.moving) and this view follows it, sub-pixel
// elements are hidden and the glass swaps to the cheap material, exactly
// as the main view does (movingDetail.ts / setRealisticGlassMoving); both
// come back the first frame after the drag ends.
function PaneMovingDriver({ syncRef, clones, simplify, glassSwap, disconnected }: {
  syncRef: React.MutableRefObject<CameraSyncState | null>
  clones: Map<THREE.Object3D, THREE.Object3D>
  simplify: boolean
  glassSwap: boolean
  disconnected: boolean
}) {
  const get = useThree(s => s.get)
  const invalidate = useThree(s => s.invalidate)
  const activeRef = useRef(false)
  useFrame(() => {
    const moving = !disconnected && !!syncRef.current?.moving
    if (moving === activeRef.current) return
    activeRef.current = moving
    if (moving) {
      const { camera, size } = get()
      for (const clone of clones.values()) {
        if (simplify) hideSmallWhileMoving(clone, camera, size.height)
        if (glassSwap) setRealisticGlassMoving(clone, true)
      }
    } else {
      for (const clone of clones.values()) {
        restoreAfterMoving(clone)
        setRealisticGlassMoving(clone, false)
      }
      invalidate()
    }
  })
  return null
}

const PANE_WHITE = new THREE.Color(1, 1, 1)

// The cloned batch's per-instance colours (sceneClone.ts copies whatever
// the primary viewport last wrote, selection tint included): each
// element's own IFC colour, or white under a Realistic class whose texture
// carries its own colour — same rule as Viewport3D.tsx's
// applyBatchSelectionColour. Alpha reset to 1 (the primary's Fade
// Unselected isn't a pane concept).
function writeClonedBatchColours(batch: BatchState, realistic: boolean) {
  for (const infos of batch.byExpressId.values()) {
    for (const info of infos) {
      batch.mesh.setColorAt(info.instanceId, realistic ? realisticInstanceBase(batch.mesh, info.instanceId, info.color, PANE_WHITE) : info.color)
    }
  }
  const colorsTexture = (batch.mesh as unknown as { _colorsTexture: THREE.DataTexture | null })._colorsTexture
  if (colorsTexture) {
    const data = colorsTexture.image.data as Float32Array
    for (let i = 3; i < data.length; i += 4) data[i] = 1
    colorsTexture.needsUpdate = true
  }
}

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
  importedObjects, transformTick, timelineSceneObjects, ifcHandles, upAxis, fieldOfView, clipStart, clipEnd, timelineDateRef,
  activities, links, profiles, elementKeyframes, paths, pathFollowers, cameraSyncRef, canvasRef, dprMultiplier,
  environmentUrl, environmentBackground, whiteBackground, backgroundColor, shadows, sunAzimuth, sunElevation, captureBackgroundOverride,
  renderMode, realisticMapping, realisticInfoVersion, realisticGlassTransmission, simplifyWhileOrbiting, showEdges, ambientOcclusion, dynamicSky, showGrid,
  active, isolation, hiddenElementKeys, dateField, config, onConfigChange, onClose, collections, udfDefinitions, getUdfValue,
  radialCharts, radialChartMatchingIds, onCommitRadialChartPosition, timelineStrips, timelineStripMatchingIds, onCommitTimelineStripPosition,
}: Props) {
  const zUp = upAxis === 'z'
  const containerRef = useRef<HTMLDivElement>(null)
  const hudActivities = useMemo(() => activitiesForPaneDates(activities, dateField === 'baseline'), [activities, dateField])
  const cameraRef = useRef<THREE.Camera | null>(null)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  // Populated by the directionalLight's own `ref` below — ShadowFrustumSync
  // (shared from Viewport3D.tsx, see its own header) needs direct access to
  // mutate light.shadow.camera every frame.
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null)
  const dpr = Math.min(window.devicePixelRatio * (dprMultiplier ?? 1), 4)
  // Same "background=false during a capture override, else live setting"
  // logic as Viewport3D.tsx's own showWhiteBackground/Environment
  // background — see that file's own comments for the full reasoning.
  // No custom HDR and no Real-Time Sky: nothing to show but white (see
  // DefaultEnvironment's header in Viewport3D.tsx).
  const showWhiteBackground = (captureBackgroundOverride === null && whiteBackground)
    || (!dynamicSky && !environmentUrl)
    || !(captureBackgroundOverride ?? environmentBackground)
  const solidBackgroundColor = captureBackgroundOverride === null && whiteBackground ? backgroundColor : '#ffffff'
  const showEnvironmentBackground = showWhiteBackground ? false : (captureBackgroundOverride ?? environmentBackground)
  // center-offset sun position + explicit target (2026-08-22, mirrors
  // Viewport3D.tsx's own fix — see computeModelBounds's header there for
  // the full "why": without this, the sun/its shadow frustum always aimed
  // at world origin regardless of where this pane's own model actually
  // sits, same "not well placed" bug as the primary viewport had).
  const modelBounds = useMemo(() => computeModelBounds(importedObjects), [importedObjects, transformTick])
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
  // Mirrors Viewport3D.tsx's own skySunPosition exactly (2026-09-01) —
  // always modelRadius=1/zUp=false, same reasoning as that file's own
  // comment: three-stdlib's Sky shader normalizes sunPosition and dots it
  // against a hardcoded Y-up `up` vector, independent of upAxis/scale.
  const skySunPosition = computeSunPosition(sunAzimuth, sunElevation, 1, false)
  // Shadow-catcher ground plane (2026-09-01, per Maro: "baseline doesnt
  // show the shadow detail/effects") — this pane never had one at all, a
  // pre-existing gap distinct from the render-mode/AO/sky parity work
  // above: Grid is a decorative shader overlay with no real geometry to
  // receive a shadow, so with no other object under an imported model,
  // `shadows` being on had nothing to actually show a shadow *on* here —
  // exactly the same "looked like the setting did nothing" report
  // Viewport3D.tsx's own shadow-catcher (2026-07-09, extended 2026-08-22
  // for model-relative placement) already solved; same math, reused as-is.
  const groundEpsilon = modelRadius * 0.001
  const groundSize = modelRadius * 8
  const groundPosition: [number, number, number] = zUp
    ? [modelBounds.center[0], modelBounds.center[1], modelBounds.min[2] - groundEpsilon]
    : [modelBounds.center[0], modelBounds.min[1] - groundEpsilon, modelBounds.center[2]]
  const groundRotation: [number, number, number] = zUp ? [0, 0, 0] : [-Math.PI / 2, 0, 0]

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
          child.castShadow = shadows && !child.userData.isRealisticGlassBatch
          child.receiveShadow = shadows
        }
      })
    }
  }, [clonesByOriginal, shadows])

  // Render mode + Edges (2026-09-01, per Maro: "baseline viewport isnt
  // using the the same render mode and effects settings") — a scoped-down
  // mirror of Viewport3D.tsx's own ModelObjects material-swap block: no
  // selection tint, texture overrides, or xray fade (this pane has none of
  // those concepts), just the same render-mode material class swap and the
  // same Edges overlay, driven off the same shared MeshStandardMaterial
  // instance sceneClone.ts's own `userData.standardMaterial` tag captures
  // (see that file's header — always the real material, never a
  // previously-swapped stand-in, so switching Gouraud -> Hidden Line ->
  // Shaded never stacks one variant on top of another). getGouraudVariant/
  // getHiddenLineMaterial cache their built variant on that same shared
  // source material's own userData, so if the primary viewport has already
  // built one for this exact render mode, this reuses that same cached
  // instance rather than building a second one.
  useEffect(() => {
    for (const [original, clone] of clonesByOriginal) {
      // The clone carries no material table of its own; its source model's
      // (realisticMaterials.ts) applies unchanged — clones keep expressID and
      // ifcGeometryId (sceneClone.ts).
      const realisticInfo = original.userData.realisticMaterialInfo as RealisticModelInfo | undefined
      const wantsEdges = showEdges || renderMode === 'hiddenLine'
      // The cloned batch (sceneClone.ts) — one shared material for every
      // still-batched element, swapped the same way the primary viewport's
      // own batch block does (Viewport3D.tsx), plus the batched Edges
      // overlay built from the clone rather than per mesh.
      const batch = clone.userData.batch as BatchState | undefined
      if (batch) {
        const batchMat = batch.mesh.userData.standardMaterial as THREE.MeshStandardMaterial
        if (renderMode === 'realistic') {
          batch.mesh.material = applyRealisticToBatch(
            batch, batchMat, realisticInfo, realisticMapping, false, realisticGlassTransmission, shadows,
          )
        } else {
          clearRealisticFromBatch(batch)
          batch.mesh.material = renderMode === 'gouraud' ? getGouraudVariant(batchMat, true)
            : renderMode === 'hiddenLine' ? getHiddenLineMaterial(batchMat, HIDDEN_LINE_BASE_COLOR, true)
            : batchMat
        }
        writeClonedBatchColours(batch, renderMode === 'realistic')
        const existingEdges = clone.userData.edgesBatch as EdgesBatch | undefined
        if (wantsEdges && !existingEdges) {
          const edgesBatch = buildEdgesBatch(clone)
          for (const entry of edgesBatch.entries.values()) clone.add(entry.mesh)
          clone.userData.edgesBatch = edgesBatch
        } else if (!wantsEdges && existingEdges) {
          disposeEdgesBatch(existingEdges)
          for (const entry of existingEdges.entries.values()) clone.remove(entry.mesh)
          clone.userData.edgesBatch = undefined
        }
      }
      clone.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        if (child === batch?.mesh || child.userData.isRealisticGlassBatch || child.userData.isEdgesBatchMesh) return
        const base = (child.userData.standardMaterial as THREE.Material | THREE.Material[] | undefined) ?? child.material
        const materials = Array.isArray(base) ? base : [base]
        const display = materials.map(mat => {
          if (!(mat instanceof THREE.MeshStandardMaterial)) return mat
          if (renderMode === 'realistic') {
            // Same explicit-material precedence as the primary viewport: a
            // material with its own base-colour texture (an override, or an
            // authored model texture) is shown as-is.
            const realisticClass = mat.map ? 0 : classIndexForMesh(child, mat, realisticInfo, realisticMapping)
            const colourOverride = mat.map ? null : colourOverrideForMesh(child, mat, realisticInfo, realisticMapping)
            if (realisticClass > 0 || colourOverride) {
              return getRealisticVariant(
                mat, realisticClass, undefined, realisticGlassTransmission, (child.userData.ifcColorAlpha as number | undefined) ?? 1,
                colourOverride,
              )
            }
          }
          // Mode off: free the variant. One shared with the primary viewport
          // (same source material) is unused there too, since both follow
          // the same render mode setting.
          if (renderMode !== 'realistic') disposeRealisticVariant(mat)
          if (renderMode === 'gouraud') return getGouraudVariant(mat)
          if (renderMode === 'hiddenLine') return getHiddenLineMaterial(mat, HIDDEN_LINE_BASE_COLOR)
          return mat
        })
        child.material = display.length > 1 ? display : display[0]

        let edges = child.userData.edgesHelper as THREE.LineSegments | undefined
        if (wantsEdges) {
          if (!edges) {
            edges = new THREE.LineSegments(new THREE.EdgesGeometry(child.geometry), new THREE.LineBasicMaterial({ color: 0x1f2937 }))
            child.userData.edgesHelper = edges
            child.add(edges)
          }
          edges.visible = true
        } else if (edges) {
          edges.visible = false
        }
      })
    }
  }, [clonesByOriginal, renderMode, showEdges, realisticMapping, realisticInfoVersion, realisticGlassTransmission, shadows])

  // Frees each clone set's own GPU-side batch state when it's replaced or
  // the pane closes — the cloned batch's textures/materials, its Realistic
  // companions and Edges overlay. Never the geometry, which is shared with
  // the primary viewport (sceneClone.ts's cloneBatch).
  useEffect(() => () => {
    for (const clone of clonesByOriginal.values()) {
      const batch = clone.userData.batch as BatchState | undefined
      if (!batch) continue
      clearRealisticFromBatch(batch)
      disposeClonedBatch(batch)
      const edgesBatch = clone.userData.edgesBatch as EdgesBatch | undefined
      if (edgesBatch) disposeEdgesBatch(edgesBatch)
    }
  }, [clonesByOriginal])

  // Ambient Occlusion (2026-09-01, second attempt — a first attempt the
  // same day was reverted after producing visibly broken rendering; see
  // AmbientOcclusionEffect's own header in Viewport3D.tsx for the real
  // "why" this pane's <Canvas> was missing the same gl={{...}} context
  // attributes the primary viewport already sets, now added above). Same
  // mount-once/never-unmount safety as Viewport3D.tsx's own
  // mountAmbientOcclusion — toggling via the mounted tree's own `enabled`
  // prop, not by mounting/unmounting the tree itself, is the documented-
  // safe way to flip this after the real 2026-07-25 EffectComposer
  // corruption bug (unrelated to, and already fixed before, the
  // depth-stencil blit issue that caused this pane's own first attempt to
  // fail).
  const [mountAmbientOcclusion, setMountAmbientOcclusion] = useState(ambientOcclusion)
  useEffect(() => {
    if (ambientOcclusion) setMountAmbientOcclusion(true)
  }, [ambientOcclusion])

  // Isolation visibility (2026-08-03) — re-applied whenever the clone set
  // or the resolved isolation target itself changes; a fresh clone always
  // starts fully visible (cloneSceneHierarchy copies the *source* object's
  // own current `visible`, not anything isolation-aware), so this has to
  // re-run after every re-clone, not just once.
  useEffect(() => {
    applyPaneIsolationVisibility(clonedImportedObjects, isolation, hiddenElementKeys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clonesByOriginal, isolation, hiddenElementKeys])

  const collectionOptions = useMemo(() => [...collections].sort((a, b) => a.name.localeCompare(b.name)), [collections])

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0">
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
        // 'demand' + IdleRenderDriver (2026-09-30) — same as Viewport3D's
        // own Canvas; see IdleRenderDriver.tsx's header.
        frameloop={active ? 'demand' : 'never'}
        dpr={dpr}
        // The real, root cause of "no shadow, ever" (2026-09-01) — R3F's
        // own `shadows` prop on <Canvas> is what actually sets
        // gl.shadowMap.enabled = true on the underlying WebGLRenderer
        // (confirmed live: light.shadow.map stayed null indefinitely
        // without this, regardless of every light/mesh castShadow/
        // receiveShadow flag already being correctly set — three.js never
        // allocates a shadow map at all while the renderer's own
        // shadowMap.enabled is off). Missing since this pane's original
        // 2026-07-12 creation — mirrors Viewport3D.tsx's own
        // <Canvas shadows={settings.shadows}>, which is the only reason
        // the primary viewport's shadows ever worked.
        shadows={shadows}
        camera={{ position: [8, 8, 8], up: [0, zUp ? 0 : 1, zUp ? 1 : 0], fov: fieldOfView, near: clipStart, far: clipEnd }}
        // Matches Viewport3D.tsx's own <Canvas> context attributes
        // (2026-09-01) — this pane had none of these explicitly set before,
        // defaulting to whatever R3F/three.js picks. logarithmicDepthBuffer
        // in particular affects how the GPU's depth buffer is encoded,
        // which AmbientOcclusionEffect's own depth-texture sampling reads
        // from directly — bringing this pane's context attributes in line
        // with the primary viewport's before re-attempting AO here, rather
        // than assuming its default context is equivalent. stencil/
        // preserveDrawingBuffer carried over for the same "match the known-
        // working config" reasoning, though neither is load-bearing for
        // anything this read-only pane currently does.
        gl={{ stencil: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true }}
      >
        {active && (
          <IdleRenderDriver
            dateRef={timelineDateRef}
            continuous={importedObjects.some(o => o.object.animations.length > 0)}
          />
        )}
        <CaptureCamera cameraRef={cameraRef} />
        <PaneClipping />
        <CaptureCanvas canvasRef={canvasRef} />
        <CameraSync syncRef={cameraSyncRef} cameraRef={cameraRef} controlsRef={controlsRef} disconnected={config.cameraDisconnected} />
        <ambientLight intensity={lightingForRenderMode(renderMode).ambient} />
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
          position={sunPosition} target={sunTarget} castShadow={shadows}
          intensity={lightingForRenderMode(renderMode).sun} color={lightingForRenderMode(renderMode).sunColor}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-near={0.5}
        />
        <ShadowFrustumSync lightRef={sunLightRef} controlsRef={controlsRef} modelRadius={modelRadius} sunRadius={sunRadius} />
        <RealisticGlassSync clones={clonesByOriginal.values()} enabled={renderMode === 'realistic'} />
        <PaneMovingDriver
          syncRef={cameraSyncRef}
          clones={clonesByOriginal}
          simplify={simplifyWhileOrbiting}
          glassSwap={renderMode === 'realistic' && realisticGlassTransmission}
          disconnected={config.cameraDisconnected}
        />
        <Suspense fallback={null}>
          {dynamicSky ? (
            // Real-Time Sky (2026-09-01) — same Environment-with-children
            // cubemap-capture trick as Viewport3D.tsx's own dynamicSky
            // branch; see that file's own comment for the full "why"
            // (Sky's shader hardcodes a Y-up sun-direction dot product, so
            // reorienting happens via backgroundRotation/environmentRotation
            // after capture, never a rotated <Sky> itself).
            <Environment
              resolution={256} frames={Infinity} far={2000}
              environmentIntensity={lightingForRenderMode(renderMode).environment}
              background={showEnvironmentBackground}
              backgroundRotation={zUp ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
              environmentRotation={zUp ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
            >
              <Sky sunPosition={skySunPosition} />
            </Environment>
          ) : !environmentUrl ? (
            renderMode === 'realistic' ? <RealisticEnvironment zUp={zUp} /> : <DefaultEnvironment />
          ) : (
            <Environment
              files={environmentUrl}
              environmentIntensity={lightingForRenderMode(renderMode).environment}
              background={showEnvironmentBackground}
              backgroundRotation={zUp ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
              environmentRotation={zUp ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
            />
          )}
          {showWhiteBackground && <color attach="background" args={[solidBackgroundColor]} />}
          {shadows && (
            <mesh position={groundPosition} rotation={groundRotation} receiveShadow>
              <planeGeometry args={[groundSize, groundSize]} />
              <shadowMaterial transparent opacity={0.35} />
            </mesh>
          )}
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
            renderMode={renderMode}
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
          {showGrid && (
            <group rotation={axisCorrectionRotation('y', upAxis)}>
              <Grid args={[40, 40]} cellColor="#d1d5db" sectionColor="#9ca3af" fadeDistance={40} infiniteGrid />
            </group>
          )}
        </Suspense>
        <OrbitControls ref={controlsRef} makeDefault up={[0, zUp ? 0 : 1, zUp ? 1 : 0]} />
        {mountAmbientOcclusion && (
          <Suspense fallback={null}>
            {/* boostQuality always false (2026-09-01) — that flag only ever
                exists to raise AO sample counts during a capture/export's
                resolution boost (Viewport3D.tsx's own `highQuality`); this
                pane has no capture/export of its own. */}
            <AmbientOcclusionEffect enabled={ambientOcclusion} boostQuality={false} modelRadius={modelRadius} />
          </Suspense>
        )}
      </Canvas>
      {radialCharts.map(chart => (
        <RadialChartHud
          key={chart.id}
          chart={chart}
          activities={hudActivities}
          matchingIds={radialChartMatchingIds.get(chart.id) ?? new Set()}
          timelineDateRef={timelineDateRef}
          containerRef={containerRef}
          onCommitPosition={onCommitRadialChartPosition}
        />
      ))}
      {timelineStrips.map(strip => (
        <TimelineStripHud
          key={strip.id}
          strip={strip}
          activities={hudActivities}
          matchingIds={timelineStripMatchingIds.get(strip.id) ?? new Set()}
          timelineDateRef={timelineDateRef}
          containerRef={containerRef}
          onCommitPosition={onCommitTimelineStripPosition}
        />
      ))}
    </div>
  )
}
