import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment, Grid, GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Activity } from '@/modules/scheduling/types'
import { DEFAULT_ANIMATION_CONFIG, type AnimationProfile } from './animationProfiles'
// Type-only — see ifcModel.ts's own header + IfcDataPanel.tsx's matching
// note: the real getExpressIdFromGuid is dynamic-import()ed inside
// TimelinePlayback's resolution effect below, so web-ifc's real weight
// isn't in the main bundle at all until an IFC file is actually imported —
// a static value import here would defeat that (and did, briefly: pulled
// web-ifc into the main chunk, ~2.95MB -> 6.6MB, before this fix).
import type { IfcModelHandle } from './ifcModel'
import { getSplitExpressId } from './elementSplitTargets'
import type { ModelElementLink } from './modelElementLinks'
import { computeAppliedAnimationStateAt, interpolateKeyframeTrack, pickActiveLink, type AppliedAnimationState, type ResolvedTimelineLink } from './timelinePlayback'
import type { ElementKeyframe, KeyframeField } from './elementKeyframes'
import type { ViewerSettings } from './viewerSettings'
import type { GizmoMode } from './TransformPanel'
import type { CustomTextureSet } from './customTextures'
import { axisCorrectionRotation, resolveDisplayAxis, type UpAxis } from './upAxis'
import { getOriginalGeometry, getOriginalMaterialSlots } from './elementBaseline'
// Real (non-type-only) import, unlike ifcModel.ts above — elementBatching.ts
// has zero web-ifc dependency of its own (see its own header), so importing
// ensureMaterialized/BatchState here doesn't reintroduce the ~2.95MB->6.6MB
// bundle regression the IfcModelHandle type-only import above exists to
// avoid.
import { ensureMaterialized, getBatchedInstanceInfo, getExpressIdWorldBounds, getMaterializedMeshes, materializeAll, type BatchState } from './elementBatching'
import { attachPreservingWorldTransform, detachToSceneRoot } from './elementRigging'
import type { ElementParent } from './elementParents'
import { MAX_TOTAL_SUBDIVIDED_TRIANGLES, subdivideGeometry, triangleCount } from './geometrySubdivision'
import { clearClonedRenderModeVariantCache, getGouraudVariant, getHiddenLineMaterial, HIDDEN_LINE_BASE_COLOR } from './renderModeMaterials'
import { ViewportErrorBoundary } from './ViewportErrorBoundary'
import { computeWorldClipPlanes } from './sectionBoxGeometry'
import type { SectionBoxBounds, SectionBoxRotation } from './sectionBoxes'
import { SectionBoxGizmos } from './SectionBoxGizmo'
import type { SectionBoxTool } from './SectionBoxPanel'
import { SectionBoxCaps } from './SectionBoxCap'
import type { CameraViewPose } from './cameraViews'
import { loadRenderCaptureSettings, saveRenderCaptureSettings, type RenderCaptureSettings } from './renderCaptureSettings'
import { RenderCaptureSettingsPopover } from './RenderCaptureSettingsPopover'
import { PathGizmos, PathAddPointCatcher } from './PathGizmo'
import type { Path, PathPoint } from './paths'
import type { PathFollower } from './pathFollowers'
import { buildPathCurve, pointAtProgress, tangentAtProgress } from './pathCurve'
import type { Annotation, AnnotationKind } from './annotations'
import { AnnotationMarker } from './AnnotationMarker'
import type { IfcUnitDisplay } from './ifcUnitDisplay'
import { MeasurementCatcher, type MeasurementHit } from './MeasurementGizmo'
import { MeasurementHoverIndicator, MeasurementMarkers, MeasurementPreview } from './MeasurementMarker'
import type { Measurement, MeasurementPoint } from './measurements'
import type { MeasuringTool } from './MeasurementsPanel'

export interface ImportedObject {
  id: string
  kind: 'ifc' | 'mesh'
  // Chosen per-object at import time (ImportModelDialog.tsx), not inferred
  // from kind — see upAxis.ts's axisCorrectionRotation for why. What
  // convention the file's own geometry was actually authored in.
  sourceUpAxis: UpAxis
  object: THREE.Object3D
  visible: boolean
  // The imported file's own name (2026-07-12, added for element-parent
  // rigging resolution in ModelObjects below — the raw THREE.Object3D's
  // own `.name` isn't reliable for this: ifcModel.ts sets it to the
  // filename, but import3d.ts never sets it at all for a mesh-kind import,
  // leaving whatever a GLTF/OBJ/FBX loader happened to name its own root
  // scene node). Same filename identity ElementParent/PathFollower/
  // ModelElementLink's own element_ref already uses.
  name: string
}

// A scene object as FourD.tsx itself models it — richer than ImportedObject
// above (which is just what ModelObjects needs to render). TimelinePlayback
// below needs `name`/`kind` too, to resolve a mesh-kind ModelElementLink's
// element_ref (a filename) back to the actual object.
export interface TimelineSceneObject {
  id: string
  name: string
  kind: 'ifc' | 'mesh'
  object: THREE.Object3D
}

// A SectionBox (sectionBoxes.ts) resolved against whichever ImportedObject
// its own model3d_file_id currently corresponds to (2026-07-09, per Maro's
// Blender "Section Box" reference) — FourD.tsx does that join (a
// SectionBox only knows its backend Model3DFile id, not the session-local
// ImportedObject.id the viewport actually keys off), and boxes whose
// target isn't currently loaded are simply left out, since there's nothing
// to clip.
export interface ResolvedSectionBox {
  id: string
  sceneObjectId: string
  active: boolean
  // Set only for an element-scoped box (SectionBox.element_ref resolved to
  // this specific model's own expressID, 2026-07-09 per-element scoping)
  // — undefined means whole-object scope, applied to every mesh under
  // sceneObjectId's own object. FourD.tsx resolves the GlobalId->expressID
  // lookup (async, needs web-ifc) before a box ever reaches here, so
  // nothing downstream (ModelObjects, SectionBoxGizmo) needs to touch
  // ifcModel.ts at all — they just match this against each mesh's own
  // `userData.expressID`, exactly like every other expressID-keyed lookup
  // already in this file.
  elementExpressId?: number
  // Whether the wireframe/drag gizmo itself is shown (2026-07-09) —
  // independent of `active` (clipping can be on with the gizmo hidden, or
  // vice versa), matching the reference's own checkbox-vs-eye distinction.
  visible: boolean
  bounds: SectionBoxBounds
  // The box's own additional rotation on top of bounds' axis-aligned extent
  // (2026-07-17, per Maro: "I'd like to rotate the bounding box") — see
  // sectionBoxPivotMatrix's own header (sectionBoxGeometry.ts) for how this
  // and bounds combine.
  rotation: SectionBoxRotation
}

// Ambient occlusion (2026-07-09, per Maro — N8AO via
// @react-three/postprocessing, chosen per this session's own research:
// mature, actively maintained, same pmndrs family as drei already a
// dependency here). Lazy-loaded, same "keep it out of the main bundle"
// discipline this file already applies to web-ifc — `postprocessing` +
// `n8ao` together added ~100kb gzipped to the main chunk, for a toggle
// that's off by default (see viewerSettings.ts's own ambientOcclusion
// default) and may never be turned on in a given session.
// aoSamples/denoiseSamples (2026-07-11) — real, verified quality knobs on
// N8AO's own underlying pass (checked directly in
// node_modules/@react-three/postprocessing's N8AOPostPass source, not
// assumed): defaults are 16/8, boosted to 64/32 while genuinely idle — see
// this file's own boostQuality state/comment for the "real-time path
// tracer, scoped down" reasoning this serves.
// intensity dropped 2 -> 0.8 (2026-07-21, per Maro: "the dark ring is
// unrealistic" — confirmed live: at 2, N8AO's contact occlusion around a
// small object sitting on a larger face reads as a hard omnidirectional
// dark halo, not a soft, physically-plausible occlusion, regardless of the
// sun's own direction). Also confirmed live: this ring only shows for
// Flat Shaded/Rendered — it's absent for Gouraud/Hidden Line, where a
// still-batched element's material is swapped to a Lambert/Basic variant
// (see the "Render mode" fix a few hundred lines down in this same file);
// root cause not yet pinned down (N8AO derives its AO from the depth
// buffer, not per-object material, so the correlation is real but not
// yet explained). Left as a known, deliberately unchased gap per Maro —
// AO/Shadows are both off by default and not something this project
// currently relies on; worth a real diagnostic pass (same evidence-first
// approach as the isolate/dope-sheet fixes elsewhere in this file) only if
// that changes.
const AmbientOcclusionEffect = lazy(() =>
  import('@react-three/postprocessing').then(({ EffectComposer, N8AO }) => ({
    default: ({ boostQuality }: { boostQuality: boolean }) => (
      <EffectComposer enableNormalPass>
        <N8AO
          aoRadius={1} intensity={0.8} distanceFalloff={1}
          aoSamples={boostQuality ? 64 : 16} denoiseSamples={boostQuality ? 32 : 8}
        />
      </EffectComposer>
    ),
  })),
)

// Self-hosted default environment (2026-07-11, per Maro — replaces the
// earlier RoomEnvironment/drei-CDN-preset fallback: "copy and save it in
// our files for default load out"). Served straight from Vite's public/
// dir, same self-hosting precedent as ifcModel.ts's WASM — no CDN, no
// network dependency beyond our own server. A partly-cloudy outdoor sky,
// so — unlike the old "apartment" preset — it's actually a sensible
// backdrop too (see DEFAULT_VIEWER_SETTINGS.environmentBackground).
export const DEFAULT_ENVIRONMENT_URL = '/hdr/kloofendal_48d_partly_cloudy_puresky_4k.hdr'

interface Props {
  settings: ViewerSettings
  importedObjects: ImportedObject[]
  selectedExpressId: number | null
  selectedExpressIds: Set<number>
  onSelect: (expressID: number | null, additive?: boolean, objectId?: string) => void
  activeObjectId: string | null
  selectedObjectIds: Set<string>
  onSelectObject: (id: string | null, additive?: boolean) => void
  // objectIds/expressIdsByObject: same convention as onBoxSelect below —
  // Select All used to only ever select whole objects, silently skipping
  // every IFC sub-element (2026-07-17, per Maro: "selecting all only
  // selects the object not the elements... I care about elements"). Now
  // resolves the same way box-select's own IFC branch does: every visible
  // element of every visible ifc-kind import, not just the model as a whole.
  onSelectAll: (objectIds: string[], expressIdsByObject: Map<string, number[]>) => void
  // Owned by FourD.tsx, not locally (2026-07-22) — see TimelinePlayback's
  // own materializeVersion prop header for the full "Select All leaves the
  // whole model stuck fully visible" story. FourD.tsx also has its own
  // model-wide materializeAll call sites entirely outside this component
  // (section box multi-select bounds, Select Linked (material)) that need
  // the exact same re-derive trigger — a single counter owned one level up
  // is simpler than three independent ones, and correctly covers every
  // caller of materializeAll, not just this file's own Select All button.
  materializeVersion: number
  onMaterializeAll: () => void
  // Select Unassigned (2026-07-15, per Maro: "pick elements that havent
  // been 4d linked to an activity yet") — linkedObjectIds is which whole
  // mesh-kind objects already have a ModelElementLink; linkedElementKeys is
  // the composite `${objectId}::${expressID}` set for already-linked IFC
  // sub-elements (FourD.tsx resolves both once, the same way
  // varianceByElementKey's own ifcLinkKeys already does, rather than
  // re-resolving GlobalId->expressID here). Replaces the current selection
  // (same convention as onSelectAll) rather than adding to it — it's a
  // toolbar action, not a drag gesture.
  linkedObjectIds: Set<string>
  linkedElementKeys: Set<string>
  onSelectUnassigned: (objectIds: string[], expressIdsByObject: Map<string, number[]>) => void
  // objectIds: whole-object matches (mesh-kind imports, which have no finer
  // sub-element concept). expressIdsByObject: individual IFC sub-elements
  // matched *within* an ifc-kind import, keyed by that import's object id —
  // box-select now hit-tests each element's own bounds inside an IFC model
  // rather than only the model's aggregate bounding box (2026-07-14, per
  // Maro: "boc select doesnt select elements, just object"), matching the
  // granularity a single click on an IFC mesh already gives via onSelect's
  // own expressID.
  onBoxSelect: (objectIds: string[], expressIdsByObject: Map<string, number[]>) => void
  // Isolate Selected / Show All (2026-07-08, per Maro: "isolate selected,
  // show view focus on selected, show all") — isolateMode is FourD.tsx
  // state (not local to this component) since it also has to affect
  // top-level object visibility, computed there via the same `visible` prop
  // hiddenIds already drives (see importedObjects' own construction).
  // onShowAll clears isolateMode *and* hiddenIds together — the universal
  // "just show me everything" escape hatch, regardless of which of the two
  // hid something.
  isolateMode: boolean
  // Frozen snapshot of what was selected the moment Isolate switched on
  // (2026-07-09 fix) — see FourD.tsx's own isolatedObjectIds/isolatedExpressIds
  // state comment and ModelObjects' matching prop comment for the full story.
  isolatedObjectIds: Set<string>
  isolatedExpressIds: Set<number>
  // Hide-by-sub-element (2026-07-11, for Collections) — an IFC sub-element
  // hidden independent of isolate mode, e.g. one door hidden out of a
  // Collection while the rest of its model stays visible. Composite
  // `${objectId}::${expressID}` keys, NOT a flat Set<number> the way
  // isolatedExpressIds/selectedExpressIds are — expressIDs are only unique
  // within one loaded IFC model, so a flat set would collide across two
  // federated models sharing the same expressID number (a real, pre-
  // existing gap in those two, not worth propagating into a new one).
  // Mirrors ModelObjects' own elementKey convention below exactly.
  hiddenExpressIds: Set<string>
  onToggleIsolate: () => void
  onShowAll: () => void
  // Hide Selected (2026-07-15, per Maro) — pushes the current selection
  // into FourD.tsx's own hiddenIds/hiddenExpressIds (it owns that state,
  // same "just hand over a ready callback" split as onToggleIsolate/
  // onShowAll above), rather than replacing what's visible the way Isolate
  // does — additive, so hiding a second batch doesn't un-hide the first.
  onHideSelected: () => void
  // "Linked Activities" widget (2026-07-09, per Maro) — pre-built by
  // FourD.tsx (it owns the async activity-link resolution) and just handed
  // over as a ready-made node to render alongside the Isolate/Show All
  // toolbar; LinkedActivitiesWidget.tsx itself already renders nothing when
  // there's nothing to show, so this is unconditionally placed here.
  linkedActivitiesWidget: React.ReactNode
  gizmoMode: GizmoMode
  onTransformChange: () => void
  environmentUrl: string | null
  onEnvironmentError: (message: string) => void
  customTextures: Record<string, CustomTextureSet>
  // 4D timeline playback (2026-07-11) — see TimelinePlayback below and
  // timelinePlayback.ts's own header. timelineDate is a ref, not React
  // state/props in the usual sense — TimelineWindow.tsx mutates it every
  // animation frame while playing, and useFrame here reads it independently
  // every render frame, deliberately bypassing React's own render cycle for
  // this hot path (same reasoning as TransformPanel's direct-object-mutation
  // approach elsewhere in this module).
  timelineDateRef: React.MutableRefObject<Date | null>
  timelineSceneObjects: TimelineSceneObject[]
  timelineActivities: Activity[]
  timelineLinks: ModelElementLink[]
  timelineProfiles: AnimationProfile[]
  timelineElementKeyframes: ElementKeyframe[]
  // Video export's own playback range (2026-07-10) — same timelineRange
  // FourD.tsx already hands to TimelineWindow.tsx, so export always covers
  // exactly what the timeline scrubber itself covers. null (no schedulable
  // activities/keyframes yet) just disables the Export Video button.
  scheduleStart: Date | null
  scheduleEnd: Date | null
  // Every currently-loaded IFC model (2026-07-09, per federated/assembly
  // modeling — "allow me to import more than one IFC model... currently
  // loading another replaces what i have") — was a single IfcModelHandle |
  // null; every consumer that used to assume "the" one handle now searches
  // across this whole list instead (see TimelinePlayback's own resolve()
  // and this component's own activeObject resolution below).
  ifcHandles: IfcModelHandle[]
  // Section Box (2026-07-09, per Maro's Blender reference) — passed
  // straight through to ModelObjects, which does the actual per-mesh
  // clippingPlanes assignment. See ResolvedSectionBox's own header.
  sectionBoxes: ResolvedSectionBox[]
  // Live-drag/commit for the 6-face gizmo (SectionBoxGizmo.tsx, 2026-07-09)
  // — onSectionBoxDragMove fires on every pointer-move with a *local*
  // preview only (FourD.tsx overrides just that one box's bounds for the
  // live clip-plane feedback, nothing persisted yet); onSectionBoxDragEnd
  // fires once on release with the final bounds, which is what actually
  // gets PATCHed.
  onSectionBoxDragMove: (boxId: string, bounds: SectionBoxBounds) => void
  onSectionBoxDragEnd: (boxId: string, bounds: SectionBoxBounds) => void
  // Same live-drag/commit split as onSectionBoxDragMove/End above, for the
  // rotate gizmo (2026-07-17, per Maro: "I'd like to rotate the bounding
  // box").
  onSectionBoxRotateMove: (boxId: string, rotation: SectionBoxRotation) => void
  onSectionBoxRotateEnd: (boxId: string, rotation: SectionBoxRotation) => void
  sectionBoxTool: SectionBoxTool
  // Camera Views (2026-07-10, per Maro: "add camera too so i can capture
  // the model at different angles like blender") — onSaveCameraView is a
  // plain callback (this component reads the live camera/controls and
  // hands the pose up; FourD.tsx does the actual POST). Applying a saved
  // view is the reverse direction (parent telling this component to *do*
  // something), which plain props can't express as a one-off action the
  // way a callback can — applyCameraViewRequest is a "command" prop
  // instead: a new object (nonce bumped) each time FourD.tsx wants a view
  // applied, watched by a useEffect below. Deliberately not a full
  // forwardRef/useImperativeHandle setup (the more common way to expose
  // imperative actions to a parent) — this component's already large, and
  // a changing-prop-as-command needs no change to its own export shape.
  onSaveCameraView: (pose: CameraViewPose, thumbnailDataUrl: string | null) => void
  applyCameraViewRequest: { pose: CameraViewPose; nonce: number } | null
  // 4D Video persistence (2026-07-20, per Maro: a dashboard widget to "open
  // one of the videos 4d sequence vids we've captured") — Export Video
  // still downloads locally exactly as before (unchanged, no regression);
  // this additionally hands the recorded Blob up to FourD.tsx so it can be
  // uploaded and picked from later, same "callback up, parent does the
  // actual persistence" split onSaveCameraView already uses.
  onExportVideo?: (blob: Blob, durationSec: number) => void
  // Paths / Follow Path (2026-07-11, per Maro's Blender curve reference —
  // see path.py/path_follower.py's own docstrings). paths/pathFollowers are
  // project-scoped, passed straight through like sectionBoxes above.
  // addingPointsForPathId arms PathAddPointCatcher for exactly one path at a
  // time (PathsPanel.tsx's own "+ Point" toggle) — null means click-to-add
  // is off and ordinary selection/box-select behave as before.
  paths: Path[]
  pathFollowers: PathFollower[]
  addingPointsForPathId: string | null
  onPathDragMove: (pathId: string, points: PathPoint[]) => void
  onPathDragEnd: (pathId: string, points: PathPoint[]) => void
  onAddPathPoint: (pathId: string, point: PathPoint) => void
  // Annotations — Placemark/Footnote (2026-07-12, per Maro's Navisworks
  // reference screenshot). Reuses timelineDateRef/timelineActivities/
  // timelineLinks/timelineProfiles/timelineElementKeyframes above rather
  // than threading a second copy of the same data down — AnnotationMarker
  // resolves its own Mode A/B state from those directly. addingAnnotationKind
  // arms AnnotationAddCatcher (PathAddPointCatcher reused verbatim) for
  // exactly one placement, unlike Path's own continuous multi-point mode.
  annotations: Annotation[]
  addingAnnotationKind: AnnotationKind | null
  onPlaceAnnotation: (point: PathPoint) => void
  selectedAnnotationId: string | null
  onSelectAnnotation: (id: string) => void
  onAnnotationDragMove: (id: string, point: PathPoint) => void
  onAnnotationDragEnd: (id: string, point: PathPoint) => void
  // App.tsx's PersistentFourD keeps FourD mounted (CSS-hidden) rather than
  // unmounting it on navigation, so imported 3D/IFC data survives leaving
  // the tab (2026-07-11, per Maro). While hidden there's nothing to see, so
  // the Canvas drops to frameloop="never" below instead of still rendering
  // every frame into an invisible tab — the scene graph/WASM model stay
  // alive in memory (that's the actual fix), this just stops burning
  // GPU/CPU for a render nobody's looking at. Resumes instantly (no
  // Canvas/WebGL re-init) the moment this flips back to true.
  active: boolean
  // Variance colour-coding (2026-07-12) — precomputed once in FourD.tsx,
  // passed straight through to ModelObjects. See that component's own
  // Props doc comment for the elementKey convention.
  varianceByElementKey: Map<string, number>
  // Clash Detective (2026-07-12) — same treatment as varianceByElementKey
  // above, one Map keyed the identical way, precomputed once in FourD.tsx
  // from every open ClashTest's un-approved results.
  clashByElementKey: Map<string, boolean>
  // "Set Pivot" click-to-pick (2026-07-12) — arms one more
  // PathAddPointCatcher instance (reused verbatim, same as Paths/
  // Annotations already do) below; onPickPivotPoint receives the
  // world-space hit, FourD.tsx's own handlePickPivotPoint converts it into
  // the active object's local space before calling elementPivot.ts's
  // setPivot.
  pivotPicking: boolean
  onPickPivotPoint: (point: PathPoint) => void
  // Crane-style rigging (2026-07-12) — passed straight through to
  // ModelObjects, see that component's own Props doc comment.
  elementParents: ElementParent[]
  // Measure tool (2026-07-19) — see MeasurementGizmo.tsx's own header for
  // why this needs its own catcher instead of reusing PathAddPointCatcher.
  measurements: Measurement[]
  unitPreference: IfcUnitDisplay
  selectedMeasurementId: string | null
  onSelectMeasurement: (id: string) => void
  measuringTool: MeasuringTool | null
  measuringPoints: MeasurementPoint[]
  measuringToMetres: number
  onMeasurementHit: (hit: MeasurementHit) => void
  measurementHoverPoint: MeasurementPoint | null
  onMeasurementHoverPoint: (point: MeasurementPoint | null) => void
}

const SELECTED_EMISSIVE = new THREE.Color(0x2563eb)
// Reused every frame by TimelinePlayback's own material diff below —
// avoids allocating a fresh THREE.Color per material per frame just to
// compare a candidate colour against what's already applied.
const _scratchColor = new THREE.Color()
// Reused every frame by TimelinePlayback's own transform diff below
// (2026-07-21 perf fix) — see that diff's own header for why.
const _scratchPosition = new THREE.Vector3()
const _scratchScale = new THREE.Vector3()
const _scratchEuler = new THREE.Euler()
// Variance colour-coding (2026-07-12, per Maro: "Colour coded elements by
// variance") — reuses the Scheduling module's own already-working
// baseline feature (Activity.variance_days, set once a baseline is
// assigned via "Assign Baseline" there) rather than building a second one
// here. Red = behind (finished later than baselined), green = ahead —
// magnitude-capped at VARIANCE_MAGNITUDE_CAP_DAYS so one wildly slipped
// activity doesn't fully flatten its element to a solid colour, and
// blended at a lighter weight than the real selection tiers above so
// selecting a variance-tinted element still reads clearly on top of it.
const VARIANCE_LATE_COLOR = new THREE.Color(0xef4444)
const VARIANCE_EARLY_COLOR = new THREE.Color(0x22c55e)
const VARIANCE_MAGNITUDE_CAP_DAYS = 30
const VARIANCE_MAX_LERP = 0.5
// Clash Detective (2026-07-12, per Maro's Navisworks reference screenshot)
// — flat red, not magnitude-scaled like variance above: a clash is binary
// (an element either has an un-approved clash right now or it doesn't),
// there's no equivalent of "days late" to scale the tint by. A stronger
// lerp than variance's own 0.5 cap so a clash reads unambiguously even on
// an already variance-tinted element.
const CLASH_COLOR = new THREE.Color(0xdc2626)
const CLASH_LERP = 0.65

