import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment, FlyControls, Grid, GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from '@react-three/drei'
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
import type { ModelElementLink } from './modelElementLinks'
import { computeAppliedAnimationStateAt, interpolateKeyframeTrack, pickActiveLink, type ResolvedTimelineLink } from './timelinePlayback'
import type { ElementKeyframe, KeyframeField } from './elementKeyframes'
import type { ViewerSettings } from './viewerSettings'
import type { GizmoMode } from './TransformPanel'
import type { CustomTextureSet } from './customTextures'
import { axisCorrectionRotation, resolveDisplayAxis, type UpAxis } from './upAxis'
import { getOriginalGeometry, getOriginalMaterialSlots } from './elementBaseline'
import { MAX_TOTAL_SUBDIVIDED_TRIANGLES, subdivideGeometry, triangleCount } from './geometrySubdivision'
import { getGouraudVariant, getHiddenLineMaterial, HIDDEN_LINE_BASE_COLOR } from './renderModeMaterials'
import { ViewportErrorBoundary } from './ViewportErrorBoundary'
import { computeWorldClipPlanes } from './sectionBoxGeometry'
import type { SectionBoxBounds } from './sectionBoxes'
import { SectionBoxGizmos } from './SectionBoxGizmo'
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

export interface ImportedObject {
  id: string
  kind: 'ifc' | 'mesh'
  // Chosen per-object at import time (ImportModelDialog.tsx), not inferred
  // from kind — see upAxis.ts's axisCorrectionRotation for why. What
  // convention the file's own geometry was actually authored in.
  sourceUpAxis: UpAxis
  object: THREE.Object3D
  visible: boolean
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
const AmbientOcclusionEffect = lazy(() =>
  import('@react-three/postprocessing').then(({ EffectComposer, N8AO }) => ({
    default: ({ boostQuality }: { boostQuality: boolean }) => (
      <EffectComposer enableNormalPass>
        <N8AO
          aoRadius={1} intensity={2} distanceFalloff={1}
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
  onSelectAll: () => void
  onBoxSelect: (ids: string[]) => void
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
  onSaveCameraView: (pose: CameraViewPose) => void
  applyCameraViewRequest: { pose: CameraViewPose; nonce: number } | null
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
}

const SELECTED_EMISSIVE = new THREE.Color(0x2563eb)
// Whole-object selection tint (2026-07-08, per Maro's Blender-style
// multi-select request) — deliberately a different colour from
// SELECTED_EMISSIVE above, which marks the one specific sub-element/expressID
// picked for the IFC Data tab's Object Information section. An object can be
// "selected" (in selectedObjectIds) without any of its sub-elements being the
// expressID-selected one, e.g. selected via the Project Overview tree/Mesh
// Data Panel rather than an in-viewport click.
const OBJECT_SELECTED_EMISSIVE = new THREE.Color(0xf59e0b)

// Applies the render-mode/visibility/shadow settings to every mesh under an
// imported object, and tints whichever mesh carries the currently-selected
// expressID (2026-07-10, per Maro) — re-run whenever settings/selection
// change, not just once on import.
function ModelObjects({
  objects, settings, selectedExpressId, selectedExpressIds, selectedObjectIds, onSelect, onSelectObject, customTextures,
  boxSelectMode, isolateMode, isolatedObjectIds, isolatedExpressIds, hiddenExpressIds, sectionBoxes,
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
}) {
  const upAxis = settings.upAxis
  useEffect(() => {
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
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
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
        child.visible = settings.showFaces && !isolatedOut && !isChildHidden
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
            clone.userData.textureOverrideOwner = ownerKey
            return clone
          })()))
          child.userData.standardMaterial = standardMaterial
        } else if (everCustomized && !Array.isArray(standardMaterial) && standardMaterial.userData.textureOverrideOwner !== ownerKey) {
          standardMaterial = standardMaterial.clone()
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
            else if (isExpressAlsoSelected) { mat.emissive = SELECTED_EMISSIVE; mat.emissiveIntensity = 0.9 }
            else if (isObjectSelected) { mat.emissive = OBJECT_SELECTED_EMISSIVE; mat.emissiveIntensity = 0.35 }
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
            else if (isExpressAlsoSelected) mat.color.lerp(SELECTED_EMISSIVE, 0.55)
            else if (isObjectSelected) mat.color.lerp(OBJECT_SELECTED_EMISSIVE, 0.15)
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
              else if (isExpressAlsoSelected) hiddenLineTint.lerp(SELECTED_EMISSIVE, 0.55)
              else if (isObjectSelected) hiddenLineTint.lerp(OBJECT_SELECTED_EMISSIVE, 0.15)
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
        const wantsEdges = settings.showEdges || settings.renderMode === 'hiddenLine'
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
        } else if (edges) {
          edges.visible = false
        }
      })
    }
  }, [objects, settings, selectedExpressId, selectedExpressIds, selectedObjectIds, customTextures, isolateMode, hiddenExpressIds])

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
        .flatMap(b => computeWorldClipPlanes(b.bounds, object.matrixWorld))
      const elementBoxes = boxesForObject.filter(b => b.elementExpressId !== undefined)
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        let clipPlanes = wholeObjectPlanes
        if (elementBoxes.length > 0) {
          const matching = elementBoxes.filter(b => b.elementExpressId === child.userData.expressID)
          if (matching.length > 0) {
            child.updateMatrixWorld(true)
            clipPlanes = [...wholeObjectPlanes, ...matching.flatMap(b => computeWorldClipPlanes(b.bounds, child.matrixWorld))]
          }
        }
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach(mat => { mat.clippingPlanes = clipPlanes.length > 0 ? clipPlanes : null })
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
    if (e.object instanceof THREE.Mesh && !e.object.visible) return
    e.stopPropagation()
    const additive = e.ctrlKey || e.metaKey
    let target: THREE.Object3D | null = e.object
    while (target && target.userData.expressID === undefined) target = target.parent
    const expressId = target ? (target.userData.expressID as number) : null

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
      {objects.map(({ id, sourceUpAxis, object, visible }) => (
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
  materials: { material: THREE.MeshStandardMaterial; baseColor: THREE.Color }[]
  keyframeTracks: Partial<Record<KeyframeField, { date: Date; value: number }[]>>
}

const DEG_TO_RAD = Math.PI / 180

function collectStandardMaterials(object: THREE.Object3D): { material: THREE.MeshStandardMaterial; baseColor: THREE.Color }[] {
  const found: { material: THREE.MeshStandardMaterial; baseColor: THREE.Color }[] = []
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
      if (mat instanceof THREE.MeshStandardMaterial) found.push({ material: mat, baseColor: mat.color.clone() })
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

function TimelinePlayback({
  dateRef, sceneObjects, activities, links, profiles, elementKeyframes, upAxis, ifcHandles, activeObjectId, onTick, paths, pathFollowers,
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
}) {
  const targetsRef = useRef<ResolvedTimelineTarget[]>([])
  const pathTargetsRef = useRef<ResolvedPathTarget[]>([])

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
          }
          byObject.set(object, target)
        }
        return target
      }

      // Mode A — schedule-driven, via ModelElementLink (unchanged resolution
      // logic: mesh-kind by filename, ifc-kind via GlobalId->expressID).
      for (const link of links) {
        const activity = activityById.get(link.activity_id)
        if (!activity || !activity.start || !activity.finish) continue
        const profile = link.animation_profile_id ? profileById.get(link.animation_profile_id)?.config : DEFAULT_ANIMATION_CONFIG
        if (!profile) continue

        let object: THREE.Object3D | null = null
        if (link.source_kind === 'mesh') {
          object = sceneObjects.find(o => o.kind === 'mesh' && o.name === link.element_ref)?.object ?? null
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
            handle.object.traverse(child => {
              if (!object && child.userData.expressID === expressId) object = child
            })
            if (object) break
          }
        }
        if (!object) continue

        const target = getOrCreate(object)
        target.links.push({ activity, profile, axis: profile.axis })
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
            if (Object.keys(target.keyframeTracks).length > 0) applyKeyframedTransform(target, now, upAxis)
          }
          for (const target of nextPathTargets) applyPathFollow(target, now)
        }
      }
    }

    resolve()
    return () => { cancelled = true }
  }, [sceneObjects, activities, links, profiles, elementKeyframes, ifcHandles, paths, pathFollowers])

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
    if (!now || (targetsRef.current.length === 0 && pathTargetsRef.current.length === 0)) return
    const nowMs = now.getTime()
    const dateChanged = lastAppliedDateMs.current !== nowMs
    lastAppliedDateMs.current = nowMs

    for (const target of targetsRef.current) {
      const hasKeyframes = Object.keys(target.keyframeTracks).length > 0
      const activeLink = pickActiveLink(target.links, now)
      const state = activeLink ? computeAppliedAnimationStateAt(activeLink.activity, activeLink.profile, now) : null

      if (hasKeyframes) {
        if (dateChanged) applyKeyframedTransform(target, now, upAxis)
      } else if (state && activeLink) {
        target.object.position.set(
          target.basePosition.x + state.positionOffset[0],
          target.basePosition.y + state.positionOffset[1],
          target.basePosition.z + state.positionOffset[2],
        )
        target.object.rotation.copy(target.baseRotation)
        target.object.rotation[activeLink.axis] += state.rotationOffsetDeg * DEG_TO_RAD
        target.object.scale.copy(target.baseScale).multiplyScalar(state.scaleMultiplier)
      }

      // Opacity/colour always come from the profile alone (if any) — never
      // fought over by keyframeTracks, which only ever cover transform.
      if (state) {
        for (const { material, baseColor } of target.materials) {
          material.transparent = state.opacity < 1
          material.opacity = state.opacity
          if (state.color) material.color.set(state.color)
          else material.color.copy(baseColor)
          material.needsUpdate = true
        }
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
  onSelectAll, onBoxSelect, isolateMode, isolatedObjectIds, isolatedExpressIds, hiddenExpressIds, onToggleIsolate, onShowAll, linkedActivitiesWidget,
  gizmoMode, onTransformChange,
  environmentUrl, onEnvironmentError, customTextures,
  timelineDateRef, timelineSceneObjects, timelineActivities, timelineLinks, timelineProfiles, timelineElementKeyframes, ifcHandles, active,
  sectionBoxes, onSectionBoxDragMove, onSectionBoxDragEnd,
  onSaveCameraView, applyCameraViewRequest,
  scheduleStart, scheduleEnd,
  paths, pathFollowers, addingPointsForPathId, onPathDragMove, onPathDragEnd, onAddPathPoint,
  annotations, addingAnnotationKind, onPlaceAnnotation, selectedAnnotationId, onSelectAnnotation, onAnnotationDragMove, onAnnotationDragEnd,
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
        let found: THREE.Object3D | null = null
        handle.object.traverse(child => { if (!found && child.userData.expressID === selectedExpressId) found = child })
        if (found) return { ...activeImportedObject, object: found }
      }
    }
    return activeImportedObject
  })()
  const activeEnvironmentUrl = environmentUrl ?? DEFAULT_ENVIRONMENT_URL
  const zUp = settings.upAxis === 'z'

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
  // Fly Mode (2026-07-11, per Maro comparing this app's navigation against
  // Blender's own camera view: "I can go into the camera mode and view it
  // and navigate from inside the camera") — swaps OrbitControls (orbit
  // around a fixed target point, this app's only navigation scheme until
  // now) for drei's FlyControls (free 6-DOF movement: WASD + drag-to-look,
  // no orbit pivot at all — matching Blender's own "Fly Navigation," as
  // opposed to its ground-constrained "Walk Navigation"). Mutually
  // exclusive by conditional rendering, not a shared ref — the two control
  // schemes have fundamentally different state (OrbitControls has a
  // `target` point to orbit around; FlyControls has none, just the
  // camera's own free position/orientation), so Save View/Frame Selected
  // (which read controlsRef.current.target) are disabled while flying
  // rather than pointed at a ref that wouldn't mean the same thing.
  const [flyMode, setFlyMode] = useState(false)
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
  // 2026-07-11 fix, caught while wiring in an explicit Resolution setting
  // for Capture/Export Video (renderCaptureSettings.ts) — R3F's own dpr
  // prop, given a [min, max] tuple, *clamps* window.devicePixelRatio into
  // that range (confirmed directly in @react-three/fiber's own source,
  // calculateDpr: `Math.min(Math.max(dpr[0], target), dpr[1])` where target
  // is the real devicePixelRatio) — it does not multiply it. On a standard
  // 1x desktop monitor (devicePixelRatio === 1, the common case on
  // Windows), [1,3] and [1,2] both clamp to exactly 1 — boostQuality's own
  // "supersampling boost while idle" from earlier today was a silent no-op
  // on that hardware the whole time, only ever doing anything on an
  // already-HiDPI display reporting >2. Fixed by computing a real
  // multiplier instead of a clamp range: dprMultiplier below is 1
  // (interactive), a modest 1.5 while merely idle (boostQuality), or
  // whatever Capture/Export Video's own explicit Resolution setting asks
  // for (captureDprMultiplier, 1/2/4×) when one of those is actually in
  // flight — capped at 4 total either way so a deliberate 4× export on top
  // of an already-HiDPI display can't ask the GPU for something absurd.
  const [captureDprMultiplier, setCaptureDprMultiplier] = useState<number | null>(null)
  const dprMultiplier = captureDprMultiplier ?? (boostQuality ? 1.5 : 1)
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
    if (selectedExpressIds.size > 0) {
      for (const { object } of importedObjects) {
        object.traverse(child => {
          if (child instanceof THREE.Mesh && selectedExpressIds.has(child.userData.expressID)) {
            box.expandByObject(child)
            any = true
          }
        })
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
  const handleSaveCameraView = () => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    onSaveCameraView({
      position_x: camera.position.x, position_y: camera.position.y, position_z: camera.position.z,
      target_x: controls.target.x, target_y: controls.target.y, target_z: controls.target.z,
    })
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
        const matched: string[] = []
        // Skip currently-hidden objects (2026-07-09 fix, per Maro's isolate
        // report — same underlying gap: box-select projects each object's
        // *world position*, not a raycast, so it never checked `.visible`
        // either, and could box-select a whole object isolate had hidden).
        for (const { id, object, visible } of importedObjects) {
          if (!visible) continue
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
          // and the newer per-element hide, without needing a full
          // expressID-granular box-select rewrite.
          const box = new THREE.Box3()
          object.traverse(child => { if (child instanceof THREE.Mesh && child.visible) box.expandByObject(child) })
          if (box.isEmpty()) continue
          const center = box.getCenter(new THREE.Vector3())
          center.project(camera)
          if (center.z < 1 && center.x >= ndcXMin && center.x <= ndcXMax && center.y >= ndcYMin && center.y <= ndcYMax) {
            matched.push(id)
          }
        }
        onBoxSelect(matched)
      }
    }
    setDragRect(null)
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
          onClick={onSelectAll}
          title="Select all objects"
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm"
        >
          Select All
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
          onClick={handleFrameSelected}
          disabled={flyMode}
          title={flyMode ? 'Frame Selected — unavailable in Fly Mode (no orbit target to frame around)' : 'Frame Selected — move the camera to fit the current selection (or the whole scene if nothing\'s selected)'}
          className="text-xs px-2 py-1 rounded-md border border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Frame Selected
        </button>
        <button
          onClick={() => setFlyMode(v => !v)}
          title={
            flyMode
              ? 'Exit Fly Mode — return to orbit navigation'
              : 'Fly Mode — navigate freely from inside the camera, Blender-style: drag to look around, WASD (+ R/F or Q/E) to move'
          }
          className={`text-xs px-2 py-1 rounded-md border shadow-sm ${
            flyMode ? 'bg-gray-900 text-white border-gray-900' : 'bg-white/90 text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Fly Mode
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
          disabled={flyMode}
          title={flyMode ? 'Save Current View — unavailable in Fly Mode (no orbit target to save)' : 'Save Current View — bookmark this camera angle (see the Camera Views panel to jump back to it later)'}
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
        gl={{ stencil: true, preserveDrawingBuffer: true }}
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
            entirely outside that tiny frustum. Widened to +-100 units at
            2048x2048 — generous enough for typical site-scale models without
            ballooning shadow-map memory; shadow-bias trims the "shadow acne"
            self-shadowing artifact a widened frustum's lower effective
            precision-per-unit would otherwise introduce. */}
        <directionalLight
          position={zUp ? [10, 10, 15] : [10, 15, 10]} intensity={1} castShadow={settings.shadows}
          shadow-mapSize={highQuality ? [4096, 4096] : [2048, 2048]} shadow-bias={-0.0005}
          shadow-camera-left={-100} shadow-camera-right={100} shadow-camera-top={100} shadow-camera-bottom={-100}
          shadow-camera-near={0.5} shadow-camera-far={300}
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
          />
          <SectionBoxGizmos
            boxes={sectionBoxes}
            objects={importedObjects}
            onDragStart={() => setSectionBoxDragging(true)}
            onDragMove={onSectionBoxDragMove}
            onDragEnd={(boxId, bounds) => { setSectionBoxDragging(false); onSectionBoxDragEnd(boxId, bounds) }}
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
        </Suspense>
        {flyMode ? (
          // movementSpeed in scene units/sec — set well above the library's
          // own default of 1 (this app's own shadow-frustum sizing
          // elsewhere notes real BIM models routinely span 50-200 units;
          // at speed 1 crossing one would take minutes). dragToLook:
          // requires holding the mouse button to look around (matching
          // this app's existing OrbitControls-style click-drag
          // interaction) rather than FlyControls' own default of
          // always-look-on-any-mouse-move, which would fight with reaching
          // for a toolbar button. Note the library's own Shift behaviour is
          // the opposite of a typical "sprint" key — held Shift *slows*
          // movement for fine control, not a speed boost; not something
          // this wrapper changes.
          <FlyControls makeDefault movementSpeed={20} rollSpeed={0.5} dragToLook />
        ) : (
          <OrbitControls ref={controlsRef} makeDefault enabled={!boxSelectMode && !sectionBoxDragging} />
        )}
        {activeObject && (
          <TransformControls object={activeObject.object} mode={gizmoMode} onChange={onTransformChange} />
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