// Applies the render-mode/visibility/shadow settings to every mesh under an
// imported object, and tints whichever mesh carries the currently-selected
// expressID (2026-07-10, per Maro) — re-run whenever settings/selection
// change, not just once on import.
function ModelObjects({
  objects, settings, selectedExpressId, selectedExpressIds, selectedObjectIds, onSelect, onSelectObject, customTextures,
  boxSelectMode, isolateMode, isolatedObjectIds, isolatedExpressIds, hiddenExpressIds, sectionBoxes,
  varianceByElementKey, clashByElementKey, elementParents,
}: {
  objects: ImportedObject[]; settings: ViewerSettings; selectedExpressId: number | null
  selectedExpressIds: Set<number>
  selectedObjectIds: Set<string>
  onSelect: (expressID: number | null, additive?: boolean, objectId?: string) => void
  onSelectObject: (id: string | null, additive?: boolean) => void
  customTextures: Record<string, CustomTextureSet>
  boxSelectMode: boolean
  // Every currently-loaded, active Section Box, already resolved against
  // whichever ImportedObject it targets (2026-07-09, per Maro) — see
  // ResolvedSectionBox's own header.
  sectionBoxes: ResolvedSectionBox[]
  // Isolate Selected (2026-07-08, per Maro: "isolate selected, show view
  // focus on selected, show all") — hides every non-isolated sub-element
  // within an IFC model while isolating (object-level isolation, an entire
  // mesh-kind import shown/hidden as a whole, is handled a level up in
  // FourD.tsx via the same `visible` prop hiddenIds already uses; this only
  // covers the finer IFC sub-element case, since that's the one granularity
  // ImportedObject's `visible` can't express on its own).
  isolateMode: boolean
  // A *frozen snapshot* of selectedObjectIds/selectedExpressIds taken the
  // moment Isolate switched on (2026-07-09 fix, per Maro: "if i click a
  // random position where an element that's hidden is. it reveals and
  // isolates that one instead. I dont want that") — deliberately separate
  // from the live selectedObjectIds/selectedExpressIds above (still used
  // for the selection *tint*, which should keep reacting to clicks
  // normally even while isolating) so a later click can't silently swap out
  // what's isolated. See FourD.tsx's own isolatedObjectIds/isolatedExpressIds
  // state comment for the full story.
  isolatedObjectIds: Set<string>
  isolatedExpressIds: Set<number>
  // See Viewport3D's own top-level Props doc comment on hiddenExpressIds —
  // same composite-key set, threaded straight through.
  hiddenExpressIds: Set<string>
  // Variance colour-coding (2026-07-12) — precomputed once in FourD.tsx
  // from modelElementLinks+activities, same elementKey convention
  // customTextures already uses (whole object id for mesh-kind, or
  // `${id}::${expressID}` for a specifically-linked IFC sub-element).
  // Toggled via settings.showVarianceColors (ViewerSettings), not a
  // separate prop — one more render-affecting viewer setting, same as
  // showEdges/shadows/ambientOcclusion above it.
  varianceByElementKey: Map<string, number>
  // Clash Detective (2026-07-12) — same elementKey convention, toggled via
  // settings.showClashColors alongside showVarianceColors above it.
  clashByElementKey: Map<string, boolean>
  // Crane-style rigging (2026-07-12) — see elementRigging.ts's own header.
  // Mesh-kind only (child/parent are both filename element_refs), resolved
  // against `objects` below the same way every other loose-ref relationship
  // in this file already is.
  elementParents: ElementParent[]
}) {
  const upAxis = settings.upAxis

  // Reparents/un-parents live Object3Ds to match elementParents whenever
  // the loaded object set or the rig relationships themselves change
  // (2026-07-12) — mirrors PathFollower's own resolution effect further
  // down this file (element_ref -> live object, re-resolved on every
  // relevant change) but drives real three.js scene-graph structure
  // instead of a per-frame animation apply, so it belongs here next to the
  // mount loop it directly feeds rather than inside TimelinePlayback.
  // riggedChildIdsRef tracks what was actually rigged as of the *previous*
  // run of this effect specifically so a row that disappears (deleted, or
  // its target unloaded) gets properly detached rather than just silently
  // left parented wherever it last was.
  const riggedChildIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const nextRigged = new Set<string>()
    for (const ep of elementParents) {
      const child = objects.find(o => o.kind === 'mesh' && o.name === ep.child_element_ref)
      const parent = objects.find(o => o.kind === 'mesh' && o.name === ep.parent_element_ref)
      if (!child || !parent) continue
      nextRigged.add(child.id)
      if (child.object.parent !== parent.object) {
        attachPreservingWorldTransform(child.object, parent.object)
      }
    }
    for (const o of objects) {
      if (riggedChildIdsRef.current.has(o.id) && !nextRigged.has(o.id)) {
        detachToSceneRoot(o.object, o.sourceUpAxis, upAxis)
      }
      // A rigged child skips the <primitive visible={...}> mount below
      // entirely, so hide/isolate's own `visible` flag (FourD.tsx's
      // hiddenIds/isolateMode) needs applying here instead — the one thing
      // that JSX prop would otherwise have done for it. Harmless no-op
      // duplication for a root object, which still gets it from the prop
      // too.
      if (nextRigged.has(o.id)) o.object.visible = o.visible
    }
    riggedChildIdsRef.current = nextRigged
  }, [objects, elementParents, upAxis])

  // Same resolution as the effect above, computed at render time (cheap —
  // just two `.find()` calls per relationship) rather than read off the
  // ref, so the mount loop below reacts to a *new* elementParents row on
  // the very same render it arrives, not one render later once the effect
  // above has caught up. Only gates which objects get their own top-level
  // <primitive> mount (rootObjects, further below) — the settings/tint
  // pass right after this stays on the full `objects` list, since a rigged
  // child still needs its own material/render-mode handling even though
  // it's no longer separately mounted.
  const riggedChildIds = new Set(
    elementParents
      .map(ep => ({
        child: objects.find(o => o.kind === 'mesh' && o.name === ep.child_element_ref),
        parent: objects.find(o => o.kind === 'mesh' && o.name === ep.parent_element_ref),
      }))
      .filter(r => r.child && r.parent)
      .map(r => r.child!.id),
  )
  const rootObjects = objects.filter(o => !riggedChildIds.has(o.id))

  // Selection-only scoping (2026-07-15, per Maro: "its very laggy... this
  // model only had 5k plus elements and its struggling") — this effect used
  // to redo its *entire* per-mesh pass (subdivision, texture overrides,
  // variance/clash colour, render-mode variant sync, edges) for every mesh
  // in the loaded model(s) on every single click, because a click changes
  // selectedExpressId/selectedExpressIds/selectedObjectIds, which are (and
  // have to stay) real effect deps. On a real structural/architectural file
  // that's thousands of meshes (one THREE.Mesh per *geometry piece*, not
  // per element — ifcModel.ts's own loadIfcModel — so "5k elements" is
  // often 10-20k actual meshes) getting fully recomputed for a change that
  // only ever affects a handful of them.
  //
  // heavyDepsRef holds the previous run's *references* for every input
  // this effect reads besides selection itself. Reference (not deep)
  // equality is deliberate and safe in both directions: these are either
  // useMemo'd (varianceByElementKey/clashByElementKey) or only ever
  // replaced wholesale on a real change (objects, customTextures) in
  // FourD.tsx, so an unchanged input reliably keeps the same reference —
  // but if that assumption is ever wrong for some future input, the only
  // failure mode is falling back to a full pass (heavyChanged stays true),
  // never a wrongly-skipped mesh.
  const heavyDepsRef = useRef<unknown[] | null>(null)
  const prevSelectionRef = useRef<{ expressId: number | null; expressIds: Set<number>; objectIds: Set<string> }>({
    expressId: null, expressIds: new Set(), objectIds: new Set(),
  })

  useEffect(() => {
    const heavyDeps = [
      objects, settings.showFaces, settings.renderMode, settings.showEdges, settings.showVarianceColors,
      settings.showClashColors, settings.shadows, upAxis, customTextures, isolateMode, isolatedObjectIds,
      isolatedExpressIds, hiddenExpressIds, varianceByElementKey, clashByElementKey,
    ]
    const heavyChanged = heavyDepsRef.current === null
      || heavyDeps.length !== heavyDepsRef.current.length
      || heavyDeps.some((v, i) => v !== heavyDepsRef.current![i])
    heavyDepsRef.current = heavyDeps

    // Symmetric difference against the previous run's selection — every
    // expressID/objectId whose *membership* actually flipped, plus (since
    // it drives its own distinct emissive tier, isExpressSelected vs
    // isExpressAlsoSelected below) the old and new `selectedExpressId`
    // even when both were already members of `selectedExpressIds`. Only
    // meaningful when heavyChanged is false — a full pass touches
    // everything regardless, so there's no need to compute this otherwise.
    const prevSel = prevSelectionRef.current
    const touchedExpressIds = new Set<number>()
    const touchedObjectIds = new Set<string>()
    if (!heavyChanged) {
      if (selectedExpressId !== prevSel.expressId) {
        if (selectedExpressId !== null) touchedExpressIds.add(selectedExpressId)
        if (prevSel.expressId !== null) touchedExpressIds.add(prevSel.expressId)
      }
      for (const eid of selectedExpressIds) if (!prevSel.expressIds.has(eid)) touchedExpressIds.add(eid)
      for (const eid of prevSel.expressIds) if (!selectedExpressIds.has(eid)) touchedExpressIds.add(eid)
      for (const oid of selectedObjectIds) if (!prevSel.objectIds.has(oid)) touchedObjectIds.add(oid)
      for (const oid of prevSel.objectIds) if (!selectedObjectIds.has(oid)) touchedObjectIds.add(oid)
    }
    prevSelectionRef.current = { expressId: selectedExpressId, expressIds: new Set(selectedExpressIds), objectIds: new Set(selectedObjectIds) }

    // Scene-wide displacement-subdivision budget for this pass (2026-07-11,
    // per Maro, mindful it "may lag our platform if abused" — see
    // geometrySubdivision.ts's own header on why a per-mesh cap alone isn't
    // enough: Apply to Linked can push one subdivision choice onto every
    // element sharing a material at once). Decremented below as each
    // subdivided mesh is encountered, cached or freshly computed alike —
    // once it hits 0, any further mesh that would want subdivision falls
    // back to its own unsubdivided geometry instead (displacement still
    // applies, just coarser), rather than letting the scene's total
    // triangle count grow without bound.
    // NOTE: on a selection-only pass (heavyChanged false), skipped meshes
    // don't re-decrement this — their own subdivision state is untouched
    // either way, so the only soft consequence is the budget check for
    // whichever *few* meshes do get touched this pass not accounting for
    // subdivided triangles already committed by meshes sitting this pass
    // out. Displacement+subdivision is a niche feature; an occasional
    // slightly-generous budget on a selection-only pass is an accepted
    // trade for not walking every mesh on every click.
    // Shared by both the heavy full-batch pass and the cheap touched-only
    // pass below (2026-07-21) — recomputes and writes exactly one batched
    // element's own highlight colour, given whichever expressIDs the
    // caller has decided need it this render. Reads selectedExpressId/
    // selectedExpressIds directly off this effect's own closure (same as
    // every other selection check in this file), not passed as params.
    const applyBatchSelectionColour = (batch: BatchState, expressIDs: number[]) => {
      const isBatchExpressSelected = selectedExpressId !== null && batch.byExpressId.has(selectedExpressId)
      for (const expressID of expressIDs) {
        const infos = batch.byExpressId.get(expressID)
        if (!infos) continue
        // Same two tiers as the individual-mesh path's own
        // isExpressSelected/isExpressAlsoSelected (a stronger lerp for the
        // one primary/only selected element, a lighter one for "also
        // selected" — several picked together via Select by Type, the
        // actually-common case for a still-batched element).
        const isExpressSelected = isBatchExpressSelected && expressID === selectedExpressId
        const isExpressAlsoSelected = selectedExpressIds.has(expressID)
        const lerpAmount = isExpressSelected ? 0.6 : isExpressAlsoSelected ? 0.35 : 0
        for (const info of infos) {
          if (lerpAmount > 0) {
            _scratchColor.copy(info.color).lerp(SELECTED_EMISSIVE, lerpAmount)
            batch.mesh.setColorAt(info.instanceId, _scratchColor)
          } else {
            batch.mesh.setColorAt(info.instanceId, info.color)
          }
        }
      }
    }

    let remainingSubdivisionBudget = MAX_TOTAL_SUBDIVIDED_TRIANGLES
    for (const { id, kind, object } of objects) {
      const isObjectSelected = selectedObjectIds.has(id)
      const isObjectIsolated = isolatedObjectIds.has(id)
      // Isolating with at least one specific sub-element in the frozen
      // snapshot narrows to just those; isolating a whole-object selection
      // with nothing more specific picked shows every sub-element of that
      // object instead (see this component's own isolateMode doc comment
      // above).
      const isolatingSubElements = isolateMode && kind === 'ifc' && isolatedExpressIds.size > 0
      // Skip this whole object's traversal outright on a selection-only
      // pass if neither it nor anything specific within it changed
      // selection membership — the cheapest possible skip, before even
      // walking its mesh tree.
      if (!heavyChanged && !touchedObjectIds.has(id) && touchedExpressIds.size === 0) continue
      const batchMeshForSkip = object.userData.batch as BatchState | undefined
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        // The shared BatchedMesh itself (2026-07-21 fix, per Maro: "not
        // selecting and not isolating, i dont see the highlight color
        // change" — reproduced live: per-instance visibility was correct
        // (visibleCount matched isolatedExpressIds exactly) but nothing
        // rendered because THREE.BatchedMesh extends THREE.Mesh, so this
        // traverse — meant only for real, individual IFC element meshes —
        // was also walking straight into the batch mesh itself. It has no
        // userData.expressID of its own, so the generic per-mesh formula
        // below (isolatedOut checks isolatedExpressIds.has(expressID),
        // undefined never matches) always decided it "isn't part of the
        // isolated set" and set the *entire batch's* own top-level
        // `.visible = false` — hiding every still-batched element
        // regardless of how correctly the dedicated batch-visibility block
        // below had just set each one's own per-instance flag. The batch
        // mesh's visibility is entirely that dedicated block's job, same
        // "owns its own lifecycle" reasoning as the isSplitPreview skip
        // just below.
        if (child === batchMeshForSkip?.mesh) return
        // Split-by-level's own live preview planes (SplitByLevelPanel.tsx)
        // are plain MeshBasicMaterial quads added straight into
        // handle.object, not real IFC/split elements — this whole effect's
        // per-mesh pass assumes a MeshStandardMaterial with a real
        // expressID (selection tint, render-mode variants, clipping,
        // visibility) and would otherwise silently stomp the preview's own
        // opacity/position/visibility or set irrelevant properties on a
        // material type that doesn't have them. Left completely alone here
        // — the panel owns their full lifecycle itself.
        if (child.userData.isSplitPreview) return
        // The actual per-mesh skip (2026-07-15) — see this effect's own
        // header above. Only reached when heavyChanged is false (a real
        // selection-only pass); a mesh sits this pass out unless its own
        // expressID or its owning object's id is one of the ones whose
        // selection membership just changed, in which case every one of
        // its properties below is already correct from the last full/
        // relevant pass and touching it again would be pure waste.
        if (!heavyChanged) {
          const meshExpressId = child.userData.expressID as number | undefined
          const relevant = touchedObjectIds.has(id) || (meshExpressId !== undefined && touchedExpressIds.has(meshExpressId))
          if (!relevant) return
        }
        // Per-element override wins over the whole-object one (2026-07-09
        // fix, per Maro: "changing a material for one element still changes
        // the whole") — FourD.tsx now writes a specific IFC sub-element's
        // edit under `${objectId}::${expressID}` instead of always
        // `objectId`, so this has to actually look there first rather than
        // only ever reading the whole-object slot; ownerKey is whichever of
        // the two keys actually matched, used below to ring-fence the
        // material clone to *that* specific override rather than the
        // object as a whole.
        const elementKey = kind === 'ifc' && child.userData.expressID !== undefined ? `${id}::${child.userData.expressID}` : null
        const elementOverride = elementKey !== null ? customTextures[elementKey] : undefined
        const overrides = elementOverride ?? customTextures[id]
        const ownerKey = elementOverride ? (elementKey as string) : id

        // Displacement subdivision (2026-07-11, per Maro — see
        // geometrySubdivision.ts's own header for the full reasoning: a
        // displacement map needs more vertices than typical IFC/BREP
        // geometry has to actually show detail). The requested level lives
        // on the displacement texture's own userData (TextureFields.tsx's
        // own Subdivision field mutates it directly) rather than in
        // customTextures' own typed shape — same "read/write the live
        // object" idiom Tile Size/Rotation already use on that same
        // texture, and it means the setting travels with the texture
        // automatically (cleared/replaced together, never orphaned).
        // Cached per-mesh keyed by level so an unrelated customTextures
        // change elsewhere (a different element's Tile Size, say) doesn't
        // recompute this mesh's subdivision every single pass — only an
        // actual level change does.
        const displacementTexture = overrides?.displacementMap?.texture
        const requestedSubdivisionLevel = (displacementTexture?.userData.subdivisionLevel as number | undefined) ?? 0
        const baseGeometry = getOriginalGeometry(child)
        if (requestedSubdivisionLevel > 0) {
          let subdivided = child.userData.subdividedGeometry as THREE.BufferGeometry | undefined
          if (child.userData.subdividedLevel !== requestedSubdivisionLevel || !subdivided) {
            subdivided?.dispose()
            subdivided = subdivideGeometry(baseGeometry, requestedSubdivisionLevel)
            child.userData.subdividedGeometry = subdivided
            child.userData.subdividedLevel = requestedSubdivisionLevel
          }
          const subdividedTriangles = triangleCount(subdivided)
          const fitsInBudget = subdividedTriangles <= remainingSubdivisionBudget
          if (fitsInBudget) {
            remainingSubdivisionBudget -= subdividedTriangles
            if (child.geometry !== subdivided) child.geometry = subdivided
          } else if (child.geometry !== baseGeometry) {
            child.geometry = baseGeometry
          }
        } else if (child.geometry !== baseGeometry) {
          const stale = child.userData.subdividedGeometry as THREE.BufferGeometry | undefined
          if (stale) { stale.dispose(); delete child.userData.subdividedGeometry; delete child.userData.subdividedLevel }
          child.geometry = baseGeometry
        }

        const isolatedOut = isolateMode && (
          isolatingSubElements ? !isolatedExpressIds.has(child.userData.expressID) : !isObjectIsolated
        )
        // Hide always wins over isolate, unconditionally ANDed in — same
        // shape as FourD.tsx's own object-level visibility check
        // (`!hiddenIds.has(o.id) && (!isolateMode || ...)`), just at the
        // sub-element granularity (2026-07-11, for Collections).
        const isChildHidden = elementKey !== null && hiddenExpressIds.has(elementKey)
        // Split-away (2026-07-15) — an original element's own mesh stays
        // out of the normal render set once elementSplitTargets.ts has
        // generated independent per-level slices for it (tagged directly
        // on this mesh's own userData when that happens, not threaded
        // through as a prop — see that module's own header), the same way
        // a manually-Hidden element already does.
        const baseVisible = settings.showFaces && !isolatedOut && !isChildHidden && !child.userData.isSplitAway
        // Cached alongside the real assignment below (2026-07-15) — this
        // effect only reruns on its own dependency list (settings/isolate/
        // hidden state), never on the timeline's own date, so
        // TimelinePlayback's own useFrame (below, runs every animation
        // frame) needs somewhere durable to read "should this be visible
        // for non-animation reasons" from, in order to combine it with the
        // animation's own opacity each tick without re-deriving the whole
        // showFaces/isolate/hidden formula itself or fighting this effect
        // over `.visible` outright.
        child.userData.baseVisible = baseVisible
        // Direct write skipped for a mesh TimelinePlayback has already
        // taken over (2026-07-22 fix, per Maro: a footing stayed visible
        // forever after being clicked, confirmed live to persist for as
        // long as it stayed *selected* — not just materialized). While
        // anything is selected, TimelinePlayback's own onTick fires every
        // frame, which bumps FourD.tsx's transform tick, which hands this
        // effect a fresh `objects` array reference every frame too — so
        // this heavy pass was re-running and unconditionally overwriting
        // `.visible` back to baseVisible (schedule-blind) on every single
        // frame, racing against and consistently beating TimelinePlayback's
        // own correct per-frame write (mesh.visible = baseVisible &&
        // opacity > epsilon) further down this file. baseVisible is still
        // written to userData unconditionally just above — that's the exact
        // signal TimelinePlayback's own write already combines with the
        // animation state, so a schedule-linked mesh keeps responding to
        // Isolate/Hide/showFaces correctly, just never via this direct
        // write once it's under animation control.
        if (!child.userData.timelineControlled) child.visible = baseVisible
        child.castShadow = settings.shadows
        child.receiveShadow = settings.shadows
        // Materials aren't necessarily unique per mesh — GLTF/OBJ/FBX
        // exporters routinely have several meshes within the *same* file
        // share one material instance (e.g. every window referencing one
        // "Glass" material), and mutating that instance's properties in
        // place — as this used to do — changes it for every mesh anywhere
        // that happens to reference the same object, not just the one
        // object being edited (2026-07-09 fix, per Maro: "ensure if i try
        // to change one object's texture map it doesnt change the whole").
        // Cloning once per mesh the first time it gets a texture override,
        // tagged with exactly which override (ownerKey — the whole object,
        // or one specific element) it was cloned for, and reusing that
        // clone on every later pass, ring-fences the mutation to only the
        // mesh(es) that specific override actually owns — a material
        // shared by several meshes under a *whole-object* override still
        // looks uniform across all of them (each gets its own clone of the
        // same override, matching "material/texture setting is based on a
        // single object at a time"), but a *per-element* override's clone
        // is keyed to that one expressID alone, so it can never leak onto a
        // sibling mesh even if they originally shared a material instance.
        // The ORIGINAL material instance is never touched either way, so
        // nothing outside whatever's actually being edited can be affected.
        //
        // Cloning also runs when this mesh was *previously* overridden but
        // isn't right now (2026-07-09 fix, per Maro: "when i change the
        // material and delete the material, it doesn't actually go back to
        // the default") — checked via the existing textureOverrideOwner tag
        // rather than requiring `overrides` itself to be truthy, since a
        // fully-cleared override needs this same owned clone to actually
        // write the restored original values into below; a mesh that's
        // *never* been touched at all skips cloning entirely (cheap — nothing
        // to restore, its material already shows the original values as-is).
        // The real, canonical PBR material(s) for this mesh — stable across
        // render-mode switches (2026-07-11, per Maro comparing this app's
        // render modes against Synchro/Blender's own — see
        // renderModeMaterials.ts's own header). Everything below this line
        // used to read/write `child.material` directly, which was safe only
        // because `child.material` was *always* the real material; now that
        // a render mode can swap `child.material` to a Lambert/Phong/unlit
        // stand-in for display, the clone-on-write override-ownership
        // system and every property mutation below needs one place that
        // keeps meaning "the real underlying material" regardless of what's
        // actually on screen this frame. Captured once per mesh, the very
        // first time this effect ever runs for it — before any render-mode
        // swap could have touched child.material yet, so this initial
        // capture is always correct — then always read from here after.
        if (!child.userData.standardMaterial) child.userData.standardMaterial = child.material
        let standardMaterial = child.userData.standardMaterial as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]

        const firstMat = Array.isArray(standardMaterial) ? standardMaterial[0] : standardMaterial
        const everCustomized = !!overrides || !!firstMat.userData.textureOverrideOwner
        if (everCustomized && Array.isArray(standardMaterial)) {
          standardMaterial = standardMaterial.map(m => (m.userData.textureOverrideOwner === ownerKey ? m : (() => {
            const clone = m.clone()
            clearClonedRenderModeVariantCache(clone)
            clone.userData.textureOverrideOwner = ownerKey
            return clone
          })()))
          child.userData.standardMaterial = standardMaterial
        } else if (everCustomized && !Array.isArray(standardMaterial) && standardMaterial.userData.textureOverrideOwner !== ownerKey) {
          standardMaterial = standardMaterial.clone()
          clearClonedRenderModeVariantCache(standardMaterial)
          standardMaterial.userData.textureOverrideOwner = ownerKey
          child.userData.standardMaterial = standardMaterial
        }

        const materials = Array.isArray(standardMaterial) ? standardMaterial : [standardMaterial]
        const originals = getOriginalMaterialSlots(child)
        const displayMaterials: THREE.Material[] = []
        materials.forEach((mat, i) => {
          {
            // wireframe/flatShading both apply on the real PBR material
            // regardless of render mode (2026-07-11) — Wireframe/Flat
            // Shaded stay on `standardMaterial` for display too (full PBR
            // fidelity, just a different draw mode or normal
            // interpolation), unlike Gouraud/Phong/Hidden Line below, which
            // swap to a different material class entirely. flatShading is a
            // shader-compile-time parameter (confirmed in three.js's own
            // WebGLPrograms.js, not assumed) — needsUpdate only flips when
            // it actually changes, not every frame.
            const wantsWireframe = settings.renderMode === 'wireframe'
            const wantsFlatShading = settings.renderMode === 'flat'
            if (mat.flatShading !== wantsFlatShading) mat.needsUpdate = true
            mat.wireframe = wantsWireframe
            mat.flatShading = wantsFlatShading

            const isExpressSelected = child.userData.expressID === selectedExpressId
            const isExpressAlsoSelected = selectedExpressIds.has(child.userData.expressID)
            // Amber "whole object selected, this element wasn't specifically
            // picked" removed for IFC elements entirely (2026-07-17, per
            // Maro: "I don't want the amber highlight at all, the element
            // highlight is good enough") — only kept for plain mesh-kind
            // imports, which have no sub-element concept at all and would
            // otherwise show zero selection feedback; those now get the same
            // blue as a specifically-picked element instead of their own
            // amber tier.
            const isPlainObjectSelected = isObjectSelected && kind !== 'ifc'
            // Three real tiers, not two (2026-07-11 fix, per Maro: "I
            // selected level 3 and IfcSlab... I get the overall highlight
            // but not the 3 elements") — isExpressAlsoSelected (one of
            // several specifically-picked elements, e.g. every IfcSlab on a
            // storey via Select by Type) and isObjectSelected (this mesh's
            // *whole model* merely contains a selection somewhere) used to
            // share one identical amber treatment. Since picking specific
            // elements always also marks their owning object selected
            // (handleSelectExpressIds/handleSelectExpressId both call
            // setSelectedObjectIds), those two conditions are true
            // *together* on almost every real multi-select — every other
            // mesh in the same model got the exact same amber wash as the
            // 3 actually-picked slabs, so the 3 slabs never stood out from
            // the other few hundred elements sharing that same object.
            // isExpressAlsoSelected now gets the same strong blue as the
            // primary pick (every individually-picked element is equally
            // "selected" — there's no real reason the very last one clicked
            // should look more special than the rest in a bulk pick), just
            // very slightly dimmer so the true primary — TransformPanel's
            // actual gizmo target — still reads as a hair brighter.
            // isObjectSelected-only meshes (this object is active, but this
            // particular mesh wasn't specifically picked) fall back to a
            // deliberately much fainter amber cast, so it reads as
            // background context rather than competing with the real
            // selection.
            //
            // 2026-07-11 fix, per Maro: "you can barely tell i've selected 7
            // elements" — additive emissive alone at these intensities
            // barely registers against a bright, near-white shaded model
            // (and is close to invisible on thin elements like IfcGrid
            // lines, which have almost no screen area to glow from either
            // way). Bumped intensity substantially, and — see the
            // mat.color.lerp calls below, right after this material's real
            // colour/map is set — the surface colour itself now shifts
            // toward the selection tint too, not just an additive glow on
            // top of it, so a selection reads as a real colour change even
            // on a small/thin element.
            if (isExpressSelected) { mat.emissive = SELECTED_EMISSIVE; mat.emissiveIntensity = 1.1 }
            else if (isExpressAlsoSelected || isPlainObjectSelected) { mat.emissive = SELECTED_EMISSIVE; mat.emissiveIntensity = 0.9 }
            else { mat.emissive = new THREE.Color(0x000000); mat.emissiveIntensity = 0 }

            // Manual texture override (2026-07-11, per Maro) — see
            // customTextures.ts's own header. A supplied map always wins
            // over whatever the file itself carried; forcing color to white
            // and metalness/roughness to 1 stops the mesh's existing flat
            // values from multiplying against (and tinting/dimming) it.
            // Each slot falls back to its own *captured original* — not a
            // no-op — whenever it isn't overridden (2026-07-09 fix, same
            // "delete the material... go back to the default" report):
            // previously nothing here ever un-set a slot once applied, so a
            // cleared override just kept showing the last thing uploaded.
            const original = originals[i]
            if (overrides?.map) { mat.map = overrides.map.texture; mat.color.set(0xffffff) }
            else if (original) { mat.map = original.map; mat.color.copy(original.color) }

            // Variance colour-coding (2026-07-12) — applied here,
            // *underneath* the selection lerps just below, so selecting a
            // variance-tinted element still reads as a real selection on
            // top of it rather than the two competing. varianceKey mirrors
            // customTextures' own ownerKey convention exactly: elementKey
            // (an IFC sub-element's own `${id}::${expressID}`) when one
            // applies, else the whole mesh-kind object's id.
            if (settings.showVarianceColors) {
              const varianceKey = elementKey ?? id
              const varianceDays = varianceByElementKey.get(varianceKey)
              if (varianceDays) {
                const tint = varianceDays > 0 ? VARIANCE_LATE_COLOR : VARIANCE_EARLY_COLOR
                const magnitude = Math.min(1, Math.abs(varianceDays) / VARIANCE_MAGNITUDE_CAP_DAYS)
                mat.color.lerp(tint, magnitude * VARIANCE_MAX_LERP)
              }
            }
            // Clash Detective (2026-07-12) — same placement/reasoning as
            // variance just above (underneath the selection lerps, same
            // elementKey convention), flat red rather than magnitude-scaled
            // (see CLASH_COLOR's own header on why).
            if (settings.showClashColors && clashByElementKey.get(elementKey ?? id)) {
              mat.color.lerp(CLASH_COLOR, CLASH_LERP)
            }
            // Shifts the actual surface colour toward the selection tint,
            // on top of (not instead of) the emissive glow above — see this
            // block's own 2026-07-11 header note for why emissive alone
            // wasn't enough, and the isExpressSelected/isExpressAlsoSelected/
            // isObjectSelected tiering note above for why these three now
            // get three visibly different treatments instead of two. A
            // 0.6/0.55 lerp on the two "specifically selected" tiers is
            // heavy enough to read clearly against any base colour
            // (including this real file's own tan/beige concrete, where the
            // old single amber tier — a similarly warm hue — used to barely
            // shift at all) without fully flattening the element to a solid
            // highlight colour. The whole-object-only tier stays
            // deliberately light (0.15) — background context, not
            // competing with the real selection.
            if (isExpressSelected) mat.color.lerp(SELECTED_EMISSIVE, 0.6)
            else if (isExpressAlsoSelected || isPlainObjectSelected) mat.color.lerp(SELECTED_EMISSIVE, 0.55)
            if (overrides?.metalnessMap) { mat.metalnessMap = overrides.metalnessMap.texture; mat.metalness = 1 }
            else if (original) { mat.metalnessMap = original.metalnessMap; mat.metalness = original.metalness }
            if (overrides?.roughnessMap) { mat.roughnessMap = overrides.roughnessMap.texture; mat.roughness = 1 }
            else if (original) { mat.roughnessMap = original.roughnessMap; mat.roughness = original.roughness }
            if (overrides?.normalMap) { mat.normalMap = overrides.normalMap.texture }
            else if (original) { mat.normalMap = original.normalMap }
            // AO/Displacement (2026-07-11, per Maro) — same override-wins/
            // fall-back-to-original shape as every slot above. Both sample
            // the material's own primary UV set automatically (three.js
            // Texture.channel defaults to 0 = 'uv', not a separate 'uv2' —
            // see customTextures.ts's own TextureSlot header for how this
            // was actually confirmed, not assumed), the same UV set
            // ifcModel.ts's box-projected UVs already populate, so no
            // further geometry work was needed to wire these in.
            if (overrides?.aoMap) { mat.aoMap = overrides.aoMap.texture }
            else if (original) { mat.aoMap = original.aoMap }
            if (overrides?.displacementMap) { mat.displacementMap = overrides.displacementMap.texture }
            else if (original) { mat.displacementMap = original.displacementMap }
            if (everCustomized) mat.needsUpdate = true

            // Which material object actually gets displayed this frame
            // (2026-07-11) — `mat` above (standardMaterial) has now
            // absorbed every override/selection-tint mutation regardless of
            // render mode, so it's always the correct *source* to display
            // or to derive a Gouraud/Hidden Line stand-in from.
            // Wireframe/Flat Shaded/Rendered(PBR) show `mat` itself
            // (full PBR fidelity — see renderModeMaterials.ts's own header
            // for why Gouraud can't preserve metalness/roughness).
            if (settings.renderMode === 'gouraud') {
              displayMaterials.push(getGouraudVariant(mat))
            } else if (settings.renderMode === 'hiddenLine') {
              const hiddenLineTint = HIDDEN_LINE_BASE_COLOR.clone()
              if (isExpressSelected) hiddenLineTint.lerp(SELECTED_EMISSIVE, 0.6)
              else if (isExpressAlsoSelected || isPlainObjectSelected) hiddenLineTint.lerp(SELECTED_EMISSIVE, 0.55)
              displayMaterials.push(getHiddenLineMaterial(mat, hiddenLineTint))
            } else {
              displayMaterials.push(mat)
            }
          }
        })
        child.material = displayMaterials.length > 1 ? displayMaterials : displayMaterials[0]

        // Edges overlay — a black wireframe LineSegments child, distinct from
        // "Render mode: Wireframe" (which replaces the shaded material
        // entirely) — this draws on top of shaded faces instead. Built once
        // per mesh and cached in userData so toggling it on/off repeatedly
        // doesn't keep recomputing the edge geometry. Forced on for Hidden
        // Line regardless of the separate Edges checkbox (2026-07-11) — the
        // whole point of that render mode is "line art over a flat
        // occluder," not optional decoration.
        let edges = child.userData.edgesHelper as THREE.LineSegments | undefined
        // Never for a THREE.BatchedMesh itself (2026-07-19 fix, per Maro:
        // "the malformed edge nonsense... only shows like that when edge is
        // activated" — confirmed: BatchedMesh extends THREE.Mesh, so this
        // traversal already reaches it, and new THREE.EdgesGeometry(
        // child.geometry) on a batch reads its own raw, shared internal
        // buffer — every distinct repeated shape's geometry concatenated
        // together with none of the per-instance placement matrices
        // (setMatrixAt, elementBatching.ts) applied at all, since
        // EdgesGeometry has no concept of per-instance transforms. The
        // result is every repeated shape's own outline overlapping at the
        // batch's single shared local origin — exactly the jumbled "star
        // burst" shape reported, and exactly why clicking-and-framing one
        // specific element "fixes" it: that materializes it out of the
        // batch into a real individual Mesh (ensureMaterialized), which
        // this same block already handles correctly. Everything still
        // sitting in the batch has no valid per-instance edge overlay to
        // build here at all — showing nothing is correct, not a
        // regression, until/unless per-instance edge tracing is built.
        const isBatchedMesh = (child as THREE.Object3D & { isBatchedMesh?: boolean }).isBatchedMesh === true
        const wantsEdges = (settings.showEdges || settings.renderMode === 'hiddenLine') && !isBatchedMesh
        if (wantsEdges) {
          if (!edges) {
            edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(child.geometry),
              new THREE.LineBasicMaterial({ color: 0x1f2937 }),
            )
            child.userData.edgesHelper = edges
            child.add(edges)
          }
          edges.visible = true
          // A real bug, caught 2026-07-15 alongside the same gap in
          // getGouraudVariant/getHiddenLineMaterial (renderModeMaterials.ts)
          // — this LineBasicMaterial is its own separate material instance,
          // never the mesh's real standardMaterial, so a split's (or
          // Section Box's) clippingPlanes were never reaching it: the black
          // edge outline kept drawing at full, uncut length even once the
          // shaded faces underneath were correctly clipped. Synced from
          // materials[0] (the real per-mesh material every clip source
          // above already writes onto) on every pass, not just at creation
          // — cheap, and correctly picks up a split committed *after* the
          // edges overlay already existed for this mesh.
          ;(edges.material as THREE.LineBasicMaterial).clippingPlanes = materials[0]?.clippingPlanes ?? null
        } else if (edges) {
          edges.visible = false
        }
      })

      // Batched-element visibility (2026-07-17) — showFaces/Isolate/Hide
      // for whatever's still sitting in ifcModel.ts's shared BatchedMesh
      // (see elementBatching.ts's own header), mirroring the same
      // baseVisible formula the traverse above applies per individual
      // mesh. Deliberately narrower than that formula — no render-mode
      // material swap, no variance/clash tint, no texture override — a
      // batched element hasn't been individually touched by definition, so
      // none of those can apply to it yet.
      //
      // Selection highlight is the one exception (2026-07-21 fix, per
      // Maro: "not selecting... i dont see the highlight color change" —
      // this comment used to claim "selection specifically always
      // materializes immediately... so a selected but still batched state
      // never actually occurs," which is only true for a single direct
      // click (Viewport3D.tsx's own handleClick does call
      // ensureMaterialized as a side effect of that specific selection
      // path) — a panel-driven Select by Storey/Type never materializes
      // anything (elementBatching.ts's own ensureMaterialized is only ever
      // called with the single, primary `selectedExpressId`, which is null
      // the instant more than one element is selected), so "selected but
      // still batched" is the *common* case for that flow, not an
      // impossible one. The individual-mesh path's own highlight
      // (isExpressSelected/isExpressAlsoSelected below) works by tinting
      // each mesh's own private material's emissive channel — not
      // available here, since every still-batched element shares one
      // material instance; THREE.BatchedMesh's own per-instance colour
      // (setColorAt, already how each element's real IFC colour rides on
      // this shared material in the first place — see ifcModel.ts's own
      // loadIfcModel) is the one per-instance channel actually available,
      // so the highlight here is a colour lerp toward the same
      // SELECTED_EMISSIVE blue instead of a real emissive glow, restored
      // to each instance's own true captured colour (info.color) the
      // moment it's no longer selected.
      //
      // KNOWN GAP, not yet visually confirmed: the write itself is
      // provably correct (read back byte-for-byte identical to what was
      // written, live, via getColorAt) and the compiled vertex shader does
      // contain USE_BATCHING_COLOR, but the tint doesn't actually show up
      // on screen in real testing — narrowed this far but not fully
      // resolved, possibly the same class of three.js 0.169 BatchedMesh
      // colour-support rough edge ifcModel.ts's own needsUpdate comment
      // documents (a confirmed real bug there, `object.colorTexture` vs
      // the real `_colorsTexture` property, though forcing that recompile
      // alone didn't fix this specific symptom either). Left in rather
      // than reverted since the data path is genuinely correct and
      // harmless either way — isolate/Frame Selected (the actual reported
      // "not selecting and not isolating" bug) are fully fixed and
      // confirmed live; this highlight is the one remaining, separate,
      // purely cosmetic gap.
      const batch = object.userData.batch as BatchState | undefined
      if (batch && heavyChanged) {
        // Diagnosed 2026-07-21, per Maro: "still not isolating" even for a
        // selection dominated by ordinary walls, confirmed (via a since-
        // removed console diagnostic — isolatedExpressIds matched 14/14
        // batch keys, so the IDs were never the problem) not to be a
        // selection/matching bug at all. The real cause: this block and
        // TimelinePlayback's own batched-visibility fast path (Viewport3D.tsx,
        // 2026-07-21 — see ResolvedBatchVisibilityTarget's own header) both
        // call THREE.BatchedMesh.setVisibleAt on the exact same instances,
        // and TimelinePlayback's runs unconditionally every single
        // animation frame — so for any schedule-linked batched element, its
        // per-frame write always wins moments later regardless of what
        // Isolate just set here, with zero awareness that Isolate even
        // exists. The individual-mesh animation path two blocks below
        // never had this problem — it already composes the schedule's own
        // opacity-driven visibility with `mesh.userData.baseVisible` (this
        // same isolate/hide verdict, cached per mesh) instead of
        // overwriting outright. batchBaseVisibleByInstanceId is that same
        // idiom for a batched instance, since there's no per-instance
        // Object3D to hang userData off directly — stored on the shared
        // BatchedMesh itself, read by TimelinePlayback's fast path to AND
        // into its own per-frame verdict instead of overwriting it.
        const baseVisibleByInstanceId = (
          batch.mesh.userData.batchBaseVisibleByInstanceId ??= new Map<number, boolean>()
        ) as Map<number, boolean>
        // See TimelinePlayback's own timelineControlledInstanceIds comment
        // (Mode A's batch fast path) for why this direct setVisibleAt is
        // now guarded — a second, separate instance of the exact same race
        // the individual-mesh path below already fixed, hit specifically by
        // a panel-driven Select by Storey/Type selection (never
        // materializes anything, so it never reaches the individual-mesh
        // path at all).
        const timelineControlledInstanceIds = batch.mesh.userData.timelineControlledInstanceIds as Set<number> | undefined
        for (const [expressID, infos] of batch.byExpressId) {
          const isolatedOut = isolateMode && (
            isolatingSubElements ? !isolatedExpressIds.has(expressID) : !isObjectIsolated
          )
          const elementKey = kind === 'ifc' ? `${id}::${expressID}` : null
          const isChildHidden = elementKey !== null && hiddenExpressIds.has(elementKey)
          const visible = settings.showFaces && !isolatedOut && !isChildHidden
          for (const info of infos) {
            baseVisibleByInstanceId.set(info.instanceId, visible)
            if (!timelineControlledInstanceIds?.has(info.instanceId)) batch.mesh.setVisibleAt(info.instanceId, visible)
          }
        }
        // Colour highlight (2026-07-21) — deliberately walks the *entire*
        // batch here too, on this same full pass, rather than only ever
        // being driven by the cheap touchedExpressIds-only pass just below:
        // a heavy pass can fire for reasons that have nothing to do with
        // selection (Isolate, Hide, a settings toggle), and this batch's
        // instances need their colour to still reflect whatever's
        // *currently* selected regardless of what actually triggered this
        // particular pass — recomputing all of it here is the simplest way
        // to guarantee that without a second selection-membership diff.
        applyBatchSelectionColour(batch, [...batch.byExpressId.keys()])

        // Render mode (2026-07-21 fix, per Maro: "render modes not
        // working" — a direct, self-inflicted regression from this same
        // session's own batchMeshForSkip fix a few messages up: skipping
        // the batch mesh out of the per-individual-mesh traversal entirely
        // was necessary to stop it being wrongly treated as "not part of
        // the isolated set" (see that fix's own header), but that same
        // traversal was *also* the only place Wireframe/Flat Shaded/
        // Gouraud/Hidden Line ever got applied to anything — including,
        // incidentally, the batch's own shared material, since before that
        // fix the traversal walked into it too. Skipping it wholesale
        // fixed isolate but silently took render-mode switching down with
        // it for every still-batched element (functionally the whole
        // model now that everything batches — see ifcModel.ts's own
        // 2026-07-21 "batch ALL geometry" header). Unlike the individual-
        // mesh path, there's exactly one shared material for the entire
        // batch, and render mode is a scene-wide setting, not a per-
        // element one — no per-instance tiering needed here the way
        // selection colour above needs it, just the same
        // wireframe/flatShading toggles and Gouraud/Hidden Line swap the
        // individual-mesh path already does, applied once. standardMaterial
        // captured once (same idiom as child.userData.standardMaterial
        // below) so a later pass reads the real underlying material even
        // after batch.mesh.material has been swapped to a Lambert/Basic
        // stand-in — without it, a Gouraud pass would treat its own
        // MeshLambertMaterial as "the real material" on the next call and
        // corrupt it. Deliberately no selection-tier tinting/variance/
        // clash/texture-override handling here (unlike the individual-mesh
        // block) — selection already has its own dedicated per-instance
        // colour treatment just above; variance/clash/texture-override
        // were already documented as not applying to batched elements
        // before today and aren't part of what was reported broken here.
        if (!batch.mesh.userData.standardMaterial) batch.mesh.userData.standardMaterial = batch.mesh.material
        const batchMat = batch.mesh.userData.standardMaterial as THREE.MeshStandardMaterial
        const batchWantsWireframe = settings.renderMode === 'wireframe'
        const batchWantsFlatShading = settings.renderMode === 'flat'
        if (batchMat.flatShading !== batchWantsFlatShading) batchMat.needsUpdate = true
        batchMat.wireframe = batchWantsWireframe
        batchMat.flatShading = batchWantsFlatShading
        if (settings.renderMode === 'gouraud') {
          batch.mesh.material = getGouraudVariant(batchMat)
        } else if (settings.renderMode === 'hiddenLine') {
          batch.mesh.material = getHiddenLineMaterial(batchMat, HIDDEN_LINE_BASE_COLOR)
        } else {
          batch.mesh.material = batchMat
        }
      } else if (batch && kind === 'ifc' && touchedExpressIds.size > 0) {
        // The cheap sibling of the pass above (2026-07-21 fix, per Maro:
        // "the selection highlight isnt responsive... it still persists"
        // on Deselect All, or when picking a *different* set from the IFC
        // Data panel, "until i isolate") — colour used to only ever be
        // recomputed on a heavy pass (above), but selectedExpressId/
        // selectedExpressIds aren't in heavyDeps at all (deliberately —
        // see this effect's own header on why a selection-only change
        // stays cheap for individual meshes), so a pure selection change
        // never triggered the block above, and a still-batched element's
        // highlight only ever caught up the next time something *else*
        // happened to force a heavy pass. touchedExpressIds already tells
        // this same render exactly which expressIDs' selection membership
        // just flipped (computed once above, the same diff the individual-
        // mesh path already relies on) — restricting to just those keeps
        // this exactly as cheap as that path, an O(touched) update instead
        // of an O(whole batch) rescan for every click.
        applyBatchSelectionColour(batch, [...touchedExpressIds])
      }
    }
    // Narrowed from the whole `settings` object (2026-07-15) — this effect
    // only ever reads the fields listed below (upAxis is destructured
    // separately above); depending on the whole object meant tweaking an
    // unrelated setting (Field of View, Clip Start/End, Grid, Axis
    // Indicator — none of which this effect touches at all) still forced a
    // full re-pass over every mesh in the loaded model(s).
  }, [
    objects, selectedExpressId, selectedExpressIds, selectedObjectIds, customTextures, isolateMode, hiddenExpressIds,
    settings.showFaces, settings.renderMode, settings.showEdges, settings.showVarianceColors, settings.showClashColors,
    settings.shadows, upAxis,
  ])

  // Section Box clipping is applied every frame here, not inside the
  // effect above (2026-07-09 fix, per Maro: "if i move the object midway
  // currently, the whole section is disrupted... the section is still
  // there") — the effect above only re-runs when specific React props
  // change reference (selection, settings, textures, isolate mode), and
  // while a TransformControls drag *does* normally bump a tick that causes
  // that too (onTransformChange -> FourD.tsx's transformTick -> a fresh
  // viewportObjects array on the next render), relying on that chain left
  // a real staleness window. A per-frame update, mirroring exactly how
  // SectionBoxGizmo.tsx's own wireframe already tracks the target's
  // matrixWorld, closes that gap completely — reassigning a material's
  // clippingPlanes is cheap (no re-render, no extra draw call), so this is
  // safe to do unconditionally for whichever objects currently have a box.
  //
  // Only traverses objects that currently have — or, for exactly one more
  // frame, *just stopped* having — a Section Box targeting them (tracked
  // via prevTrackedIds below), rather than every loaded object every
  // frame: the common case (no Section Box anywhere in the project) costs
  // nothing beyond one small array scan per frame. The one-more-frame
  // grace period is what correctly clears clippingPlanes back to null the
  // moment a box is deactivated or deleted, instead of leaving the last
  // computed planes stuck on the mesh forever once it drops out of
  // sectionBoxes entirely.
  const prevTrackedIds = useRef<Set<string>>(new Set())
  useFrame(() => {
    const currentIds = new Set(sectionBoxes.map(b => b.sceneObjectId))
    const idsToProcess = new Set([...prevTrackedIds.current, ...currentIds])
    for (const { id, object } of objects) {
      if (!idsToProcess.has(id)) continue
      object.updateMatrixWorld(true)
      const boxesForObject = sectionBoxes.filter(b => b.sceneObjectId === id && b.active)
      // Whole-object boxes (elementExpressId undefined) apply to every mesh
      // under this object, computed once against the object's own
      // matrixWorld. Element-scoped boxes (2026-07-09, per-element scoping)
      // apply *only* to the one matching mesh, computed against that
      // mesh's own matrixWorld instead — correctly reflecting both this
      // object's placement and that element's own local transform within
      // it (see ifcModel.ts's loadIfcModel — each element mesh carries its
      // own baked-in placement transform). Both kinds can apply to the same
      // mesh simultaneously (a whole-model box plus an element box on one
      // of its own elements) — planes from both are simply concatenated,
      // same "layer more than one cut" reasoning as multiple whole-object
      // boxes already have.
      const wholeObjectPlanes = boxesForObject
        .filter(b => b.elementExpressId === undefined)
        .flatMap(b => computeWorldClipPlanes(b.bounds, b.rotation, object.matrixWorld))
      const elementBoxes = boxesForObject.filter(b => b.elementExpressId !== undefined)
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        let clipPlanes = wholeObjectPlanes
        if (elementBoxes.length > 0) {
          const matching = elementBoxes.filter(b => b.elementExpressId === child.userData.expressID)
          if (matching.length > 0) {
            child.updateMatrixWorld(true)
            clipPlanes = [...wholeObjectPlanes, ...matching.flatMap(b => computeWorldClipPlanes(b.bounds, b.rotation, child.matrixWorld))]
          }
        }
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach(mat => { mat.clippingPlanes = clipPlanes.length > 0 ? clipPlanes : null })

        // The edges overlay's own LineBasicMaterial was never included
        // here (2026-07-13, per Maro: "i noticed it was the case with
        // sections as well") — a section box cut the shaded faces but left
        // the black wireframe sticking out past the cut plane untouched.
        const edges = child.userData.edgesHelper as THREE.LineSegments | undefined
        if (edges) (edges.material as THREE.LineBasicMaterial).clippingPlanes = clipPlanes.length > 0 ? clipPlanes : null
      })
    }
    prevTrackedIds.current = currentIds
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // Box-select mode owns click/drag entirely while active (its own
    // pointerup on the wrapping div resolves the selection) — a plain click
    // underneath it would otherwise also fire and fight over the result.
    if (boxSelectMode) return
    // Isolate hides non-isolated meshes by setting `.visible = false` (this
    // component's own effect above) — but three.js's Raycaster deliberately
    // never checks `.visible` at all (only `.layers`, confirmed in
    // three/src/core/Raycaster.js), so an invisible mesh is still fully
    // clickable by default (2026-07-09 fix, per Maro: "when i click a
    // random spot even though it doesnt reveal it, its still selectable...
    // I dont want that"). Returning here *without* stopPropagation lets
    // R3F's own event system keep walking to the next-nearest actual hit
    // along the same ray (it already computes every intersection, nearest
    // first, and only stops there because a handler called
    // stopPropagation) — so a click "through" an isolated-out mesh
    // correctly reveals whatever real, visible thing is behind it, or
    // reaches onPointerMissed and clears selection if there's nothing else
    // there at all, exactly as if the hidden mesh were never part of the
    // scene to begin with.
    // Hard rule (2026-07-15, per Maro: "if any element is hidden i
    // shouldnt be able to click... make sure this is a hard set rule") —
    // the check above this comment used to only look at e.object's own
    // `.visible`, which misses a real, confirmed case: toggling a whole
    // model's own visibility checkbox sets `.visible = false` only on that
    // model's top-level group (the <primitive visible={...}> prop further
    // down), never cascading it onto each individual child mesh's own
    // flag — three.js's Raycaster doesn't check ancestor visibility either
    // (only the specific hit object's own, same gap this file's own
    // isolate-click-through comment already describes for one mesh), so a
    // whole hidden model stayed fully clickable even though nothing of it
    // was ever drawn. Walking the full parent chain closes that gap
    // uniformly for every reason something can be invisible — Hide,
    // Isolate, whole-model visibility, animation-hidden, split-away — all
    // of them already work by setting `.visible = false` *somewhere* in
    // this chain, so this one walk is the single hard rule covering all of
    // them instead of a special case per mechanism.
    for (let node: THREE.Object3D | null = e.object; node; node = node.parent) {
      if (!node.visible) return
    }
    e.stopPropagation()
    const additive = e.ctrlKey || e.metaKey

    // Batched-element hit resolution (2026-07-17, per Maro — see
    // elementBatching.ts's own header for the full "why": THREE.BatchedMesh
    // carries every element whose geometry repeats elsewhere in the file,
    // draw-call-cheap but *not* individually addressable via
    // userData.expressID the way a normal per-element mesh is; three.js's
    // own BatchedMesh.raycast (verified directly in
    // node_modules/three/src/objects/BatchedMesh.js, not assumed) tags
    // each intersection with which instance got hit via `batchId` instead.
    // Resolved via the reverse lookup ifcModel.ts attaches to the batch's
    // own root object at import time, then materialized immediately —
    // ensureMaterialized converts it into a normal individual THREE.Mesh
    // right here, so every line below this block (and every other
    // selection/highlight/edit code path elsewhere in this file, in
    // TransformPanel.tsx, etc.) needs zero changes to keep working for it,
    // exactly as if it had never been batched at all.
    let target: THREE.Object3D | null = e.object
    let expressId: number | null = null
    if ((target as THREE.Object3D & { isBatchedMesh?: boolean }).isBatchedMesh && e.batchId !== undefined) {
      let batchRoot: THREE.Object3D | null = target
      while (batchRoot && batchRoot.userData.batch === undefined) batchRoot = batchRoot.parent
      const batchState = batchRoot?.userData.batch as BatchState | undefined
      const resolvedId = batchState?.expressIdByInstanceId.get(e.batchId)
      if (resolvedId !== undefined && batchRoot) {
        ensureMaterialized(batchRoot, resolvedId)
        expressId = resolvedId
      }
    } else {
      while (target && target.userData.expressID === undefined) target = target.parent
      expressId = target ? (target.userData.expressID as number) : null
    }

    // Walks up to whichever ancestor is one of FourD.tsx's own top-level
    // imports (tagged sceneObjectId there at import time) — resolved
    // unconditionally now (2026-07-09, per multi-model support) since
    // expressIDs are only unique *within* their own model's web-ifc
    // session, so onSelect needs to know which specific loaded model this
    // click's expressID belongs to, not just the expressID itself.
    let root: THREE.Object3D | null = e.object
    while (root && root.userData.sceneObjectId === undefined) root = root.parent
    const objectId = root ? (root.userData.sceneObjectId as string) : null
    onSelect(expressId, additive, objectId ?? undefined)

    // Whole-object selection (2026-07-11, per Maro) — a click inside an IFC
    // model both highlights the specific sub-element (blue tint, IFC Data
    // tab) *and* makes the whole IFC model the active object for the
    // Transform panel/gizmo — moving individual BIM elements isn't a real
    // workflow here, repositioning the whole imported model against the
    // site is. Only called directly for a mesh-kind click (no expressID) —
    // when a click resolves a specific IFC sub-element, FourD.tsx's
    // handleSelectExpressId handles the whole model's own object-level
    // membership itself via the objectId just passed to onSelect above
    // (2026-07-08, per Maro: "multi selector in the hierarchy" — ensures
    // membership without toggling, so ctrl-clicking a *second* sub-element
    // of the same model doesn't flip the model back out of the selection).
    if (expressId === null) {
      onSelectObject(objectId, additive)
    }
  }

  return (
    <>
      {/* rootObjects, not objects (2026-07-12) — a rigged child is never
          separately mounted here; it rides along as a real descendant of
          its parent's already-mounted Object3D (the effect above), same
          pattern this file already uses for IFC sub-meshes, which are
          never individually JSX'd either. */}
      {rootObjects.map(({ id, sourceUpAxis, object, visible }) => (
        <group key={id} rotation={axisCorrectionRotation(sourceUpAxis, upAxis)}>
          <primitive object={object} visible={visible} onClick={handleClick} />
        </group>
      ))}
    </>
  )
}

// Two independent drivers per target, either or both present (2026-07-08,
// per Maro: "I need to be able to animate also independently from the
// activity schedule... two modes. the normal and a blender way with the
// keyframes"): activity+profile (Mode A, schedule-driven — requires a
// ModelElementLink) and keyframeTracks (Mode B, manual — requires nothing
// but the object itself; see ElementKeyframe's own docstring for why it's
// deliberately not tied to any link). When keyframeTracks has any entries at
// all, they own the *whole* transform for this target (per-field: a field
// with no track just holds its captured base value, same as an unkeyed
// channel in Blender) — the profile, if also present, only ever drives
// opacity/colour in that case; never fights over position/rotation/scale.
// One object can be linked to more than one activity (2026-07-11 fix, per
// Maro: an IFC object assigned to a "fall down" profile on one activity and
// a "go back up" profile on a second, later activity — only the second
// animation ever played, because ResolvedTimelineTarget used to hold a
// single activity/profile per object and each link just overwrote whatever
// the previous one had set. Every link now gets kept (see `links` below),
// and pickActiveLink() at apply-time chooses whichever activity is
// chronologically current for `now` — the same idea as a Blender NLA strip
// stack, minus any blending: activities before their own start still
// correctly show "at rest" (computeAppliedAnimationStateAt already clamps
// that), so falling back to the earliest link when `now` precedes every
// link's start is safe, not just a default-of-convenience.
interface ResolvedTimelineTarget {
  object: THREE.Object3D
  links: ResolvedTimelineLink[]
  basePosition: THREE.Vector3
  baseRotation: THREE.Euler
  baseScale: THREE.Vector3
  // Every standard material anywhere in the target's subtree, each with its
  // own captured base colour (2026-07-11 fix — "works for ifc not normal
  // 3d": an ifc-kind target resolves to one leaf THREE.Mesh, but a mesh-
  // kind target resolves to the *whole imported object* — a THREE.Group for
  // GLTF/OBJ/FBX, never a Mesh itself — so a single "is this a Mesh?" check
  // silently found nothing to apply opacity/colour to for every plain 3D
  // import, while transform still worked since that sets directly on the
  // object regardless of its type. object.traverse() visits the object
  // itself first, then every descendant, so this one collection correctly
  // covers both shapes.)
  // `mesh` alongside each material (2026-07-13, per Maro: Gouraud/Hidden
  // Line render modes don't animate, and Hidden Line's own edges overlay
  // "just static" during playback) — needed so the per-frame sync below
  // can also reach that mesh's own cached render-mode variant
  // (userData.standardMaterial.userData.lambertVariant/hiddenLineVariant,
  // renderModeMaterials.ts) and edges overlay (userData.edgesHelper,
  // ModelObjects' own effect above), neither of which is `material` itself.
  materials: { material: THREE.MeshStandardMaterial; baseColor: THREE.Color; mesh: THREE.Mesh }[]
  keyframeTracks: Partial<Record<KeyframeField, { date: Date; value: number }[]>>
  // Mode A's own pickActiveLink/computeAppliedAnimationStateAt result,
  // cached across frames (2026-07-17 perf fix, per Maro: "everything
  // optimised for scale... speed drop when I play the animation from 6
  // ifcs or navigate"). Viewport3D's Canvas runs frameloop="always"
  // whenever the 4D tab is merely visible — not just during Play — so
  // this useFrame loop fires continuously even while the user is just
  // orbiting a static, paused scene. Before this fix, pickActiveLink (an
  // array copy + full re-sort, each comparison constructing fresh Date
  // objects) and computeAppliedAnimationStateAt ran unconditionally for
  // every linked target on every single frame, regardless of whether the
  // timeline date had moved at all — cost scaling directly with total
  // linked-element count across however many IFC files are combined.
  // These two are a pure function of (links, date), so they only need to
  // be recomputed when the date actually changes (the same dateChanged
  // gate Mode B/keyframes already use, for the same reason) — this cache
  // holds the last result so the still-unconditional per-frame transform
  // write and material-reassertion loop below (both correctly needed
  // every frame, see their own comments) can keep reusing it for free on
  // every frame the date hasn't moved.
  cachedActiveLink: ResolvedTimelineLink | null
  cachedState: AppliedAnimationState | null
}

// Batched-visibility fast path (2026-07-21, per Maro — see
// getBatchedInstanceInfo's own header in elementBatching.ts) — for a
// schedule-linked element that's still batched AND whose profile is pure
// opacity/colour (transform_kind 'none', the default every schedule-
// generated link actually uses), animating it never needs a real mesh or
// material at all: THREE.BatchedMesh.setVisibleAt/setColorAt drive the same
// visible presence + colour tint directly on the shared batch, at zero
// extra draw-call cost regardless of how many elements this covers. No
// `object`/`materials`/transform fields at all — by construction (the
// transform_kind === 'none' eligibility check below), this target never has
// a transform component to apply.
interface ResolvedBatchVisibilityTarget {
  mesh: THREE.BatchedMesh
  instances: { instanceId: number; baseColor: THREE.Color }[]
  links: ResolvedTimelineLink[]
  cachedActiveLink: ResolvedTimelineLink | null
  cachedState: AppliedAnimationState | null
  // Colour, unlike visibility just above, has no other writer racing with
  // it (nothing else calls setColorAt on a linked instance), so a plain
  // last-written cache is safe here and avoids a getColorAt readback +
  // THREE.Color allocation every frame for every instance.
  lastColorHex: string | null
  // The live reverse map elementBatching.ts's own ensureMaterialized
  // deletes an instance from synchronously, the instant that instance gets
  // pulled out of the shared batch (2026-07-22 fix, per Maro — reproduced
  // live with a stack trace: click a batched element, and this file's own
  // per-frame batch loop below can call setVisibleAt(instanceId, true) on
  // it moments *after* ensureMaterialized already called
  // setVisibleAt(instanceId, false) — a genuine race, not the
  // already-fixed "stays selected" one. handleClick's own ensureMaterialized
  // call is synchronous, right inside the click handler; the migration
  // effect that removes this bvTarget from batchVisibilityTargetsRef is a
  // useEffect, which only runs after React commits — one or more
  // requestAnimationFrame ticks later. R3F's own frame loop keeps calling
  // this file's per-frame batch loop on every one of those intervening
  // ticks regardless, still finding the stale bvTarget (with its own
  // pre-click cachedState, e.g. "fully visible" if the click happened on a
  // date where this element genuinely was), and reasserting *that* onto
  // the instance ensureMaterialized had just correctly hidden — a stray
  // write that then sticks forever, since neither system ever revisits an
  // orphaned instance once resolve() and the migration effect have both
  // stopped tracking it. Checking this map catches the race in the exact
  // frame it would otherwise happen: ensureMaterialized's own delete is
  // synchronous, so by the very next tick of this loop (still well before
  // the migration effect runs), the instance already reads as materialized
  // here and is correctly skipped.
  expressIdByInstanceId: Map<number, number>
}

const DEG_TO_RAD = Math.PI / 180
// Below this, an element counts as "animation-hidden" for both rendering
// and click-through purposes (2026-07-15, per Maro: "if elements are
// hidden due to the animation... it still selects it" — three.js's
// Raycaster never looks at opacity, only `.visible` (see handleClick's own
// comment on the equivalent isolate case), so a faded-to-nothing element
// was still fully clickable and could block whatever's actually behind it.
// A small epsilon rather than a strict `=== 0` check catches the
// imperceptibly-faint tail of an ease curve too, not just the exact
// endpoint.
const ANIMATION_VISIBILITY_EPSILON = 0.02

// Caps how many materials get their GPU-facing `needsUpdate` flag set in a
// single frame (2026-07-21 perf fix, per Maro — same bounded-budget idiom as
// geometrySubdivision.ts's own MAX_TOTAL_SUBDIVIDED_TRIANGLES). Jumping the
// timeline a long way (vs. smooth Play, where only a handful of elements
// cross a state boundary in any given frame) can flip many linked elements'
// state at once, and `material.needsUpdate = true` forces three.js to
// synchronously recompile that material's shader program the next time it
// renders — genuinely expensive, and this session's earlier fix (see
// target.materials' own loop below) already established that doing this for
// every changed material in one frame is fine at structural+architectural
// scale but not at six combined discipline files' worth of linked elements.
// Spreads a big jump's material changes across a handful of frames instead
// of one — a brief, staggered "pop in" for the elements past this frame's
// budget rather than a multi-second freeze. Pure pacing, no semantic change:
// ordinary Play-speed scrubbing never comes close to this many changes in a
// single frame, so behaviour there is unaffected.
const MAX_NEEDS_UPDATE_PER_FRAME = 40

function collectStandardMaterials(object: THREE.Object3D): { material: THREE.MeshStandardMaterial; baseColor: THREE.Color; mesh: THREE.Mesh }[] {
  const found: { material: THREE.MeshStandardMaterial; baseColor: THREE.Color; mesh: THREE.Mesh }[] = []
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    // Reads child.userData.standardMaterial — the real, stable PBR material
    // ModelObjects' own effect anchors there (2026-07-11, per Maro
    // comparing this app's render modes against Synchro/Blender's own) —
    // not child.material directly. Once a render mode other than
    // Wireframe/Flat/Rendered can swap child.material to a Gouraud/Phong/
    // Hidden Line stand-in (renderModeMaterials.ts), reading child.material
    // here would silently find nothing to animate opacity/colour on for
    // any element with one of those modes active: an `instanceof
    // THREE.MeshStandardMaterial` check that used to always pass would
    // start failing for every mesh currently displaying a different
    // material class. Falls back to child.material for the (rare) case
    // this runs before ModelObjects' own effect has ever established the
    // anchor for a given mesh yet.
    const source = (child.userData.standardMaterial as THREE.Material | THREE.Material[] | undefined) ?? child.material
    const materials = Array.isArray(source) ? source : [source]
    for (const mat of materials) {
      if (mat instanceof THREE.MeshStandardMaterial) found.push({ material: mat, baseColor: mat.color.clone(), mesh: child })
    }
  })
  return found
}

// 4D timeline playback (2026-07-11, per Maro — see timelinePlayback.ts's
// own header for the animation math, and animationProfiles.ts for the
// Bonsai/Blender-add-on reference this was scoped against). Resolves each
// ModelElementLink to its actual THREE object *once* (an effect, not every
// frame) — mesh-kind by matching sceneObjects on filename, ifc-kind via
// ifcModel.ts's getExpressIdFromGuid + a traverse to find the matching
// expressID-tagged mesh — and caches each target's "base" pose/colour to
// offset from every frame after that, rather than re-deriving it (which
// would drift once the profile itself has started moving the object).
//
// Known limitation: if the *same* object is also being hand-edited via
// TransformControls/PropertiesPanel's Transform fields while the timeline
// is playing, the two fight over position each frame — same as Blender
// itself when you drag an object that also has baked keyframe animation.
// Pause the timeline first.
//
// onTick (2026-07-11 fix, per Maro: "doesn't reflect when the presets
// drive the animations") — this whole component deliberately mutates THREE
// objects outside React so animating dozens of elements every frame
// doesn't mean re-rendering FourD.tsx's whole tree 60 times a second (see
// this file's own onTransformChange precedent) — but that means
// PropertiesPanel's TransformPanel section, which reads position/rotation/
// scale straight off the selected object at *render* time, never got a
// reason to re-render while playback (as opposed to a gizmo drag) was what
// was moving it, so it just showed a stale snapshot. Only fires while
// something's actually selected (activeObjectId set) — no point poking
// FourD.tsx to re-render a panel that isn't even visible.
// Applies whichever of Mode A (activity+profile) / Mode B (keyframeTracks)
// a target actually has, per this component's own header on which one wins
// for transform. Keyframe values are stored in *display* space (whatever
// TransformPanel shows, Blender-style when upAxis is 'z') — resolveDisplayAxis
// is the same conversion TransformPanel itself uses, so a value keyed there
// lands back on the exact same local axis/sign here.
function applyKeyframedTransform(target: ResolvedTimelineTarget, now: Date, upAxis: UpAxis) {
  const obj = target.object
  for (const displayAxis of ['x', 'y', 'z'] as const) {
    const pos = resolveDisplayAxis(displayAxis, upAxis, 'position')
    const posTrack = target.keyframeTracks[`pos_${displayAxis}` as KeyframeField]
    const posValue = posTrack ? interpolateKeyframeTrack(posTrack, now) : null
    obj.position[pos.localAxis] = posValue !== null ? pos.sign * posValue : target.basePosition[pos.localAxis]

    const rot = resolveDisplayAxis(displayAxis, upAxis, 'rotation')
    const rotTrack = target.keyframeTracks[`rot_${displayAxis}` as KeyframeField]
    const rotValue = rotTrack ? interpolateKeyframeTrack(rotTrack, now) : null
    obj.rotation[rot.localAxis] = rotValue !== null ? rot.sign * rotValue * DEG_TO_RAD : target.baseRotation[rot.localAxis]

    const scale = resolveDisplayAxis(displayAxis, upAxis, 'scale')
    const scaleTrack = target.keyframeTracks[`scale_${displayAxis}` as KeyframeField]
    const scaleValue = scaleTrack ? interpolateKeyframeTrack(scaleTrack, now) : null
    obj.scale[scale.localAxis] = scaleValue !== null ? scaleValue : target.baseScale[scale.localAxis]
  }
}

// Mode C — Follow Path (2026-07-11, per Maro's Blender curve reference).
// Deliberately mesh-kind only for this first pass, matching Mode B's own
// existing v1 scope note just above (no stable per-sub-element identity for
// IFC keyframing yet) — same reasoning applies to path_progress, and camera
// binding is left for a later pass entirely (see this session's own scoping
// decision). A target with no path_progress keyframes at all still resolves
// (defaults to progress 0, the curve's own start point) so binding a path
// is immediately visible rather than silently doing nothing until the first
// keyframe is added.
interface ResolvedPathTarget {
  object: THREE.Object3D
  curve: THREE.CatmullRomCurve3 | null
  singlePoint: THREE.Vector3 | null
  orientToPath: boolean
  progressTrack: { date: Date; value: number }[]
}

// Path points are captured in world space (PathAddPointCatcher's own
// raycast hit.point), but every imported object sits inside its own
// up-axis-correction <group> (Viewport3D's per-object wrapper reconciling
// sourceUpAxis against the live upAxis setting) — object.position is local
// to *that* group, not world space. Skipped entirely whenever the two axes
// already match (identity rotation, worldToLocal is a no-op), which is why
// this only ever showed up with a source/display up-axis mismatch. lookAt
// doesn't need the same treatment — three.js's own Object3D.lookAt already
// converts its target through the parent's world matrix internally.
function toLocalPoint(object: THREE.Object3D, worldPoint: THREE.Vector3): THREE.Vector3 {
  if (!object.parent) return worldPoint
  object.parent.updateWorldMatrix(true, false)
  return object.parent.worldToLocal(worldPoint.clone())
}

function applyPathFollow(target: ResolvedPathTarget, now: Date) {
  const progress = target.progressTrack.length > 0 ? (interpolateKeyframeTrack(target.progressTrack, now) ?? 0) : 0
  if (target.curve) {
    const point = pointAtProgress(target.curve, progress)
    target.object.position.copy(toLocalPoint(target.object, point))
    if (target.orientToPath) {
      const tangent = tangentAtProgress(target.curve, progress)
      target.object.lookAt(point.clone().add(tangent))
    }
  } else if (target.singlePoint) {
    target.object.position.copy(toLocalPoint(target.object, target.singlePoint))
  }
}

// Exported (2026-07-12, per Maro's "advanced 4D" baseline-vs-actual
// compare request) so BaselineViewportPane.tsx can mount its own instance
// against the same imported geometry (cloned — see sceneClone.ts), reading
// bl_start/bl_finish instead of start/finish for Mode A. See dateField's
// own header just below for exactly what that does and doesn't affect.
export function TimelinePlayback({
  dateRef, sceneObjects, activities, links, profiles, elementKeyframes, upAxis, ifcHandles, activeObjectId, onTick, paths, pathFollowers,
  selectedExpressId,
  materializeVersion,
  dateField = 'live',
}: {
  dateRef: React.MutableRefObject<Date | null>
  paths: Path[]
  pathFollowers: PathFollower[]
  sceneObjects: TimelineSceneObject[]
  activities: Activity[]
  links: ModelElementLink[]
  profiles: AnimationProfile[]
  elementKeyframes: ElementKeyframe[]
  upAxis: UpAxis
  ifcHandles: IfcModelHandle[]
  activeObjectId: string | null
  onTick: () => void
  // Drives ONLY the small migrateSelectedExpressId effect below, never the
  // main resolve() effect (2026-07-22 fix, per Maro: "when i click an
  // element in animation, it then ignores the animation completely...
  // scrubbed to the first frame but these two elements i clicked some time
  // ago are showing even though they are not meant to be seen now" —
  // reproduced live and confirmed: a click's own materialize side effect
  // (Viewport3D.tsx's own handleClick, ensureMaterialized) pulls that one
  // element out of the shared BatchedMesh into a real individual Mesh, but
  // only resolve() below ever populates targetsRef/batchVisibilityTargetsRef
  // — what every animation frame actually reads from — and it has no
  // dependency that fires on a mid-session materialization, so the newly-
  // individual mesh has no entry in either ref and nothing drives its
  // schedule-based visibility ever again, "clicking away" included.
  // A first attempt fixed this by adding selectedExpressId straight to
  // resolve()'s own dependency array — technically correct in principle,
  // but confirmed live to cause a real regression (every click briefly/
  // durably hid the rest of the model, reading as an accidental Isolate):
  // resolve() re-derives targetsRef/batchVisibilityTargetsRef for the
  // *entire* model from scratch, an expensive full re-traversal never
  // meant to run on every click, and something about re-running it
  // specifically off a selection change broke more than it fixed. Reverted
  // that outright rather than chase the exact mechanism further.
  // migrateSelectedExpressId below is the real fix: surgical, not a full
  // re-resolve — reuses the *already-resolved* ResolvedBatchVisibilityTarget
  // for this one specific expressID (built by the last real resolve() pass,
  // still perfectly valid for every other element) to construct a proper
  // individual ResolvedTimelineTarget for the now-materialized mesh, moves
  // it into targetsRef, and drops the stale batch entry — an O(1) map
  // lookup plus one small object construction, not a model-wide re-index,
  // so it's safe to run on every single click with no risk of reintroducing
  // that regression.
  selectedExpressId: number | null
  // Bumped by Viewport3D's own handleSelectAllClick after a bulk
  // materializeAll (2026-07-22, per Maro — same live repro as
  // selectedExpressId's own header above, but for Select All specifically:
  // "select all" on the Hospital file left the *entire* model stuck fully
  // visible at day one of the schedule, confirmed via a clean fresh-load
  // A/B test — empty before Select All, wrongly fully-built after). Select
  // All's materializeAll() call pulls every still-batched element out of the
  // shared BatchedMesh at once, same as a single click's ensureMaterialized,
  // but there is no single expressID for migrateSelectedExpressId's own
  // surgical per-element fix to key off — potentially thousands of fresh
  // individual meshes appear in one synchronous call, none of them wired
  // into targetsRef. Unlike selectedExpressId (rejected as a resolve()
  // dependency above for firing on every click), Select All is already a
  // deliberate, expensive, occasional bulk action — triggering one real
  // resolve() re-derive in response is proportionate, not a hot-path
  // regression risk.
  materializeVersion: number
  // 'baseline' (2026-07-12) — Mode A (the only animation source that reads
  // Activity dates at all) resolves each link's window from
  // activity.bl_start/bl_finish instead of activity.start/finish. Mode B
  // (manual keyframes) and Mode C (Follow Path) aren't schedule-driven, so
  // they resolve identically either way — a baseline pane showing the
  // "planned" timeline still plays the same hand-keyframed/path-bound
  // motion as the live pane, only the Activity-driven pieces differ.
  dateField?: 'live' | 'baseline'
}) {
  const targetsRef = useRef<ResolvedTimelineTarget[]>([])
  const pathTargetsRef = useRef<ResolvedPathTarget[]>([])
  const batchVisibilityTargetsRef = useRef<ResolvedBatchVisibilityTarget[]>([])
  // expressID -> { handle, target } for every element resolve() just gave a
  // ResolvedBatchVisibilityTarget (2026-07-22) — see migrateSelectedExpressId's
  // own header below for what this feeds. Rebuilt in lockstep with
  // batchVisibilityTargetsRef on every real resolve() pass; entries are
  // deleted as elements get individually migrated out, so a repeat click on
  // an already-migrated element is a single Map.has() miss, not repeated work.
  const expressIdToBatchTargetRef = useRef<Map<number, { handle: IfcModelHandle; target: ResolvedBatchVisibilityTarget }>>(new Map())

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      const activityById = new Map(activities.map(a => [a.id, a]))
      const profileById = new Map(profiles.map(p => [p.id, p]))
      // Dynamic import — see this component's own import block header for
      // why (keeping web-ifc out of the main bundle). Skipped entirely if
      // nothing here actually needs an ifc-kind lookup.
      const ifcModel = links.some(l => l.source_kind === 'ifc') && ifcHandles.length > 0 ? await import('./ifcModel') : null
      if (cancelled) return

      // Indexed once per handle rather than re-walked per link (2026-07-15
      // fix, per Maro: "on the first frame I expect to see nothing... these
      // elements... are visible" — the previous resolution below called
      // `handle.object.traverse()` — a full walk of the *entire* IFC
      // model's object graph — once for every single ModelElementLink row,
      // to find that one link's own mesh. Building one expressID->mesh map
      // per handle up front turns that into a single traverse per handle
      // plus a plain Map lookup per link.
      // Array per expressID, not a single mesh (2026-07-15 fix, per Maro:
      // "these framing elements... stay solid at every date" — verified
      // against the real Snowdon file: loadIfcModel (ifcModel.ts) creates
      // one THREE.Mesh per *geometry piece* under an element, not one per
      // element — a complex element like an open-web bar joist truss comes
      // back from web-ifc as a single expressID with dozens of separate
      // geometries (chords, web members, ...), each its own Mesh, all
      // tagged with that same shared expressID. A `Map<number, Object3D>`
      // can only ever remember the *last* one visited, silently dropping
      // every other piece — so only one truss member out of ~31 ever
      // actually got wired into the animation system, while the rest sat
      // at their native, fully-opaque imported material forever, reading
      // as "the whole joist never animates." A simple single-piece column
      // or beam (the common case) still gets a one-element array here, so
      // this changes nothing for the elements that already worked.
      //
      // Only used by the ifc_split branch below now (2026-07-21) — real IFC
      // elements (the `ifcModel` branch) resolve via getMaterializedMeshes
      // instead, since a plain traverse here can never see a still-batched
      // element (elementBatching.ts's own BatchedMesh optimization). Split
      // clones (elementSplitTargets.ts) are always real individual meshes,
      // never batched, so a plain traverse still finds them correctly and
      // cheaply — no need to route them through the batch-aware path too.
      const expressIdIndexByHandle = new Map<IfcModelHandle, Map<number, THREE.Object3D[]>>()
      const getExpressIdIndex = (handle: IfcModelHandle): Map<number, THREE.Object3D[]> => {
        let index = expressIdIndexByHandle.get(handle)
        if (!index) {
          index = new Map()
          handle.object.traverse(child => {
            const expressID = child.userData.expressID as number | undefined
            if (expressID === undefined) return
            const existing = index!.get(expressID)
            if (existing) existing.push(child); else index!.set(expressID, [child])
          })
          expressIdIndexByHandle.set(handle, index)
        }
        return index
      }
      // Same anti-pattern for mesh-kind links — `sceneObjects.find(...)` per
      // link is O(links * sceneObjects) — fixed the same way, by name.
      const meshByName = new Map(sceneObjects.filter(o => o.kind === 'mesh').map(o => [o.name, o.object]))

      const byObject = new Map<THREE.Object3D, ResolvedTimelineTarget>()
      const getOrCreate = (object: THREE.Object3D): ResolvedTimelineTarget => {
        let target = byObject.get(object)
        if (!target) {
          target = {
            object, links: [],
            basePosition: object.position.clone(),
            baseRotation: object.rotation.clone(),
            baseScale: object.scale.clone(),
            materials: collectStandardMaterials(object),
            keyframeTracks: {},
            cachedActiveLink: null,
            cachedState: null,
          }
          byObject.set(object, target)
        }
        return target
      }

      // Batched-visibility fast path's own dedupe map (2026-07-21) — see
      // ResolvedBatchVisibilityTarget's own header. Keyed by the batch
      // mesh's uuid + expressID rather than object identity (there's no
      // per-element Object3D to key on at all for a still-batched element)
      // so more than one link pointing at the same element still shares one
      // target, same reasoning as byObject above.
      const batchVisibilityByKey = new Map<string, ResolvedBatchVisibilityTarget>()
      // Rebuilt in lockstep with batchVisibilityByKey every real resolve()
      // pass (2026-07-22) — see this ref's own declaration above.
      expressIdToBatchTargetRef.current.clear()

      // Mode A — schedule-driven, via ModelElementLink (unchanged resolution
      // logic: mesh-kind by filename, ifc-kind via GlobalId->expressID).
      //
      // Yielded every 200 links (2026-07-15, per Maro: schedule generation
      // against a real IFC model creates one ModelElementLink per linked
      // element — thousands on a real structural+architectural run — and
      // every ifc-kind one here calls ifcModel.getExpressIdFromGuid, a
      // synchronous native WASM call. Run back-to-back with no yield, this
      // loop used to block the main thread for the entire batch in one go
      // any time this effect's deps changed (activities/links update after
      // Generate Schedule, on project load, ...) — same chunked-progress
      // idiom extractScheduleElements (ifcScheduleExtraction.ts) already
      // uses for its own bulk per-element WASM reads, just without a
      // visible progress bar here since this always resolves in the
      // background rather than inside a wizard step.
      for (let linkIndex = 0; linkIndex < links.length; linkIndex++) {
        if (linkIndex > 0 && linkIndex % 200 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0))
          if (cancelled) return
        }
        const link = links[linkIndex]
        const activity = activityById.get(link.activity_id)
        if (!activity) continue
        // dateField switch (2026-07-12) — see this component's own Props
        // header. `window` is what actually flows into ResolvedTimelineLink
        // below; pickActiveLink/computeAppliedAnimationStateAt only ever
        // read .start/.finish off of it, with zero awareness of which
        // source they came from.
        const window = dateField === 'baseline'
          ? { start: activity.bl_start, finish: activity.bl_finish }
          : { start: activity.start, finish: activity.finish }
        if (!window.start || !window.finish) continue
        // Parsed once here, not per frame (2026-07-21 perf fix) — see
        // pickActiveLink's own header in timelinePlayback.ts for why this
        // specifically used to matter: every ResolvedTimelineLink built from
        // this loop ends up read once per frame during actual Play/scrub,
        // at real-schedule scale.
        const windowStartMs = new Date(window.start).getTime()
        const windowFinishMs = new Date(window.finish).getTime()
        const profile = link.animation_profile_id ? profileById.get(link.animation_profile_id)?.config : DEFAULT_ANIMATION_CONFIG
        if (!profile) continue

        // One link can resolve to *several* mesh pieces (see
        // getExpressIdIndex's own header above) — every piece gets the
        // exact same {activity, profile, axis} pushed onto its own
        // ResolvedTimelineTarget, so each one independently computes the
        // identical per-frame state off its own captured base pose and
        // moves/fades in lockstep with its siblings, reconstructing the
        // whole element's animation instead of just one arbitrary member
        // of it.
        let objects: THREE.Object3D[] = []
        if (link.source_kind === 'mesh') {
          const mesh = meshByName.get(link.element_ref)
          if (mesh) objects = [mesh]
        } else if (link.source_kind === 'ifc_split') {
          // A level-slice (elementSplitTargets.ts) — its clone mesh(es)
          // already live in the same handle.object tree as everything
          // else, tagged with a synthetic (not real) expressID, so the
          // *only* thing different here is resolving element_ref via that
          // module's own map instead of ifcModel.getExpressIdFromGuid;
          // getExpressIdIndex below finds it exactly the same way it finds
          // a real element, since the clone genuinely has
          // userData.expressID set.
          for (const handle of ifcHandles) {
            const expressId = getSplitExpressId(handle, link.element_ref)
            if (expressId === undefined) continue
            const matches = getExpressIdIndex(handle).get(expressId)
            if (matches && matches.length > 0) { objects = matches; break }
          }
        } else if (ifcModel) {
          // Tries each loaded IFC model in turn for a GlobalId match
          // (2026-07-09, per federated/assembly modeling) — a link doesn't
          // record *which* model it belongs to, so this now has to ask
          // every currently-loaded one instead of assuming a single global
          // handle, same reasoning as linkedElements.ts's own
          // resolveInAnyHandle.
          for (const handle of ifcHandles) {
            const expressId = ifcModel.getExpressIdFromGuid(handle, link.element_ref)
            if (expressId === undefined) continue

            // Batched-visibility fast path (2026-07-21, per Maro — see
            // ResolvedBatchVisibilityTarget's own header) — tried *before*
            // getMaterializedMeshes below, and only for transform_kind
            // 'none' (pure opacity/colour, the profile every schedule-
            // generated link actually uses by default — confirmed by
            // tracing DEFAULT_ANIMATION_CONFIG). getBatchedInstanceInfo
            // returns null (not eligible) for anything already individual —
            // never batched to begin with, or already materialized for some
            // other reason (a manual edit, a previous non-'none' profile,
            // Select All, ...) — in which case this falls through to the
            // normal materializing path exactly as before, unchanged.
            if (profile.transform_kind === 'none') {
              const batchInfo = getBatchedInstanceInfo(handle.object, expressId)
              if (batchInfo) {
                const key = `${batchInfo.mesh.uuid}:${expressId}`
                let bvTarget = batchVisibilityByKey.get(key)
                if (!bvTarget) {
                  bvTarget = {
                    mesh: batchInfo.mesh, instances: batchInfo.instances, links: [],
                    cachedActiveLink: null, cachedState: null, lastColorHex: null,
                    expressIdByInstanceId: (handle.object.userData.batch as BatchState).expressIdByInstanceId,
                  }
                  batchVisibilityByKey.set(key, bvTarget)
                  // One expressID per bvTarget, always (2026-07-22) — this
                  // key is `${mesh.uuid}:${expressId}`, so reusing the same
                  // expressId always lands on the same bvTarget regardless
                  // of which link put it there; feeds
                  // migrateSelectedExpressId's own O(1) lookup below.
                  expressIdToBatchTargetRef.current.set(expressId, { handle, target: bvTarget })
                  // Same ModelObjects hand-off as the individual-mesh path's
                  // own timelineControlled marker (2026-07-22 fix, per Maro
                  // — see that one's own comment for the full story, and
                  // ModelObjects' own batch heavy-pass for why this is a
                  // second, separate instance of the identical race: a
                  // panel-driven Select by Storey/Type selection never
                  // materializes anything, so it hits this batch path, not
                  // the individual-mesh one — confirmed live, a still-
                  // selected batched element stayed stuck fully visible at
                  // day one exactly like the individual-mesh case did before
                  // its own fix). Marked per-instance, not per-expressID,
                  // since that's what ModelObjects' own setVisibleAt call
                  // below is keyed on.
                  const timelineControlledInstanceIds = (
                    batchInfo.mesh.userData.timelineControlledInstanceIds ??= new Set<number>()
                  ) as Set<number>
                  for (const { instanceId } of batchInfo.instances) timelineControlledInstanceIds.add(instanceId)
                }
                bvTarget.links.push({ activity: window, startMs: windowStartMs, finishMs: windowFinishMs, profile, axis: profile.axis })
                objects = []
                break
              }
            }

            // getMaterializedMeshes, not getExpressIdIndex (2026-07-21 fix,
            // per Maro — see elementBatching.ts's own header) — a real IFC
            // element whose geometry repeats gets batched into the shared
            // THREE.BatchedMesh (elementBatching.ts) and has no individual
            // THREE.Mesh/userData.expressID at all until something pulls it
            // out. getExpressIdIndex's plain traverse could never see those,
            // so any schedule-linked element that happened to still be
            // batched silently never animated. Materializes on demand (cheap
            // now that ensureMaterialized is O(1), not the whole-model
            // traverse this session's earlier bug made it) — reached for
            // anything the fast path above didn't already handle: a
            // transform-driven profile, or an element that wasn't eligible
            // for the fast path.
            const matches = getMaterializedMeshes(handle.object, expressId)
            if (matches.length > 0) { objects = matches; break }
          }
        }
        if (objects.length === 0) continue

        for (const object of objects) {
          const target = getOrCreate(object)
          target.links.push({ activity: window, startMs: windowStartMs, finishMs: windowFinishMs, profile, axis: profile.axis })
          // Tells ModelObjects' own per-mesh effect to back off `.visible`
          // for this mesh (2026-07-22 fix, per Maro — see that effect's own
          // `timelineControlled` check for the full story: while an element
          // stays selected, ModelObjects' heavy pass reruns every single
          // frame and was unconditionally winning the race against this
          // file's own correct per-frame write).
          object.userData.timelineControlled = true
          object.traverse(child => { child.userData.timelineControlled = true })
        }
      }

      // Mode B — manual keyframes, entirely independent of the above: any
      // mesh-kind scene object with at least one ElementKeyframe row gets a
      // target here regardless of whether it's linked to any activity at
      // all (2026-07-08, per Maro: "animate also independently from the
      // activity schedule... adding a simple cube and i cant do animation
      // because its asking for a dated activity"). IFC sub-elements aren't
      // included — v1 scope, see ElementKeyframe's own docstring for why.
      for (const so of sceneObjects) {
        if (so.kind !== 'mesh') continue
        const tracks: ResolvedTimelineTarget['keyframeTracks'] = {}
        for (const kf of elementKeyframes) {
          // path_progress is Mode C's own field (see the Follow Path block
          // below, which builds progressTrack from it directly) — never a
          // real pos/rot/scale track. Left in here, this object would still
          // qualify for a Mode B target (`Object.keys(tracks).length > 0`)
          // with no pos_x/y/z entries of its own, and applyKeyframedTransform
          // resets every axis with no track back to basePosition (2026-07-12
          // fix, per Maro: "playing it doesnt move the object" — Mode B was
          // stomping the path-bound position back to its pre-bind spot on
          // every frame the date changed, right after Mode C had just set it
          // correctly; only imperceptible during a single step/scrub because
          // the very next unchanged-date frame let Mode C's unconditional
          // reapply correct it again before the eye could catch it).
          if (kf.field === 'path_progress') continue
          if (kf.source_kind !== 'mesh' || kf.element_ref !== so.name) continue
          const points = tracks[kf.field] ?? (tracks[kf.field] = [])
          points.push({ date: new Date(kf.date), value: kf.value })
        }
        if (Object.keys(tracks).length === 0) continue
        getOrCreate(so.object).keyframeTracks = tracks
      }

      // Mode C — Follow Path (2026-07-11) — resolved separately from Mode
      // A/B above rather than folded into ResolvedTimelineTarget: a path-
      // bound object's position is computed directly from the curve, not
      // offset from a captured basePosition the way keyframeTracks/profile
      // offsets are, so it doesn't share that shape. Mesh-kind only this
      // pass — see ResolvedPathTarget's own header.
      const pathById = new Map(paths.map(p => [p.id, p]))
      const nextPathTargets: ResolvedPathTarget[] = []
      for (const follower of pathFollowers) {
        if (follower.target_kind !== 'mesh') continue
        const path = pathById.get(follower.path_id)
        if (!path) continue
        const so = sceneObjects.find(o => o.kind === 'mesh' && o.name === follower.element_ref)
        if (!so) continue
        const progressTrack: { date: Date; value: number }[] = []
        for (const kf of elementKeyframes) {
          if (kf.source_kind !== 'mesh' || kf.field !== 'path_progress' || kf.element_ref !== follower.element_ref) continue
          progressTrack.push({ date: new Date(kf.date), value: kf.value })
        }
        nextPathTargets.push({
          object: so.object,
          curve: buildPathCurve(path.points, path.closed),
          singlePoint: path.points.length === 1 ? new THREE.Vector3(path.points[0].x, path.points[0].y, path.points[0].z) : null,
          orientToPath: follower.orient_to_path,
          progressTrack,
        })
      }

      if (!cancelled) {
        targetsRef.current = [...byObject.values()]
        batchVisibilityTargetsRef.current = [...batchVisibilityByKey.values()]
        pathTargetsRef.current = nextPathTargets
        // Immediately reflects the latest keyframe data (2026-07-09) —
        // adding/removing/editing a keyframe elsewhere (TransformPanel's
        // own keyframe dot) doesn't move the timeline's own date, so the
        // useFrame loop's own date-changed gate (see its header) wouldn't
        // otherwise re-apply anything until the next actual scrub, leaving
        // a stale pose in the meantime. One-off, not per-frame — matches
        // Blender's own dependency-graph-updates-on-data-change behavior,
        // not just frame-change. Path targets get the same treatment.
        const now = dateRef.current
        if (now) {
          for (const target of targetsRef.current) {
            if (Object.keys(target.keyframeTracks).length > 0) {
              applyKeyframedTransform(target, now, upAxis)
            } else {
              // Schedule-driven (non-keyframe) targets get the same one-off
              // treatment as keyframed ones just above (2026-07-22 fix, per
              // Maro: a wall linked to an activity starting over a month
              // later was showing fully visible right after being selected
              // via Select All — reproduced live and confirmed the *actual*
              // trigger isn't limited to a single direct click: any path
              // that materializes an element out of the shared batch
              // *without* going through this file's own selectedExpressId-
              // keyed migration effect below (Select All is exactly that —
              // ModelObjects' own selection-tint pass has to individually
              // materialize every element it selects to tint each one, but
              // selectedExpressId itself stays null for a genuine multi-
              // select, so that migration effect's own guard skips every
              // one of them) leaves a fresh getOrCreate() target — built by
              // this same resolve() pass, a few dozen lines up, once
              // getMaterializedMeshes finds it already individual — sitting
              // at cachedState: null exactly like a freshly-materialized
              // batch target used to. Computed here immediately, the same
              // way the migration effect and the batch loop just below both
              // already do, rather than waiting for the next real date
              // change that may never come in the same session.
              target.cachedActiveLink = pickActiveLink(target.links, now)
              target.cachedState = target.cachedActiveLink
                ? computeAppliedAnimationStateAt(target.cachedActiveLink, now)
                : null
            }
          }
          for (const target of nextPathTargets) applyPathFollow(target, now)
          // Batch-visibility targets get the same one-off treatment
          // (2026-07-22 fix, per Maro: a wall linked to an activity starting
          // over a month later was showing fully visible right after
          // Generate Schedule, with no click and no scrub — confirmed via
          // the real schedule data, not assumed). This block already knew
          // to immediately reflect fresh keyframe/path data instead of
          // waiting for the useFrame loop's own dateChanged gate below — it
          // just never knew batchVisibilityTargetsRef existed yet (added
          // 2026-07-21, after this block was written) and left every fresh
          // batch target's cachedActiveLink/cachedState at the null they're
          // built with. useFrame's own dateChanged gate (`lastAppliedDateMs
          // !== nowMs`) only catches this once per genuine date change —
          // true on the very first frame ever, after which it's already
          // been "consumed" by whatever was in targetsRef/batchVisibility
          // *before* this resolve() pass, so a later resolve() (activities/
          // links changing — Generate Schedule, a project reload, ...)
          // rebuilding fresh batch targets on an unmoved date left every one
          // of them stuck with a null cachedState, and therefore
          // `scheduleVisible = false ? ...` never overrides their default
          // fully-visible import state, for the rest of the session unless
          // someone happens to scrub. Computed here the same way the
          // migration effect below now does for its own fresh targets.
          for (const bv of batchVisibilityTargetsRef.current) {
            bv.cachedActiveLink = pickActiveLink(bv.links, now)
            bv.cachedState = bv.cachedActiveLink ? computeAppliedAnimationStateAt(bv.cachedActiveLink, now) : null
          }
        }
      }
    }

    resolve()
    return () => { cancelled = true }
  }, [sceneObjects, activities, links, profiles, elementKeyframes, ifcHandles, paths, pathFollowers, dateField, materializeVersion])

  // Surgical migration for one just-materialized element (2026-07-22) — see
  // this component's own selectedExpressId prop header for the full story
  // (a click's own materialize side effect otherwise permanently detaches
  // that element from schedule-driven animation, and a first, reverted fix
  // attempt tried solving it by re-running the whole resolve() effect above
  // on every click instead, which caused a real regression of its own).
  // Deliberately its own tiny effect, not folded into resolve(): this only
  // ever touches the one element selectedExpressId currently refers to — an
  // O(1) Map lookup, and only if that lookup actually hits, one small
  // object build — never a model-wide re-index. Viewport3D's own render
  // body already calls ensureMaterialized synchronously for the active
  // selection (the TransformPanel gizmo's own target resolution) before any
  // effect ever runs, so by the time this fires, getMaterializedMeshes
  // below is guaranteed to see whatever that call just produced.
  useEffect(() => {
    if (selectedExpressId === null) return
    const entry = expressIdToBatchTargetRef.current.get(selectedExpressId)
    if (!entry) return
    const { handle, target: bvTarget } = entry
    const meshes = getMaterializedMeshes(handle.object, selectedExpressId)
    // Not actually materialized (yet, or ever, e.g. a transform-driven
    // profile's own selectedExpressId that was never routed onto the
    // batch fast path to begin with) — left in the map so a later
    // selection change checks again cheaply instead of assuming this one
    // negative result forever.
    if (meshes.length === 0) return

    expressIdToBatchTargetRef.current.delete(selectedExpressId)
    batchVisibilityTargetsRef.current = batchVisibilityTargetsRef.current.filter(t => t !== bvTarget)
    // bvTarget.links carries the exact same {activity, startMs, finishMs,
    // profile, axis} entries the batch fast path was already driving this
    // element with — reused verbatim, not re-derived, since nothing about
    // which activities/profiles link to this element changed, only how
    // it's rendered (individual mesh vs. batch instance) did.
    //
    // cachedActiveLink/cachedState computed right here, not left null
    // (2026-07-22 fix, per Maro: a wall linked to an activity starting over
    // a month later was showing fully visible the instant it was clicked,
    // with no scrub in between — confirmed via the real schedule data, not
    // assumed). The main useFrame loop below only ever *recomputes* a
    // target's cache when the timeline's date has actually changed since
    // last frame (`dateChanged`) — correct for every target that already
    // existed on the previous frame, but this target didn't: it's being
    // created fresh, mid-session, on a frame where the date usually hasn't
    // moved at all (a plain click, not a scrub). Left null, it fell through
    // `else if (state && activeLink)` every single frame — no visibility,
    // opacity, or position write at all — leaving the freshly-materialized
    // mesh stuck at whatever default-visible state ensureMaterialized gave
    // it until the *next* real date change happened to come along, which
    // could be never in the same session. Computed once, immediately, from
    // the current date the same way resolve()'s own initial pass already
    // does for every other fresh target (a few dozen lines up) — the
    // unconditional write block below then applies it on the very next
    // frame regardless of dateChanged, exactly like every other target.
    const now = dateRef.current
    const migrated: ResolvedTimelineTarget[] = meshes.map(object => {
      const cachedActiveLink = now ? pickActiveLink(bvTarget.links, now) : null
      const cachedState = cachedActiveLink && now ? computeAppliedAnimationStateAt(cachedActiveLink, now) : null
      // baseColor corrected against getOriginalMaterialSlots, not trusted
      // as collectStandardMaterials captured it (2026-07-22 fix, per Maro:
      // a deselected element's highlight tint was sticking permanently on
      // exactly this class of element — reproduced live and confirmed:
      // ModelObjects' own selection-tint effect and this migration effect
      // both fire off the same selectedExpressId change, in the same React
      // commit, and ModelObjects mounts first in this file's own JSX (see
      // its call site above TimelinePlayback's) — so by the time this runs,
      // the mesh ensureMaterialized just created has *already* been tinted
      // toward SELECTED_EMISSIVE (it's normally the active selection,
      // that's what triggered materialization to begin with).
      // collectStandardMaterials's own baseColor is just `material.color`
      // read at call time, with no idea any of that happened, so it
      // captured the tint itself as "the real colour" — permanently, since
      // nothing ever recomputes it afterward. Every later frame this target
      // has an active link but no colour profile (state.color null, the
      // common case — see the material-diff block below), the loop
      // reasserts *that* frozen-in tint back onto the mesh, undoing
      // ModelObjects' own correct restore-to-original on every deselect
      // from then on. getOriginalMaterialSlots reads
      // finalizeIndividualMesh's own captureOriginalMaterial snapshot
      // instead — taken synchronously inside ensureMaterialized itself,
      // before this mesh is even added to the scene and so well before
      // either effect above can touch it — the one source in this whole
      // path actually guaranteed untinted.
      const originalSlots = getOriginalMaterialSlots(object)
      const materials = collectStandardMaterials(object).map((entry, i) => (
        originalSlots[i] ? { ...entry, baseColor: originalSlots[i].color.clone() } : entry
      ))
      // Same ModelObjects hand-off as resolve()'s own Mode A loop above —
      // see its own timelineControlled comment for the full story.
      object.userData.timelineControlled = true
      return {
        object, links: [...bvTarget.links],
        basePosition: object.position.clone(),
        baseRotation: object.rotation.clone(),
        baseScale: object.scale.clone(),
        materials,
        keyframeTracks: {},
        cachedActiveLink,
        cachedState,
      }
    })
    targetsRef.current = [...targetsRef.current, ...migrated]
  }, [selectedExpressId])

  // Tracks the last date keyframed transforms were actually applied for
  // (2026-07-09 fix, per Maro: "keyframing locks the model in place when
  // that's not how it works") — the bug: this whole useFrame previously
  // called applyKeyframedTransform unconditionally on *every* render
  // frame (~60/sec), regardless of whether the timeline's current date had
  // moved at all. The instant any field had even one keyframe, that field
  // became permanently unmovable — any manual drag/typed edit got
  // overwritten within a single frame, before the user could even see it
  // land, let alone press the keyframe dot to record a *new* key there.
  // Blender's own animation system doesn't work this way: a keyed channel
  // only gets re-evaluated when the current frame actually changes: sit
  // still on one frame and you can freely pose the object by hand
  // (that's exactly how you set up a new keyframe — pose it, then press I
  // to insert); only scrubbing/playing re-triggers evaluation, which is
  // when an un-keyed manual pose reverts to whatever the curve says.
  // Comparing the date's own timestamp (not object identity — a fresh
  // `Date` object often gets constructed each tick even for the "same"
  // moment) reproduces exactly that: still applies smoothly every frame
  // during actual playback (the date genuinely changes every frame then),
  // but stops fighting the user the instant playback pauses.
  const lastAppliedDateMs = useRef<number | null>(null)

  useFrame(() => {
    const now = dateRef.current
    if (!now || (
      targetsRef.current.length === 0 && pathTargetsRef.current.length === 0 && batchVisibilityTargetsRef.current.length === 0
    )) return
    const nowMs = now.getTime()
    const dateChanged = lastAppliedDateMs.current !== nowMs
    lastAppliedDateMs.current = nowMs
    let needsUpdateBudget = MAX_NEEDS_UPDATE_PER_FRAME

    for (const target of targetsRef.current) {
      const hasKeyframes = Object.keys(target.keyframeTracks).length > 0
      // Only recomputed on an actual date change (see cachedActiveLink/
      // cachedState's own doc comment) — the unconditional writes below
      // (transform + material reassertion) keep reusing whatever was
      // computed on the last date-changed frame.
      if (dateChanged) {
        target.cachedActiveLink = pickActiveLink(target.links, now)
        target.cachedState = target.cachedActiveLink
          ? computeAppliedAnimationStateAt(target.cachedActiveLink, now)
          : null
      }
      const activeLink = target.cachedActiveLink
      const state = target.cachedState

      if (hasKeyframes) {
        if (dateChanged) applyKeyframedTransform(target, now, upAxis)
      } else if (state && activeLink) {
        // Diffed before writing, not applied unconditionally (2026-07-21
        // perf fix, per Maro: "animation literally doesn't play and instead
        // snaps to position due to ridiculous lag" — this block used to
        // rewrite position/rotation/scale on `target.object` every single
        // frame regardless of whether the computed values had actually
        // changed since last frame. `dateChanged` being true just means
        // `now` moved at all, not that *this specific target's* animation
        // state moved — most elements in a real multi-discipline schedule
        // are already fully installed and done animating (offset 0,
        // multiplier 1) for the overwhelming majority of the timeline, so
        // this was three Vector3/Euler writes, every frame, for effectively
        // every already-settled element, at a scale (six combined
        // discipline files' worth of linked elements) where that adds up to
        // real per-frame cost. Comparing against `target.object`'s own
        // CURRENT values (not a separately-cached "last written" value)
        // keeps the same "an external change gets corrected next frame"
        // correctness the material diff below already relies on, while
        // skipping the write for every target whose computed pose hasn't
        // actually moved.
        _scratchPosition.set(
          target.basePosition.x + state.positionOffset[0],
          target.basePosition.y + state.positionOffset[1],
          target.basePosition.z + state.positionOffset[2],
        )
        _scratchEuler.copy(target.baseRotation)
        _scratchEuler[activeLink.axis] += state.rotationOffsetDeg * DEG_TO_RAD
        _scratchScale.copy(target.baseScale).multiplyScalar(state.scaleMultiplier)
        if (!target.object.position.equals(_scratchPosition)) target.object.position.copy(_scratchPosition)
        if (!target.object.rotation.equals(_scratchEuler)) target.object.rotation.copy(_scratchEuler)
        if (!target.object.scale.equals(_scratchScale)) target.object.scale.copy(_scratchScale)
      }

      // Opacity/colour always come from the profile alone (if any) — never
      // fought over by keyframeTracks, which only ever cover transform.
      if (state) {
        for (const { material, baseColor, mesh } of target.materials) {
          // Diffed before writing, not applied unconditionally (2026-07-17
          // perf fix, per Maro: "mad laggy" — this loop runs every single
          // frame by design (see mesh.visible's own comment below on why —
          // some other effect can reset a mesh's state between date-change
          // ticks and this has to keep reasserting it), but material.
          // needsUpdate = true forces three.js to re-upload/recompile the
          // material's GPU-facing state, and that was firing unconditionally
          // for every material of every animated target, every frame,
          // regardless of whether anything actually changed — fine at
          // structural+architectural scale, not at six combined discipline
          // files' worth of linked elements. Comparing against the
          // material's own CURRENT value (not a separately-cached "what we
          // last wrote" value) preserves the original "reassert every
          // frame" correctness — an external change is still detected and
          // corrected on the very next frame — while skipping the actual
          // GPU-facing write (and the costly needsUpdate flag) whenever
          // nothing would change, which is the overwhelming majority of
          // frames whenever the timeline itself isn't actively moving.
          const nextTransparent = state.opacity < 1
          // state.color is a hex string (profile config), baseColor a real
          // THREE.Color — normalized through one reused scratch Color
          // (module-level, below) rather than allocating a fresh one every
          // material every frame just to compare.
          if (state.color) _scratchColor.set(state.color); else _scratchColor.copy(baseColor)
          let changed = false
          if (material.transparent !== nextTransparent) { material.transparent = nextTransparent; changed = true }
          if (material.opacity !== state.opacity) { material.opacity = state.opacity; changed = true }
          if (!material.color.equals(_scratchColor)) { material.color.copy(_scratchColor); changed = true }
          // Frame-budgeted (2026-07-21) — see MAX_NEEDS_UPDATE_PER_FRAME's
          // own header. The property values above are always written
          // immediately regardless of budget (cheap, no GPU cost); only the
          // `needsUpdate` flag itself — the expensive part — can be
          // deferred to a later frame. pendingAnimUpdate (material.userData,
          // same idiom as lambertVariant/hiddenLineVariant below) persists
          // across frames so a material that missed this frame's budget
          // isn't silently dropped: `changed` alone can't be relied on for
          // this, since by the next frame the properties already match (we
          // just wrote them) and would otherwise never re-trigger the flag.
          if (changed) material.userData.pendingAnimUpdate = true
          if (material.userData.pendingAnimUpdate && needsUpdateBudget > 0) {
            material.needsUpdate = true
            material.userData.pendingAnimUpdate = false
            needsUpdateBudget--
          }

          // Combined with ModelObjects' own showFaces/isolate/hidden verdict
          // (cached on mount/settings-change as userData.baseVisible, since
          // that effect never reruns on its own just because the timeline's
          // date changed) rather than overwriting `.visible` outright — a
          // manually-Hidden element must stay hidden even mid-animation,
          // and an animation-hidden element must stay unclickable even
          // when nothing else is hiding it. Every frame, so leaving the
          // "before start" pose (or scrubbing back into it) reliably
          // re-hides a mesh some other effect had last set visible.
          // (Plain assignment, not diffed — .visible has no GPU-facing
          // cost the way needsUpdate does, nothing to save here.)
          mesh.visible = (mesh.userData.baseVisible ?? true) && state.opacity > ANIMATION_VISIBILITY_EPSILON

          // Gouraud/Hidden Line render modes display a cached variant
          // derived from this material (renderModeMaterials.ts's own
          // getGouraudVariant/getHiddenLineMaterial), not this material
          // itself — normally re-synced by ModelObjects' own effect above,
          // but that effect's dependency list doesn't include the
          // timeline's date, so a pure playback tick never re-runs it
          // (2026-07-13, per Maro: "gouraud render mode doesnt go with the
          // animation... i'll need to go back to flat and back to gouraud
          // before it works" — toggling render modes force-reruns that
          // effect, which is why it "works as still"). Propagated here
          // every frame instead so both variants stay live during Play,
          // not just at the moment they're (re)built.
          const lambertVariant = material.userData.lambertVariant as THREE.MeshLambertMaterial | undefined
          if (lambertVariant) {
            lambertVariant.transparent = material.transparent
            lambertVariant.opacity = material.opacity
            lambertVariant.color.copy(material.color)
          }
          const hiddenLineVariant = material.userData.hiddenLineVariant as THREE.MeshBasicMaterial | undefined
          if (hiddenLineVariant) {
            // Hidden Line's own colour is a fixed selection tint, not the
            // element's real colour (getHiddenLineMaterial's own header) —
            // only opacity/transparency need to track playback here.
            hiddenLineVariant.transparent = material.transparent
            hiddenLineVariant.opacity = material.opacity
          }

          // The black EdgesGeometry overlay (ModelObjects' own effect
          // above) has its own separate LineBasicMaterial, set once at
          // creation and otherwise untouched — so an element fading out
          // per the 4D sequence used to keep its edges fully opaque and
          // visible regardless (2026-07-13, per Maro: "hidden lines shows
          // the edges match the sequence and are just static... the faces
          // go through this process but not the edges"). Faded the same
          // way the face material itself is, rather than toggling
          // `.visible` (which is exclusively owned by the settings-driven
          // showEdges/renderMode effect above — touching it here would
          // fight that effect instead of cooperating with it).
          const edges = mesh.userData.edgesHelper as THREE.LineSegments | undefined
          if (edges) {
            const edgesMaterial = edges.material as THREE.LineBasicMaterial
            edgesMaterial.transparent = state.opacity < 1
            edgesMaterial.opacity = state.opacity
          }
        }
      }
    }

    // Batched-visibility fast path (2026-07-21) — see
    // ResolvedBatchVisibilityTarget's own header. No transform, no
    // individual mesh/material at all: just a per-instance visible flip
    // (and, only for profiles that ask for it, a colour tint) directly on
    // the shared THREE.BatchedMesh — draw-call count for this element never
    // changes no matter how the schedule links it.
    for (const bv of batchVisibilityTargetsRef.current) {
      if (dateChanged) {
        bv.cachedActiveLink = pickActiveLink(bv.links, now)
        bv.cachedState = bv.cachedActiveLink
          ? computeAppliedAnimationStateAt(bv.cachedActiveLink, now)
          : null
      }
      const state = bv.cachedState
      const scheduleVisible = state ? state.opacity > ANIMATION_VISIBILITY_EPSILON : false
      // Composed with ModelObjects' own isolate/hide verdict, not just the
      // schedule's (2026-07-21 fix, per Maro: "still not isolating" — a
      // real, confirmed bug, not the theoretical "corrected next frame"
      // this comment used to claim). ModelObjects' settings-driven pass
      // (showFaces/isolate/hidden) also calls setVisibleAt on this same
      // BatchedMesh, but only on its own much rarer heavyChanged trigger,
      // while this loop runs unconditionally every animation frame — so
      // "an external change is corrected on the very next frame" only ever
      // ran in this loop's own favour: the instant a schedule-linked
      // element was isolated, this loop's next tick silently reasserted
      // scheduleVisible over it, with zero awareness isolate mode even
      // existed, permanently. batchBaseVisibleByInstanceId (set by that
      // same ModelObjects pass, immediately above in this same file) is
      // that verdict, cached per instance the same way an individual
      // mesh's own userData.baseVisible already is — ANDed in here exactly
      // like `(mesh.userData.baseVisible ?? true) && state.opacity > ...`
      // already does for the individual-mesh path a few dozen lines above.
      const baseVisibleByInstanceId = bv.mesh.userData.batchBaseVisibleByInstanceId as Map<number, boolean> | undefined
      for (const { instanceId } of bv.instances) {
        // Skips an instance ensureMaterialized has already pulled out of
        // the shared batch (2026-07-22 fix) — see ResolvedBatchVisibilityTarget's
        // own expressIdByInstanceId header for the exact race this catches:
        // this bvTarget can still be sitting in batchVisibilityTargetsRef
        // for one or more frames after a click already materialized this
        // one instance (the migration effect that removes it is async), and
        // writing here during that window reasserts this bvTarget's own
        // stale pre-click visibility right on top of ensureMaterialized's
        // already-correct hide, permanently — nothing else ever revisits an
        // orphaned instance once both systems have stopped tracking it.
        if (!bv.expressIdByInstanceId.has(instanceId)) continue
        const baseVisible = baseVisibleByInstanceId?.get(instanceId) ?? true
        const nextVisible = baseVisible && scheduleVisible
        if (bv.mesh.getVisibleAt(instanceId) !== nextVisible) bv.mesh.setVisibleAt(instanceId, nextVisible)
      }
      // null once the profile's own colour window has passed (see
      // computeAppliedAnimationStateAt's own header) — restores each
      // instance's real imported colour rather than leaving the last tint
      // applied stuck on forever.
      const nextColorHex = state?.color ?? null
      if (bv.lastColorHex !== nextColorHex) {
        if (nextColorHex) {
          _scratchColor.set(nextColorHex)
          for (const { instanceId } of bv.instances) bv.mesh.setColorAt(instanceId, _scratchColor)
        } else {
          for (const { instanceId, baseColor } of bv.instances) bv.mesh.setColorAt(instanceId, baseColor)
        }
        bv.lastColorHex = nextColorHex
      }
    }

    // Mode C runs LAST, deliberately (2026-07-12 fix, per Maro: "the
    // profile isnt working right... profile + path now both fight/glitch")
    // — the first attempt at this fix only guarded Mode A's own transform
    // block against a path-bound object, but Mode B's applyKeyframedTransform
    // has the *identical* problem: it resets any axis with no explicit
    // keyframe back to basePosition, so a path-bound object that also
    // happens to carry an unrelated keyframe (rotation, or a leftover
    // position key from earlier testing) got stomped right back the same
    // way, just through a different code path. Rather than adding another
    // one-off exclusion check (and inevitably missing the next mode that
    // touches position too), Follow Path simply applies *after* every
    // other mode has had its say each frame — path position is always the
    // final word for a bound object, full stop, no matter what Mode A/B
    // computed moments earlier in the same frame. No dateChanged gate:
    // unlike Mode A/B, a path-bound object's Location fields are locked
    // read-only in TransformPanel (see PathProgressSupport's own header),
    // so there's no manual-edit-vs-playback fight to guard against here —
    // always safe to re-apply, last, unconditionally.
    for (const target of pathTargetsRef.current) applyPathFollow(target, now)

    if (activeObjectId) onTick()
  })

  return null
}

// Canvas's own `camera={{ fov, near, far, up }}` prop (below) only sets
// these on the camera it constructs at mount — it isn't reactive, so
// changing a setting afterwards needs this: re-applied every time
// fov/near/far/upAxis change (2026-07-11 addition, per Maro: Blender's View
// tab "Clip Start"/"Clip End" — the camera's near/far planes; upAxis added
// 2026-07-08, see upAxis.ts's header — OrbitControls reads camera.up to
// decide which direction stays "vertical" on screen while orbiting, so this
// has to move in lockstep with the content-rotation group below it.)
function CameraSettings({ fov, near, far, upAxis }: { fov: number; near: number; far: number; upAxis: UpAxis }) {
  const { camera } = useThree()
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fov
      camera.near = near
      camera.far = far
      camera.updateProjectionMatrix()
    }
    camera.up.set(0, upAxis === 'z' ? 0 : 1, upAxis === 'z' ? 1 : 0)
  }, [camera, fov, near, far, upAxis])
  return null
}

// Box-select (2026-07-08, per Maro: "select box in viewport") needs the live
// camera to project each object's world position into screen space, but the
// drag-rectangle itself is tracked in plain DOM pointer events on the
// wrapping div *outside* the Canvas (so it keeps working over empty space,
// which R3F's per-mesh onClick never sees) — this just mirrors the camera
// three.js already constructed into a ref that outside code can read.
// rendererRef (2026-07-10, per Maro: still-image capture + camera
// bookmarks) — same mirror-into-a-ref-for-outside-code purpose as
// cameraRef already served; the renderer's own <canvas> element
// (gl.domElement) is what handleCaptureImage below actually reads pixels
// from.
function CameraCapture({ cameraRef, rendererRef }: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>
}) {
  const { camera, gl } = useThree()
  useEffect(() => { cameraRef.current = camera }, [camera, cameraRef])
  useEffect(() => { rendererRef.current = gl }, [gl, rendererRef])
  return null
}

// Section Box support (2026-07-09, per Maro's Blender reference) — three.js
// ignores every material's own `clippingPlanes` array unless this renderer-
// level flag is on (default false); set once, unconditionally, same as
// CameraSettings above sets camera.fov/near/far once. Mounted regardless of
// whether any Section Box actually exists yet, so the flag is already on
// the moment the first one is created.
function ClippingSetup() {
  const { gl } = useThree()
  useEffect(() => { gl.localClippingEnabled = true }, [gl])
  return null
}

// The persistent 3D viewport (2026-07-09/10, per Maro) — always mounted by
// FourD.tsx regardless of which windows are open above it or what's been
// imported, so bringing in/exiting a Schedule/Resource Tracking/Resource
// Usage window (or importing/selecting a model) never disturbs it. Real
// camera controls (orbit/pan/zoom) and the axis-orientation gizmo work
// whether or not anything's loaded.
//
// <Environment> (2026-07-11) — fixes imported models rendering flat gray
// regardless of their actual material: GLTFLoader's fallback material for
// any mesh with no material assigned is metalness:1/roughness:1, and a
// fully metallic surface has essentially no diffuse response — it only
// shows reflected environment light, which plain ambient+directional lights
// don't provide. Defaults to DEFAULT_ENVIRONMENT_URL above (self-hosted,
// per Maro) — environmentUrl (a user-uploaded .hdr/.exr, PropertiesPanel.tsx's
// "Environment" section) overrides it when set, both going through the same
// files= path since both are just URLs at this point (a local data: URL for
// an upload, a same-origin path for the default) — no CDN involved either
// way. Wrapped in ViewportErrorBoundary regardless, so a missing/corrupt
// file (default or uploaded) degrades to "no environment" instead of
// crashing the app the way the old CDN-preset default once did.
//
// TransformControls' onChange calls onTransformChange (a plain callback,
// not local state) — the actual Transform number fields moved out of this
// component into PropertiesPanel.tsx (2026-07-11, per Maro), a sibling of
// Viewport3D under FourD.tsx rather than a child of it, so a local re-render
// trigger here wouldn't reach it; FourD.tsx owns the tick state that
// re-renders both.
export function Viewport3D({
  settings, importedObjects, selectedExpressId, selectedExpressIds, onSelect, activeObjectId, selectedObjectIds, onSelectObject,
  onSelectAll, materializeVersion, onMaterializeAll, onBoxSelect, isolateMode, isolatedObjectIds, isolatedExpressIds, hiddenExpressIds, onToggleIsolate, onShowAll, onHideSelected, linkedActivitiesWidget,
  linkedObjectIds, linkedElementKeys, onSelectUnassigned,
  gizmoMode, onTransformChange,
  environmentUrl, onEnvironmentError, customTextures,
  timelineDateRef, timelineSceneObjects, timelineActivities, timelineLinks, timelineProfiles, timelineElementKeyframes, ifcHandles, active,
  sectionBoxes, onSectionBoxDragMove, onSectionBoxDragEnd, onSectionBoxRotateMove, onSectionBoxRotateEnd, sectionBoxTool,
  onSaveCameraView, applyCameraViewRequest, onExportVideo,
  scheduleStart, scheduleEnd,
  paths, pathFollowers, addingPointsForPathId, onPathDragMove, onPathDragEnd, onAddPathPoint,
  annotations, addingAnnotationKind, onPlaceAnnotation, selectedAnnotationId, onSelectAnnotation, onAnnotationDragMove, onAnnotationDragEnd,
  varianceByElementKey, clashByElementKey, pivotPicking, onPickPivotPoint, elementParents,
  measurements, unitPreference, selectedMeasurementId, onSelectMeasurement, measuringTool, measuringPoints, measuringToMetres, onMeasurementHit,
  measurementHoverPoint, onMeasurementHoverPoint,
}: Props) {
  const activeImportedObject = importedObjects.find(o => o.id === activeObjectId) ?? null
  // The gizmo targets the *specific selected sub-element*, not the whole
  // IFC model, whenever one's actually picked (2026-07-08, per Maro: "the
  // whole ifc model is grouped, even though i select an individual object.
  // using any of the transforms affect the model") — previously always the
  // top-level group regardless of what was selected in the Project Overview
  // tree, on the theory that repositioning individual BIM elements wasn't a
  // real workflow; turns out it is. Falls back to the whole model when
  // nothing more specific is selected (or for mesh-kind imports, which have
  // no sub-element concept at all).
  const activeObject = (() => {
    if (!activeImportedObject) return null
    if (activeImportedObject.kind === 'ifc' && selectedExpressId !== null) {
      const handle = ifcHandles.find(h => `ifc-${h.modelID}` === activeImportedObject.id)
      if (handle) {
        // ensureMaterialized, not a plain traverse (2026-07-17) — see
        // elementBatching.ts's own header: a repeated-geometry element may
        // still be sitting in the shared BatchedMesh rather than its own
        // traversable mesh if selected some way other than a click.
        const found = ensureMaterialized(handle.object, selectedExpressId)
        if (found) return { ...activeImportedObject, object: found }
      }
    }
    return activeImportedObject
  })()
  const activeEnvironmentUrl = environmentUrl ?? DEFAULT_ENVIRONMENT_URL
  const zUp = settings.upAxis === 'z'

  // Model-scale radius (2026-07-19 fix, per Maro: "shadow is still weird
  // floating on that plane") — a real building can easily span well past
  // the fixed 20-unit light distance this used before, which put the
  // "sun" only marginally outside (sometimes practically inside) the
  // model's own volume instead of comfortably above/around it, producing
  // exactly this kind of warped, disconnected-looking shadow. Derived from
  // the actual loaded model's own bounding sphere (its diagonal/2) instead
  // of a fixed guess, so the light — and its shadow camera's own frustum
  // below — scale to whatever's actually loaded rather than one arbitrary
  // demo-scale number. Memoized since expandByObject does a real geometry
  // traversal, not free to redo on every unrelated render. Falls back to
  // 20 (the old fixed default) when nothing's loaded yet.
  const modelRadius = useMemo(() => {
    const box = new THREE.Box3()
    let any = false
    for (const { object } of importedObjects) { box.expandByObject(object); any = true }
    if (!any || box.isEmpty()) return 20
    return Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importedObjects])

  // Sun azimuth/elevation -> a real directional-light position (2026-07-19,
  // per Maro: "make [shadows] more distinct, able to control shadow/light
  // angle" — see viewerSettings.ts's own sunAzimuth/sunElevation header for
  // why these two numbers and their defaults). Plain spherical-to-Cartesian
  // conversion at modelRadius * 3 (comfortably outside the model regardless
  // of its real scale, see modelRadius's own comment just above — this
  // used to be a fixed 20 regardless of model size); azimuth is the compass
  // angle in the ground plane, elevation the angle up from it, with the
  // ground plane's own two axes swapped between up-axis conventions the
  // same way every other zUp-conditional in this file already is.
  const sunAzimuthRad = (settings.sunAzimuth * Math.PI) / 180
  const sunElevationRad = (settings.sunElevation * Math.PI) / 180
  const sunRadius = modelRadius * 3
  const sunHorizontal = Math.cos(sunElevationRad) * sunRadius
  const sunHeight = Math.sin(sunElevationRad) * sunRadius
  const sunPosition: [number, number, number] = zUp
    ? [Math.cos(sunAzimuthRad) * sunHorizontal, Math.sin(sunAzimuthRad) * sunHorizontal, sunHeight]
    : [Math.cos(sunAzimuthRad) * sunHorizontal, sunHeight, Math.sin(sunAzimuthRad) * sunHorizontal]

  // Box-select (2026-07-08, per Maro: "select box in viewport", modelled on
  // Blender's B-key marquee) — a toggleable mode rather than always-on,
  // since a plain drag is what OrbitControls uses to orbit; entering this
  // mode disables OrbitControls for the duration. Tracked in plain DOM
  // pointer events on this wrapping div (not R3F's per-mesh events) so it
  // also works when dragging starts/ends over empty space, which no mesh's
  // onClick would ever see. cameraRef is populated by CameraCapture inside
  // the Canvas below; containerRef gives pixel-to-NDC conversion without
  // needing the renderer's own size.
  const [boxSelectMode, setBoxSelectMode] = useState(false)
  const [dragRect, setDragRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [isExportingVideo, setIsExportingVideo] = useState(false)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  // "Real-time path tracer" was the actual ask, scoped down deliberately
  // (2026-07-11, per Maro: "i just wont move around so it gives me a good
  // preview") — true GPU path tracing needs a three.js version bump (this
  // app is 11 minors behind what three-gpu-pathtracer's own peerDependencies
  // require), a new WebGPU-only rendering pipeline, and three new
  // dependencies, judged too risky given how much of this app's own code
  // already reaches directly into three.js internals; Maro agreed to this
  // lower-risk alternative instead. Delivers the same underlying want — a
  // noticeably better-looking preview once the camera settles — by boosting
  // the *existing* raster pipeline's own quality knobs (supersampling via
  // Canvas's dpr, N8AO's aoSamples/denoiseSamples, shadow-map resolution)
  // only while genuinely idle, since none of those are affordable to run at
  // full strength during live orbiting. True path tracing (accurate global
  // illumination, reflections, soft shadows from real light transport) is
  // still not what this is — it's the existing look, just cleaner/sharper —
  // an honest limitation worth remembering if this ever gets revisited.
  //
  // Tracks OrbitControls' own 'start'/'end' interaction events (fired by
  // three.js's OrbitControls itself, not something built here) rather than
  // polling — 'end' means the drag/zoom/pan that was happening has genuinely
  // stopped, not just "no mouse movement this exact frame."
  const [boostQuality, setBoostQuality] = useState(false)
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const onStart = () => setBoostQuality(false)
    const onEnd = () => setBoostQuality(true)
    controls.addEventListener('start', onStart)
    controls.addEventListener('end', onEnd)
    return () => {
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('end', onEnd)
    }
  }, [])
  // 2026-07-19 fix, per Maro: "when i move the axis angles the elements in
  // view visibly shake before settling" plus a separate, intermittent
  // "exploded on refresh" report — both traced to real, repeated
  // GL_INVALID_OPERATION: glBlitFramebuffer errors in the browser console
  // (hundreds of them, not assumed), a known @react-three/postprocessing
  // failure mode: EffectComposer's `enableNormalPass` (needed by the N8AO
  // ambient-occlusion effect below) keeps its own depth-stencil render
  // target, and resizing the renderer's own pixel ratio — which boostQuality
  // used to do here, toggling dpr between 1x and 1.5x on every orbit
  // start/end — races that target's own resize, corrupting the shared
  // depth-stencil buffer for a few frames (the "shake") or, if the same
  // race hits during OrbitControls' own initial setup (which can fire a
  // spurious 'end'-like event on mount), corrupting it before the WebGL
  // context ever stabilizes (the "sometimes broken on refresh," which
  // doesn't self-repair since the context is left in a bad state). Fixed by
  // never varying dpr for the idle-vs-interactive boost at all — only the
  // explicit, one-shot Capture/Export Video path (captureDprMultiplier)
  // still resizes it, a deliberate user action rather than a per-orbit
  // toggle. boostQuality's own AO-sample-count and shadow-map-resolution
  // bumps below are unaffected and still work exactly as before — neither
  // needs a render-target resize, just a pass-parameter change, so neither
  // was ever part of this bug.
  const [captureDprMultiplier, setCaptureDprMultiplier] = useState<number | null>(null)
  const dprMultiplier = captureDprMultiplier ?? 1
  const dpr = Math.min(window.devicePixelRatio * dprMultiplier, 4)
  // Drives N8AO's aoSamples/denoiseSamples and shadow-map resolution — true
  // either while merely idle (boostQuality) or while a capture/export is
  // actively forcing captureDprMultiplier, so a forced capture always gets
  // the full quality treatment (AO/shadows included), not just the extra
  // resolution.
  const highQuality = boostQuality || captureDprMultiplier !== null
  // HDR Background override for a capture/export (2026-07-11, per Maro:
  // "give me the option to show hdr background when rendering/capturing")
  // — null means "just use the live viewport's own ViewerSettings.
  // environmentBackground, unchanged," matching every render before this
  // feature existed; handleCaptureImage/handleExportVideo set this to
  // renderCaptureSettings.showHdrBackground right before capturing
  // (independent of whatever the live view is currently showing — e.g.
  // background hidden for a cleaner working view, but wanted in the final
  // output) and clear it back to null afterward.
  const [captureBackgroundOverride, setCaptureBackgroundOverride] = useState<boolean | null>(null)
  // Path helpers (curve line + control-point handles, PathGizmo.tsx) are a
  // live-editing aid, not part of the model — forced off for the duration
  // of a capture/still-export the same way captureBackgroundOverride forces
  // HDR background on, per path.py's own `visible` docstring (2026-07-11).
  const [hidePathHelpers, setHidePathHelpers] = useState(false)
  const [renderCaptureSettings, setRenderCaptureSettings] = useState<RenderCaptureSettings>(loadRenderCaptureSettings)
  const handleRenderCaptureSettingsChange = (next: RenderCaptureSettings) => {
    setRenderCaptureSettings(next)
    saveRenderCaptureSettings(next)
  }
  // Disables OrbitControls for the duration of a Section Box face drag
  // (2026-07-09) — same reasoning as boxSelectMode above: a plain drag is
  // what OrbitControls uses to orbit, so it has to get out of the way
  // while SectionBoxGizmo.tsx's own pointer handlers are driving a drag.
  const [sectionBoxDragging, setSectionBoxDragging] = useState(false)

  // Frame Selected (2026-07-08, per Maro: "show view focus on selected" —
  // Blender's Numpad . ) — repositions the camera to fit whatever's
  // selected, preferring specific IFC sub-elements (tighter framing) over
  // the whole object they belong to when both are technically "selected"
  // (see handleSelectExpressId's own note on why a model stays selected
  // whenever any of its sub-elements are); frames the whole scene if
  // nothing's selected at all, same as Blender's own fallback.
  const handleFrameSelected = () => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    const box = new THREE.Box3()
    let any = false
    // getExpressIdWorldBounds, not a plain traverse (2026-07-21 fix, per
    // Maro: "its not frame selecting or isolating or nothing" for a panel-
    // driven selection, "if i click in viewport though it works" — a plain
    // `object.traverse(child => child instanceof THREE.Mesh && ...)` can
    // only ever find expressIDs that are already real, individual meshes.
    // A direct click always is one (Viewport3D.tsx's own handleClick calls
    // ensureMaterialized as a side effect of selecting it); a panel-driven
    // Select by Storey/Type never materializes anything (see
    // elementBatching.ts's own ensureMaterialized header — only ever
    // called with the single `selectedExpressId`, which is null the moment
    // more than one element is selected), so every one of those still
    // lives purely as instances inside the shared BatchedMesh with no
    // individual Object3D for a traverse to ever find. The old code's own
    // "any" stayed false for a real panel selection, silently falling
    // through past it to the *whole-object* box below — a real bounding
    // box, just the entire building's, not the actual isolated subset,
    // which usually reads as "nothing visible" once nearly everything else
    // is hidden and the handful of actually-isolated elements are too
    // small against that much wider framing to make out. getExpressIdWorldBounds
    // (elementBatching.ts, built earlier this session for schedule
    // extraction) already handles both cases — a real per-mesh box for an
    // already-materialized element, computed directly off the batch's own
    // stored geometry+instance matrix for one that isn't — without
    // forcing materialization either way.
    if (selectedExpressIds.size > 0) {
      for (const { object } of importedObjects) {
        for (const expressID of selectedExpressIds) {
          const elementBox = getExpressIdWorldBounds(object, expressID)
          if (elementBox) { box.union(elementBox); any = true }
        }
      }
    }
    if (!any) {
      for (const { id, object } of importedObjects) {
        if (selectedObjectIds.has(id)) { box.expandByObject(object); any = true }
      }
    }
    if (!any) {
      for (const { object } of importedObjects) { box.expandByObject(object); any = true }
    }
    if (!any) return

    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.length() / 2, 0.5)
    const fovRad = camera instanceof THREE.PerspectiveCamera ? (camera.fov * Math.PI) / 180 : Math.PI / 3
    const distance = radius / Math.sin(fovRad / 2)
    const direction = camera.position.clone().sub(controls.target)
    if (direction.lengthSq() === 0) direction.set(1, 1, 1)
    direction.normalize().multiplyScalar(distance)
    camera.position.copy(center).add(direction)
    controls.target.copy(center)
    controls.update()
  }

  // Auto-frame on load (2026-07-19, per Maro: "upon refresh, default frame
  // all elements") — reuses handleFrameSelected's own "nothing selected ->
  // frame the whole scene" fallback exactly once, the first time there's
  // both real, boundable geometry AND a live camera/controls to move,
  // rather than leaving the camera sitting at its fixed default position
  // ([8,8,8], this Canvas's own `camera` prop below) regardless of how
  // big/where the real model turns out to be. Polls via
  // requestAnimationFrame (restarted whenever importedObjects itself
  // changes) rather than firing once — an entry appears in that array as
  // soon as an import *starts* (an ImportedObject wrapping a still-empty
  // THREE.Group), and cameraRef.current/controlsRef.current (populated by
  // CameraCapture, below) aren't necessarily ready on the very first
  // frame either — so "done" is only ever marked once both are actually
  // true, not just once geometry showed up in the array. (The
  // "still blank" symptom this was chased under twice turned out to be a
  // real bug the whole time — see ifcModel.ts's own recenterOffset
  // comment: real-world/site coordinates ~400,000 units from the origin
  // put the *camera* at an equally huge, numerically unstable position
  // once framed, which is what actually made the result look blank, not
  // this polling logic.)
  const hasAutoFramedRef = useRef(false)
  useEffect(() => {
    if (hasAutoFramedRef.current) return
    let cancelled = false
    let rafId = 0
    const tryFrame = () => {
      if (cancelled || hasAutoFramedRef.current) return
      if (!cameraRef.current || !controlsRef.current) {
        rafId = requestAnimationFrame(tryFrame)
        return
      }
      const box = new THREE.Box3()
      for (const { object } of importedObjects) box.expandByObject(object)
      if (!box.isEmpty()) {
        hasAutoFramedRef.current = true
        handleFrameSelected()
        return
      }
      rafId = requestAnimationFrame(tryFrame)
    }
    rafId = requestAnimationFrame(tryFrame)
    return () => { cancelled = true; cancelAnimationFrame(rafId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importedObjects])

  // Still-image capture (2026-07-10, per Maro's research-backed ask —
  // reads directly off the renderer's own <canvas> right after whatever
  // it most recently drew (preserveDrawingBuffer above is what makes that
  // reliable), so it captures exactly what's on screen — current camera
  // angle, isolate/section-box state, render mode, everything — with zero
  // extra rendering work of its own. toBlob (not toDataURL) since it
  // doesn't block the main thread building a giant base64 string for
  // what's typically a multi-megapixel image.
  //
  // Always captures at boosted quality, plus whatever Capture/Export
  // Video's own explicit Render/Capture Settings ask for (2026-07-11, per
  // Maro: "include these options when i want to capture/render in the
  // settings as well") — captureDprMultiplier/captureBackgroundOverride
  // force resolution and HDR background to renderCaptureSettings'
  // own values regardless of the live viewport's current idle/background
  // state (setting either non-null also makes highQuality true, boosting
  // AO/shadow quality along with it — see that variable's own comment),
  // then waits a few *real* animation frames for all of that to actually
  // land in a *drawn* frame before reading pixels back (a React state
  // update here isn't synchronous with what's next painted to the canvas —
  // capturing immediately would screenshot the pre-boost frame), then
  // reverts both overrides back to null (idle-detection/live settings
  // resume driving them normally).
  const handleCaptureImage = () => {
    const canvas = rendererRef.current?.domElement
    if (!canvas) return
    const doCapture = () => {
      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `prosota-4d-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
        a.click()
        URL.revokeObjectURL(url)
        setCaptureDprMultiplier(null)
        setCaptureBackgroundOverride(null)
        setHidePathHelpers(false)
      }, 'image/png')
    }
    setCaptureDprMultiplier(renderCaptureSettings.resolutionMultiplier)
    setCaptureBackgroundOverride(renderCaptureSettings.showHdrBackground)
    setHidePathHelpers(true)
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(doCapture)))
  }

  // Camera Views (2026-07-10) — reads the live camera position + orbit
  // target and hands the pose up to FourD.tsx, which does the actual save
  // (with a name the user can rename afterward, same "create with a
  // sensible default, rename via double-click" convention Section Box's
  // own "+ Add" already uses).
  //
  // Thumbnail capture (2026-07-20, per Maro: "contextual visibility... I
  // want it to go back to exactly what it was at the time") — reuses
  // handleCaptureImage's own "hide path helpers, wait a few real frames for
  // that to actually land in a drawn frame, then read pixels" approach, but
  // toDataURL() (synchronous, gives back the data URI string directly)
  // instead of toBlob()+download, and deliberately skips the DPR/HDR
  // render-quality boost that Capture/Export Video use — this is a small
  // dashboard-widget thumbnail, not an export, so native resolution keeps
  // the saved payload modest.
  const captureThumbnail = (): Promise<string | null> => {
    const canvas = rendererRef.current?.domElement
    if (!canvas) return Promise.resolve(null)
    return new Promise(resolve => {
      setHidePathHelpers(true)
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        const dataUrl = canvas.toDataURL('image/png')
        setHidePathHelpers(false)
        resolve(dataUrl)
      })))
    })
  }

  const handleSaveCameraView = async () => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    const pose = {
      position_x: camera.position.x, position_y: camera.position.y, position_z: camera.position.z,
      target_x: controls.target.x, target_y: controls.target.y, target_z: controls.target.z,
    }
    const thumbnailDataUrl = await captureThumbnail()
    onSaveCameraView(pose, thumbnailDataUrl)
  }

  // Video export (2026-07-10, per Maro's original "AO, video, still renders
  // etc." ask) — the research this session originally cited
  // ("r3f-video-recorder") turned out not to exist on npm at all; rather
  // than chase another maybe-real package, this uses two native browser
  // APIs and zero new dependencies: HTMLCanvasElement.captureStream() to
  // get a live MediaStream off the same canvas Capture/toBlob already
  // reads, and MediaRecorder to encode it straight to webm.
  //
  // captureStream(fps) samples the canvas on its own real-time clock —
  // it doesn't know or care about timelineDateRef. So rather than trying
  // to drive playback at some notion of "simulation time per frame," this
  // just walks timelineDateRef from scheduleStart to scheduleEnd linearly
  // over a fixed real-world durationMs, paced by requestAnimationFrame
  // (performance.now()-based, not frame-count-based, so it still finishes
  // in ~durationMs regardless of the display's actual refresh rate) —
  // R3F's own default frameloop='always' is already redrawing every real
  // frame, so nothing here needs to force a render itself.
  // fps/durationMs/resolution/HDR background now come from
  // renderCaptureSettings (2026-07-11, per Maro: "implement the others
  // also" — Export Video's own settings, alongside Capture's) instead of
  // being fixed at 30fps/8s — same RenderCaptureSettingsPopover, same
  // captureDprMultiplier/captureBackgroundOverride mechanism
  // handleCaptureImage already uses, just held active for the whole export
  // (not just a few frames) since this keeps redrawing continuously for
  // durationMs rather than reading back a single frame.
  const handleExportVideo = async () => {
    if (isExportingVideo || !scheduleStart || !scheduleEnd) return
    const canvas = rendererRef.current?.domElement
    if (!canvas) return
    const totalMs = scheduleEnd.getTime() - scheduleStart.getTime()
    if (totalMs <= 0) return

    setIsExportingVideo(true)
    setCaptureDprMultiplier(renderCaptureSettings.resolutionMultiplier)
    setCaptureBackgroundOverride(renderCaptureSettings.showHdrBackground)
    setHidePathHelpers(true)
    try {
      // Same "wait a few real drawn frames" reasoning as handleCaptureImage
      // — the boosted resolution/background/AO/shadow settings just forced
      // above aren't guaranteed to be reflected in the very next frame
      // captureStream happens to sample.
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })

      const fps = renderCaptureSettings.videoFps
      const durationMs = renderCaptureSettings.videoDurationSec * 1000
      const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(fps)
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
      const chunks: Blob[] = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve() })

      recorder.start()
      const startTime = performance.now()
      await new Promise<void>(resolve => {
        const step = () => {
          const t = Math.min((performance.now() - startTime) / durationMs, 1)
          timelineDateRef.current = new Date(scheduleStart.getTime() + totalMs * t)
          if (t >= 1) { resolve(); return }
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
      // Let captureStream flush its last sampled frame(s) before stopping.
      await new Promise(resolve => setTimeout(resolve, 300))
      recorder.stop()
      await stopped

      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `prosota-4d-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`
      a.click()
      URL.revokeObjectURL(url)
      onExportVideo?.(blob, renderCaptureSettings.videoDurationSec)
    } finally {
      setIsExportingVideo(false)
      setCaptureDprMultiplier(null)
      setCaptureBackgroundOverride(null)
      setHidePathHelpers(false)
    }
  }

  // Applies a saved Camera View on request (2026-07-10) — see this
  // component's own Props doc comment on why this is a "command" prop
  // (nonce-keyed) rather than a callback. Instant, not animated/eased —
  // matches Frame Selected's own plain camera.position.copy() above; a
  // smooth fly-to is a nice-to-have, not what was asked for.
  useEffect(() => {
    if (!applyCameraViewRequest) return
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    const { pose } = applyCameraViewRequest
    camera.position.set(pose.position_x, pose.position_y, pose.position_z)
    controls.target.set(pose.target_x, pose.target_y, pose.target_z)
    controls.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyCameraViewRequest?.nonce])

  const handleBoxPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!boxSelectMode) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDragRect({ x0: x, y0: y, x1: x, y1: y })
  }

  const handleBoxPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRect) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setDragRect(prev => (prev ? { ...prev, x1: e.clientX - rect.left, y1: e.clientY - rect.top } : prev))
  }

  const handleBoxPointerUp = () => {
    const rect = containerRef.current?.getBoundingClientRect()
    const camera = cameraRef.current
    if (dragRect && rect && camera) {
      const xMin = Math.min(dragRect.x0, dragRect.x1)
      const xMax = Math.max(dragRect.x0, dragRect.x1)
      const yMin = Math.min(dragRect.y0, dragRect.y1)
      const yMax = Math.max(dragRect.y0, dragRect.y1)
      // A plain click (no real drag distance) selects nothing via box-select
      // — matches Blender's own B-key behaviour, and avoids clearing/no-op
      // surprises from an accidental single click while the mode is armed.
      if (xMax - xMin > 4 || yMax - yMin > 4) {
        const ndcXMin = (xMin / rect.width) * 2 - 1
        const ndcXMax = (xMax / rect.width) * 2 - 1
        const ndcYMax = -(yMin / rect.height) * 2 + 1
        const ndcYMin = -(yMax / rect.height) * 2 + 1
        const matchedObjectIds: string[] = []
        const expressIdsByObject = new Map<string, number[]>()
        const inRect = (v: THREE.Vector3) => v.z < 1 && v.x >= ndcXMin && v.x <= ndcXMax && v.y >= ndcYMin && v.y <= ndcYMax
        // Skip currently-hidden objects (2026-07-09 fix, per Maro's isolate
        // report — same underlying gap: box-select projects each object's
        // *world position*, not a raycast, so it never checked `.visible`
        // either, and could box-select a whole object isolate had hidden).
        for (const { id, object, kind, visible } of importedObjects) {
          if (!visible) continue
          // IFC imports: hit-test each *element's* own bounds individually
          // (2026-07-14 fix, per Maro: "boc select doesnt select elements,
          // just object") — matches the granularity a single click on an
          // IFC mesh already gives (onSelect's expressID), instead of only
          // ever resolving to the whole model regardless of how tightly the
          // box was drawn around a handful of elements. Mesh-kind imports
          // have no sub-element concept at all, so they keep the earlier
          // whole-object behaviour below.
          if (kind === 'ifc') {
            const matchedIds: number[] = []
            object.traverse(child => {
              if (!(child instanceof THREE.Mesh) || !child.visible) return
              const expressID = child.userData.expressID as number | undefined
              if (expressID === undefined) return
              const box = new THREE.Box3().setFromObject(child)
              if (box.isEmpty()) return
              const center = box.getCenter(new THREE.Vector3())
              center.project(camera)
              if (inRect(center)) matchedIds.push(expressID)
            })
            if (matchedIds.length > 0) expressIdsByObject.set(id, matchedIds)
            continue
          }
          // Bounds of only the currently-*visible* meshes within this object
          // (2026-07-11 fix, per Maro: "when i isolate then box select, it
          // doesnt work") — THREE.Box3.setFromObject includes every mesh's
          // geometry regardless of its own .visible flag, so once a specific
          // sub-element is isolated (or, since Collections, individually
          // hidden), the *whole object's* bounding-box center stayed
          // anchored to its full, un-isolated geometry — nowhere near
          // wherever the now-zoomed-in isolated content actually sits on
          // screen, so a box drawn around what's visible could never
          // contain that stale center point. Building the box mesh-by-mesh
          // from only what's actually visible fixes this for both isolate
          // and the newer per-element hide.
          const box = new THREE.Box3()
          object.traverse(child => { if (child instanceof THREE.Mesh && child.visible) box.expandByObject(child) })
          if (box.isEmpty()) continue
          const center = box.getCenter(new THREE.Vector3())
          center.project(camera)
          if (inRect(center)) matchedObjectIds.push(id)
        }
        onBoxSelect(matchedObjectIds, expressIdsByObject)
      }
    }
    setDragRect(null)
  }

  // Select Unassigned (2026-07-15, per Maro: "pick elements that havent
  // been 4d linked to an activity yet") — same visible-element enumeration
  // as box-select's own IFC branch above (element-by-element for ifc-kind,
  // whole object for mesh-kind, both gated on .visible so isolated/hidden
  // elements are never offered up), just matched against "not already
  // linked" instead of "inside the dragged rectangle".
  const handleSelectUnassigned = () => {
    const matchedObjectIds: string[] = []
    const expressIdsByObject = new Map<string, number[]>()
    for (const { id, object, kind, visible } of importedObjects) {
      if (!visible) continue
      if (kind === 'ifc') {
        const matchedIds: number[] = []
        object.traverse(child => {
          if (!(child instanceof THREE.Mesh) || !child.visible) return
          const expressID = child.userData.expressID as number | undefined
          if (expressID === undefined) return
          if (!linkedElementKeys.has(`${id}::${expressID}`)) matchedIds.push(expressID)
        })
        if (matchedIds.length > 0) expressIdsByObject.set(id, matchedIds)
        continue
      }
      if (!linkedObjectIds.has(id)) matchedObjectIds.push(id)
    }
    onSelectUnassigned(matchedObjectIds, expressIdsByObject)
  }

  // Select All (2026-07-17 fix, per Maro: "selecting all only selects the
  // object not the elements... I care about elements") — same visible-element
  // enumeration as box-select/Select Unassigned above, just with no filter
  // beyond "is it actually on screen right now" (which already makes this
  // correctly select just the isolated subset when isolate mode is on, since
  // isolate/hide both work by flipping `.visible` off — "all" and "the
  // isolated subset" mean the same thing on screen, per Maro's earlier Select
  // All fix for the isolate case). materializeAll first — batched elements
  // (elementBatching.ts) have no individual THREE.Mesh/userData.expressID
  // until touched, so a plain traverse would silently skip every one of them.
  const handleSelectAllClick = () => {
    const matchedObjectIds: string[] = []
    const expressIdsByObject = new Map<string, number[]>()
    for (const { id, object, kind, visible } of importedObjects) {
      if (!visible) continue
      if (kind === 'ifc') {
        materializeAll(object)
        const matchedIds: number[] = []
        object.traverse(child => {
          if (!(child instanceof THREE.Mesh) || !child.visible) return
          const expressID = child.userData.expressID as number | undefined
          if (expressID === undefined) return
          matchedIds.push(expressID)
        })
        if (matchedIds.length > 0) expressIdsByObject.set(id, matchedIds)
        continue
      }
      matchedObjectIds.push(id)
    }
    onSelectAll(matchedObjectIds, expressIdsByObject)
    // Forces TimelinePlayback's own resolve() to re-derive targetsRef for
    // every element materializeAll just pulled out of the shared batch —
    // see materializeVersion's own prop header for why this is otherwise
    // permanently skipped.
    onMaterializeAll()
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 bg-gradient-to-b from-sky-100 to-white"
      onPointerDown={handleBoxPointerDown}
      onPointerMove={handleBoxPointerMove}
      onPointerUp={handleBoxPointerUp}
    >
      <div className="absolute top-2 left-2 z-10 flex flex-wrap gap-1 max-w-[calc(100%-1rem)]">
        <button
          onClick={handleSelectAllClick}
          title="Select every visible object and IFC element"
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm"
        >
          Select All
        </button>
        <button
          onClick={handleSelectUnassigned}
          title="Select every visible element that hasn't been linked to a schedule activity yet"
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm"
        >
          Select Unassigned
        </button>
        <button
          onClick={() => setBoxSelectMode(v => !v)}
          title="Box select — drag a rectangle in the viewport to select objects inside it"
          className={`text-xs px-2 py-1 rounded-md border shadow-sm ${
            boxSelectMode ? 'bg-gray-900 text-white border-gray-900' : 'bg-white/90 text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Box Select
        </button>
        <button
          onClick={onToggleIsolate}
          title={isolateMode ? 'Exit isolation — show everything again' : 'Isolate Selected — hide everything except the current selection'}
          className={`text-xs px-2 py-1 rounded-md border shadow-sm ${
            isolateMode ? 'bg-gray-900 text-white border-gray-900' : 'bg-white/90 text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Isolate
        </button>
        <button
          onClick={onShowAll}
          title="Show All — clear isolation and un-hide everything"
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm"
        >
          Show All
        </button>
        <button
          onClick={onHideSelected}
          disabled={selectedObjectIds.size === 0 && selectedExpressIds.size === 0}
          title="Hide Selected — hide the current selection (Show All brings it back)"
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Hide
        </button>
        <button
          onClick={() => { onSelect(null); onSelectObject(null) }}
          disabled={selectedObjectIds.size === 0 && selectedExpressIds.size === 0}
          title="Deselect All — clear the current selection"
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Deselect All
        </button>
        <button
          onClick={handleFrameSelected}
          title="Frame Selected — move the camera to fit the current selection (or the whole scene if nothing's selected)"
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Frame Selected
        </button>
        <button
          onClick={handleCaptureImage}
          title="Capture Image — download exactly what's currently on screen as a PNG"
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm"
        >
          Capture
        </button>
        <button
          onClick={handleSaveCameraView}
          title="Save Current View — bookmark this camera angle (see the Camera Views panel to jump back to it later)"
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save View
        </button>
        <button
          onClick={handleExportVideo}
          disabled={isExportingVideo || !scheduleStart || !scheduleEnd}
          title={
            !scheduleStart || !scheduleEnd
              ? 'Export Video — needs at least one scheduled/linked activity to know what date range to play'
              : `Export Video — records a ${renderCaptureSettings.videoDurationSec}s .webm at ${renderCaptureSettings.videoFps}fps of the timeline playing from schedule start to finish (see ⚙ Render/Capture Settings)`
          }
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExportingVideo ? 'Recording…' : 'Export Video'}
        </button>
        <RenderCaptureSettingsPopover settings={renderCaptureSettings} onChange={handleRenderCaptureSettingsChange} />
      </div>
      {/* "Linked Activities" widget (2026-07-09) — sits directly below the
          Isolate/Show All toolbar, since it's only ever meaningful while
          isolating; renders as nothing (LinkedActivitiesWidget.tsx's own
          empty-list check) the rest of the time. */}
      <div className="absolute top-11 left-2 z-10">
        {linkedActivitiesWidget}
      </div>
      {dragRect && (
        <div
          className="absolute z-10 border border-blue-500 bg-blue-500/10 pointer-events-none"
          style={{
            left: Math.min(dragRect.x0, dragRect.x1),
            top: Math.min(dragRect.y0, dragRect.y1),
            width: Math.abs(dragRect.x1 - dragRect.x0),
            height: Math.abs(dragRect.y1 - dragRect.y0),
          }}
        />
      )}
      <Canvas
        frameloop={active ? 'always' : 'never'}
        shadows={settings.shadows}
        // Supersampling — see the dprMultiplier/dpr computation above (and
        // its own 2026-07-11 fix note) for why this is a real multiplier of
        // window.devicePixelRatio, not a [min,max] clamp range.
        dpr={dpr}
        camera={{
          position: [8, 8, 8], up: [0, zUp ? 0 : 1, zUp ? 1 : 0],
          fov: settings.fieldOfView, near: settings.clipStart, far: settings.clipEnd,
        }}
        // stencil: true (2026-07-09) — explicit, not relying on whatever
        // R3F/three.js defaults to, since Section Box's solid caps
        // (SectionBoxCap.tsx) need a real stencil buffer on the WebGL
        // context to work at all; without one, the stencil ops silently
        // no-op and the cap material's NotEqualStencilFunc test behaves
        // unpredictably instead of cleanly failing closed.
        //
        // preserveDrawingBuffer: true (2026-07-10, per Maro: still-image
        // capture) — without this, the browser is free to clear the
        // WebGL drawing buffer as soon as a frame finishes presenting,
        // which makes gl.domElement.toBlob()/toDataURL() unreliable (it
        // can read back a blank or partially-cleared frame depending on
        // exact timing). A small, constant memory cost for guaranteeing
        // handleCaptureImage below always reads back exactly what was
        // just on screen.
        //
        // logarithmicDepthBuffer: true (2026-07-19 fix, per Maro: "the
        // elements... visibly shake" — confirmed independent of AO/
        // Shadows/Edges, ruling all three out; the real cause is Clip
        // Start/Clip End (settings.clipStart/clipEnd, user-adjustable in 3D
        // View Properties, default 0.1/10000 — a 100,000:1 near:far ratio).
        // A standard WebGL depth buffer spends most of its precision within
        // the first fraction of that range, leaving almost none left at a
        // real BIM model's typical viewing distance — classic z-fighting:
        // two near-coincident surfaces' depth values round to the same
        // encoded value, so the rasterizer flips which one "wins" from
        // frame to frame as the projection matrix shifts slightly during
        // orbit, reading as a flicker/shake that stops the instant the
        // camera (and therefore the projection matrix) stops changing.
        // three.js's own logarithmic depth buffer is the standard fix for
        // exactly this — large near:far ratios by design — at the cost of
        // needing verification against N8AO/EffectComposer's own depth
        // read (enableNormalPass above), since not every postprocessing
        // effect is written to expect log-encoded depth.
        gl={{ stencil: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true }}
        onPointerMissed={() => { if (!boxSelectMode) { onSelect(null); onSelectObject(null) } }}
      >
        <CameraCapture cameraRef={cameraRef} rendererRef={rendererRef} />
        <CameraSettings fov={settings.fieldOfView} near={settings.clipStart} far={settings.clipEnd} upAxis={settings.upAxis} />
        <ClippingSetup />
        <ambientLight intensity={0.6} />
        {/* Shadow camera frustum (2026-07-09 fix, per Maro: "check if the
            shadows effects works") — three.js's DirectionalLight defaults to
            a +-5 unit orthographic shadow-camera frustum (near 0.5, far 500,
            512x512 map), sized for a small demo scene, not a BIM-scale
            import (buildings routinely span 50-200 units): with shadows
            "on," most real models simply had no shadow at all, clipped
            entirely outside that tiny frustum. shadow-bias trims the
            "shadow acne" self-shadowing artifact a widened frustum's lower
            effective precision-per-unit would otherwise introduce.
            2026-07-19 fix (per Maro: "shadow is still weird floating") —
            the frustum bounds and far plane now scale with modelRadius
            (see that variable's own comment) instead of a fixed +-100/300:
            a light now positioned at modelRadius*3 away needs a far plane
            that actually reaches back past the model, and a too-tight
            fixed frustum on a much smaller/larger real model than the
            original +-100 guess was tuned for is exactly what produced a
            clipped, disconnected-looking shadow. */}
        <directionalLight
          position={sunPosition} intensity={1} castShadow={settings.shadows}
          shadow-mapSize={highQuality ? [4096, 4096] : [2048, 2048]}
          // normalBias, not (only) bias (2026-07-21 fix, per Maro: a real,
          // flat exterior wall self-shadowing with a hard diagonal band
          // that "shouldn't be there at all" — textbook shadow acne, not a
          // real architectural feature casting it. The old fixed
          // shadow-bias={-0.0005} was a depth-space constant, implicitly
          // tuned against whatever real building this app was last tested
          // against (Snowdon/Hotel, both far bigger than modelRadius's own
          // 10-unit floor) — shadow-camera-far scales with modelRadius (see
          // sunRadius above), so the same fixed bias is a different
          // fraction of the depth buffer's usable precision at a different
          // model scale, too small exactly on a small model like this one
          // and producing acne. normalBias offsets along the surface's own
          // normal in world space instead of light-space depth, so it
          // scales with real geometry rather than the frustum's far plane —
          // the standard three.js fix for acne on flat/near-grazing
          // surfaces (a vertical wall under a fairly low sun elevation is
          // exactly that case) — proportioned to modelRadius the same way
          // the frustum itself already is, so it stays correctly scaled
          // whether this is a small test file or a real full-scale import.
          shadow-normalBias={modelRadius * 0.002}
          shadow-camera-left={-modelRadius * 2} shadow-camera-right={modelRadius * 2}
          shadow-camera-top={modelRadius * 2} shadow-camera-bottom={-modelRadius * 2}
          shadow-camera-near={0.5} shadow-camera-far={sunRadius + modelRadius * 2}
        />
        <Suspense fallback={null}>
          <ViewportErrorBoundary key={activeEnvironmentUrl} onError={onEnvironmentError}>
            {/* Equirect HDR/EXR skies are authored assuming Y is the zenith
                direction (2026-07-08 fix, per Maro: "hdr too off") — that
                mapping is baked into the texture sampling itself, not the
                scene graph, so wrapping <Environment> in a rotated <group>
                (like Grid/ModelObjects above) wouldn't touch it. backgroundRotation/
                environmentRotation (three.js r162+) are the actual hook for
                this — same +90-about-X correction as everything else Y-up. */}
            <Environment
              files={activeEnvironmentUrl}
              background={captureBackgroundOverride ?? settings.environmentBackground}
              backgroundRotation={zUp ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
              environmentRotation={zUp ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
            />
          </ViewportErrorBoundary>
          {/* Grid is Y-up by its own native convention (it's our own
              geometry) — this wrapper corrects it to match upAxis, same as
              ModelObjects does per-object internally using each object's own
              sourceUpAxis (chosen per-file at import time, see
              upAxis.ts's axisCorrectionRotation for why this is no longer a
              blanket per-kind guess). TransformControls/TimelinePlayback
              aren't affected either way: they read/write
              object.position/rotation/scale in the object's own *local*
              space, which a wrapper never touches — only where that local
              space ends up pointing in world space. */}
          {settings.showGrid && (
            <group rotation={axisCorrectionRotation('y', settings.upAxis)}>
              <Grid args={[40, 40]} cellColor="#d1d5db" sectionColor="#9ca3af" fadeDistance={40} infiniteGrid />
            </group>
          )}
          {/* Shadow-catcher ground plane (2026-07-09 fix, per Maro: "check if
              the shadows effects works") — Grid above is a decorative shader
              overlay (drei's own implementation), not a real mesh, so it
              can't receive a shadow no matter what settings.shadows is set
              to: with no other object underneath an imported model, "shadows
              on" had nothing to actually show a shadow *on*, so it looked
              like the setting did nothing. <shadowMaterial> renders fully
              invisible everywhere except where a shadow actually falls
              across it, so this doesn't add a visible floor/disc when
              shadows are off or nothing's casting one — same rotation
              wrapper as Grid, independent of showGrid (shadows should work
              whether or not the visual grid lines are on), slightly below
              y=0 in local space to avoid z-fighting with the Grid's own
              lines when both are visible. */}
          {settings.shadows && (
            <group rotation={axisCorrectionRotation('y', settings.upAxis)}>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
                <planeGeometry args={[400, 400]} />
                <shadowMaterial transparent opacity={0.35} />
              </mesh>
            </group>
          )}
          <ModelObjects
            objects={importedObjects}
            settings={settings}
            selectedExpressId={selectedExpressId}
            selectedExpressIds={selectedExpressIds}
            selectedObjectIds={selectedObjectIds}
            onSelect={onSelect}
            onSelectObject={onSelectObject}
            customTextures={customTextures}
            boxSelectMode={boxSelectMode}
            isolateMode={isolateMode}
            isolatedObjectIds={isolatedObjectIds}
            isolatedExpressIds={isolatedExpressIds}
            hiddenExpressIds={hiddenExpressIds}
            sectionBoxes={sectionBoxes}
            varianceByElementKey={varianceByElementKey}
            clashByElementKey={clashByElementKey}
            elementParents={elementParents}
          />
          <SectionBoxGizmos
            boxes={sectionBoxes}
            objects={importedObjects}
            tool={sectionBoxTool}
            onDragStart={() => setSectionBoxDragging(true)}
            onDragMove={onSectionBoxDragMove}
            onDragEnd={(boxId, bounds) => { setSectionBoxDragging(false); onSectionBoxDragEnd(boxId, bounds) }}
            onRotateStart={() => setSectionBoxDragging(true)}
            onRotateMove={onSectionBoxRotateMove}
            onRotateEnd={(boxId, rotation) => { setSectionBoxDragging(false); onSectionBoxRotateEnd(boxId, rotation) }}
          />
          <SectionBoxCaps boxes={sectionBoxes} objects={importedObjects} />
          <TimelinePlayback
            dateRef={timelineDateRef}
            sceneObjects={timelineSceneObjects}
            activities={timelineActivities}
            links={timelineLinks}
            profiles={timelineProfiles}
            elementKeyframes={timelineElementKeyframes}
            upAxis={settings.upAxis}
            ifcHandles={ifcHandles}
            activeObjectId={activeObjectId}
            onTick={onTransformChange}
            paths={paths}
            pathFollowers={pathFollowers}
            selectedExpressId={selectedExpressId}
            materializeVersion={materializeVersion}
          />
          {!hidePathHelpers && (
            <PathGizmos
              paths={paths}
              onDragStart={() => {}}
              onDragMove={onPathDragMove}
              onDragEnd={onPathDragEnd}
            />
          )}
          <PathAddPointCatcher
            active={addingPointsForPathId !== null}
            upAxis={settings.upAxis}
            onAddPoint={point => { if (addingPointsForPathId) onAddPathPoint(addingPointsForPathId, point) }}
          />
          {annotations.map(annotation => (
            <AnnotationMarker
              key={annotation.id}
              annotation={annotation}
              dateRef={timelineDateRef}
              activities={timelineActivities}
              modelElementLinks={timelineLinks}
              animationProfiles={timelineProfiles}
              elementKeyframes={timelineElementKeyframes}
              leaderTargetObject={
                (annotation.kind === 'footnote' || annotation.kind === 'comment') && annotation.source_kind === 'mesh' && annotation.element_ref
                  ? (timelineSceneObjects.find(o => o.kind === 'mesh' && o.name === annotation.element_ref)?.object ?? null)
                  : null
              }
              selected={selectedAnnotationId === annotation.id}
              onSelect={onSelectAnnotation}
              onDragStart={() => {}}
              onDragMove={onAnnotationDragMove}
              onDragEnd={onAnnotationDragEnd}
            />
          ))}
          {/* Single click-to-place for a new Placemark/Footnote (2026-07-12)
              — reuses PathAddPointCatcher verbatim (its own raycast-the-scene-
              then-fall-back-to-ground-plane logic has nothing Path-specific
              in it); onPlaceAnnotation itself clears addingAnnotationKind
              after one placement, so this naturally goes inactive right
              after, unlike Path's own continuous multi-point mode. */}
          <PathAddPointCatcher
            active={addingAnnotationKind !== null}
            upAxis={settings.upAxis}
            onAddPoint={onPlaceAnnotation}
          />
          {/* "Set Pivot" click-to-pick (2026-07-12) — reuses
              PathAddPointCatcher verbatim a third time; onPickPivotPoint
              itself clears pivotPicking after one placement, same one-shot
              behaviour as Annotation placement above. */}
          <PathAddPointCatcher
            active={pivotPicking}
            upAxis={settings.upAxis}
            onAddPoint={onPickPivotPoint}
          />
          <MeasurementMarkers
            measurements={measurements}
            unitPreference={unitPreference}
            selectedId={selectedMeasurementId}
            onSelect={onSelectMeasurement}
          />
          {measuringTool === 'length' && (
            <MeasurementPreview
              points={measuringPoints}
              toMetres={measuringToMetres}
              unitPreference={unitPreference}
            />
          )}
          <MeasurementHoverIndicator point={measuringTool !== null ? measurementHoverPoint : null} />
          {/* Measure tool click-to-place (2026-07-19) — its own catcher
              rather than PathAddPointCatcher, since Area (face) mode needs a
              resolved mesh + faceIndex back, not just a world-space point;
              see MeasurementGizmo.tsx's own header. */}
          <MeasurementCatcher
            active={measuringTool !== null}
            upAxis={settings.upAxis}
            onHit={onMeasurementHit}
            onHoverPoint={onMeasurementHoverPoint}
          />
        </Suspense>
        {/* Fly Mode (drei's FlyControls) removed 2026-07-19, per Maro: "fly
            mode is horrible, just remove for now" — even after fixing the
            real 100x rollSpeed oversensitivity bug, it wasn't a good enough
            navigation feel to keep; OrbitControls is this app's only
            navigation scheme again, same as before Fly Mode existed. */}
        <OrbitControls ref={controlsRef} makeDefault enabled={!boxSelectMode && !sectionBoxDragging} />
        {activeObject && (
          <TransformControls
            object={activeObject.object}
            mode={gizmoMode}
            onChange={onTransformChange}
            // Tagged isPathGizmo (2026-07-12 fix, per Maro: "pick in
            // viewport is very bad" — picking a wrong point) — the gizmo's
            // own arrow/ring handle meshes are real, raycastable Object3Ds
            // sitting in the scene right on top of whatever's selected,
            // and PathAddPointCatcher's hit-test (reused verbatim for
            // Paths/Annotations/pivot-picking) had no reason to know to
            // skip them, same as it already skips its own curve/handle
            // meshes. A click meant for the object's own surface could
            // land on a gizmo handle instead, especially likely for pivot
            // picking specifically since that's only ever armed *while* an
            // object (and therefore this gizmo) is already selected and
            // visible. `controls` (three-stdlib's TransformControls) is
            // itself a real Object3D — tagging just this one root is
            // enough, since the hit-test walks *up* the parent chain
            // looking for the flag.
            ref={el => { if (el) el.userData.isPathGizmo = true }}
          />
        )}
        {settings.showAxisIndicator && (
          <GizmoHelper alignment="bottom-left" margin={[80, 80]}>
            <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" />
          </GizmoHelper>
        )}
        {settings.ambientOcclusion && (
          <Suspense fallback={null}>
            <AmbientOcclusionEffect boostQuality={highQuality} />
          </Suspense>
        )}
      </Canvas>
      {importedObjects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-gray-400 bg-white/70 px-3 py-1.5 rounded-md">
            No model loaded — use Import 3D or Import IFC above
          </p>
        </div>
      )}
      {/* Selection count info box (2026-07-09, per Maro: "an info box
          somewhere small in the right corner which tells me how many
          objects I'm selecting") — object count is selectedObjectIds
          (top-level imports), element count is selectedExpressIds (IFC
          sub-elements within whichever model is active) — reported
          separately since they're different granularities of "selected",
          not summed into one number. Hidden entirely when nothing's
          selected, so it doesn't clutter an idle viewport. */}
      {(selectedObjectIds.size > 0 || selectedExpressIds.size > 0) && (
        <div className="absolute top-2 right-2 z-10 text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 shadow-sm pointer-events-none">
          {selectedObjectIds.size > 0 && `${selectedObjectIds.size} object${selectedObjectIds.size === 1 ? '' : 's'} selected`}
          {selectedObjectIds.size > 0 && selectedExpressIds.size > 0 && ' · '}
          {selectedExpressIds.size > 0 && `${selectedExpressIds.size} element${selectedExpressIds.size === 1 ? '' : 's'} selected`}
        </div>
      )}
    </div>
  )
}
