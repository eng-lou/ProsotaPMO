import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Box3, Euler, Mesh, Vector3, type Object3D } from 'three'
import axios from 'axios'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { GanttChart } from '@/modules/scheduling/GanttChart'
import { computePeriodBuckets, loadGanttZoom, saveGanttZoom, type GanttZoom } from '@/modules/scheduling/ganttZoom'
import { loadResourcesLayout } from '@/modules/scheduling/resourcesLayout'
import { ResourceTrackingWidget } from '@/modules/scheduling/ResourceTrackingWidget'
import { ResourceUsageProfileWidget } from '@/modules/scheduling/ResourceUsageProfileWidget'
import { computeUsageProfileBars, useResourcesTabData } from '@/modules/scheduling/useResourcesTabData'
import type { Activity, ActivityRelationship, Calendar, Resource, ResourceAssignment } from '@/modules/scheduling/types'
import { disposeObject3D, loadModel3DFile, loadTexturedObj } from './import3d'
import { createPointCloudObject, parseXyzFile } from './pointCloud'
import { bakeEmbeddedAnimationToKeyframes } from './embeddedAnimationBake'
import { loadCustomEnvironment } from './environmentHdr'
import { disposeCustomTextureSet, loadCustomTexture, type CustomTextureSet, type TextureSlot } from './customTextures'
import { loadPresetAsTextureSet, useMaterialPresets, type MaterialPreset } from './materialPresets'
import { findLinkedExpressIds } from './linkedMaterials'
import { resolveActivityLinksToIsolationTargets, resolveElementRefsToTargets, resolveIsolationTargetsToActivityIds } from './linkedElements'
import { LinkedActivitiesWidget } from './LinkedActivitiesWidget'
import { assignAnimationProfile, createModelElementLink, deleteModelElementLink, listModelElementLinks, type ModelElementLink, type ModelElementLinkSourceKind } from './modelElementLinks'
import {
  deleteModel3DFile, downloadModel3DFile, listModel3DFiles, updateUnloadedElements, uploadModel3DFile,
  type Model3DKind, type UnloadedElementInfo,
} from './model3dFiles'
import { createSectionBox, deleteSectionBox, listSectionBoxes, updateSectionBox, type SectionBox, type SectionBoxBounds, type SectionBoxRotation } from './sectionBoxes'
import { computeLocalBoundsForObject, computeLocalBoundsForObjects } from './sectionBoxGeometry'
import { AnimationProfilePanel } from './AnimationProfilePanel'
import { SideDock, type DockedPanel, type PanelSide } from './SideDock'
import { SectionBoxPanel, type SectionBoxTool } from './SectionBoxPanel'
import { createCameraView, deleteCameraView, listCameraViews, updateCameraView, type CameraView, type CameraViewPose } from './cameraViews'
import { createCamera, deleteCamera, listCameras, updateCamera, type Camera as CinematicCamera, type CameraPose } from './cameras'
import { uploadFourDVideo } from './fourDVideos'
import { CameraViewPanel } from './CameraViewPanel'
import { CamerasPanel } from './CamerasPanel'
import {
  addCollectionMember, createCollection, deleteCollection, flattenCollectionMemberRefs, listCollections, removeCollectionMember, updateCollection,
  type Collection as CollectionType, type CollectionMember,
} from './collections'
import { CollectionsPanel } from './CollectionsPanel'
import { listElementSplits, type ElementSplit } from './elementSplits'
import { regenerateSplitTargets } from './elementSplitTargets'
import { SplitByLevelPanel } from './SplitByLevelPanel'
import { listElementTransforms, saveElementTransform, type ElementTransform } from './elementTransforms'
import { resolveSelectionToMemberRefs } from './collectionResolvers'
import { useAnimationProfiles } from './animationProfiles'
import { useElementKeyframes, type ElementKeyframe, type KeyframeField } from './elementKeyframes'
import { DockLayoutMenu } from './DockLayoutMenu'
import { DEFAULT_DOCK_CONFIG, useActiveDockConfig, useDockLayouts, type DockLayoutConfig } from './dockLayouts'
// Type-only — see ifcModel.ts's own header + IfcDataPanel.tsx's matching
// note: the real loadIfcModel/disposeIfcModel functions are dynamic-
// import()ed inside handleImportIfc/handleUnloadIfc below, so web-ifc's real
// weight isn't in the main bundle at all until an IFC file is actually
// imported.
import type { IfcModelHandle } from './ifcModel'
// Real (non-type-only) import — elementBatching.ts has zero web-ifc
// dependency of its own (see its own header), unlike the type-only
// IfcModelHandle import above, so this doesn't reintroduce the
// ~2.95MB->6.6MB bundle regression ifcModel.ts's own header describes.
// Needed here specifically (not just dynamically imported at each call
// site like the rest of ifcModel.ts) because the render-body TransformPanel
// gizmo-target resolution below runs synchronously during render, where an
// await import() isn't an option.
import { ensureMaterialized, hasGeometry, materializeAll, removeElementsFromModel } from './elementBatching'
import { DataPanel, type DataPanelTab } from './DataPanel'
import { DockDivider } from './DockDivider'
import { PropertiesPanel } from './PropertiesPanel'
import { computeVisibleActivities, ScheduleWindow } from './ScheduleWindow'
import { SplitRow } from './SplitRow'
import { TimelineWindow } from './TimelineWindow'
import { computeKeyframeRange, computeScheduleRange, FPS_OPTIONS, padDegenerateRange, unionRanges, type TimeDisplayMode } from './timelinePlayback'
import type { GizmoMode, GizmoSpace, KeyframeSupport, PathProgressSupport, PivotRotationSupport, PivotSupport } from './TransformPanel'
import { ensurePivotSnapshot, getPivot, getPivotRotation, setPivot, setPivotRotation } from './elementPivot'
import { deleteElementParent, listElementParents, upsertElementParent, type ElementParent as ElementParentType } from './elementParents'
import { ElementRigPanel } from './ElementRigPanel'
import { createPath, deletePath, listPaths, updatePath, type Path, type PathPoint } from './paths'
import { deletePathFollower, listPathFollowers, updatePathFollower, upsertPathFollower, type PathFollower } from './pathFollowers'
import { PathsPanel } from './PathsPanel'
import { createZone, deleteZone, listZones, updateZone, type Zone, type ZonePoint } from './zones'
import { ZonesPanel } from './ZonesPanel'
import { createRadialChart, deleteRadialChart, listRadialCharts, updateRadialChart, uploadRadialChartIcon, type RadialChart, type RadialChartCenterMode } from './radialCharts'
import { RadialChartsPanel } from './RadialChartsPanel'
import { resolveScopeActivityIds, type ScopeFilter } from './scheduleScope'
import { useUserDefinedFieldDefinitions, useUserDefinedFieldValues } from '@/lib/userDefinedFields'
import { getTimelineStrip, saveTimelineStrip, type TimelineStrip } from './timelineStrips'
import { TimelineStripPanel } from './TimelineStripPanel'
import { getSiteContext, saveSiteContext, getTilesApiKey, saveTilesApiKey, type SiteContext } from './siteContext'
import { SiteContextPanel } from './SiteContextPanel'
import { createAnnotation, deleteAnnotation, listAnnotations, updateAnnotation, type Annotation, type AnnotationKind, type AnnotationUpdate } from './annotations'
import { AnnotationsPanel } from './AnnotationsPanel'
import {
  createClashTest, deleteClashTest, listClashTests, replaceClashResults, updateClashResult,
  type ClashResult, type ClashResultPair, type ClashTest,
} from './clashTests'
import { ClashDetectionPanel } from './ClashDetectionPanel'
import { resolveMembersToElements, findClashes, type ClashSceneObject } from './sceneClash'
import { listSiteCaptures, uploadSiteCapture, convertSiteCapture, generateIfcFromCapture, downloadSiteCapture, deleteSiteCapture, type SiteCapture, type SiteCaptureKind } from './siteCaptures'
import {
  createProgressVarianceTest, deleteProgressVarianceTest, listProgressVarianceTests,
  replaceProgressVarianceResults, updateProgressVarianceResult, updateProgressVarianceTest,
  getActivityProgressSuggestions,
  type ProgressVarianceResult, type ProgressVarianceResultElement, type ProgressVarianceTest,
  type ActivityProgressSuggestion,
} from './progressVarianceTests'
import { ProgressVariancePanel } from './ProgressVariancePanel'
import { loadFullPointCloud, getCachedPointCloud, setCachedPointCloud, clearPointCloudCache, runProgressVarianceQuery } from './progressVarianceEngine'
import { createMeasurement, deleteMeasurement, listMeasurements, updateMeasurement, type Measurement, type MeasurementPoint } from './measurements'
import { MeasurementsPanel, type MeasuringTool } from './MeasurementsPanel'
import type { MeasurementHit } from './MeasurementGizmo'
// Real (non-type-only) import, same reasoning as elementBatching.ts above —
// pure geometry math with zero web-ifc dependency of its own, so there's no
// bundle-weight benefit to deferring it the way ifcModel.ts itself needs
// (see resolveToMetresForHit below, which still dynamic-imports that one).
import { distanceMetres, measureFacePatch } from './measurementGeometry'
import { Viewport3D, type CameraSyncState, type ImportedObject, type ResolvedSectionBox, type VarianceEntry } from './Viewport3D'
import { ComparisonViewportPane } from './ComparisonViewportPane'
import { DEFAULT_PANE_CONFIG, useResolvedPaneIsolation, type PaneConfig } from './comparisonPane'
import { ImportErrorsBadge } from './ImportErrorsBadge'
import { ImportModelDialog } from './ImportModelDialog'
import { IfcScheduleWizard } from './IfcScheduleWizard'
import { UnloadModelDialog } from './UnloadModelDialog'
import { ReloadIfcDialog } from './ReloadIfcDialog'
import { defaultSourceUpAxis, type UpAxis } from './upAxis'
import { loadViewerSettings, saveViewerSettings, type ViewerSettings } from './viewerSettings'
import { loadIfcUnitDisplay, saveIfcUnitDisplay, type IfcUnitDisplay } from './ifcUnitDisplay'
import { WindowChrome, type DockSide } from './WindowChrome'

type WindowKey = 'schedule' | 'gantt' | 'tracking' | 'usage' | 'timeline'
const ALL_WINDOW_KEYS: WindowKey[] = ['schedule', 'gantt', 'tracking', 'usage', 'timeline']
const WINDOW_LABELS: Record<WindowKey, string> = {
  schedule: 'Activity Table', gantt: 'Gantt Chart', tracking: 'Resource Tracking', usage: 'Resource Usage', timeline: 'Animation Timeline',
}

interface SceneObject {
  id: string
  name: string
  kind: 'ifc' | 'mesh'
  // Chosen per-file at import time (ImportModelDialog.tsx) — see
  // upAxis.ts's axisCorrectionRotation for why this replaced a blanket
  // per-kind guess (2026-07-08, per Maro: "objects are still being imported
  // in a wrong axis").
  sourceUpAxis: ImportedObject['sourceUpAxis']
  object: ImportedObject['object']
  // The backend Model3DFile row id, once the upload finishes (2026-07-09,
  // per Maro's persistence request) — null while the upload is still in
  // flight, or if it failed (persistence is best-effort; a failed upload
  // still leaves the model usable for the rest of this session, just not
  // survivable across a hard refresh). handleUnloadIfc/handleUnloadMesh use
  // this to also delete the server-side copy, per Maro's explicit follow-up
  // constraint: "if i unload, i expect the data not to persist so you dont
  // endlessly store unneccessary data."
  fileId: string | null
}

const PROPERTIES_OPEN_KEY = 'prosota_4d_properties_open'
const DATA_PANEL_OPEN_KEY = 'prosota_4d_data_panel_open'
const PROFILE_PANEL_OPEN_KEY = 'prosota_4d_profile_panel_open'
const PROFILE_PANEL_DOCK_KEY = 'prosota_4d_profile_panel_dock'
const SECTION_PANEL_OPEN_KEY = 'prosota_4d_section_panel_open'
const SECTION_PANEL_DOCK_KEY = 'prosota_4d_section_panel_dock'
const CAMERA_PANEL_OPEN_KEY = 'prosota_4d_camera_panel_open'
const CAMERA_PANEL_DOCK_KEY = 'prosota_4d_camera_panel_dock'
const CAMERAS_PANEL_OPEN_KEY = 'prosota_4d_cinematic_cameras_panel_open'
const CAMERAS_PANEL_DOCK_KEY = 'prosota_4d_cinematic_cameras_panel_dock'
const COLLECTIONS_PANEL_OPEN_KEY = 'prosota_4d_collections_panel_open'
const COLLECTIONS_PANEL_DOCK_KEY = 'prosota_4d_collections_panel_dock'
const SPLIT_PANEL_OPEN_KEY = 'prosota_4d_split_panel_open'
const SPLIT_PANEL_DOCK_KEY = 'prosota_4d_split_panel_dock'
const PATHS_PANEL_OPEN_KEY = 'prosota_4d_paths_panel_open'
const PATHS_PANEL_DOCK_KEY = 'prosota_4d_paths_panel_dock'
const ZONES_PANEL_OPEN_KEY = 'prosota_4d_zones_panel_open'
const ZONES_PANEL_DOCK_KEY = 'prosota_4d_zones_panel_dock'
const RADIAL_CHARTS_PANEL_OPEN_KEY = 'prosota_4d_radial_charts_panel_open'
const RADIAL_CHARTS_PANEL_DOCK_KEY = 'prosota_4d_radial_charts_panel_dock'
const TIMELINE_STRIP_PANEL_OPEN_KEY = 'prosota_4d_timeline_strip_panel_open'
const TIMELINE_STRIP_PANEL_DOCK_KEY = 'prosota_4d_timeline_strip_panel_dock'
const SITE_CONTEXT_PANEL_OPEN_KEY = 'prosota_4d_site_context_panel_open'
const SITE_CONTEXT_PANEL_DOCK_KEY = 'prosota_4d_site_context_panel_dock'
const ANNOTATIONS_PANEL_OPEN_KEY = 'prosota_4d_annotations_panel_open'
const ANNOTATIONS_PANEL_DOCK_KEY = 'prosota_4d_annotations_panel_dock'
const CLASH_PANEL_OPEN_KEY = 'prosota_4d_clash_panel_open'
const CLASH_PANEL_DOCK_KEY = 'prosota_4d_clash_panel_dock'
const PROGRESS_VARIANCE_PANEL_OPEN_KEY = 'prosota_4d_progress_variance_panel_open'
const PROGRESS_VARIANCE_PANEL_DOCK_KEY = 'prosota_4d_progress_variance_panel_dock'
const RIG_PANEL_OPEN_KEY = 'prosota_4d_rig_panel_open'
const RIG_PANEL_DOCK_KEY = 'prosota_4d_rig_panel_dock'
const MEASUREMENTS_PANEL_OPEN_KEY = 'prosota_4d_measurements_panel_open'
const MEASUREMENTS_PANEL_DOCK_KEY = 'prosota_4d_measurements_panel_dock'
function loadPanelOpen(key: string, defaultOpen = true): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? defaultOpen : raw === 'true'
  } catch {
    return defaultOpen
  }
}

// The 4D workspace shell (2026-07-09/10, per Maro) — a persistent 3D
// viewport (Viewport3D.tsx) that never unmounts, "windows" of Schedule/
// Gantt Chart/Resource Tracking/Resource Usage/Animation Timeline
// (placeholder — see TimelineWindow.tsx) that can be docked above *or*
// below the viewport and closed again without disturbing it, a collapsible
// "3D View Properties" panel on the left (render settings), and a tabbed
// "Data" panel on the right (DataPanel.tsx) — an IFC tab (spatial
// structure/type counts/selected-element properties) and a 3D tab (list of
// plain "Import 3D" objects with per-object visibility + unload), since
// generic GLTF/OBJ/FBX imports have no IFC property data and needed their
// own management surface (2026-07-11, per Maro). "Import 3D" (via three.js's
// own loaders) and "Import IFC" (via web-ifc — see ifcModel.ts for why that
// library specifically, and what's verified vs. not) both add into the same
// viewport; sceneObjects below is the shared source of truth for what's in
// it.
//
// Windows dock top or bottom (windowDock, per-key, 2026-07-11 per Maro:
// "place them not just above the 3D viewport but below it if I want") and
// multiple windows sharing a dock split side by side with a drag handle
// (SplitRow.tsx, per Maro: "split the top for the schedule and gantt to
// share") — WindowChrome.tsx supplies the one shared header/dock-toggle/
// close every window uses, renderWindow/renderWindowContent below just
// supply what goes inside it per key.
//
// Data fetch here deliberately mirrors Scheduling.tsx's own `refresh()`
// shape rather than sharing a hook with it — this is the only other place
// that needs the same activities/relationships/resources/resourceAssignments/
// calendars for a project's live schedule, and extracting a shared hook
// would mean touching Scheduling.tsx's own well-tested data flow for a
// one-off reuse.
//
// `active` (2026-07-11, per Maro) — App.tsx's PersistentFourD keeps this
// component mounted for the whole session (CSS-hidden, not unmounted, so
// imported 3D/IFC data survives leaving the tab), and passes false while
// hidden so Viewport3D.tsx can drop its Canvas to frameloop="never" instead
// of rendering into an invisible tab. Defaults true so this still works if
// ever rendered directly (e.g. in isolation).
// Hoisted out of the restore-on-mount effect below (2026-07-26, for
// "Reload IFC" — see handleReloadIfc's own header) — a pure function with
// no closure over component state, so sharing it between the normal
// restore-on-mount flow and a one-off single-file reload is just a plain
// function reference, not a refactor of either call site's own logic.
function applyElementTransform(object: Object3D, t: ElementTransform | undefined) {
  if (!t) return
  // Pivot first (2026-07-12, extended 2026-07-22 for pivot rotation) —
  // setPivot/setPivotRotation's own compensating position/quaternion
  // writes would otherwise be immediately overwritten by the .set() calls
  // below anyway, but running them first means those correctly land on
  // the saved *final* authored position/rotation rather than fighting a
  // pivot-driven change applied after the fact — geometry recentering is
  // the part that actually matters here, since nothing else re-derives
  // it. See elementPivot.ts's own header.
  if (t.pivot_x !== null && t.pivot_y !== null && t.pivot_z !== null) {
    setPivot(object, new Vector3(t.pivot_x, t.pivot_y, t.pivot_z))
  }
  if (t.pivot_rotation_x !== null && t.pivot_rotation_y !== null && t.pivot_rotation_z !== null) {
    setPivotRotation(object, new Euler(t.pivot_rotation_x, t.pivot_rotation_y, t.pivot_rotation_z))
  }
  object.position.set(t.position_x, t.position_y, t.position_z)
  object.rotation.set(t.rotation_x, t.rotation_y, t.rotation_z)
  object.scale.set(t.scale_x, t.scale_y, t.scale_z)
}

export function FourD({ active = true }: { active?: boolean } = {}) {
  const { selectedProject } = useProject()
  // hasEverBeenActive (2026-07-20, optimization pass) — flips true the
  // first time this tab is actually opened and stays true for the rest of
  // the session (never reverts to false). PersistentFourD mounts this
  // component the instant a project is selected and keeps it mounted
  // forever after (hidden via CSS, not unmounted, so switching tabs
  // resumes instantly) — without this gate, ~20 independent data-loading
  // effects below (camera views, collections, annotations, clash tests,
  // measurements, model3d files, ...) all fired their own fetch the moment
  // a project was selected, regardless of whether /4d was ever opened.
  // Deliberately does NOT re-gate on every active transition after the
  // first one — once you've opened /4d in a session, switching projects
  // still refreshes its data as before; only the "never opened it at all"
  // case is what this closes.
  const [hasEverBeenActive, setHasEverBeenActive] = useState(active)
  useEffect(() => {
    if (active) setHasEverBeenActive(true)
  }, [active])
  // refetchPeriod (2026-07-09 fix, per Maro: "the activity table and gantt
  // still doesnt show what's in the schedule even clicking the refresh
  // icon") — this hook's own `period` only ever gets (re-)resolved once,
  // when `selectedProject.id` first changes (see useScheduleVariant.ts's
  // own bootstrap effect, gated on `[projectId]` alone). App.tsx's
  // PersistentFourD keeps FourD mounted for the *entire session*, so that
  // one resolution happens once, near whenever the project was first
  // selected — if the real "live" schedule period's identity changes after
  // that (a freeze/promote/baseline action taken on the actual Scheduling
  // page counts, since that page creates a new live SchedulePeriod row and
  // marks the old one frozen — see schedule_period.py's bootstrap_period),
  // this component's `period` reference goes stale and stays stale
  // indefinitely: the manual refresh button and the tab-reactivation effect
  // below were both correctly re-fetching *activities*, just always for the
  // same now-wrong period id — asking the right question of the wrong
  // period, however many times you ask it.
  const { period, refetch: refetchPeriod } = useActiveScheduleVariant(selectedProject?.id)

  const [activities, setActivities] = useState<Activity[]>([])
  const [relationships, setRelationships] = useState<ActivityRelationship[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [resourceAssignments, setResourceAssignments] = useState<ResourceAssignment[]>([])
  const [calendars, setCalendars] = useState<Calendar[]>([])

  const [scheduleLoading, setScheduleLoading] = useState(false)
  // Guards against an out-of-order response overwriting newer data (2026-07-09
  // fix — "still cant see the loaded schedule" turned out to be this, not
  // just the staleness this refetch was originally added for): the effect
  // below fires on every selectedProject/period/active change, and
  // useActiveScheduleVariant's own period can genuinely change more than
  // once in quick succession while it's still resolving (an initial
  // bootstrap-master period, immediately followed by whichever variant was
  // actually restored from sessionStorage) — if the *first* (wrong/earlier)
  // request happens to resolve *after* the second (correct) one, its
  // response would land last and silently overwrite the right data with
  // the wrong period's, often empty, one. Each call captures its own
  // request token; only the call that's still the most recent one when its
  // response arrives is allowed to commit state.
  const scheduleRequestRef = useRef(0)

  const refreshSchedule = async () => {
    if (!selectedProject || !period) return
    const requestId = ++scheduleRequestRef.current
    setScheduleLoading(true)
    try {
      const [activitiesRes, relationshipsRes, resourcesRes, assignmentsRes, calendarsRes] = await Promise.all([
        api.get<Activity[]>('/api/v1/activities/', { params: { project_id: selectedProject.id, schedule_period_id: period.id } }),
        api.get<ActivityRelationship[]>('/api/v1/activity-relationships/', { params: { schedule_period_id: period.id } }),
        api.get<Resource[]>('/api/v1/resources/', { params: { project_id: selectedProject.id } }),
        api.get<ResourceAssignment[]>('/api/v1/resource-assignments/', { params: { schedule_period_id: period.id } }),
        api.get<Calendar[]>('/api/v1/calendars/', { params: { project_id: selectedProject.id } }),
      ])
      if (requestId !== scheduleRequestRef.current) return
      setActivities(activitiesRes.data)
      setRelationships(relationshipsRes.data)
      setResources(resourcesRes.data)
      setResourceAssignments(assignmentsRes.data)
      setCalendars(calendarsRes.data)
    } finally {
      if (requestId === scheduleRequestRef.current) setScheduleLoading(false)
    }
  }

  // Refetches whenever the project/period changes, AND every time this tab
  // becomes visible again (2026-07-09 fix, per Maro: "sometimes it doesn't
  // pull exactly the activities from the schedule") — App.tsx's
  // PersistentFourD keeps this component mounted for the entire session
  // rather than unmounting it on navigation (so imported 3D/IFC data
  // survives leaving the tab), which means the original project/period-only
  // effect only ever fetched *once* per project selection: editing the
  // schedule in the real Scheduling tab and switching back to 4D kept
  // showing whatever activities/dates were loaded the very first time,
  // indefinitely stale. `active` flips true->false->true on every visit to
  // this tab (see this component's own header comment on that prop) — a
  // clean, already-existing signal for "the user just switched back to this
  // tab," reused here as the refetch trigger.
  //
  // refetchPeriod() first (2026-07-09 fix, per Maro: "still doesnt show
  // what's in the schedule even clicking the refresh icon") — see this
  // component's own comment by the `period` destructure above: re-fetching
  // *activities* alone was never enough if `period` itself had gone stale.
  // refetchPeriod() always resolves a *new* period object (a fresh
  // deserialized API response, never the same reference even when nothing's
  // actually changed — see useScheduleVariant.ts's own loadPeriodFor), so
  // this effect's own `period` dependency below is guaranteed to see a
  // change and re-run `refreshSchedule()` against whatever period is
  // *actually* live now — not relying on this same synchronous call seeing
  // the update immediately, since setPeriod() inside the hook only takes
  // effect on the next render.
  useEffect(() => {
    if (!active) return
    refetchPeriod()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, active])

  useEffect(() => {
    if (!active) return
    refreshSchedule()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, period, active])

  // Activity↔model-element links (2026-07-11) — the frontend half of
  // model_element_link.py's backend (built earlier this session, tested,
  // but with no UI until now). Project-scoped, not period-scoped like
  // activities above — a link survives across periods/re-imports as long as
  // the same element_ref (GlobalId or filename) comes back, per the
  // backend's own persistence model.
  const [modelElementLinks, setModelElementLinks] = useState<ModelElementLink[]>([])
  const [linkError, setLinkError] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listModelElementLinks(selectedProject.id).then(links => { if (!cancelled) setModelElementLinks(links) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  const handleLinkElement = async (sourceKind: ModelElementLinkSourceKind, elementRef: string, elementLabel: string, activityId: string) => {
    try {
      setLinkError(null)
      const link = await createModelElementLink({ activity_id: activityId, source_kind: sourceKind, element_ref: elementRef, element_label: elementLabel })
      setModelElementLinks(prev => [...prev, link])
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to link element to activity')
    }
  }
  const handleUnlinkElement = async (linkId: string) => {
    try {
      setLinkError(null)
      await deleteModelElementLink(linkId)
      setModelElementLinks(prev => prev.filter(l => l.id !== linkId))
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to remove link')
    }
  }

  // Section Box (2026-07-09, per Maro's Blender "Section Box" plugin
  // reference, walked through via screenshots) — project-scoped like
  // modelElementLinks above, persisted server-side (section_box.py).
  // Whole-object scope only for now — element-scoped boxes land with
  // per-IFC-element scoping (see sectionBoxGeometry.ts/Viewport3D.tsx's
  // ResolvedSectionBox for the fuller design).
  const [sectionBoxes, setSectionBoxes] = useState<SectionBox[]>([])
  const [sectionBoxError, setSectionBoxError] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listSectionBoxes(selectedProject.id).then(boxes => { if (!cancelled) setSectionBoxes(boxes) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  // Seeds a new box around whatever's currently the "active" whole object
  // (Transform panel's own target — see activeSceneObject below) — matches
  // the reference's own "select something, then click +" flow. Guarded on
  // fileId being resolved yet (2026-07-09, per design review): a
  // freshly-imported model's upload runs in the background
  // (persistModelFile), and SectionBox.model3d_file_id is a real FK —
  // there's nothing to attach to until that upload lands.
  // Prefers the backend's own `detail` message over axios's generic
  // "Request failed with status code 404" (2026-07-09 fix, per a real
  // incident: a stale fileId from an earlier import in a long-lived
  // browser tab produced exactly that generic message for what was
  // actually a clear, specific backend error — "Model file not found" —
  // and diagnosing it took reading the backend's own access log instead
  // of just being able to read the error in the UI).
  const sectionBoxErrorMessage = (err: unknown, fallback: string): string => {
    if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') return err.response.data.detail
    return err instanceof Error ? err.message : fallback
  }

  const handleCreateSectionBox = async () => {
    const target = sceneObjects.find(o => o.id === activeObjectId)
    if (!target || !selectedProject) return
    if (!target.fileId) {
      setSectionBoxError('Still saving this model — try again in a moment.')
      return
    }
    try {
      setSectionBoxError(null)
      // Self-heals a stale cached fileId (2026-07-09 fix, per a real
      // incident: this tab's own sceneObjects.fileId had drifted from
      // what the server actually has — a page reload should fix that but
      // didn't reliably enough in practice) — re-checks the server's own
      // current listing by name right before creating, rather than
      // trusting whatever fileId got cached whenever this object was
      // first loaded. If the server's own id for this file has since
      // changed (re-upload, a stale restore, anything), uses the fresh
      // one and corrects sceneObjects too, so the next action on this
      // object doesn't hit the same staleness again.
      let fileId = target.fileId
      const files = await listModel3DFiles(selectedProject.id).catch(() => [])
      const current = files.find(f => f.name === target.name && f.kind === target.kind)
      if (current && current.id !== fileId) {
        fileId = current.id
        setSceneObjects(prev => prev.map(o => (o.id === target.id ? { ...o, fileId: current.id } : o)))
      }
      // Element-scoped when a specific IFC sub-element is selected within
      // this object (2026-07-09, per-element scoping) — same selection-
      // priority convention handleFrameSelected already uses (a specific
      // sub-element beats the whole object). Bounds are computed against
      // that element's own mesh, not the whole model, so the box wraps
      // just that element; element_ref stores its GlobalId (the stable
      // identifier — expressIDs only mean anything within one web-ifc
      // session, see ifcModel.ts). Relies on selectedExpressId only ever
      // being non-null when exactly one element is genuinely selected —
      // see handleBoxSelect/handleSelectUnassigned/handleSelectAll's own
      // 2026-07-17 fix headers for why that invariant used to not hold.
      let elementRef: string | null = null
      let bounds: SectionBoxBounds
      if (target.kind === 'ifc' && selectedExpressId !== null) {
        const handle = getIfcHandleFor(target.id)
        // ensureMaterialized, not a plain traverse (2026-07-17) — see
        // elementBatching.ts's own header: a repeated-geometry element may
        // still be sitting in the shared BatchedMesh, not its own
        // traversable mesh, if it was selected some way other than a
        // click (handleClick's own materialize call covers that path).
        let found: Object3D | null = null
        if (handle) {
          found = ensureMaterialized(handle.object, selectedExpressId)
        }
        if (found && handle) {
          const { getElementInfo } = await import('./ifcModel')
          elementRef = (await getElementInfo(handle, selectedExpressId)).globalId
          bounds = computeLocalBoundsForObject(found)
        } else {
          bounds = computeLocalBoundsForObject(target.object)
        }
      } else if (target.kind === 'ifc' && selectedExpressIds.size > 0) {
        // Multi-element selection (e.g. a Collection) — see
        // computeLocalBoundsForObjects's own header for why this exists.
        const handle = getIfcHandleFor(target.id)
        const found: Object3D[] = []
        if (handle) {
          // materializeAll first (2026-07-17 fix) — this branch used to be
          // unreachable for any multi-select (see this function's own
          // header above), so its missing materialize call never mattered
          // until now: a plain traverse only ever sees real individual
          // meshes, silently skipping every element still sitting in the
          // shared THREE.BatchedMesh untouched, which for a large Select
          // All is most of them — same "materialize first" convention
          // elementBatching.ts's own header documents for every other
          // whole-model scan in this app.
          materializeAll(handle.object)
          // Same TimelinePlayback re-derive trigger Select All's own
          // materializeAll needs — see materializeVersion's own state
          // comment for why this call site needs it too.
          setMaterializeVersion(v => v + 1)
          handle.object.traverse(child => { if (selectedExpressIds.has(child.userData.expressID)) found.push(child) })
        }
        bounds = found.length > 0 ? computeLocalBoundsForObjects(target.object, found) : computeLocalBoundsForObject(target.object)
      } else {
        bounds = computeLocalBoundsForObject(target.object)
      }
      const box = await createSectionBox({ model3d_file_id: fileId, element_ref: elementRef, ...bounds })
      setSectionBoxes(prev => [...prev, box])
    } catch (err) {
      setSectionBoxError(sectionBoxErrorMessage(err, 'Failed to create section box'))
    }
  }

  const handleUpdateSectionBox = async (id: string, data: Partial<SectionBoxBounds> & Partial<SectionBoxRotation> & { name?: string; active?: boolean; visible?: boolean }) => {
    try {
      setSectionBoxError(null)
      const updated = await updateSectionBox(id, data)
      setSectionBoxes(prev => prev.map(b => (b.id === id ? updated : b)))
    } catch (err) {
      setSectionBoxError(sectionBoxErrorMessage(err, 'Failed to update section box'))
    }
  }
  const handleRenameSectionBox = (id: string, name: string) => handleUpdateSectionBox(id, { name })
  const handleToggleSectionBoxActive = (id: string) => {
    const box = sectionBoxes.find(b => b.id === id)
    if (box) handleUpdateSectionBox(id, { active: !box.active })
  }
  const handleToggleSectionBoxVisible = (id: string) => {
    const box = sectionBoxes.find(b => b.id === id)
    if (box) handleUpdateSectionBox(id, { visible: !box.visible })
  }
  // SectionBoxGizmo.tsx's own live-drag/commit — see draggingSectionBox's
  // own header for why the preview is kept separate from sectionBoxes
  // itself. onDragEnd both clears the preview and fires the real PATCH in
  // one go, so there's never a frame where neither the override nor the
  // committed value reflects the just-released position.
  const handleSectionBoxDragMove = (id: string, bounds: SectionBoxBounds) => setDraggingSectionBox({ id, bounds })
  const handleSectionBoxDragEnd = (id: string, bounds: SectionBoxBounds) => {
    setDraggingSectionBox(null)
    handleUpdateSectionBox(id, bounds)
  }
  // Same live-drag/commit split as handleSectionBoxDragMove/End above, for
  // the rotate gizmo (2026-07-17).
  const handleSectionBoxRotateMove = (id: string, rotation: SectionBoxRotation) => setDraggingSectionBoxRotation({ id, rotation })
  const handleSectionBoxRotateEnd = (id: string, rotation: SectionBoxRotation) => {
    setDraggingSectionBoxRotation(null)
    handleUpdateSectionBox(id, rotation)
  }

  const handleDeleteSectionBox = async (id: string) => {
    try {
      setSectionBoxError(null)
      await deleteSectionBox(id)
      setSectionBoxes(prev => prev.filter(b => b.id !== id))
    } catch (err) {
      // A 404 here means the box is already gone server-side (e.g. its
      // Model3DFile was deleted elsewhere, cascading it away — see
      // section_box.py's own docstring on why that FK cascades) — the
      // user's actual goal ("make this go away") is already true, so
      // self-heal the stale local entry instead of leaving a phantom row
      // the delete button can never successfully clear (2026-07-09, per a
      // real incident: a stale sectionBoxes entry from before an earlier
      // model re-import kept 404ing on every delete attempt).
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setSectionBoxes(prev => prev.filter(b => b.id !== id))
        return
      }
      setSectionBoxError(sectionBoxErrorMessage(err, 'Failed to delete section box'))
    }
  }

  // Collections (2026-07-11, per Maro's Blender reference) — project-scoped,
  // persisted server-side (collection.py). This phase is hollow: tree CRUD
  // only (create/rename/reparent/delete) — Add-Selected and per-collection
  // Select/Hide/Isolate land once the reverse resolver and sub-element hide
  // extension exist (see this feature's own plan doc, later phases).
  const [collections, setCollections] = useState<CollectionType[]>([])
  const [collectionError, setCollectionError] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listCollections(selectedProject.id).then(cs => { if (!cancelled) setCollections(cs) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  // "Split an element by level" (2026-07-15, per Maro) — project-scoped,
  // persisted server-side (element_split.py). Same fetch-on-project-change
  // shape as Collections/ModelElementLink above; the actual slice
  // generation (elementSplitTargets.ts) reacts to this state further below,
  // once ifcHandles is declared.
  const [elementSplits, setElementSplits] = useState<ElementSplit[]>([])
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listElementSplits(selectedProject.id).then(s => { if (!cancelled) setElementSplits(s) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])
  const refreshElementSplits = () => {
    if (!selectedProject) return
    listElementSplits(selectedProject.id).then(setElementSplits)
  }

  // Exposed so SplitByLevelPanel.tsx can refetch after auto-creating its own
  // "Splits" collection on commit (2026-07-15, per Maro: "add the original
  // its slices in a collection") — mirrors refreshElementSplits above.
  const refreshCollections = () => {
    if (!selectedProject) return
    listCollections(selectedProject.id).then(setCollections)
  }

  const collectionErrorMessage = (err: unknown, fallback: string): string => {
    if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') return err.response.data.detail
    return err instanceof Error ? err.message : fallback
  }

  const handleCreateCollection = async (parentCollectionId: string | null) => {
    if (!selectedProject) return
    try {
      setCollectionError(null)
      const created = await createCollection({ project_id: selectedProject.id, parent_collection_id: parentCollectionId })
      setCollections(prev => [...prev, created])
    } catch (err) {
      setCollectionError(collectionErrorMessage(err, 'Failed to create collection'))
    }
  }

  const handleUpdateCollection = async (id: string, data: { name?: string; parent_collection_id?: string | null }) => {
    try {
      setCollectionError(null)
      const updated = await updateCollection(id, data)
      setCollections(prev => prev.map(c => (c.id === id ? updated : c)))
    } catch (err) {
      setCollectionError(collectionErrorMessage(err, 'Failed to update collection'))
    }
  }
  const handleRenameCollection = (id: string, name: string) => handleUpdateCollection(id, { name })
  const handleReparentCollection = (id: string, parentCollectionId: string | null) =>
    handleUpdateCollection(id, { parent_collection_id: parentCollectionId })

  const handleDeleteCollection = async (id: string) => {
    if (!selectedProject) return
    try {
      setCollectionError(null)
      await deleteCollection(id)
      // Cascades sub-collections server-side (ON DELETE CASCADE) — a
      // re-fetch (not a local filter) is the simplest correct way to drop
      // whichever descendants went with it, rather than re-deriving the
      // cascade's own reachability logic client-side just to avoid one
      // extra round-trip.
      setCollections(await listCollections(selectedProject.id))
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setCollections(await listCollections(selectedProject.id))
        return
      }
      setCollectionError(collectionErrorMessage(err, 'Failed to delete collection'))
    }
  }

  // "Add Selected to Collection" (2026-07-11) — resolveSelectionToMemberRefs
  // is the reverse of linkedElements.ts's own resolvers: live selection ->
  // loose (source_kind, element_ref) refs. getIfcHandleFor(activeIfcModelId)
  // is the same handle selectedExpressIds is already implicitly scoped to
  // (see collectionResolvers.ts's own header) — no re-derivation needed.
  const handleAddSelectedToCollection = async (collectionId: string) => {
    const handle = getIfcHandleFor(activeIfcModelId)
    const drafts = await resolveSelectionToMemberRefs(selectedObjectIds, selectedExpressIds, sceneObjects, handle)
    if (drafts.length === 0) return
    setCollectionError(null)
    const newMembers: CollectionMember[] = []
    for (const draft of drafts) {
      try {
        newMembers.push(await addCollectionMember({ collection_id: collectionId, ...draft }))
      } catch (err) {
        // 409 = this element's already in this collection — a benign no-op
        // from the user's perspective (they selected some already-grouped
        // elements alongside new ones), not worth surfacing per-element.
        if (axios.isAxiosError(err) && err.response?.status === 409) continue
        setCollectionError(collectionErrorMessage(err, 'Failed to add some elements to the collection'))
      }
    }
    if (newMembers.length > 0) {
      setCollections(prev => prev.map(c => (c.id === collectionId ? { ...c, members: [...c.members, ...newMembers] } : c)))
    }
  }

  // "Remove Selected from Collection" (2026-07-15, per Maro: "just realised
  // there's not remove selected from collection") — exact inverse of Add
  // Selected above: same resolveSelectionToMemberRefs call to get the
  // current selection's own (source_kind, element_ref) identity, matched
  // against this *specific* collection's own members (not a flattened
  // subtree — mirrors Add Selected's own single-collection scope, so
  // removing from a parent never reaches into a sub-collection's separate
  // membership). Elements in the selection that aren't actually in this
  // collection are silently skipped, same permissive shape as Add
  // Selected's own 409-is-a-no-op handling — the point is "remove whatever
  // of the selection *is* here," not to error over the rest.
  const handleRemoveSelectedFromCollection = async (collectionId: string) => {
    const collection = collections.find(c => c.id === collectionId)
    if (!collection) return
    const handle = getIfcHandleFor(activeIfcModelId)
    const drafts = await resolveSelectionToMemberRefs(selectedObjectIds, selectedExpressIds, sceneObjects, handle)
    if (drafts.length === 0) return
    const draftKeys = new Set(drafts.map(d => `${d.source_kind}::${d.element_ref}`))
    const toRemove = collection.members.filter(m => draftKeys.has(`${m.source_kind}::${m.element_ref}`))
    if (toRemove.length === 0) return
    setCollectionError(null)
    const removedIds = new Set<string>()
    for (const member of toRemove) {
      try {
        await removeCollectionMember(member.id)
        removedIds.add(member.id)
      } catch (err) {
        setCollectionError(collectionErrorMessage(err, 'Failed to remove some elements from the collection'))
      }
    }
    if (removedIds.size > 0) {
      setCollections(prev => prev.map(c => (
        c.id === collectionId ? { ...c, members: c.members.filter(m => !removedIds.has(m.id)) } : c
      )))
    }
  }

  const handleSelectCollection = async (collectionId: string) => {
    const refs = flattenCollectionMemberRefs(collectionId, collections)
    const { objectIds, expressIds } = await resolveElementRefsToTargets(refs, sceneObjects, ifcHandles)
    if (objectIds.size === 0 && expressIds.size === 0) return
    setSelectedObjectIds(objectIds)
    setSelectedExpressIds(expressIds)
    setSelectedExpressId(null)  // no single "primary" element in a bulk collection select
    const ifcObjectIds = [...objectIds].filter(id => id.startsWith('ifc-'))
    setActiveIfcModelId(ifcObjectIds.length === 1 ? ifcObjectIds[0] : null)
    setActiveObjectId(objectIds.size === 1 ? [...objectIds][0] : null)
  }

  // Per-member select (2026-07-15, per Maro: "i want to be able select each
  // element in the split collection") — same resolution as
  // handleSelectCollection above, just scoped to one (source_kind,
  // element_ref) pair instead of a whole collection's flattened
  // membership, and *does* set a single "primary" element (there's exactly
  // one, unlike the bulk case), so IfcDataPanel's Object Information
  // actually shows something for it.
  const handleSelectCollectionMember = async (member: { source_kind: 'ifc' | 'mesh' | 'ifc_split'; element_ref: string }) => {
    const { objectIds, expressIds } = await resolveElementRefsToTargets([member], sceneObjects, ifcHandles)
    if (objectIds.size === 0 && expressIds.size === 0) return
    setSelectedObjectIds(objectIds)
    setSelectedExpressIds(expressIds)
    setSelectedExpressId(expressIds.size === 1 ? [...expressIds][0] : null)
    const ifcObjectIds = [...objectIds].filter(id => id.startsWith('ifc-'))
    setActiveIfcModelId(ifcObjectIds.length === 1 ? ifcObjectIds[0] : null)
    setActiveObjectId(objectIds.size === 1 ? [...objectIds][0] : null)
  }

  const handleHideCollection = async (collectionId: string) => {
    const refs = flattenCollectionMemberRefs(collectionId, collections)
    const { objectIds, expressKeys } = await resolveElementRefsToTargets(refs, sceneObjects, ifcHandles)
    // objectIds mixes genuine mesh-kind whole-object members with the
    // owning IFC model's own bookkeeping entry (added for isolate's "parent
    // hides children" three.js need — see linkedElements.ts's own comment —
    // irrelevant to hide). Only the former belongs in hiddenIds; hiding an
    // IFC sub-element never touches its model's own object-level
    // visibility (Viewport3D.tsx's own hiddenExpressIds doc comment).
    const meshObjectIds = [...objectIds].filter(id => !id.startsWith('ifc-'))
    if (meshObjectIds.length > 0) setHiddenIds(prev => new Set([...prev, ...meshObjectIds]))
    if (expressKeys.size > 0) setHiddenExpressIds(prev => new Set([...prev, ...expressKeys]))
  }

  // Unhide (2026-07-15, per Maro) — exact inverse of handleHideCollection
  // above: removes this collection's own members from hiddenIds/
  // hiddenExpressIds instead of adding to them. Deliberately narrow (only
  // this collection's own membership, same resolution as Hide) rather than
  // Show All's "clear everything" — a collection someone else hid stays
  // hidden if it isn't part of what got unhidden.
  const handleUnhideCollection = async (collectionId: string) => {
    const refs = flattenCollectionMemberRefs(collectionId, collections)
    const { objectIds, expressKeys } = await resolveElementRefsToTargets(refs, sceneObjects, ifcHandles)
    const meshObjectIds = [...objectIds].filter(id => !id.startsWith('ifc-'))
    if (meshObjectIds.length > 0) {
      setHiddenIds(prev => {
        const next = new Set(prev)
        meshObjectIds.forEach(id => next.delete(id))
        return next
      })
    }
    if (expressKeys.size > 0) {
      setHiddenExpressIds(prev => {
        const next = new Set(prev)
        expressKeys.forEach(key => next.delete(key))
        return next
      })
    }
  }

  // Hide Selected (2026-07-15, per Maro) — the viewport toolbar's own
  // equivalent of the Collections panel's per-collection Hide button above,
  // just sourced from whatever's currently selected instead of a
  // collection's membership list. Same two-Set split: specific IFC
  // sub-elements (selectedExpressIds, non-empty only alongside a single
  // activeObjectId — see resolveActiveTextureKeys' own comment on why this
  // codebase already treats that pairing as the one-active-model
  // assumption) go to hiddenExpressIds under their composite key; any
  // *other* selected whole objects (a plain mesh import, or a second model
  // picked up via ctrl-click alongside sub-elements of the first) go to
  // hiddenIds. A whole-object-only selection (Select All, or a plain mesh
  // click) has no expressIds at all, so it falls straight to the second
  // branch instead.
  // Filter (2026-07-26, per Maro — see Viewport3D.tsx's own onFilterApply
  // prop header for the full "why"). keptExpressIds already comes back
  // scoped to activeObjectId (ElementFilterDialog.tsx only ever reads one
  // handle at a time), so this just replaces selectedExpressIds outright —
  // same "narrows to a fresh result set" convention onSelectUnassigned/
  // handleSelectAll already use, not an additive selection gesture.
  const handleFilterApply = (keptExpressIds: number[]) => {
    setSelectedExpressIds(new Set(keptExpressIds))
    setSelectedExpressId(keptExpressIds.length === 1 ? keptExpressIds[0] : null)
    if (activeObjectId) setSelectedObjectIds(new Set([activeObjectId]))
  }

  const handleHideSelected = () => {
    if (selectedObjectIds.size === 0 && selectedExpressIds.size === 0) return
    if (activeObjectId && selectedExpressIds.size > 0) {
      const expressKeys = [...selectedExpressIds].map(expressID => `${activeObjectId}::${expressID}`)
      setHiddenExpressIds(prev => new Set([...prev, ...expressKeys]))
      const wholeObjectIds = [...selectedObjectIds].filter(id => id !== activeObjectId)
      if (wholeObjectIds.length > 0) setHiddenIds(prev => new Set([...prev, ...wholeObjectIds]))
    } else if (selectedObjectIds.size > 0) {
      setHiddenIds(prev => new Set([...prev, ...selectedObjectIds]))
    }
  }

  const handleIsolateCollection = async (collectionId: string) => {
    const refs = flattenCollectionMemberRefs(collectionId, collections)
    const { objectIds, expressIds } = await resolveElementRefsToTargets(refs, sceneObjects, ifcHandles)
    if (objectIds.size === 0) return
    setIsolatedObjectIds(objectIds)
    setIsolatedExpressIds(expressIds)
    setIsolateMode(true)
  }

  // Paths / Follow Path (2026-07-11, per Maro's Blender curve reference:
  // "in blender you can add a curve, edit it and set a path from point a to
  // b... i can then place an object to follow that path") — project-scoped,
  // persisted server-side (path.py/path_follower.py). Mesh targets only
  // this pass — see PathFollower binding below and Viewport3D.tsx's own
  // ResolvedPathTarget header for why (matches ElementKeyframe's own
  // existing mesh-only v1 scope; camera binding is a later pass).
  const [paths, setPaths] = useState<Path[]>([])
  const [pathFollowers, setPathFollowers] = useState<PathFollower[]>([])
  const [pathError, setPathError] = useState<string | null>(null)
  const [addingPointsForPathId, setAddingPointsForPathId] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listPaths(selectedProject.id).then(ps => { if (!cancelled) setPaths(ps) })
    listPathFollowers(selectedProject.id).then(fs => { if (!cancelled) setPathFollowers(fs) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  const pathErrorMessage = (err: unknown, fallback: string): string => {
    if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') return err.response.data.detail
    return err instanceof Error ? err.message : fallback
  }

  const handleCreatePath = async () => {
    if (!selectedProject) return
    try {
      setPathError(null)
      const path = await createPath({ project_id: selectedProject.id })
      setPaths(prev => [...prev, path])
    } catch (err) {
      setPathError(pathErrorMessage(err, 'Failed to create path'))
    }
  }

  const handleUpdatePath = async (id: string, data: Partial<Pick<Path, 'name' | 'points' | 'closed' | 'visible' | 'color' | 'line_style' | 'show_arrow' | 'show_label' | 'line_width' | 'dash_size' | 'gap_size' | 'animate' | 'animation_loop'>>) => {
    try {
      setPathError(null)
      const updated = await updatePath(id, data)
      setPaths(prev => prev.map(p => (p.id === id ? updated : p)))
    } catch (err) {
      setPathError(pathErrorMessage(err, 'Failed to update path'))
    }
  }
  const handleRenamePath = (id: string, name: string) => handleUpdatePath(id, { name })
  const handleTogglePathClosed = (id: string) => {
    const path = paths.find(p => p.id === id)
    if (path) handleUpdatePath(id, { closed: !path.closed })
  }
  const handleTogglePathVisible = (id: string) => {
    const path = paths.find(p => p.id === id)
    if (path) handleUpdatePath(id, { visible: !path.visible })
  }
  const handleDeletePath = async (id: string) => {
    try {
      setPathError(null)
      await deletePath(id)
      setPaths(prev => prev.filter(p => p.id !== id))
      setPathFollowers(prev => prev.filter(f => f.path_id !== id))
      if (addingPointsForPathId === id) setAddingPointsForPathId(null)
      await deleteOrphanedAnimKeyframes('path', id)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setPaths(prev => prev.filter(p => p.id !== id))
        await deleteOrphanedAnimKeyframes('path', id)
        return
      }
      setPathError(pathErrorMessage(err, 'Failed to delete path'))
    }
  }
  const handleToggleAddPathPoints = (id: string) => {
    setAddingPointsForPathId(prev => (prev === id ? null : id))
  }
  const handleRemoveLastPathPoint = (id: string) => {
    const path = paths.find(p => p.id === id)
    if (!path || path.points.length === 0) return
    handleUpdatePath(id, { points: path.points.slice(0, -1) })
  }
  // Click-to-place (PathGizmo.tsx's PathAddPointCatcher) appends straight
  // to the server copy — no local-only preview needed here since each click
  // is already a discrete, deliberate action (unlike a continuous drag).
  // Every point lands exactly where clicked, height included — no ground
  // lock, no surface-snap refinement (2026-07-29, per Maro: removed after
  // "Trace on ground"/"Snap to surface" went through several attempts —
  // rooftop-arcing fix, lock-to-first-point, a vertical-refine raycast,
  // a pending-point confirm step — and still wasn't reliable; plain
  // per-click placement, with PathGizmo.tsx's own drag-to-real-surface fix
  // and handleSetPathElevation's manual nudge below, "works better").
  const handleAddPathPoint = (id: string, point: PathPoint) => {
    const path = paths.find(p => p.id === id)
    if (!path) return
    handleUpdatePath(id, { points: [...path.points, point] })
  }
  // Path has no dedicated `elevation` column the way Zone does (path.py's
  // points are a genuine 3D curve, not a flat footprint) — computed here
  // instead as the points' own average up-coordinate, and written back as
  // a uniform shift of the whole array, so a sloped path's own relative
  // shape survives a nudge; only its overall height moves. PathsPanel.tsx's
  // own pathElevation() computes the identical average for display, kept
  // in sync with this write by construction (same formula, same source
  // data) rather than by any shared constant.
  const handleSetPathElevation = (id: string, elevation: number) => {
    const path = paths.find(p => p.id === id)
    if (!path || path.points.length === 0) return
    const key = settings.upAxis === 'z' ? 'z' : 'y'
    const current = path.points.reduce((sum, p) => sum + p[key], 0) / path.points.length
    const delta = elevation - current
    handleUpdatePath(id, { points: path.points.map(p => ({ ...p, [key]: p[key] + delta })) })
  }
  // PathGizmo.tsx's own live-drag/commit for an existing control point —
  // same local-preview-then-PATCH-on-release convention as
  // draggingSectionBox below, so a drag doesn't spam a PATCH per pointer-
  // move frame.
  const [draggingPath, setDraggingPath] = useState<{ id: string; points: PathPoint[] } | null>(null)
  const handlePathDragMove = (id: string, points: PathPoint[]) => setDraggingPath({ id, points })
  const handlePathDragEnd = (id: string, points: PathPoint[]) => {
    setDraggingPath(null)
    handleUpdatePath(id, { points })
  }
  // Memoized (2026-07-12 fix, per Maro: path-follow animation freezes
  // during Play, only catches up the instant it's paused) — same identity-
  // churn bug as timelineRange above, one level further downstream: this
  // plain .map() built a brand-new array on *every* render even when
  // draggingPath was null (the overwhelmingly common case), and that fresh
  // array is what Viewport3D forwards into TimelinePlayback's own paths
  // prop — a dependency of its path-resolution effect. Selecting a scene
  // object makes this whole component re-render on literally every
  // animation frame (onTick -> setTransformTick, so TransformPanel's
  // Location fields stay live), which was tearing that effect down and
  // rebuilding it 60x/sec while playing, instead of leaving it alone
  // between actual path edits.
  const resolvedPaths: Path[] = useMemo(
    () => paths.map(p => (draggingPath?.id === p.id ? { ...p, points: draggingPath.points } : p)),
    [paths, draggingPath],
  )

  // Zones — filled, labeled ground-plane areas (2026-07-29, per Maro's
  // site-logistics reference — a "PROJECT SITE" style boundary). See
  // zone.py's own docstring for why this is a separate resource from Path.
  // Mirrors the Path state block just above field-for-field.
  const [zones, setZones] = useState<Zone[]>([])
  const [zoneError, setZoneError] = useState<string | null>(null)
  const [addingPointsForZoneId, setAddingPointsForZoneId] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listZones(selectedProject.id).then(zs => { if (!cancelled) setZones(zs) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  // shape (2026-07-30, per Maro: "the radial zone for things like crane
  // clearance etc") — fixed at creation, see zone.py's own docstring for
  // why; ZonesPanel.tsx's own "+ Zone"/"+ Circle" buttons are the only
  // callers that ever pass 'circle'.
  const handleCreateZone = async (shape: Zone['shape'] = 'polygon') => {
    if (!selectedProject) return
    try {
      setZoneError(null)
      const zone = await createZone({ project_id: selectedProject.id, shape })
      setZones(prev => [...prev, zone])
    } catch (err) {
      setZoneError(pathErrorMessage(err, 'Failed to create zone'))
    }
  }
  const handleUpdateZone = async (id: string, data: Partial<Pick<Zone, 'name' | 'points' | 'radius' | 'elevation' | 'fill_color' | 'fill_opacity' | 'border_color' | 'border_width' | 'border_style' | 'border_dash_size' | 'border_gap_size' | 'visible' | 'animate' | 'animation_loop' | 'animation_mode' | 'label_font_size'>>) => {
    try {
      setZoneError(null)
      const updated = await updateZone(id, data)
      setZones(prev => prev.map(z => (z.id === id ? updated : z)))
    } catch (err) {
      setZoneError(pathErrorMessage(err, 'Failed to update zone'))
    }
  }
  const handleRenameZone = (id: string, name: string) => handleUpdateZone(id, { name })
  const handleToggleZoneVisible = (id: string) => {
    const zone = zones.find(z => z.id === id)
    if (zone) handleUpdateZone(id, { visible: !zone.visible })
  }
  const handleDeleteZone = async (id: string) => {
    try {
      setZoneError(null)
      await deleteZone(id)
      setZones(prev => prev.filter(z => z.id !== id))
      if (addingPointsForZoneId === id) setAddingPointsForZoneId(null)
      await deleteOrphanedAnimKeyframes('zone', id)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setZones(prev => prev.filter(z => z.id !== id))
        await deleteOrphanedAnimKeyframes('zone', id)
        return
      }
      setZoneError(pathErrorMessage(err, 'Failed to delete zone'))
    }
  }
  const handleToggleAddZonePoints = (id: string) => {
    setAddingPointsForZoneId(prev => (prev === id ? null : id))
  }
  const handleRemoveLastZonePoint = (id: string) => {
    const zone = zones.find(z => z.id === id)
    if (!zone || zone.points.length === 0) return
    handleUpdateZone(id, { points: zone.points.slice(0, -1) })
  }
  // Zeroes the up-axis coordinate of PathAddPointCatcher's raw hit point
  // before storing it (2026-07-29) — a Zone's own points are a flat
  // footprint (zone.py's own docstring), regardless of what real surface
  // was actually clicked to place this corner. A circle zone (2026-07-30)
  // only ever wants exactly one point (its center) — a click *replaces*
  // that single point instead of appending, and immediately exits add-
  // point mode, same "one click, done" convention Annotation placement
  // already uses, rather than leaving the user to notice on their own that
  // a second click would be pointless (the circle renderer only ever reads
  // points[0] — see zoneGeometry.ts's own buildZoneShapeGeometry).
  const handleAddZonePoint = (id: string, point: ZonePoint) => {
    const zone = zones.find(z => z.id === id)
    if (!zone) return
    const flattened: ZonePoint = settings.upAxis === 'z' ? { ...point, z: 0 } : { ...point, y: 0 }
    if (zone.shape === 'circle') {
      handleUpdateZone(id, { points: [flattened] })
      setAddingPointsForZoneId(null)
      return
    }
    handleUpdateZone(id, { points: [...zone.points, flattened] })
  }
  // Live-drag preview (2026-07-29) — same local-preview-then-PATCH-on-
  // release convention as draggingPath above.
  const [draggingZone, setDraggingZone] = useState<{ id: string; points: ZonePoint[] } | null>(null)
  const handleZoneDragMove = (id: string, points: ZonePoint[]) => setDraggingZone({ id, points })
  const handleZoneDragEnd = (id: string, points: ZonePoint[]) => {
    setDraggingZone(null)
    handleUpdateZone(id, { points })
  }
  // Same identity-churn fix as resolvedPaths above.
  const resolvedZones: Zone[] = useMemo(
    () => zones.map(z => (draggingZone?.id === z.id ? { ...z, points: draggingZone.points } : z)),
    [zones, draggingZone],
  )

  // Radial Progress Charts (2026-07-31, per Maro's own Synchro-style
  // reference screenshot — a progress ring per discipline, e.g. "CONCRETE
  // STRUCTURE"). Unlike Zone/Path/Annotation above, this is a screen-space
  // HUD widget, not a 3D-world object — see radial_chart.py's own
  // docstring. Mirrors the Zone state block just above field-for-field for
  // the CRUD parts; the UDF-matching/progress bits below are new
  // (radialChartProgress.ts).
  const [radialCharts, setRadialCharts] = useState<RadialChart[]>([])
  const [radialChartError, setRadialChartError] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listRadialCharts(selectedProject.id).then(cs => { if (!cancelled) setRadialCharts(cs) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  const handleCreateRadialChart = async () => {
    if (!selectedProject) return
    try {
      setRadialChartError(null)
      const chart = await createRadialChart({ project_id: selectedProject.id })
      setRadialCharts(prev => [...prev, chart])
    } catch (err) {
      setRadialChartError(pathErrorMessage(err, 'Failed to create radial chart'))
    }
  }
  const handleUpdateRadialChart = async (id: string, data: Partial<{
    title: string
    visible: boolean
    position_x_pct: number
    position_y_pct: number
    radius_px: number
    thickness_px: number
    border_color: string
    track_color: string
    progress_color: string
    fill_color: string
    text_color: string
    font_size: number
    center_mode: RadialChartCenterMode
    scope_mode: RadialChart['scope_mode']
    udf_field_definition_id: string | null
    udf_value: string | null
    wbs_node_activity_id: string | null
  }>) => {
    try {
      setRadialChartError(null)
      const updated = await updateRadialChart(id, data)
      setRadialCharts(prev => prev.map(c => (c.id === id ? updated : c)))
    } catch (err) {
      setRadialChartError(pathErrorMessage(err, 'Failed to update radial chart'))
    }
  }
  const handleRenameRadialChart = (id: string, title: string) => handleUpdateRadialChart(id, { title })
  const handleToggleRadialChartVisible = (id: string) => {
    const chart = radialCharts.find(c => c.id === id)
    if (chart) handleUpdateRadialChart(id, { visible: !chart.visible })
  }
  const handleDeleteRadialChart = async (id: string) => {
    try {
      setRadialChartError(null)
      await deleteRadialChart(id)
      setRadialCharts(prev => prev.filter(c => c.id !== id))
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setRadialCharts(prev => prev.filter(c => c.id !== id))
        return
      }
      setRadialChartError(pathErrorMessage(err, 'Failed to delete radial chart'))
    }
  }
  const handleUpdateRadialChartScope = (id: string, scope: ScopeFilter) => {
    handleUpdateRadialChart(id, scope)
  }
  const handleUploadRadialChartIcon = async (id: string, file: File) => {
    try {
      setRadialChartError(null)
      const updated = await uploadRadialChartIcon(id, file)
      setRadialCharts(prev => prev.map(c => (c.id === id ? updated : c)))
    } catch (err) {
      setRadialChartError(pathErrorMessage(err, 'Failed to upload icon'))
    }
  }
  const handleCommitRadialChartPosition = (id: string, positionXPct: number, positionYPct: number) => {
    handleUpdateRadialChart(id, { position_x_pct: positionXPct, position_y_pct: positionYPct })
  }

  // UDF-based activity filter for each radial chart — one bulk-fetch across
  // every "activity" UDF definition in the project (not one per chart),
  // same perf reasoning useUserDefinedFieldValues's own header already
  // documents for its per-cell grid callers.
  const activityUdfDefinitions = useUserDefinedFieldDefinitions(selectedProject?.id, 'activity')
  const radialChartActivityIds = useMemo(() => activities.map(a => a.id), [activities])
  const activityUdfValues = useUserDefinedFieldValues(activityUdfDefinitions.definitions, radialChartActivityIds)
  const radialChartMatchingIds = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const chart of radialCharts) {
      map.set(chart.id, resolveScopeActivityIds(activities, chart, activityUdfValues.getValue))
    }
    return map
  }, [radialCharts, activities, activityUdfValues.getValue])

  // Timeline Strip (2026-08-03, per Maro's own Synchro-style reference
  // screenshot) — a genuine singleton, unlike Radial Charts above: one GET/
  // PUT pair, no create/delete/list (see timeline_strip.py's own
  // docstring). null until the initial GET resolves; getTimelineStrip
  // always returns a full object with real defaults even when nothing's
  // been saved yet, so there's no separate "not configured" state to
  // handle beyond the brief pre-fetch null.
  const [timelineStrip, setTimelineStrip] = useState<TimelineStrip | null>(null)
  const [timelineStripError, setTimelineStripError] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    getTimelineStrip(selectedProject.id).then(s => { if (!cancelled) setTimelineStrip(s) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  // PUT upserts the whole row (no partial-update endpoint — see
  // timelineStrips.ts's own header), so every caller here merges its patch
  // onto the current in-memory strip before saving, rather than sending a
  // sparse body the way Radial Chart/Zone's own PATCH handlers do.
  const handleUpdateTimelineStrip = async (patch: Partial<Omit<TimelineStrip, 'id' | 'project_id' | 'created_at' | 'updated_at'>>) => {
    if (!timelineStrip || !selectedProject) return
    const { id: _id, created_at: _created_at, updated_at: _updated_at, ...current } = timelineStrip
    try {
      setTimelineStripError(null)
      const updated = await saveTimelineStrip({ ...current, project_id: selectedProject.id, ...patch })
      setTimelineStrip(updated)
    } catch (err) {
      setTimelineStripError(pathErrorMessage(err, 'Failed to update timeline strip'))
    }
  }
  const handleUpdateTimelineStripScope = (scope: ScopeFilter) => handleUpdateTimelineStrip(scope)
  const handleCommitTimelineStripPosition = (positionXPct: number, positionYPct: number) => {
    handleUpdateTimelineStrip({ position_x_pct: positionXPct, position_y_pct: positionYPct })
  }
  const timelineStripMatchingIds = useMemo(
    () => (timelineStrip ? resolveScopeActivityIds(activities, timelineStrip, activityUdfValues.getValue) : new Set<string>()),
    [timelineStrip, activities, activityUdfValues.getValue],
  )

  // Site Context (2026-08-19, per Maro) — Google Photorealistic 3D Tiles
  // embedded directly in the main viewport (SiteTilesLayer.tsx); a
  // separate CesiumJS panel was tried and dropped first, see that file's
  // own header. Same singleton GET/PUT shape as Timeline Strip above.
  const [siteContext, setSiteContext] = useState<SiteContext | null>(null)
  const [siteContextError, setSiteContextError] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    getSiteContext(selectedProject.id).then(s => { if (!cancelled) setSiteContext(s) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  const handleUpdateSiteContext = async (patch: Partial<Omit<SiteContext, 'id' | 'project_id' | 'created_at' | 'updated_at'>>) => {
    if (!siteContext || !selectedProject) return
    const { id: _id, created_at: _created_at, updated_at: _updated_at, ...current } = siteContext
    try {
      setSiteContextError(null)
      const updated = await saveSiteContext({ ...current, project_id: selectedProject.id, ...patch })
      setSiteContext(updated)
    } catch (err) {
      setSiteContextError(pathErrorMessage(err, 'Failed to update site context'))
    }
  }

  // App-level Google Maps Platform key (site_context.py's own AppSettings-
  // backed GET/PUT /tiles-key) — fetched once per session, editable
  // straight from SiteContextPanel.tsx (per Maro: editing backend/.env by
  // hand "is not good" UX).
  const [siteTilesApiKey, setSiteTilesApiKey] = useState<string | null>(null)
  useEffect(() => {
    if (!hasEverBeenActive) return
    let cancelled = false
    getTilesApiKey().then(k => { if (!cancelled) setSiteTilesApiKey(k) })
    return () => { cancelled = true }
  }, [hasEverBeenActive])
  const handleSaveSiteTilesApiKey = async (key: string) => {
    const saved = await saveTilesApiKey(key)
    setSiteTilesApiKey(saved)
  }

  const handleBindPathFollower = async (pathId: string, targetKind: 'mesh', elementRef: string) => {
    if (!selectedProject) return
    // Scope boundary (2026-07-12) — see the Element Parenting block's own
    // header on why Follow Path and rig-parenting don't combine on the
    // same object.
    if (elementParents.some(ep => ep.child_element_ref === elementRef)) {
      setPathError('This element is already rigged to a parent — clear its parent (Rigging panel) before binding a Path')
      return
    }
    try {
      setPathError(null)
      const follower = await upsertPathFollower({ project_id: selectedProject.id, path_id: pathId, target_kind: targetKind, element_ref: elementRef })
      setPathFollowers(prev => [...prev.filter(f => !(f.target_kind === targetKind && f.element_ref === elementRef)), follower])
    } catch (err) {
      setPathError(pathErrorMessage(err, 'Failed to bind path'))
    }
  }
  const handleUnbindPathFollower = async (followerId: string) => {
    try {
      setPathError(null)
      await deletePathFollower(followerId)
      setPathFollowers(prev => prev.filter(f => f.id !== followerId))
    } catch (err) {
      setPathError(pathErrorMessage(err, 'Failed to unbind path'))
    }
  }
  const handleTogglePathFollowerOrient = async (followerId: string) => {
    const follower = pathFollowers.find(f => f.id === followerId)
    if (!follower) return
    try {
      setPathError(null)
      const updated = await updatePathFollower(followerId, { orient_to_path: !follower.orient_to_path })
      setPathFollowers(prev => prev.map(f => (f.id === followerId ? updated : f)))
    } catch (err) {
      setPathError(pathErrorMessage(err, 'Failed to update path binding'))
    }
  }
  // Heading offset (2026-08-06, per Maro: "when i hit bind it changed the
  // rotation of the car" — see path_follower.py's own docstring for the
  // full "why": compensates for an imported model's own authored forward
  // axis not matching three.js's lookAt convention, applied as an extra
  // yaw on top of it in Viewport3D.tsx's applyPathFollow.
  const handleSetPathFollowerHeadingOffset = async (followerId: string, headingOffsetDeg: number) => {
    try {
      setPathError(null)
      const updated = await updatePathFollower(followerId, { heading_offset_deg: headingOffsetDeg })
      setPathFollowers(prev => prev.map(f => (f.id === followerId ? updated : f)))
    } catch (err) {
      setPathError(pathErrorMessage(err, 'Failed to update path binding'))
    }
  }

  // Annotations — Placemark/Comment (2026-07-12, per Maro's Navisworks
  // reference screenshot). Project-scoped, persisted server-side like
  // everything else this session (see annotation.py's own docstring).
  // "+ Placemark"/"+ Comment" (AnnotationsPanel.tsx) arm addingAnnotationKind,
  // which AnnotationAddCatcher (reusing PathGizmo.tsx's own
  // PathAddPointCatcher verbatim — see Viewport3D.tsx's render below) turns
  // into a single click-to-place; handlePlaceAnnotation creates it and
  // immediately clears the arming state, unlike Path's own continuous
  // multi-point mode.
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const [addingAnnotationKind, setAddingAnnotationKind] = useState<AnnotationKind | null>(null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listAnnotations(selectedProject.id).then(as => { if (!cancelled) setAnnotations(as) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  // Default icon per kind (2026-07-12) — Placemark keeps the pin, Comment
  // defaults to its own speech-bubble glyph — immediately visually
  // distinct the moment you place one, on top of the status/style
  // differences.
  const DEFAULT_ANNOTATION_ICON: Record<AnnotationKind, Annotation['icon']> = {
    placemark: 'pin', comment: 'comment',
  }
  const handlePlaceAnnotation = async (point: { x: number; y: number; z: number }) => {
    if (!selectedProject || !addingAnnotationKind) return
    const kind = addingAnnotationKind
    setAddingAnnotationKind(null)
    try {
      setAnnotationError(null)
      const created = await createAnnotation({
        project_id: selectedProject.id, kind, position_x: point.x, position_y: point.y, position_z: point.z,
        icon: DEFAULT_ANNOTATION_ICON[kind],
      })
      setAnnotations(prev => [...prev, created])
    } catch (err) {
      setAnnotationError(err instanceof Error ? err.message : 'Failed to place annotation')
    }
  }
  const handleUpdateAnnotation = async (id: string, patch: AnnotationUpdate) => {
    try {
      setAnnotationError(null)
      const updated = await updateAnnotation(id, patch)
      setAnnotations(prev => prev.map(a => (a.id === id ? updated : a)))
    } catch (err) {
      setAnnotationError(err instanceof Error ? err.message : 'Failed to update annotation')
    }
  }
  const handleDeleteAnnotation = async (id: string) => {
    try {
      setAnnotationError(null)
      await deleteAnnotation(id)
      setAnnotations(prev => prev.filter(a => a.id !== id))
      if (selectedAnnotationId === id) setSelectedAnnotationId(null)
      await deleteOrphanedAnimKeyframes('annotation', id)
    } catch (err) {
      setAnnotationError(err instanceof Error ? err.message : 'Failed to delete annotation')
    }
  }
  // Live drag preview for a marker being dragged in the viewport
  // (AnnotationMarker.tsx) — same local-preview-then-PATCH-on-release
  // convention as draggingPath above, so a drag doesn't spam a PATCH per
  // pointer-move frame.
  const [draggingAnnotation, setDraggingAnnotation] = useState<{ id: string; point: { x: number; y: number; z: number } } | null>(null)
  const handleAnnotationDragMove = (id: string, point: { x: number; y: number; z: number }) => setDraggingAnnotation({ id, point })
  const handleAnnotationDragEnd = (id: string, point: { x: number; y: number; z: number }) => {
    setDraggingAnnotation(null)
    handleUpdateAnnotation(id, { position_x: point.x, position_y: point.y, position_z: point.z })
  }
  // Leader-offset handle drag (2026-08-06) — same local-preview-then-PATCH-
  // on-release convention as draggingAnnotation just above, for
  // leader_offset_x/y/z instead of position_x/y/z. AnnotationMarker.tsx's
  // own useFrame already renders *its own* live preview imperatively via
  // calloutGroupRef while dragging (same as PathGizmo/ZoneGizmo's own
  // vertex-drag convention, bypassing the annotation prop entirely mid-
  // drag) — this state feeds resolvedAnnotations purely so any *other*
  // consumer (a live numeric readout, say) sees the same in-progress value,
  // mirroring draggingAnnotation's own precedent for consistency.
  const [draggingAnnotationLeader, setDraggingAnnotationLeader] = useState<{ id: string; offset: { x: number; y: number; z: number } } | null>(null)
  const handleAnnotationLeaderDragStart = () => {}
  const handleAnnotationLeaderDragMove = (id: string, offset: { x: number; y: number; z: number }) => setDraggingAnnotationLeader({ id, offset })
  const handleAnnotationLeaderDragEnd = (id: string, offset: { x: number; y: number; z: number }) => {
    setDraggingAnnotationLeader(null)
    handleUpdateAnnotation(id, { leader_offset_x: offset.x, leader_offset_y: offset.y, leader_offset_z: offset.z })
  }
  // Memoized (2026-07-12) — same resolvedPaths lesson from tonight's own
  // Follow Path debugging: a plain .map() here would hand Viewport3D a
  // fresh array identity on every render, and this array feeds straight
  // into each AnnotationMarker's own useMemo dependencies.
  const resolvedAnnotations: Annotation[] = useMemo(
    () => annotations.map(a => {
      let next = a
      if (draggingAnnotation?.id === a.id) {
        next = { ...next, position_x: draggingAnnotation.point.x, position_y: draggingAnnotation.point.y, position_z: draggingAnnotation.point.z }
      }
      if (draggingAnnotationLeader?.id === a.id) {
        next = { ...next, leader_offset_x: draggingAnnotationLeader.offset.x, leader_offset_y: draggingAnnotationLeader.offset.y, leader_offset_z: draggingAnnotationLeader.offset.z }
      }
      return next
    }),
    [annotations, draggingAnnotation, draggingAnnotationLeader],
  )
  const handleBindAnnotationLeader = (id: string) => {
    if (!pathBindTarget) return
    handleUpdateAnnotation(id, { source_kind: 'mesh', element_ref: pathBindTarget.ref })
  }
  const handleUnbindAnnotationLeader = (id: string) => handleUpdateAnnotation(id, { source_kind: null, element_ref: null })
  const handleLinkAnnotationToActivity = async (annotationId: string, activityId: string) => {
    try {
      setLinkError(null)
      const link = await createModelElementLink({
        activity_id: activityId, source_kind: 'annotation', element_ref: annotationId,
        element_label: annotations.find(a => a.id === annotationId)?.text || 'Annotation',
      })
      setModelElementLinks(prev => [...prev, link])
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to link annotation')
    }
  }

  // Camera Views (2026-07-10, per Maro: "add camera too so i can capture
  // the model at different angles like blender") — project-scoped,
  // persisted server-side like everything else this session (see
  // camera_view.py's own docstring). applyCameraViewRequest is the
  // "command" prop Viewport3D.tsx's own Props doc comment explains —
  // bumping nonce on every apply (even re-applying the *same* view twice
  // in a row) is what makes the child's useEffect fire each time, not
  // just on the first click.
  const [cameraViews, setCameraViews] = useState<CameraView[]>([])
  const [cameraViewError, setCameraViewError] = useState<string | null>(null)
  const [applyCameraViewRequest, setApplyCameraViewRequest] = useState<{ pose: CameraViewPose; nonce: number } | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listCameraViews(selectedProject.id).then(views => { if (!cancelled) setCameraViews(views) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  // viewport_state (2026-07-20, per Maro: "capture not just orbit angle but
  // contextual visibility as well") — the same 5 pieces of state
  // handleShowAll (below) already clears together, plus which IFC model
  // isolatedExpressIds is scoped to and whether clash colors were on.
  // Annotations aren't captured — they're project-wide persistent markers,
  // unaffected by which camera view is active (see CameraViewportState's
  // own docstring, backend/app/schemas/camera_view.py).
  const handleSaveCameraView = async (pose: CameraViewPose, thumbnailDataUrl: string | null) => {
    if (!selectedProject) return
    try {
      setCameraViewError(null)
      const view = await createCameraView({
        project_id: selectedProject.id, ...pose,
        viewport_state: {
          isolate_mode: isolateMode,
          isolated_object_ids: [...isolatedObjectIds],
          isolated_express_ids: [...isolatedExpressIds],
          isolated_ifc_model_id: activeIfcModelId,
          hidden_ids: [...hiddenIds],
          hidden_express_ids: [...hiddenExpressIds],
          show_clash_colors: settings.showClashColors,
        },
        ...(thumbnailDataUrl ? { thumbnail_data_url: thumbnailDataUrl } : {}),
      })
      setCameraViews(prev => [...prev, view])
    } catch (err) {
      setCameraViewError(err instanceof Error ? err.message : 'Failed to save camera view')
    }
  }
  const handleApplyCameraView = (view: CameraView) => {
    setApplyCameraViewRequest({ pose: view, nonce: Date.now() })
    const vs = view.viewport_state
    if (vs) {
      setIsolateMode(vs.isolate_mode)
      setIsolatedObjectIds(new Set(vs.isolated_object_ids))
      setIsolatedExpressIds(new Set(vs.isolated_express_ids))
      setActiveIfcModelId(vs.isolated_ifc_model_id)
      setHiddenIds(new Set(vs.hidden_ids))
      setHiddenExpressIds(new Set(vs.hidden_express_ids))
      setSettings({ ...settings, showClashColors: vs.show_clash_colors })
    }
  }
  // 4D Video persistence (2026-07-20) — Export Video's own local download
  // (Viewport3D.tsx) is unchanged; this additionally uploads the same
  // recorded Blob so the dashboard's "4D Video" widget has something to
  // list. A quiet console warning on failure, not a blocking error dialog —
  // the export itself (and its local download) already succeeded by this
  // point, same "the thing the user actually asked for already happened"
  // reasoning as not surfacing a hard error over a secondary side effect.
  const handleExportVideoUpload = async (blob: Blob, durationSec: number) => {
    if (!selectedProject) return
    try {
      await uploadFourDVideo(selectedProject.id, `4D Sequence ${new Date().toLocaleString()}`, durationSec, blob)
    } catch (err) {
      console.error('Failed to persist 4D video export', err)
    }
  }

  const handleRenameCameraView = async (id: string, name: string) => {
    try {
      setCameraViewError(null)
      const updated = await updateCameraView(id, { name })
      setCameraViews(prev => prev.map(v => (v.id === id ? updated : v)))
    } catch (err) {
      setCameraViewError(err instanceof Error ? err.message : 'Failed to rename camera view')
    }
  }
  const handleDeleteCameraView = async (id: string) => {
    try {
      setCameraViewError(null)
      await deleteCameraView(id)
      setCameraViews(prev => prev.filter(v => v.id !== id))
    } catch (err) {
      setCameraViewError(err instanceof Error ? err.message : 'Failed to delete camera view')
    }
  }

  // Cinematic Cameras (2026-08-03, per Maro: "add separate cameras and
  // play the animation and see the transitions") — same project-scoped,
  // server-persisted shape as Camera Views just above, but a Camera is a
  // standing, keyframeable actor the viewport can lock onto (activeCameraId),
  // not a one-shot "jump to" bookmark — see camera.py's own docstring on
  // how the two features differ.
  const [cameras, setCameras] = useState<CinematicCamera[]>([])
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listCameras(selectedProject.id).then(list => { if (!cancelled) setCameras(list) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  const handleAddCamera = async (pose: CameraPose) => {
    if (!selectedProject) return
    try {
      setCameraError(null)
      const camera = await createCamera({ project_id: selectedProject.id, ...pose })
      setCameras(prev => [...prev, camera])
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Failed to create camera')
    }
  }
  const handleLookThroughCamera = (camera: CinematicCamera) => setActiveCameraId(camera.id)
  const handleExitCameraView = () => setActiveCameraId(null)
  const handleRenameCamera = async (id: string, name: string) => {
    try {
      setCameraError(null)
      const updated = await updateCamera(id, { name })
      setCameras(prev => prev.map(c => (c.id === id ? updated : c)))
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Failed to rename camera')
    }
  }
  const handleDeleteCamera = async (id: string) => {
    try {
      setCameraError(null)
      await deleteCamera(id)
      setCameras(prev => prev.filter(c => c.id !== id))
      // Deleting the camera you're currently looking through would leave
      // the viewport locked with nothing to keep re-applying its pose —
      // same "can't reference something that no longer exists" guard as
      // FourD.tsx's own model-unload cleanups elsewhere.
      setActiveCameraId(prev => (prev === id ? null : prev))
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Failed to delete camera')
    }
  }
  // Lens field edits (Focal Length/Clip Start/Clip End, CamerasPanel.tsx's
  // own expanded detail) — plain base-value updates, independent of
  // keyframing (unlike Position/Target, these aren't driven by orbiting
  // the live camera, so there's no "capture the live value" step needed).
  const handleUpdateCameraBase = async (id: string, patch: Partial<CameraPose>) => {
    try {
      setCameraError(null)
      const updated = await updateCamera(id, patch)
      setCameras(prev => prev.map(c => (c.id === id ? updated : c)))
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Failed to update camera')
    }
  }
  // Keyframing (2026-08-03, per Maro: "keyframe the positions of this
  // camera") — Viewport3D.tsx's own handleKeyCameraPose reads the live
  // camera/controls (only it can) and hands the resolved pose up here;
  // this is where the actual ElementKeyframe persistence happens, same
  // "callback up, parent does the actual writes" split as every other
  // camera handler above. All 9 of a Camera's own fields are always keyed
  // together at the same date — see CamerasPanel.tsx's own
  // keyframeDatesFor header on why this isn't 9 separate per-field dots.
  const handleKeyCameraPose = async (cameraId: string, date: Date, pose: CameraPose) => {
    await Promise.all([
      elementKeyframes.upsert('camera', cameraId, 'pos_x', date, pose.base_position_x),
      elementKeyframes.upsert('camera', cameraId, 'pos_y', date, pose.base_position_y),
      elementKeyframes.upsert('camera', cameraId, 'pos_z', date, pose.base_position_z),
      elementKeyframes.upsert('camera', cameraId, 'target_x', date, pose.base_target_x),
      elementKeyframes.upsert('camera', cameraId, 'target_y', date, pose.base_target_y),
      elementKeyframes.upsert('camera', cameraId, 'target_z', date, pose.base_target_z),
      elementKeyframes.upsert('camera', cameraId, 'focal_length', date, pose.base_focal_length),
      elementKeyframes.upsert('camera', cameraId, 'clip_start', date, pose.base_clip_start),
      elementKeyframes.upsert('camera', cameraId, 'clip_end', date, pose.base_clip_end),
    ])
  }
  const handleDeleteCameraKeyframeDate = async (cameraId: string, dateIso: string) => {
    const matching = elementKeyframes.keyframes.filter(
      k => k.source_kind === 'camera' && k.element_ref === cameraId && k.date === dateIso
    )
    await Promise.all(matching.map(k => elementKeyframes.remove(k.id)))
  }
  // Keyframe-click-to-seek (2026-08-03, per Maro: "clicking it doesnt take
  // me to the time/frame, just able to delete it") — CamerasPanel.tsx is a
  // sibling of TimelineWindow.tsx (both live under FourD.tsx's own
  // SideDock/dockable-window registration), with no direct access to
  // TimelineWindow's own internal scrubber state, so this is the same
  // "lift shared state up, prop-drill back down" pattern already used for
  // speedDaysPerSecond/timeDisplayMode/fps above. token is a fresh value
  // per request (not just the date) so re-seeking to the exact same
  // already-current date — e.g. clicking the same keyframe twice — still
  // fires TimelineWindow's own consuming effect; see that effect's own
  // comment for why a raw Date dependency wouldn't reliably do this.
  const [timelineSeekRequest, setTimelineSeekRequest] = useState<{ date: Date; token: number } | null>(null)
  const handleSeekTimelineTo = (date: Date) => {
    timelineDateRef.current = date
    setTimelineSeekRequest({ date, token: Date.now() })
  }

  // Reusable animation recipes (2026-07-11, per Maro — see
  // animationProfiles.ts's own header for the Bonsai/Blender-add-on
  // reference) — a library, not a per-link fetch, so it's loaded once here
  // and handed to both ElementLinkFields.tsx (assignment) and
  // AnimationProfileMenu.tsx (management) rather than either fetching its
  // own copy.
  const animationProfiles = useAnimationProfiles(selectedProject?.id)
  const handleAssignProfile = async (linkId: string, profileId: string | null) => {
    try {
      setLinkError(null)
      const updated = await assignAnimationProfile(linkId, profileId)
      setModelElementLinks(prev => prev.map(l => (l.id === linkId ? updated : l)))
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to assign animation profile')
    }
  }
  // Manual per-field keyframes (2026-07-08, per Maro: "animate also
  // independently from the activity schedule... two modes. the normal and a
  // blender way with the keyframes as long as you have 3d/ifc object in the
  // scene") — a project-wide library like animationProfiles above, not
  // fetched per-object, since TransformPanel/TimelinePlayback both need the
  // full set (the former to show which fields are keyed, the latter to
  // resolve every keyframed object each frame regardless of selection).
  const elementKeyframes = useElementKeyframes(selectedProject?.id)
  const timelineDateRef = useRef<Date | null>(null)
  // Publishes every timelineDateRef change to the Gantt/Activity Table
  // windows (2026-08-29, per Maro: "when the animation plays or gets
  // scrubbed... the activity table and the gantt chart would also be
  // interactive") without making timelineDateRef itself state — same
  // per-frame-re-render concern its own header above already documents.
  // Listeners live in a ref (not state) too, and each subscriber
  // (GanttChart/ScheduleWindow) owns its own local reaction to a tick, so
  // this component's own body never re-runs because of playback/scrubbing.
  const timelineFocusListenersRef = useRef<Set<(d: Date) => void>>(new Set())
  const subscribeTimelineFocus = useCallback((cb: (d: Date) => void) => {
    timelineFocusListenersRef.current.add(cb)
    return () => { timelineFocusListenersRef.current.delete(cb) }
  }, [])
  const publishTimelineFocus = useCallback((d: Date) => {
    timelineDateRef.current = d
    timelineFocusListenersRef.current.forEach(fn => fn(d))
  }, [])
  // Orbit camera sync between the main viewport and the Baseline pane
  // (2026-07-24, per Maro: "i'd like to sync the orbit movement. so i get
  // the same camera angles") — see Viewport3D.tsx's own CameraSync header
  // for the full mechanism. A plain ref, not state, same reasoning as
  // timelineDateRef just above (this changes on literally every orbit-drag
  // frame; forcing a React re-render for that would be its own
  // performance problem).
  const cameraSyncRef = useRef<CameraSyncState | null>(null)
  // Multi-viewport Compare Baseline (2026-08-03, generalizing the original
  // single "Include Baseline" pane per Maro: "compare baseline goes beyond
  // just the one baseline view") — up to MAX_COMPARISON_PANES extra
  // ComparisonViewportPane.tsx docks can be open at once, each with its
  // own real WebGL canvas; a fixed-size array of plain refs (not state —
  // same reasoning cameraSyncRef above already documents: stable DOM node
  // references, not something that should trigger a re-render when set),
  // one per pane *slot* (not per active pane — React's rules of hooks mean
  // this can't be created dynamically), written by each active pane's own
  // CaptureCanvas the moment its Canvas mounts, read by Viewport3D.tsx's
  // own handleCaptureImage/handleExportVideo to composite every active
  // pane alongside the main one.
  // baselineDprMultiplier IS state (unlike the refs above) because it
  // needs to actually change every active pane's own Canvas `dpr` prop
  // when a capture starts/ends — mirrors Viewport3D.tsx's own internal
  // captureDprMultiplier out via its onCaptureQualityChange callback prop,
  // so every pane renders at the same boosted resolution during a
  // capture, same "boost every pane together" convention as before.
  const MAX_COMPARISON_PANES = 3
  const comparisonCanvasRefs = [
    useRef<HTMLCanvasElement | null>(null),
    useRef<HTMLCanvasElement | null>(null),
    useRef<HTMLCanvasElement | null>(null),
  ]
  const [baselineDprMultiplier, setBaselineDprMultiplier] = useState<number | null>(null)
  // Mirrors Viewport3D.tsx's own captureBackgroundOverride the same way
  // baselineDprMultiplier just above mirrors captureDprMultiplier
  // (2026-07-25, per Maro: "baseline 3d doesnt share the same render
  // shader settings etc") — so a capture/export's HDR-background override
  // (Render/Capture Settings' own "Show HDR Background") applies to both
  // panes identically instead of only the main one.
  const [baselineBackgroundOverride, setBaselineBackgroundOverride] = useState<boolean | null>(null)
  // The 4D timeline's "current date" (2026-07-11) — a ref, not state; see
  // Viewport3D.tsx's own Props comment for why. timelineRange is real
  // state-derived (not a ref) since it only needs to update when the
  // activity/keyframe lists themselves change, not every animation frame.
  // Unioned with keyframe dates (2026-07-08) so the Timeline window still
  // has something to scrub in a project with zero dated activities — a
  // schedule and free-form keyframes are two independent sources for the
  // same one scrubber, not a schedule prerequisite for the other (that
  // prerequisite was exactly Maro's complaint: "adding a simple cube and i
  // cant do animation because its asking for a dated activity").
  // Memoized (2026-07-11 fix, per Maro: "press play... doesn't work") —
  // these were plain per-render calls, producing a brand-new Date-bearing
  // object on *every* FourD.tsx render regardless of whether activities or
  // keyframes actually changed. TimelineWindow's own play/pause
  // requestAnimationFrame loop depends on scheduleStart/scheduleEnd by
  // identity (see its own header — shared via prop, not state) to keep
  // accumulating real elapsed time across frames; a fresh identity on every
  // unrelated re-render tore that effect down and rebuilt it constantly,
  // resetting its internal lastTimeRef to null before a meaningful delta
  // could ever accumulate — Play looked like it did nothing, while a manual
  // scrub (self-contained local state inside TimelineWindow, untouched by
  // this) worked fine.
  const timelineRange = useMemo(
    () => padDegenerateRange(unionRanges(computeScheduleRange(activities), computeKeyframeRange(elementKeyframes.keyframes))),
    [activities, elementKeyframes.keyframes],
  )
  // Seeds the shared "current date" the moment there's anything to seed it
  // from — schedule or keyframes — falling back to today if there's neither
  // yet (2026-07-08, per Maro: keying a brand-new project's first-ever
  // object shouldn't be blocked on a schedule existing at all). Runs once
  // per null->non-null transition (the `=== null` guard), so it never
  // clobbers wherever the user has since scrubbed to. TimelineWindow.tsx has
  // its own near-identical seed for when it mounts after this already ran —
  // both guarded the same way, so whichever runs first wins and the other
  // is a no-op.
  useEffect(() => {
    if (timelineDateRef.current === null) timelineDateRef.current = timelineRange?.start ?? new Date()
  }, [timelineRange])

  // Lifted out of TimelineWindow.tsx (2026-07-30, per Maro: "I want frames
  // or seconds not dates" for Path/Zone's own Start/End keyframe fields) —
  // PathsPanel.tsx/ZonesPanel.tsx need the exact same Date/Seconds/Frames
  // formatting TimelineWindow.tsx's own scrubber already uses
  // (formatTimelineValue/dateFromTimelineValue, timelinePlayback.ts), and
  // "the same numbers on two different panels" only actually means
  // anything if both read the one shared speed/mode/fps instead of each
  // owning an independent copy. TimelineWindow.tsx now receives these as
  // controlled props instead of local useState — same lifted-state
  // pattern already used for timelineDateRef/timelineRange just above.
  // localStorage keys/defaults unchanged from TimelineWindow.tsx's own
  // former local state, so an existing user's saved preference carries
  // over exactly.
  const [speedDaysPerSecond, setSpeedDaysPerSecond] = useState(7)
  const [timeDisplayMode, setTimeDisplayMode] = useState<TimeDisplayMode>(() => {
    try {
      const raw = localStorage.getItem('prosota_4d_timeline_display_mode')
      return raw === 'seconds' || raw === 'frames' ? raw : 'date'
    } catch {
      return 'date'
    }
  })
  const [fps, setFps] = useState(() => {
    try {
      const raw = Number(localStorage.getItem('prosota_4d_timeline_fps'))
      return FPS_OPTIONS.includes(raw) ? raw : 30
    } catch {
      return 30
    }
  })
  const handleTimeDisplayModeChange = (mode: TimeDisplayMode) => {
    setTimeDisplayMode(mode)
    try { localStorage.setItem('prosota_4d_timeline_display_mode', mode) } catch { /* ignore */ }
  }
  const handleFpsChange = (value: number) => {
    setFps(value)
    try { localStorage.setItem('prosota_4d_timeline_fps', String(value)) } catch { /* ignore */ }
  }

  // Resolves each Path/Zone's own reveal window straight out of the
  // ElementKeyframe rows keyed anim_start/anim_end for it (2026-07-30 —
  // see paths.ts's/PathGizmo.tsx's own headers for why these moved off the
  // old plain animation_start/animation_end columns). Passed to
  // PathGizmos/ZoneGizmos in Viewport3D.tsx below instead of each gizmo
  // reading path.animation_start itself, since that field no longer exists
  // on the Path/Zone type at all.
  const pathAnimWindows = useMemo(() => {
    const map = new Map<string, { start: Date | null; end: Date | null }>()
    for (const k of elementKeyframes.keyframes) {
      if (k.source_kind !== 'path' || (k.field !== 'anim_start' && k.field !== 'anim_end')) continue
      const entry = map.get(k.element_ref) ?? { start: null, end: null }
      if (k.field === 'anim_start') entry.start = new Date(k.date); else entry.end = new Date(k.date)
      map.set(k.element_ref, entry)
    }
    return map
  }, [elementKeyframes.keyframes])
  const zoneAnimWindows = useMemo(() => {
    const map = new Map<string, { start: Date | null; end: Date | null }>()
    for (const k of elementKeyframes.keyframes) {
      if (k.source_kind !== 'zone' || (k.field !== 'anim_start' && k.field !== 'anim_end')) continue
      const entry = map.get(k.element_ref) ?? { start: null, end: null }
      if (k.field === 'anim_start') entry.start = new Date(k.date); else entry.end = new Date(k.date)
      map.set(k.element_ref, entry)
    }
    return map
  }, [elementKeyframes.keyframes])
  // Annotation's own leader-reveal window (2026-08-06, per Maro: "how the
  // leader works and how its animated which should also have the ability
  // to be animated independent of tasks") — same anim_start/anim_end
  // convention as Path/Zone just above, keyed by the Annotation row's own
  // id.
  const annotationAnimWindows = useMemo(() => {
    const map = new Map<string, { start: Date | null; end: Date | null }>()
    for (const k of elementKeyframes.keyframes) {
      if (k.source_kind !== 'annotation' || (k.field !== 'anim_start' && k.field !== 'anim_end')) continue
      const entry = map.get(k.element_ref) ?? { start: null, end: null }
      if (k.field === 'anim_start') entry.start = new Date(k.date); else entry.end = new Date(k.date)
      map.set(k.element_ref, entry)
    }
    return map
  }, [elementKeyframes.keyframes])
  // "Key" buttons in PathsPanel.tsx/ZonesPanel.tsx/AnnotationsPanel.tsx
  // (2026-07-30, per Maro: "add a key frame buttons to the side. so i can
  // key frame the start and end") — anim_start/anim_end are singleton
  // markers (paths.ts's own header: "the keyframe's own date IS the
  // value"), so re-keying a field replaces whichever row already holds it
  // rather than upserting alongside it — upsert's own conflict key
  // includes `date`, so keying at a *different* playhead position than
  // last time would otherwise leave two anim_start rows instead of moving
  // the one that matters.
  const handleKeyAnim = async (sourceKind: 'path' | 'zone' | 'annotation' | 'mesh', elementRef: string, field: 'anim_start' | 'anim_end') => {
    const now = timelineDateRef.current ?? new Date()
    const existing = elementKeyframes.keyframes.filter(k => k.source_kind === sourceKind && k.element_ref === elementRef && k.field === field)
    for (const k of existing) await elementKeyframes.remove(k.id)
    await elementKeyframes.upsert(sourceKind, elementRef, field, now, 0)
  }
  // Deleting a Path/Zone/Annotation doesn't cascade to its own anim_start/
  // anim_end rows on its own (2026-07-30 fix, per Maro: "there's nothing
  // in the scene... why do i see the animation data" — a deleted Path/
  // Zone's own reveal keyframes were still showing in the Animation
  // Timeline under a raw UUID). ElementKeyframe has no FK to any of these
  // at all (by design — see elementKeyframes.ts's own header), so
  // handleDeletePath/handleDeleteZone/handleDeleteAnnotation all call this
  // explicitly right after the delete succeeds.
  const deleteOrphanedAnimKeyframes = async (sourceKind: 'path' | 'zone' | 'annotation', elementRef: string) => {
    const orphaned = elementKeyframes.keyframes.filter(k => k.source_kind === sourceKind && k.element_ref === elementRef && (k.field === 'anim_start' || k.field === 'anim_end'))
    for (const k of orphaned) await elementKeyframes.remove(k.id)
  }

  const [openWindows, setOpenWindows] = useState<Set<WindowKey>>(new Set())
  const toggleWindow = (key: WindowKey) => {
    setOpenWindows(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // Which side of the viewport each window docks to (2026-07-11, per Maro:
  // "place them not just above the 3D viewport but below it if I want").
  // Keyed by every WindowKey up front (not just open ones) so a window
  // remembers its side across close/reopen within the same session.
  const [windowDock, setWindowDock] = useState<Record<WindowKey, DockSide>>({
    schedule: 'top', gantt: 'top', tracking: 'top', usage: 'top', timeline: 'top',
  })
  const toggleWindowDock = (key: WindowKey) => {
    setWindowDock(prev => ({ ...prev, [key]: prev[key] === 'top' ? 'bottom' : 'top' }))
  }
  const [ganttWindowZoom, setGanttWindowZoomState] = useState<GanttZoom>(loadGanttZoom)
  const setGanttWindowZoom = (z: GanttZoom) => { setGanttWindowZoomState(z); saveGanttZoom(z) }

  const [propertiesOpen, setPropertiesOpen] = useState(() => loadPanelOpen(PROPERTIES_OPEN_KEY))
  const toggleProperties = () => {
    setPropertiesOpen(prev => {
      const next = !prev
      localStorage.setItem(PROPERTIES_OPEN_KEY, String(next))
      return next
    })
  }
  const [dataPanelOpen, setDataPanelOpen] = useState(() => loadPanelOpen(DATA_PANEL_OPEN_KEY))
  const toggleDataPanel = () => {
    setDataPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(DATA_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  // Dockable Animation Profiles panel (2026-07-11, per Maro: "make the
  // profile widget dockable but for the left or right panels") — closed by
  // default (defaultOpen=false), unlike Properties/Data above, since it's a
  // newly-added extra panel rather than something every 4D session needs
  // open. Persisted the same way regardless, including which side it's on.
  const [profilePanelOpen, setProfilePanelOpen] = useState(() => loadPanelOpen(PROFILE_PANEL_OPEN_KEY, false))
  const toggleProfilePanel = () => {
    setProfilePanelOpen(prev => {
      const next = !prev
      localStorage.setItem(PROFILE_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [profilePanelDock, setProfilePanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(PROFILE_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleProfilePanelDock = () => {
    setProfilePanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(PROFILE_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Section Box panel (2026-07-09, per Maro: "make section
  // contextual like profiles, i can fit in the profile panel or dock on
  // each side. effectively sharing a side dock if i want") — same
  // open/dock persistence shape as Animation Profiles above; SideDock.tsx
  // is what actually lets the two share one physical slot when they land
  // on the same side.
  const [sectionPanelOpen, setSectionPanelOpen] = useState(() => loadPanelOpen(SECTION_PANEL_OPEN_KEY, false))
  const toggleSectionPanel = () => {
    setSectionPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(SECTION_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [sectionPanelDock, setSectionPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(SECTION_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleSectionPanelDock = () => {
    setSectionPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(SECTION_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Camera Views panel (2026-07-10, per Maro: "add camera too so
  // i can capture the model at different angles like blender") — same
  // shared-side-dock treatment as Section Box/Animation Profiles above.
  const [cameraPanelOpen, setCameraPanelOpen] = useState(() => loadPanelOpen(CAMERA_PANEL_OPEN_KEY, false))
  const toggleCameraPanel = () => {
    setCameraPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(CAMERA_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [cameraPanelDock, setCameraPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(CAMERA_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleCameraPanelDock = () => {
    setCameraPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(CAMERA_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Cameras panel (2026-08-03, per Maro: "add separate cameras
  // and play the animation and see the transitions") — same shared-
  // side-dock treatment as Camera Views/Section Box/Animation Profiles
  // above; a distinct id/label from Camera Views' own 'cameras' since
  // they're two different features (see camera.py's own docstring).
  const [camerasPanelOpen, setCamerasPanelOpen] = useState(() => loadPanelOpen(CAMERAS_PANEL_OPEN_KEY, false))
  const toggleCamerasPanel = () => {
    setCamerasPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(CAMERAS_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [camerasPanelDock, setCamerasPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(CAMERAS_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleCamerasPanelDock = () => {
    setCamerasPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(CAMERAS_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Collections panel (2026-07-11, per Maro's Blender reference) —
  // same shared-side-dock treatment as Section Box/Camera Views/Animation
  // Profiles above.
  const [collectionsPanelOpen, setCollectionsPanelOpen] = useState(() => loadPanelOpen(COLLECTIONS_PANEL_OPEN_KEY, false))
  const toggleCollectionsPanel = () => {
    setCollectionsPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(COLLECTIONS_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [collectionsPanelDock, setCollectionsPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(COLLECTIONS_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleCollectionsPanelDock = () => {
    setCollectionsPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(COLLECTIONS_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Split by Level panel (2026-07-15, per Maro) — same shared-
  // side-dock treatment as Collections/Section Box/Camera Views above.
  const [splitPanelOpen, setSplitPanelOpen] = useState(() => loadPanelOpen(SPLIT_PANEL_OPEN_KEY, false))
  const toggleSplitPanel = () => {
    setSplitPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(SPLIT_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [splitPanelDock, setSplitPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(SPLIT_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleSplitPanelDock = () => {
    setSplitPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(SPLIT_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Paths panel (2026-07-11, per Maro's Blender curve reference:
  // "in blender you can add a curve... i can then place an object to follow
  // that path") — same shared-side-dock treatment as Collections/Section
  // Box/Camera Views/Animation Profiles above.
  const [pathsPanelOpen, setPathsPanelOpen] = useState(() => loadPanelOpen(PATHS_PANEL_OPEN_KEY, false))
  const togglePathsPanel = () => {
    setPathsPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(PATHS_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [pathsPanelDock, setPathsPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(PATHS_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const togglePathsPanelDock = () => {
    setPathsPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(PATHS_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Zones panel (2026-07-29, per Maro's site-logistics reference —
  // a filled, labeled ground-plane area like "PROJECT SITE") — same shared-
  // side-dock treatment as Paths just above.
  const [zonesPanelOpen, setZonesPanelOpen] = useState(() => loadPanelOpen(ZONES_PANEL_OPEN_KEY, false))
  const toggleZonesPanel = () => {
    setZonesPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(ZONES_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [zonesPanelDock, setZonesPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(ZONES_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleZonesPanelDock = () => {
    setZonesPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(ZONES_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Radial Charts panel (2026-07-31, per Maro's own Synchro-style
  // reference screenshot) — same shared-side-dock treatment as Zones just
  // above.
  const [radialChartsPanelOpen, setRadialChartsPanelOpen] = useState(() => loadPanelOpen(RADIAL_CHARTS_PANEL_OPEN_KEY, false))
  const toggleRadialChartsPanel = () => {
    setRadialChartsPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(RADIAL_CHARTS_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [radialChartsPanelDock, setRadialChartsPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(RADIAL_CHARTS_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleRadialChartsPanelDock = () => {
    setRadialChartsPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(RADIAL_CHARTS_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Timeline Strip panel (2026-08-03, per Maro's own Synchro-style
  // reference screenshot) — same shared-side-dock treatment as Radial
  // Charts just above.
  const [timelineStripPanelOpen, setTimelineStripPanelOpen] = useState(() => loadPanelOpen(TIMELINE_STRIP_PANEL_OPEN_KEY, false))
  const toggleTimelineStripPanel = () => {
    setTimelineStripPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(TIMELINE_STRIP_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [timelineStripPanelDock, setTimelineStripPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(TIMELINE_STRIP_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleTimelineStripPanelDock = () => {
    setTimelineStripPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(TIMELINE_STRIP_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Site Context panel — same shared-side-dock treatment as
  // Timeline Strip above.
  const [siteContextPanelOpen, setSiteContextPanelOpen] = useState(() => loadPanelOpen(SITE_CONTEXT_PANEL_OPEN_KEY, false))
  const toggleSiteContextPanel = () => {
    setSiteContextPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(SITE_CONTEXT_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [siteContextPanelDock, setSiteContextPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(SITE_CONTEXT_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleSiteContextPanelDock = () => {
    setSiteContextPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(SITE_CONTEXT_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Annotations panel — Placemark/Comment (2026-07-12, per Maro's
  // Navisworks reference screenshot) — same shared-side-dock treatment as
  // Paths/Collections/Section Box/Camera Views/Animation Profiles above.
  const [annotationsPanelOpen, setAnnotationsPanelOpen] = useState(() => loadPanelOpen(ANNOTATIONS_PANEL_OPEN_KEY, false))
  const toggleAnnotationsPanel = () => {
    setAnnotationsPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(ANNOTATIONS_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [annotationsPanelDock, setAnnotationsPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(ANNOTATIONS_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleAnnotationsPanelDock = () => {
    setAnnotationsPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(ANNOTATIONS_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Clash Detective panel (2026-07-12) — same shared-side-dock
  // treatment as every panel above.
  const [clashPanelOpen, setClashPanelOpen] = useState(() => loadPanelOpen(CLASH_PANEL_OPEN_KEY, false))
  const toggleClashPanel = () => {
    setClashPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(CLASH_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [clashPanelDock, setClashPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(CLASH_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleClashPanelDock = () => {
    setClashPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(CLASH_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Progress Variance panel (2026-08-20) — same shared-side-dock
  // treatment as every panel above.
  const [progressVariancePanelOpen, setProgressVariancePanelOpen] = useState(() => loadPanelOpen(PROGRESS_VARIANCE_PANEL_OPEN_KEY, false))
  const toggleProgressVariancePanel = () => {
    setProgressVariancePanelOpen(prev => {
      const next = !prev
      localStorage.setItem(PROGRESS_VARIANCE_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [progressVariancePanelDock, setProgressVariancePanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(PROGRESS_VARIANCE_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleProgressVariancePanelDock = () => {
    setProgressVariancePanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(PROGRESS_VARIANCE_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Rigging panel (2026-07-12) — same shared-side-dock treatment
  // as every panel above.
  const [rigPanelOpen, setRigPanelOpen] = useState(() => loadPanelOpen(RIG_PANEL_OPEN_KEY, false))
  const toggleRigPanel = () => {
    setRigPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(RIG_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [rigPanelDock, setRigPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(RIG_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleRigPanelDock = () => {
    setRigPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(RIG_PANEL_DOCK_KEY, next)
      return next
    })
  }
  // Dockable Measurements panel (2026-07-19) — same shared-side-dock
  // treatment as every panel above.
  const [measurementsPanelOpen, setMeasurementsPanelOpen] = useState(() => loadPanelOpen(MEASUREMENTS_PANEL_OPEN_KEY, false))
  const toggleMeasurementsPanel = () => {
    setMeasurementsPanelOpen(prev => {
      const next = !prev
      localStorage.setItem(MEASUREMENTS_PANEL_OPEN_KEY, String(next))
      return next
    })
  }
  const [measurementsPanelDock, setMeasurementsPanelDock] = useState<PanelSide>(() => {
    try {
      return localStorage.getItem(MEASUREMENTS_PANEL_DOCK_KEY) === 'left' ? 'left' : 'right'
    } catch {
      return 'right'
    }
  })
  const toggleMeasurementsPanelDock = () => {
    setMeasurementsPanelDock(prev => {
      const next = prev === 'left' ? 'right' : 'left'
      localStorage.setItem(MEASUREMENTS_PANEL_DOCK_KEY, next)
      return next
    })
  }

  // Measure tool (2026-07-19, per Maro: "add a measurement feature, length
  // and areas" then "maybe i can also click element surfaces and it gives
  // me the area") — project-scoped, persisted server-side like every other
  // 4D-viewport tool this session (see measurement.py's own docstring).
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [measurementError, setMeasurementError] = useState<string | null>(null)
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null)
  const [measuringTool, setMeasuringTool] = useState<MeasuringTool | null>(null)
  // Local-only until Finish/auto-finalize actually creates the row — a
  // Measurement is a fixed record once saved (see measurement.py's
  // MeasurementUpdate docstring), so points are gathered client-side first
  // rather than persisted-and-patched per click the way Path's own points
  // are.
  const [measuringPoints, setMeasuringPoints] = useState<MeasurementPoint[]>([])
  // Resolved once per in-progress measurement, from the FIRST click's own
  // hit target only (2026-07-19 v1 simplification, same spirit as
  // sceneClash.ts's own documented "assumes scene units are already
  // metres" — here at least corrected for whichever one model the
  // measurement is actually being taken against, via
  // getLengthUnitToMetres, rather than skipping the correction entirely).
  // Defaults to 1 (assume already metres) for a ground-plane click or a
  // plain non-IFC mesh, matching ifcUnitDisplay.ts's own toMetres===null
  // passthrough convention.
  const [measuringToMetres, setMeasuringToMetres] = useState(1)
  // Live snap-cursor preview (2026-07-19, per Maro: "learn from blender") —
  // read-only, updated on every pointermove by MeasurementCatcher; see that
  // component's own header for why it only resolves for an
  // already-individual (non-batched) mesh.
  const [measurementHoverPoint, setMeasurementHoverPoint] = useState<MeasurementPoint | null>(null)

  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listMeasurements(selectedProject.id).then(ms => { if (!cancelled) setMeasurements(ms) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  const measurementErrorMessage = (err: unknown, fallback: string): string => {
    if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') return err.response.data.detail
    return err instanceof Error ? err.message : fallback
  }

  const handleStartMeasuring = (tool: MeasuringTool) => {
    setMeasuringTool(prev => (prev === tool ? null : tool))
    setMeasuringPoints([])
  }

  // Walks up from a raw click's hit object to whichever ancestor carries
  // sceneObjectId (set at import time, same tag getIfcHandleFor's every
  // other caller already relies on) to find which loaded IFC model, if any,
  // actually owns it, then reads that model's own real LENGTHUNIT — a plain
  // mesh import or a ground-plane click (object===null) has nothing to
  // read and stays at the "assume metres" default of 1.
  const resolveToMetresForHit = async (object: Object3D | null): Promise<number> => {
    if (!object) return 1
    let node: Object3D | null = object
    while (node && node.userData.sceneObjectId === undefined) node = node.parent
    const sceneObjectId = node?.userData.sceneObjectId as string | undefined
    const handle = sceneObjectId ? getIfcHandleFor(sceneObjectId) : null
    if (!handle) return 1
    const { getSpatialTree, getLengthUnitToMetres } = await import('./ifcModel')
    const tree = await getSpatialTree(handle)
    return getLengthUnitToMetres(handle, tree.expressID)
  }

  const handleCreateMeasurement = async (
    kind: 'length' | 'area', points: MeasurementPoint[], value: number, name: string, holeLoops?: MeasurementPoint[][],
  ) => {
    if (!selectedProject) return
    try {
      setMeasurementError(null)
      const created = await createMeasurement({ project_id: selectedProject.id, kind, points, value, name, hole_loops: holeLoops })
      setMeasurements(prev => [...prev, created])
    } catch (err) {
      setMeasurementError(measurementErrorMessage(err, 'Failed to save measurement'))
    }
  }

  const handleMeasurementHit = async (hit: MeasurementHit) => {
    if (!measuringTool) return

    if (measuringTool === 'area_face') {
      setMeasuringTool(null)
      if (!hit.object || hit.faceIndex === null || !(hit.object instanceof Mesh)) {
        setMeasurementError('Click directly on a real element surface to measure its face area')
        return
      }
      const toMetres = await resolveToMetresForHit(hit.object)
      const patch = measureFacePatch(hit.object, hit.faceIndex, toMetres)
      if (!patch) {
        setMeasurementError('Could not measure that surface (unsupported geometry)')
        return
      }
      await handleCreateMeasurement('area', patch.outlinePointsScene, patch.areaMetres, 'Face area', patch.holeLoopsScene)
      return
    }

    // Only 'length' reaches here now (area_points removed 2026-07-19, per
    // Maro — Area (face)'s automatic flood-fill made manually clicking a
    // polygon's own corners redundant).
    const toMetres = measuringPoints.length === 0 ? await resolveToMetresForHit(hit.object) : measuringToMetres
    if (measuringPoints.length === 0) setMeasuringToMetres(toMetres)
    const nextPoints = [...measuringPoints, hit.point]
    if (nextPoints.length < 2) {
      setMeasuringPoints(nextPoints)
      return
    }
    setMeasuringTool(null)
    setMeasuringPoints([])
    await handleCreateMeasurement('length', nextPoints, distanceMetres(nextPoints[0], nextPoints[1], toMetres), 'Length')
  }

  const handleRenameMeasurement = async (id: string, name: string) => {
    try {
      setMeasurementError(null)
      const updated = await updateMeasurement(id, { name })
      setMeasurements(prev => prev.map(m => (m.id === id ? updated : m)))
    } catch (err) {
      setMeasurementError(measurementErrorMessage(err, 'Failed to rename measurement'))
    }
  }
  const handleToggleMeasurementVisible = async (id: string) => {
    const m = measurements.find(m => m.id === id)
    if (!m) return
    try {
      setMeasurementError(null)
      const updated = await updateMeasurement(id, { visible: !m.visible })
      setMeasurements(prev => prev.map(x => (x.id === id ? updated : x)))
    } catch (err) {
      setMeasurementError(measurementErrorMessage(err, 'Failed to update measurement'))
    }
  }
  const handleDeleteMeasurement = async (id: string) => {
    try {
      setMeasurementError(null)
      await deleteMeasurement(id)
      setMeasurements(prev => prev.filter(m => m.id !== id))
      if (selectedMeasurementId === id) setSelectedMeasurementId(null)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setMeasurements(prev => prev.filter(m => m.id !== id))
        return
      }
      setMeasurementError(measurementErrorMessage(err, 'Failed to delete measurement'))
    }
  }
  // Heights of the top/bottom window docks, in px — drag-resizable via
  // DockDivider.tsx between each dock and the viewport (2026-07-11, per
  // Maro: "the dividers separating the windows and the main the 3d
  // viewport"). A fixed height rather than the earlier maxHeight: '45vh'
  // matters beyond just being resizable — max-height on a flex-column child
  // doesn't give its own flex-1 descendants (SplitRow → WindowChrome's
  // overflow-auto body) a reliably definite height to size against, so
  // oversized window content (ResourceUsageProfileWidget in particular,
  // which — unlike ResourceTrackingWidget — has no maxHeight/overflowY of
  // its own) was being clipped by this wrapper's overflow-hidden instead of
  // scrolling inside its own window. A real height fixes both.
  const [topDockHeight, setTopDockHeight] = useState(320)
  const [bottomDockHeight, setBottomDockHeight] = useState(320)
  // Split ratios for each dock's SplitRow — lifted here (rather than local
  // to SplitRow) so a saved DockLayout can capture/restore them (2026-07-11,
  // per Maro: "create different dockable layouts sizes etc."). Empty until
  // SplitRow's own count-mismatch effect first populates them.
  const [topSplitRatios, setTopSplitRatios] = useState<number[]>([])
  const [bottomSplitRatios, setBottomSplitRatios] = useState<number[]>([])
  // Compare Baseline, generalized (2026-08-03, per Maro: "compare baseline
  // goes beyond just the one baseline view") — up to MAX_COMPARISON_PANES
  // read-only ComparisonViewportPane.tsx docks alongside the real
  // Viewport3D via the same SplitRow used for the top/bottom window docks
  // above (nesting a second, column-oriented SplitRow for the stacked
  // slot once more than one extra pane is open — see the render JSX
  // below). Deliberately plain localStorage, not folded into the backend
  // DockLayoutConfig system those two window-dock ratios belong to — this
  // is a per-browser view preference, not part of a named, shareable dock
  // arrangement, and doesn't warrant its own backend schema change for a
  // first pass (confirmed with Maro).
  const COMPARISON_PANES_KEY = 'prosota_4d_comparison_panes'
  const [paneConfigs, setPaneConfigs] = useState<PaneConfig[]>(() => {
    try {
      const raw = localStorage.getItem(COMPARISON_PANES_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.slice(0, MAX_COMPARISON_PANES) : []
    } catch {
      return []
    }
  })
  const savePaneConfigs = (next: PaneConfig[]) => {
    setPaneConfigs(next)
    try { localStorage.setItem(COMPARISON_PANES_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  // Keeps the original single-click toggle's exact muscle memory: off ->
  // exactly one pane, defaulting to Baseline mode; on (with any number of
  // panes open) -> closes all of them. Adding a 2nd/3rd pane afterward is
  // the separate "+" control below.
  const toggleCompareBaseline = () => {
    savePaneConfigs(paneConfigs.length > 0 ? [] : [DEFAULT_PANE_CONFIG])
  }
  const addComparisonPane = () => {
    if (paneConfigs.length >= MAX_COMPARISON_PANES) return
    savePaneConfigs([...paneConfigs, DEFAULT_PANE_CONFIG])
  }
  const removeComparisonPane = (index: number) => {
    savePaneConfigs(paneConfigs.filter((_, i) => i !== index))
  }
  const updatePaneConfig = (index: number, config: PaneConfig) => {
    savePaneConfigs(paneConfigs.map((c, i) => (i === index ? config : c)))
  }
  const [compareSplitRatios, setCompareSplitRatios] = useState<number[]>([])
  // Top/bottom (or middle) split ratios *within* the stacked slot, only
  // meaningful once 2+ extra panes are open — same SplitRow ratio-state
  // convention as compareSplitRatios above, just for the nested column
  // split instead of the outer row one.
  const [paneColumnRatios, setPaneColumnRatios] = useState<number[]>([])

  // Named, saved dock-window arrangements (2026-07-11, per Maro: "at the
  // top, allow me to save layout, edit, delete") — same active-config-on-
  // mount + create/apply/update/delete/reset shape as
  // frontend/src/lib/ganttLayout.ts's own hooks; see dockLayouts.ts.
  const dockLayouts = useDockLayouts(selectedProject?.id)
  const activeDockConfig = useActiveDockConfig(selectedProject?.id)

  const applyDockConfig = (config: DockLayoutConfig) => {
    setOpenWindows(new Set(config.open_windows as WindowKey[]))
    setWindowDock(prev => ({ ...prev, ...(config.window_dock as Partial<Record<WindowKey, DockSide>>) }))
    setTopDockHeight(config.top_dock_height)
    setBottomDockHeight(config.bottom_dock_height)
    setTopSplitRatios(config.top_split_ratios)
    setBottomSplitRatios(config.bottom_split_ratios)
    setPropertiesOpen(config.properties_open)
    setDataPanelOpen(config.data_panel_open)
  }
  // Applies once the active layout resolves on mount (or whenever the
  // selected project changes) — not on every activeDockConfig.config
  // identity change, since that would also fire (and stomp in-progress
  // edits) after every create/update/apply call this same hook makes.
  useEffect(() => {
    if (!activeDockConfig.loading) applyDockConfig(activeDockConfig.config)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDockConfig.loading, selectedProject?.id])

  const captureCurrentDockConfig = (): DockLayoutConfig => ({
    open_windows: [...openWindows],
    window_dock: windowDock,
    top_dock_height: topDockHeight,
    bottom_dock_height: bottomDockHeight,
    top_split_ratios: topSplitRatios,
    bottom_split_ratios: bottomSplitRatios,
    properties_open: propertiesOpen,
    data_panel_open: dataPanelOpen,
  })
  const handleApplyDockLayout = async (id: string) => applyDockConfig(await dockLayouts.apply(id))
  const handleSaveDockLayout = (name: string) => dockLayouts.create(name, captureCurrentDockConfig())
  const handleOverwriteDockLayout = (id: string, name: string) => dockLayouts.update(id, name, captureCurrentDockConfig())
  const handleResetDockLayout = async () => { await dockLayouts.reset(); applyDockConfig(DEFAULT_DOCK_CONFIG) }

  // --- Import 3D / Import IFC + viewport state ---
  const [settings, setSettingsState] = useState<ViewerSettings>(loadViewerSettings)
  const setSettings = (next: ViewerSettings) => { setSettingsState(next); saveViewerSettings(next) }
  // Auto/ft/m preference for IFC storey elevations (IfcDataPanel) and
  // Location fields (TransformPanel) — owned here, not by either panel
  // (2026-07-11, per Maro: "rewire units"), so both stay in sync live
  // rather than only agreeing after a remount. Same load-on-mount/
  // save-on-change shape as settings/setSettings just above.
  const [ifcUnitDisplay, setIfcUnitDisplayState] = useState<IfcUnitDisplay>(loadIfcUnitDisplay)
  const setIfcUnitDisplay = (next: IfcUnitDisplay) => { setIfcUnitDisplayState(next); saveIfcUnitDisplay(next) }
  const [customEnvironment, setCustomEnvironment] = useState<{ name: string; url: string } | null>(null)
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  const handleUploadEnvironment = async (file: File) => {
    try {
      setEnvironmentError(null)
      setCustomEnvironment(await loadCustomEnvironment(file))
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : 'Failed to load environment file')
    }
  }
  const handleClearEnvironment = () => { setCustomEnvironment(null); setEnvironmentError(null) }
  // Fires from ViewportErrorBoundary when the *active* environment fails to
  // render (2026-07-11 fix) — e.g. a corrupt uploaded .hdr/.exr. Reverts to
  // Viewport3D.tsx's self-hosted DEFAULT_ENVIRONMENT_URL rather than leaving
  // the boundary stuck reporting a now-permanent error with no way back.
  const handleEnvironmentError = (message: string) => {
    setEnvironmentError(message)
    setCustomEnvironment(null)
  }
  // Every imported object (both "Import 3D" meshes and the one "Import IFC"
  // model), regardless of what's in the viewport this render — the single
  // source of truth both Viewport3D and the DataPanel tabs (IFC/3D, see
  // DataPanel.tsx) are derived from below (2026-07-11, per Maro: manage 3D
  // data, not just IFC — including unloading one).
  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([])

  // A mesh import's own raw embedded animation loop, keyframeable exactly
  // like Path/Zone/Annotation's own Reveal window (2026-08-22, per Maro:
  // first "I need some controls" — a plain play/pause toggle — then,
  // rejecting that in favour of "I need to be able to keyframe the
  // pause/play of the loop... yes like that," confirming Path/Zone's own
  // anim_start/anim_end pattern is what he actually wants). A raw-loop
  // actor has none of AnimationActorsList's own OTHER actor-defining
  // signals (no ModelElementLink, PathFollower, or animate-flagged
  // Path/Zone) — object.animations.length > 0 is the only thing that
  // actually distinguishes "this mesh kept its raw clip because it
  // couldn't be baked" from every other mesh import, so this Set is what
  // makes it show up in AnimationActorsList as animatable (its own
  // rawAnimationMeshNames header) even before any anim_start/anim_end
  // keyframe has been set on it yet.
  const rawAnimationMeshNames = useMemo(
    () => new Set(sceneObjects.filter(o => o.kind === 'mesh' && o.object.animations.length > 0).map(o => o.name)),
    [sceneObjects],
  )
  // Resolved straight out of the same ElementKeyframe rows, exactly
  // mirroring pathAnimWindows/zoneAnimWindows/annotationAnimWindows below
  // (same convention, just source_kind: 'mesh') — Viewport3D.tsx's own
  // EmbeddedAnimationLoop reads this to gate whether each raw clip
  // advances or holds its pose at the current scrubber date.
  const meshAnimWindows = useMemo(() => {
    const map = new Map<string, { start: Date | null; end: Date | null }>()
    for (const k of elementKeyframes.keyframes) {
      if (k.source_kind !== 'mesh' || (k.field !== 'anim_start' && k.field !== 'anim_end')) continue
      const entry = map.get(k.element_ref) ?? { start: null, end: null }
      if (k.field === 'anim_start') entry.start = new Date(k.date); else entry.end = new Date(k.date)
      map.set(k.element_ref, entry)
    }
    return map
  }, [elementKeyframes.keyframes])

  // Forces a real save before a refresh is allowed to actually happen
  // (2026-07-17, per Maro, after a real incident: a freshly-imported IFC
  // set survived in the live scene for a while — since persistModelFile's
  // own upload is deliberately fire-and-forget, not blocking the import —
  // but a refresh mid-upload (a 150MB+ real building file can take a real
  // while over the wire) discards whatever hadn't finished landing
  // server-side yet, with nothing forcing the user to notice or wait).
  // `fileId === null` on a scene object means exactly "imported, but not
  // yet confirmed saved" (see persistModelFile's own header) — the browser's
  // native beforeunload prompt is the only mechanism that can actually make
  // a refresh wait on the user's own explicit "yes, leave anyway," the same
  // way any other app warns on real unsaved changes. A ref, not a `useEffect`
  // dependency on `sceneObjects` itself, so this one listener registered
  // once on mount always reads whatever the *latest* state is at the moment
  // the browser actually fires the event, not whatever it happened to close
  // over at mount time.
  const sceneObjectsRef = useRef(sceneObjects)
  useEffect(() => { sceneObjectsRef.current = sceneObjects })
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (sceneObjectsRef.current.some(o => o.fileId === null)) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // A live-drag override for whichever one box is currently being resized
  // via SectionBoxGizmo.tsx's own pointer handlers (2026-07-09) — updated
  // on every pointer-move (handleSectionBoxDragMove below), cleared once
  // the drag ends and the real PATCH lands. Deliberately NOT folded into
  // sectionBoxes itself: that would mean rewriting the whole array on
  // every pointer-move just to preview one box's bounds, and would make
  // "did the user actually save this" ambiguous while dragging.
  // (resolvedSectionBoxes itself — the actual join against sceneObjects —
  // lives further below, after getIfcHandleFor is declared, since
  // per-element scoping needs it too; see that block's own header.)
  const [draggingSectionBox, setDraggingSectionBox] = useState<{ id: string; bounds: SectionBoxBounds } | null>(null)
  // Same live-preview-until-release convention as draggingSectionBox above,
  // just for the box's own rotation (2026-07-17, per Maro: "I'd like to
  // rotate the bounding box") — kept as a separate piece of state rather
  // than folded into draggingSectionBox's own shape, since resize and
  // rotate are two independent drag gestures that should never clobber
  // each other's live preview.
  const [draggingSectionBoxRotation, setDraggingSectionBoxRotation] = useState<{ id: string; rotation: SectionBoxRotation } | null>(null)
  // Resize vs Rotate (2026-07-17, per Maro: "the rotation handles make it
  // hard to manipulate the original handles") — one gizmo active at a
  // time across every box, not per-box; matches gizmoMode's own single
  // global toggle for the ordinary object/element TransformControls
  // elsewhere in this file.
  const [sectionBoxTool, setSectionBoxTool] = useState<SectionBoxTool>('resize')
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  // Hide-by-sub-element (2026-07-11, for Collections) — see Viewport3D.tsx's
  // own Props doc comment on why this is a composite-key Set<string>, not a
  // flat Set<number> the way isolatedExpressIds/selectedExpressIds are.
  const [hiddenExpressIds, setHiddenExpressIds] = useState<Set<string>>(new Set())
  // Isolate Selected / Show All (2026-07-08, per Maro: "isolate selected,
  // show view focus on selected, show all") — a temporary overlay on top of
  // hiddenIds' own deliberate per-object hide list, not a replacement for
  // it (see viewportObjects' visible computation below, and Viewport3D.tsx's
  // ModelObjects for the finer IFC sub-element case this alone can't
  // express). Show All clears both together — the universal "just show me
  // everything" escape hatch, regardless of which of the two hid something.
  //
  // isolatedObjectIds/isolatedExpressIds (2026-07-09 fix, per Maro: "if i
  // click a random position where an element that's hidden is. it reveals
  // and isolates that one instead. I dont want that... I only want the
  // element or elements that I selected") — a *frozen snapshot* of
  // selectedObjectIds/selectedExpressIds taken the moment Isolate is
  // switched on, not a live re-derivation from whatever's currently
  // selected. The original version tied isolate visibility directly to the
  // live selection, so a later plain click anywhere (which *replaces* the
  // selection, per handleSelectObject/handleSelectExpressId's own
  // convention) immediately changed what was isolated too — clicking
  // *anything* while isolating, including empty space or a different
  // element, silently swapped the whole isolated set out from under the
  // user. Selecting things while Isolate is on (for texture edits, Select
  // Linked, etc.) now has zero effect on what's isolated — that only
  // changes when Isolate is explicitly toggled again or Show All is used.
  const [isolateMode, setIsolateMode] = useState(false)
  const [isolatedObjectIds, setIsolatedObjectIds] = useState<Set<string>>(new Set())
  const [isolatedExpressIds, setIsolatedExpressIds] = useState<Set<number>>(new Set())
  const [dataTab, setDataTab] = useState<DataPanelTab>('ifc')
  // Federated/assembly modeling (2026-07-09, per Maro: "allow me to import
  // more than one IFC model or 3d model. so I can start building an
  // assembly or federated model e.g structural IFC, architecture IFC, road
  // fbx, tree gltf etc. currently loading another replaces what i have") —
  // a real, common BIM workflow this previously blocked outright
  // ("Only one IFC model at a time this pass" — a deliberate v1 scope cut,
  // not an accident). Mesh-kind imports were never restricted this way
  // (sceneObjects has always been a plain array); this brings IFC in line
  // with that. Every consumer that used to assume "the" single ifcHandle
  // now looks up the *specific* handle for whichever model a given
  // expressID/selection actually belongs to — see getIfcHandleFor below.
  const [ifcHandles, setIfcHandles] = useState<IfcModelHandle[]>([])
  const getIfcHandleFor = (objectId: string | null | undefined): IfcModelHandle | null =>
    ifcHandles.find(h => `ifc-${h.modelID}` === objectId) ?? null

  // One useResolvedPaneIsolation call per comparison-pane *slot* (2026-08-03,
  // not per active pane — React's rules of hooks mean this can't be a
  // variable-length loop). Each pane's own config, or DEFAULT_PANE_CONFIG
  // ('baseline' mode, resolves to null/no-op) for an inactive slot — see
  // comparisonPane.ts's own header for exactly what each contentMode
  // resolves to.
  const paneIsolations = [
    useResolvedPaneIsolation(paneConfigs[0] ?? DEFAULT_PANE_CONFIG, activities, collections, modelElementLinks, sceneObjects, ifcHandles, activityUdfValues.getValue),
    useResolvedPaneIsolation(paneConfigs[1] ?? DEFAULT_PANE_CONFIG, activities, collections, modelElementLinks, sceneObjects, ifcHandles, activityUdfValues.getValue),
    useResolvedPaneIsolation(paneConfigs[2] ?? DEFAULT_PANE_CONFIG, activities, collections, modelElementLinks, sceneObjects, ifcHandles, activityUdfValues.getValue),
  ]

  // "Unload Selected"/"Reload IFC" (2026-07-26, per Maro: "if i refresh, i
  // expect the elements i unloaded to stay unloaded... give me an option to
  // reload ifc which can identify the elements unloaded") — Model3DFile's
  // own unloaded_elements column, mirrored here keyed by fileId so
  // performUnloadElements/the "Reload IFC" dialog can read/merge it without
  // a network round-trip on every keystroke. Seeded from listModel3DFiles'
  // response in the restore-on-mount effect below, kept in sync afterwards
  // by whichever of this file's own calls to updateUnloadedElements last
  // succeeded.
  const [unloadedElementsByFileId, setUnloadedElementsByFileId] = useState<Map<string, UnloadedElementInfo[]>>(new Map())
  // Re-keyed by scene-object id (not fileId) for IfcDataPanel.tsx's own
  // per-model Reload button, which only ever knows the model's `ifc-${modelID}`
  // id, not its backend fileId.
  const unloadedCountByModelId = new Map(
    sceneObjects.filter(o => o.kind === 'ifc' && o.fileId).map(o => [o.id, unloadedElementsByFileId.get(o.fileId!)?.length ?? 0]),
  )
  // Which loaded scene objects genuinely haven't finished saving yet
  // (2026-07-28, per Maro — see IfcDataPanel.tsx's own unsavedObjectIds
  // prop header for the full story) — fileId stays null until the upload
  // truly lands, same fact the beforeunload guard/toolbar progress
  // indicator already read, now surfaced per row in both data panels too.
  const unsavedObjectIds = new Set(sceneObjects.filter(o => o.fileId === null).map(o => o.id))

  // Regenerates every level-slice clone whenever the loaded IFC models or
  // the split configuration change (2026-07-15) — see elementSplitTargets.ts's
  // own header for why this is a full rebuild each time, not an incremental
  // diff. Bumps sceneObjects afterward (a trivial new-array-same-contents
  // set) purely to give Viewport3D.tsx's ModelObjects effect a fresh
  // `objects` identity to react to — it already re-derives viewportObjects
  // fresh off sceneObjects on every render, but has no other way to notice
  // this effect just imperatively added new mesh children to a handle it
  // already holds a reference to (mutating handle.object doesn't itself
  // trigger a React re-render the way setState does).
  useEffect(() => {
    if (ifcHandles.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const handle of ifcHandles) await regenerateSplitTargets(handle, elementSplits, settings.upAxis)
      if (!cancelled) setSceneObjects(prev => [...prev])
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ifcHandles, elementSplits, settings.upAxis])

  const [scheduleWizardOpen, setScheduleWizardOpen] = useState(false)

  // Resolves each element-scoped SectionBox's own GlobalId (element_ref)
  // to an expressID within whichever specific IFC model it belongs to
  // (2026-07-09, per-element scoping) — async (needs web-ifc, dynamic-
  // imported to keep it out of the main bundle same as every other
  // ifcModel.ts consumer in this file) and kept in its own small lookup
  // table rather than inline in resolvedSectionBoxes below, since that's a
  // plain synchronous render-time computation and can't itself await
  // anything. A box whose element hasn't resolved yet (or whose target
  // model isn't loaded) is simply left out of the lookup — resolvedSectionBoxes
  // below already treats "no entry" as "not resolvable yet," same
  // skip-if-not-resolvable convention as everywhere else in this feature.
  const [sectionBoxElementIds, setSectionBoxElementIds] = useState<Record<string, number>>({})
  useEffect(() => {
    const elementScoped = sectionBoxes.filter(b => b.element_ref !== null)
    if (elementScoped.length === 0) { setSectionBoxElementIds({}); return }
    let cancelled = false
    ;(async () => {
      const { getExpressIdFromGuid } = await import('./ifcModel')
      if (cancelled) return
      const next: Record<string, number> = {}
      for (const box of elementScoped) {
        const sceneObject = sceneObjects.find(o => o.fileId === box.model3d_file_id)
        if (!sceneObject || sceneObject.kind !== 'ifc') continue
        const handle = getIfcHandleFor(sceneObject.id)
        if (!handle) continue
        const expressId = getExpressIdFromGuid(handle, box.element_ref as string)
        if (expressId !== undefined) next[box.id] = expressId
      }
      if (!cancelled) setSectionBoxElementIds(next)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionBoxes, sceneObjects, ifcHandles])

  // Variance colour-coding (2026-07-12, per Maro: "Colour coded elements
  // by variance") — resolves each IFC-kind ModelElementLink's own GlobalId
  // to an expressID the same async, own-lookup-table way
  // sectionBoxElementIds above already does (mesh-kind links need no
  // async resolution at all — element_ref is already the filename
  // ModelObjects keys mesh-kind objects by).
  const [ifcLinkKeys, setIfcLinkKeys] = useState<Record<string, string>>({})
  useEffect(() => {
    const ifcLinks = modelElementLinks.filter(l => l.source_kind === 'ifc')
    if (ifcLinks.length === 0) { setIfcLinkKeys({}); return }
    let cancelled = false
    ;(async () => {
      const { getExpressIdFromGuid } = await import('./ifcModel')
      if (cancelled) return
      const next: Record<string, string> = {}
      // Yielded every 200 links (2026-07-15, per Maro: "its very laggy...
      // this model only had 5k plus elements") — Generate Schedule creates
      // one ifc-kind ModelElementLink per linked element, so a real
      // structural+architectural run can mean thousands of rows here; each
      // one calls getExpressIdFromGuid, a synchronous native WASM call, and
      // this loop used to run every one of them back-to-back with no
      // yield — a real main-thread freeze on every modelElementLinks/
      // ifcHandles change (right after generation, on project load, ...).
      // Same chunking idiom ifcScheduleExtraction.ts's own bulk WASM reads
      // and Viewport3D.tsx's TimelinePlayback resolver now both use.
      for (let i = 0; i < ifcLinks.length; i++) {
        if (i > 0 && i % 200 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0))
          if (cancelled) return
        }
        const link = ifcLinks[i]
        for (const handle of ifcHandles) {
          const expressId = getExpressIdFromGuid(handle, link.element_ref)
          if (expressId !== undefined) { next[link.id] = `ifc-${handle.modelID}::${expressId}`; break }
        }
      }
      if (!cancelled) setIfcLinkKeys(next)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelElementLinks, ifcHandles])

  // Keyed exactly like customTextures' own per-element overrides (whole
  // mesh-kind object id, or `${objectId}::${expressID}` for a specific IFC
  // sub-element) — Viewport3D.tsx's ModelObjects/TimelinePlayback both read
  // this straight through with zero further resolution needed. Only
  // activities with a real, non-null variance_days contribute (no baseline
  // assigned yet = no colour, not a false "on time" green) — and now also
  // only those with real start/finish dates (2026-07-24, third pass, per
  // Maro: "i dont want the variance color to be permanently the color...
  // vibrant through the duration of its relevant activity duration then go
  // back to its original color" — start/finish are what Viewport3D.tsx's
  // own resolveVarianceTint compares the current playhead date against
  // every frame, gating the tint to the activity's own live window instead
  // of showing it at every date on the timeline).
  const varianceByElementKey: Map<string, VarianceEntry> = useMemo(() => {
    const map = new Map<string, VarianceEntry>()
    const activityById = new Map(activities.map(a => [a.id, a]))
    for (const link of modelElementLinks) {
      const activity = activityById.get(link.activity_id)
      if (!activity || activity.variance_days === null || activity.variance_days === undefined) continue
      if (!activity.start || !activity.finish) continue
      const entry: VarianceEntry = {
        days: activity.variance_days,
        start: new Date(activity.start).getTime(),
        finish: new Date(activity.finish).getTime(),
      }
      if (link.source_kind === 'mesh') {
        const sceneObject = sceneObjects.find(o => o.kind === 'mesh' && o.name === link.element_ref)
        if (sceneObject) map.set(sceneObject.id, entry)
      } else if (link.source_kind === 'ifc') {
        const key = ifcLinkKeys[link.id]
        if (key) map.set(key, entry)
      }
    }
    return map
  }, [modelElementLinks, activities, sceneObjects, ifcLinkKeys])

  // Select Unassigned (2026-07-15, per Maro: "pick elements that havent
  // been 4d linked to an activity yet") — the "already linked" side of that
  // check, split the same mesh/ifc way varianceByElementKey already is (and
  // reusing the same ifcLinkKeys resolution rather than re-resolving
  // GlobalId->expressID again). annotation-kind links aren't scene geometry
  // at all, so they never contribute here.
  const linkedMeshObjectIds: Set<string> = useMemo(() => {
    const set = new Set<string>()
    for (const link of modelElementLinks) {
      if (link.source_kind !== 'mesh') continue
      const sceneObject = sceneObjects.find(o => o.kind === 'mesh' && o.name === link.element_ref)
      if (sceneObject) set.add(sceneObject.id)
    }
    return set
  }, [modelElementLinks, sceneObjects])
  const linkedIfcElementKeys: Set<string> = useMemo(() => {
    const set = new Set<string>()
    for (const link of modelElementLinks) {
      if (link.source_kind !== 'ifc') continue
      const key = ifcLinkKeys[link.id]
      if (key) set.add(key)
    }
    return set
  }, [modelElementLinks, ifcLinkKeys])

  // Replaces the current selection, same convention as handleSelectAll —
  // Viewport3D.tsx's handleSelectUnassigned already filtered to
  // visible/unlinked objects and elements, this just applies the result the
  // same way handleBoxSelect applies its own matches (see that handler's
  // own comment on why a loop over per-id setters would clobber itself).
  const handleSelectUnassigned = (objectIds: string[], expressIdsByObject: Map<string, number[]>) => {
    if (objectIds.length === 0 && expressIdsByObject.size === 0) return
    const allExpressIds = [...expressIdsByObject.values()].flat()
    setSelectedExpressIds(new Set(allExpressIds))
    // Only a genuine single-element result gets a "primary" element
    // (2026-07-17 fix — see handleBoxSelect's own header for why).
    setSelectedExpressId(allExpressIds.length === 1 ? allExpressIds[0] : null)
    setSelectedObjectIds(new Set([...objectIds, ...expressIdsByObject.keys()]))
    const lastObjectId = allExpressIds.length > 0 ? [...expressIdsByObject.keys()].pop()! : objectIds[objectIds.length - 1]
    if (lastObjectId) {
      setActiveObjectId(lastObjectId)
      if (expressIdsByObject.has(lastObjectId)) setActiveIfcModelId(lastObjectId)
    }
  }

  // Clash Detective (2026-07-12, per Maro's Navisworks reference screenshot)
  // — reuses Collections as a test's two selection sets (see clash_test.py's
  // own docstring on why) rather than a second selection concept. Geometry
  // only ever exists client-side; "Run" reads whatever the viewport
  // currently shows (sceneClash.ts's own header) and PUTs the computed
  // pairs, letting the backend preserve review status for pairs that still
  // exist across a re-run.
  const [clashTests, setClashTests] = useState<ClashTest[]>([])
  const [clashError, setClashError] = useState<string | null>(null)
  const [clashRunProgress, setClashRunProgress] = useState<{ testId: string; done: number; total: number } | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listClashTests(selectedProject.id).then(ts => { if (!cancelled) setClashTests(ts) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  const clashErrorMessage = (err: unknown, fallback: string): string => {
    if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') return err.response.data.detail
    return err instanceof Error ? err.message : fallback
  }

  const handleCreateClashTest = async (draft: {
    name: string; group_a_collection_id: string; group_b_collection_id: string; test_type: 'hard' | 'clearance'; tolerance_mm: number
  }) => {
    if (!selectedProject) return
    try {
      setClashError(null)
      const created = await createClashTest({ project_id: selectedProject.id, ...draft })
      setClashTests(prev => [...prev, created])
    } catch (err) {
      setClashError(clashErrorMessage(err, 'Failed to create clash test'))
    }
  }

  const handleDeleteClashTest = async (id: string) => {
    try {
      setClashError(null)
      await deleteClashTest(id)
      setClashTests(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      setClashError(clashErrorMessage(err, 'Failed to delete clash test'))
    }
  }

  const handleUpdateClashResult = async (resultId: string, data: { status?: ClashResult['status']; comment?: string | null }) => {
    try {
      setClashError(null)
      const updated = await updateClashResult(resultId, data)
      setClashTests(prev => prev.map(t => (
        t.id === updated.clash_test_id ? { ...t, results: t.results.map(r => (r.id === updated.id ? updated : r)) } : t
      )))
    } catch (err) {
      setClashError(clashErrorMessage(err, 'Failed to update clash result'))
    }
  }

  const handleRunClashTest = async (testId: string) => {
    const test = clashTests.find(t => t.id === testId)
    if (!test) return
    const collectionA = collections.find(c => c.id === test.group_a_collection_id)
    const collectionB = collections.find(c => c.id === test.group_b_collection_id)
    if (!collectionA || !collectionB) {
      setClashError('One of this test\'s Collections no longer exists — pick new ones (delete and recreate the test)')
      return
    }
    setClashError(null)
    setClashRunProgress({ testId, done: 0, total: 0 })
    try {
      const clashSceneObjects: ClashSceneObject[] = sceneObjects.map(o => ({ id: o.id, kind: o.kind, name: o.name, object: o.object }))
      // Clash Detective doesn't understand level-slices yet (2026-07-15,
      // deliberately out of scope for that feature's own first pass — see
      // elementSplitTargets.ts's own header) — filtered out here rather
      // than widening sceneClash.ts's own real/mesh-only element type, so a
      // slice-containing Collection degrades to "clash-test its non-slice
      // members" instead of a type error or a runtime crash.
      const nonSplitMembers = (members: typeof collectionA.members) =>
        members.filter((m): m is typeof m & { source_kind: 'ifc' | 'mesh' } => m.source_kind !== 'ifc_split')
      const elementsA = await resolveMembersToElements(nonSplitMembers(collectionA.members), clashSceneObjects, ifcHandles)
      const selfTest = collectionA.id === collectionB.id
      const elementsB = selfTest ? elementsA : await resolveMembersToElements(nonSplitMembers(collectionB.members), clashSceneObjects, ifcHandles)
      const found = await findClashes(elementsA, elementsB, test.test_type, test.tolerance_mm, selfTest, (done, total) => {
        setClashRunProgress({ testId, done, total })
      })
      const pairs: ClashResultPair[] = found.map(f => ({
        element_a_source_kind: f.elementA.sourceKind, element_a_ref: f.elementA.ref, element_a_label: f.elementA.label,
        element_b_source_kind: f.elementB.sourceKind, element_b_ref: f.elementB.ref, element_b_label: f.elementB.label,
        distance_mm: f.distanceMm,
      }))
      const updated = await replaceClashResults(testId, pairs)
      setClashTests(prev => prev.map(t => (t.id === testId ? updated : t)))
    } catch (err) {
      setClashError(clashErrorMessage(err, 'Failed to run clash test'))
    } finally {
      setClashRunProgress(null)
    }
  }

  const handleSelectClashPair = async (
    elementA: { source_kind: 'ifc' | 'mesh'; ref: string },
    elementB: { source_kind: 'ifc' | 'mesh'; ref: string },
  ) => {
    const refs = [
      { source_kind: elementA.source_kind, element_ref: elementA.ref },
      { source_kind: elementB.source_kind, element_ref: elementB.ref },
    ]
    const { objectIds, expressIds } = await resolveElementRefsToTargets(refs, sceneObjects, ifcHandles)
    if (objectIds.size === 0 && expressIds.size === 0) return
    setSelectedObjectIds(objectIds)
    setSelectedExpressIds(expressIds)
    setSelectedExpressId(null)
    const ifcObjectIds = [...objectIds].filter(id => id.startsWith('ifc-'))
    setActiveIfcModelId(ifcObjectIds.length === 1 ? ifcObjectIds[0] : null)
    setActiveObjectId(objectIds.size === 1 ? [...objectIds][0] : null)
  }

  // Keyed exactly like varianceByElementKey/customTextures above — resolved
  // via the same per-ref async GlobalId->expressID lookup ifcLinkKeys uses,
  // just keyed by the raw ref string instead of a ModelElementLink id since
  // more than one ClashResult can share the same element. Approved results
  // are excluded (Navisworks' own "approved clashes stop showing as red").
  const [clashRefKeys, setClashRefKeys] = useState<Record<string, string>>({})
  useEffect(() => {
    const refs = new Map<string, 'ifc' | 'mesh'>()
    for (const test of clashTests) {
      for (const r of test.results) {
        if (r.status === 'approved') continue
        refs.set(r.element_a_ref, r.element_a_source_kind)
        refs.set(r.element_b_ref, r.element_b_source_kind)
      }
    }
    if (refs.size === 0) { setClashRefKeys({}); return }
    let cancelled = false
    ;(async () => {
      const needsIfc = [...refs.values()].some(k => k === 'ifc') && ifcHandles.length > 0
      const ifcModel = needsIfc ? await import('./ifcModel') : null
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const [ref, sourceKind] of refs) {
        if (sourceKind === 'mesh') {
          const sceneObject = sceneObjects.find(o => o.kind === 'mesh' && o.name === ref)
          if (sceneObject) next[ref] = sceneObject.id
        } else if (ifcModel) {
          for (const handle of ifcHandles) {
            const expressId = ifcModel.getExpressIdFromGuid(handle, ref)
            if (expressId !== undefined) { next[ref] = `ifc-${handle.modelID}::${expressId}`; break }
          }
        }
      }
      if (!cancelled) setClashRefKeys(next)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clashTests, sceneObjects, ifcHandles])

  const clashByElementKey: Map<string, boolean> = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const test of clashTests) {
      for (const r of test.results) {
        if (r.status === 'approved') continue
        const keyA = clashRefKeys[r.element_a_ref]
        const keyB = clashRefKeys[r.element_b_ref]
        if (keyA) map.set(keyA, true)
        if (keyB) map.set(keyB, true)
      }
    }
    return map
  }, [clashTests, clashRefKeys])

  // Progress Variance (2026-08-20, per the approved plan) — reuses
  // sceneClash.ts's own resolveMembersToElements for Group A resolution
  // (the exact same "Collection resolves to whatever the viewport
  // currently shows" concept Clash Detective's Group A already is), just
  // tested against a SiteCapture's point-cloud density instead of a
  // second element group's own geometry (progressVarianceEngine.ts).
  const [siteCaptures, setSiteCaptures] = useState<SiteCapture[]>([])
  const [progressVarianceTests, setProgressVarianceTests] = useState<ProgressVarianceTest[]>([])
  const [progressVarianceError, setProgressVarianceError] = useState<string | null>(null)
  const [progressVarianceRunProgress, setProgressVarianceRunProgress] = useState<{ testId: string; done: number; total: number } | null>(null)
  // Keyed by test id — a read-only view fetched on demand (not part of
  // the test's own persisted shape, see getActivityProgressSuggestions's
  // own docstring), so it's tracked separately rather than folded into
  // ProgressVarianceTest itself.
  const [activityProgressSuggestions, setActivityProgressSuggestions] = useState<Record<string, ActivityProgressSuggestion[]>>({})
  const [applyingActivityId, setApplyingActivityId] = useState<string | null>(null)
  const [uploadingCapture, setUploadingCapture] = useState(false)
  // Which capture (if any) is currently mid-conversion server-side
  // (2026-08-20) — see site_capture.py's own POST .../convert: for a real,
  // large multi-scan .e57 this can genuinely take minutes, so the panel
  // needs a real "this is working, not stuck" state, not just a disabled
  // button with no explanation.
  const [convertingCaptureId, setConvertingCaptureId] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listSiteCaptures(selectedProject.id).then(cs => { if (!cancelled) setSiteCaptures(cs) })
    listProgressVarianceTests(selectedProject.id).then(ts => { if (!cancelled) setProgressVarianceTests(ts) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  const progressVarianceErrorMessage = (err: unknown, fallback: string): string => {
    if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') return err.response.data.detail
    return err instanceof Error ? err.message : fallback
  }

  // Which SceneObject (if any) each currently-loaded SiteCapture became —
  // keyed by site_capture_id -> sceneObject.id (2026-08-20). Deliberately
  // NOT name-matched (unlike mesh-kind Collection members/
  // resolveMembersToElements, which key on SceneObject.name) — a real
  // MatterPak export's own cloud.xyz is *always* that literal filename,
  // and site_capture.py explicitly allows re-uploading the same name as a
  // new, separate dated capture rather than replacing (see that model's
  // own docstring: "a project can, and should, have many captures over
  // time"), so name collisions between two different captures are the
  // expected normal case here, not an edge case. Stale entries (the
  // mapped scene object was removed some other way — e.g. a future
  // "Unload All") are harmless: every reader below treats a missing
  // sceneObjects match as "not loaded," so nothing needs to proactively
  // clean this map on every possible unload path.
  const [captureSceneObjectIds, setCaptureSceneObjectIds] = useState<Record<string, string>>({})
  const loadedCaptureIds: Set<string> = useMemo(() => {
    const set = new Set<string>()
    for (const [captureId, sceneObjectId] of Object.entries(captureSceneObjectIds)) {
      if (sceneObjects.some(o => o.id === sceneObjectId)) set.add(captureId)
    }
    return set
  }, [captureSceneObjectIds, sceneObjects])

  const handleUploadSiteCapture = async (file: File) => {
    if (!selectedProject) return
    setUploadingCapture(true)
    try {
      setProgressVarianceError(null)
      const capturedAt = new Date().toISOString().slice(0, 10)
      // Raw .e57 bytes upload as-is — conversion to a loadable point cloud
      // happens later, server-side, via the panel's own explicit "Convert"
      // button (site_capture.py's POST .../convert) — see that endpoint's
      // own header for why (a real 14.4GB export has no safe way to
      // convert in a browser tab).
      const kind: SiteCaptureKind = file.name.toLowerCase().endsWith('.e57') ? 'e57' : 'xyz'
      const created = await uploadSiteCapture(selectedProject.id, file.name, capturedAt, kind, defaultSourceUpAxis('mesh'), file)
      setSiteCaptures(prev => [...prev, created])
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to upload site capture'))
    } finally {
      setUploadingCapture(false)
    }
  }

  const handleDeleteSiteCapture = async (id: string) => {
    try {
      setProgressVarianceError(null)
      const loadedSceneObjectId = captureSceneObjectIds[id]
      if (loadedSceneObjectId) {
        performUnloadMesh(loadedSceneObjectId)
        setCaptureSceneObjectIds(prev => { const { [id]: _removed, ...rest } = prev; return rest })
      }
      clearPointCloudCache(id)
      await deleteSiteCapture(id)
      setSiteCaptures(prev => prev.filter(c => c.id !== id))
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to delete site capture'))
    }
  }

  // Server-side E57->XYZ conversion (2026-08-20, per Maro's own real
  // 14.4GB, 105-scan export — see site_capture.py's own convert_capture
  // for the full "why this doesn't happen in the browser" story). A plain
  // await, not fire-and-forget — the request itself can take minutes, so
  // convertingCaptureId drives the panel's own "Converting… this can take
  // several minutes for a large scan" state for exactly that long, rather
  // than the button just going quiet.
  const handleConvertSiteCapture = async (id: string) => {
    setConvertingCaptureId(id)
    try {
      setProgressVarianceError(null)
      const updated = await convertSiteCapture(id)
      setSiteCaptures(prev => prev.map(c => (c.id === id ? updated : c)))
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to convert site capture'))
    } finally {
      setConvertingCaptureId(null)
    }
  }

  // "Generate IFC" (2026-08-20, per Maro: "pointcloud to ifc" / "build") —
  // runs the vendored Cloud2BIM pipeline server-side against this
  // capture's own xyz point cloud, then immediately loads the resulting
  // Model3DFile into the viewport the exact same way any other persisted
  // IFC restore does — download its bytes, wrap them as a File, hand off
  // to handleImportIfc (defined further down this component) rather than
  // duplicating that function's own scene-object/persistence wiring here.
  // handleImportIfc's own persistModelFile re-upload at the end re-saves
  // bytes the server just generated — a real but small waste (a generated
  // room-scale IFC is KB-to-low-MB, nothing like the point-cloud sizes
  // this session's other work had to specifically design around), traded
  // for reusing already-correct, already-tested import wiring instead of
  // a second copy of it.
  const [generatingIfcCaptureId, setGeneratingIfcCaptureId] = useState<string | null>(null)
  const handleGenerateIfcFromCapture = async (captureId: string) => {
    setGeneratingIfcCaptureId(captureId)
    try {
      setProgressVarianceError(null)
      const model3dFile = await generateIfcFromCapture(captureId)
      const blob = await downloadModel3DFile(model3dFile.id)
      const file = new File([blob], model3dFile.name)
      await handleImportIfc(file, model3dFile.source_up_axis, model3dFile.name)
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to generate IFC'))
    } finally {
      setGeneratingIfcCaptureId(null)
    }
  }

  // "Load in Viewport" (2026-08-20) parses the FULL cloud once (cached by
  // progressVarianceEngine.ts, reused by every later "Run Test" against
  // this capture) and separately renders a decimated preview
  // (pointCloud.ts's own createPointCloudObject) as a normal mesh-kind
  // scene object — positioned at the origin, same as any other import, so
  // the existing Move gizmo is how it gets manually aligned onto the BIM
  // model (see the plan's own disclosed "only as good as manual alignment"
  // limitation). "Unload" just removes that scene object, same
  // performUnloadMesh path any other mesh-kind import already uses — the
  // capture's own backend row/disk file is untouched (deleting it is a
  // separate, explicit action).
  const handleToggleLoadCapture = async (capture: SiteCapture) => {
    const existingId = captureSceneObjectIds[capture.id]
    const existing = existingId ? sceneObjects.find(o => o.id === existingId) : undefined
    if (existing) {
      performUnloadMesh(existing.id)
      setCaptureSceneObjectIds(prev => { const { [capture.id]: _removed, ...rest } = prev; return rest })
      return
    }
    if (capture.kind === 'e57') {
      setProgressVarianceError('Convert this capture to XYZ first (see its own "Convert" button above) — a raw .e57 can\'t be loaded directly.')
      return
    }
    try {
      setProgressVarianceError(null)
      const blob = await downloadSiteCapture(capture.id)
      const cloud = await loadFullPointCloud(capture.id, blob, capture.name)
      const object = createPointCloudObject(cloud)
      const id = crypto.randomUUID()
      object.name = capture.name
      object.userData.sceneObjectId = id
      object.userData.siteCaptureId = capture.id
      setSceneObjects(prev => [...prev, { id, name: capture.name, kind: 'mesh', sourceUpAxis: capture.source_up_axis, object, fileId: null }])
      setCaptureSceneObjectIds(prev => ({ ...prev, [capture.id]: id }))
      setDataTab('3d')
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to load site capture'))
    }
  }

  const handleCreateProgressVarianceTest = async (draft: {
    name: string; group_a_collection_id: string; site_capture_id: string; min_coverage_percent: number
  }) => {
    if (!selectedProject) return
    try {
      setProgressVarianceError(null)
      const created = await createProgressVarianceTest({ project_id: selectedProject.id, ...draft })
      setProgressVarianceTests(prev => [...prev, created])
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to create progress variance test'))
    }
  }

  const handleDeleteProgressVarianceTest = async (id: string) => {
    try {
      setProgressVarianceError(null)
      await deleteProgressVarianceTest(id)
      setProgressVarianceTests(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to delete progress variance test'))
    }
  }

  const handleUpdateProgressVarianceThreshold = async (testId: string, minCoveragePercent: number) => {
    try {
      setProgressVarianceError(null)
      const updated = await updateProgressVarianceTest(testId, { min_coverage_percent: minCoveragePercent })
      setProgressVarianceTests(prev => prev.map(t => (t.id === testId ? updated : t)))
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to update threshold'))
    }
  }

  const handleUpdateProgressVarianceResult = async (resultId: string, data: { status?: ProgressVarianceResult['status']; comment?: string | null }) => {
    try {
      setProgressVarianceError(null)
      const updated = await updateProgressVarianceResult(resultId, data)
      setProgressVarianceTests(prev => prev.map(t => (
        t.id === updated.progress_variance_test_id ? { ...t, results: t.results.map(r => (r.id === updated.id ? updated : r)) } : t
      )))
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to update result'))
    }
  }

  const handleRunProgressVarianceTest = async (testId: string) => {
    const test = progressVarianceTests.find(t => t.id === testId)
    if (!test) return
    const collectionA = collections.find(c => c.id === test.group_a_collection_id)
    const capture = siteCaptures.find(c => c.id === test.site_capture_id)
    if (!collectionA) {
      setProgressVarianceError('This test\'s Collection no longer exists — pick a new one (delete and recreate the test)')
      return
    }
    if (!capture) {
      setProgressVarianceError('This test\'s Site Capture no longer exists — pick a new one (delete and recreate the test)')
      return
    }
    const pointCloudSceneObjectId = captureSceneObjectIds[capture.id]
    const pointCloudSceneObject = pointCloudSceneObjectId ? sceneObjects.find(o => o.id === pointCloudSceneObjectId) : undefined
    const fullCloud = getCachedPointCloud(capture.id)
    if (!pointCloudSceneObject || !fullCloud) {
      setProgressVarianceError('Load this capture in the viewport first (Site Captures above)')
      return
    }
    setProgressVarianceError(null)
    setProgressVarianceRunProgress({ testId, done: 0, total: 0 })
    try {
      const clashSceneObjects: ClashSceneObject[] = sceneObjects.map(o => ({ id: o.id, kind: o.kind, name: o.name, object: o.object }))
      // Same level-slice exclusion as Clash Detective's own handleRunClashTest
      // — see that handler's own comment.
      const nonSplitMembers = collectionA.members.filter(
        (m): m is typeof m & { source_kind: 'ifc' | 'mesh' } => m.source_kind !== 'ifc_split',
      )
      const found = await runProgressVarianceQuery(
        nonSplitMembers, clashSceneObjects, ifcHandles, fullCloud, pointCloudSceneObject.object, test.min_coverage_percent,
        (done, total) => setProgressVarianceRunProgress({ testId, done, total }),
      )
      const elements: ProgressVarianceResultElement[] = found.map(f => ({
        element_source_kind: f.ref.sourceKind, element_ref: f.ref.ref, element_label: f.ref.label,
        point_count: f.pointCount, coverage_percent: f.coveragePercent, confirmed_in_scan: f.confirmedInScan,
      }))
      const updated = await replaceProgressVarianceResults(testId, elements)
      setProgressVarianceTests(prev => prev.map(t => (t.id === testId ? updated : t)))
      // Best-effort, not blocking/failing the run itself — a fresh set
      // of element results is exactly when there's something new to
      // suggest, but a project with no ModelElementLinks at all (most
      // projects, until this feature actually gets used) just comes back
      // empty, which is a normal, silent outcome, not an error to surface.
      try {
        const suggestions = await getActivityProgressSuggestions(testId)
        setActivityProgressSuggestions(prev => ({ ...prev, [testId]: suggestions }))
      } catch { /* non-fatal — the element results above already saved fine */ }
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to run progress variance test'))
    } finally {
      setProgressVarianceRunProgress(null)
    }
  }

  // "Apply" writes a scan-suggested % straight into Activity.pct_complete
  // (2026-08-21) — the same field the PM already edits manually, already
  // feeding EVM/SPI/CPI and Baseline Comparison with zero new plumbing,
  // per the approved plan's own "review-and-apply, not silent overwrite"
  // call: pct_complete is EVM-critical, so this is always an explicit
  // per-activity action the reviewer takes, never automatic off a Run
  // Test. Removes the applied suggestion from the review list on success
  // (its own current_pct_complete is now stale) rather than leaving a
  // suggestion that reads as "not yet applied" once it has been.
  const handleApplyActivityProgress = async (testId: string, suggestion: ActivityProgressSuggestion) => {
    setApplyingActivityId(suggestion.activity_id)
    try {
      setProgressVarianceError(null)
      await api.patch(`/api/v1/activities/${suggestion.activity_id}`, { pct_complete: suggestion.scan_suggested_pct_complete })
      setActivityProgressSuggestions(prev => ({
        ...prev,
        [testId]: (prev[testId] ?? []).filter(s => s.activity_id !== suggestion.activity_id),
      }))
    } catch (err) {
      setProgressVarianceError(progressVarianceErrorMessage(err, 'Failed to apply activity progress'))
    } finally {
      setApplyingActivityId(null)
    }
  }

  const handleSelectVarianceElement = async (element: { source_kind: 'ifc' | 'mesh'; ref: string }) => {
    const refs = [{ source_kind: element.source_kind, element_ref: element.ref }]
    const { objectIds, expressIds } = await resolveElementRefsToTargets(refs, sceneObjects, ifcHandles)
    if (objectIds.size === 0 && expressIds.size === 0) return
    setSelectedObjectIds(objectIds)
    setSelectedExpressIds(expressIds)
    setSelectedExpressId(null)
    const ifcObjectIds = [...objectIds].filter(id => id.startsWith('ifc-'))
    setActiveIfcModelId(ifcObjectIds.length === 1 ? ifcObjectIds[0] : null)
    setActiveObjectId(objectIds.size === 1 ? [...objectIds][0] : null)
  }

  // Joins each backend SectionBox (keyed by its own model3d_file_id) against
  // whichever currently-loaded SceneObject actually corresponds to that
  // file (keyed by fileId — see model3dFiles.ts wiring) — a box whose
  // target isn't currently loaded is simply left out, since there's
  // nothing to clip (2026-07-09, per Viewport3D.tsx's own ResolvedSectionBox
  // header). An element-scoped box additionally needs its own expressID
  // resolved (sectionBoxElementIds above) before it's usable — left out
  // until then, same as an unloaded target.
  const resolvedSectionBoxes: ResolvedSectionBox[] = sectionBoxes.flatMap(box => {
    const sceneObject = sceneObjects.find(o => o.fileId === box.model3d_file_id)
    if (!sceneObject) return []
    if (box.element_ref !== null && sectionBoxElementIds[box.id] === undefined) return []
    const bounds = draggingSectionBox?.id === box.id ? draggingSectionBox.bounds : box
    const rotation = draggingSectionBoxRotation?.id === box.id
      ? draggingSectionBoxRotation.rotation
      : { rot_x: box.rot_x, rot_y: box.rot_y, rot_z: box.rot_z }
    return [{
      id: box.id, sceneObjectId: sceneObject.id, active: box.active, visible: box.visible, bounds, rotation,
      elementExpressId: box.element_ref !== null ? sectionBoxElementIds[box.id] : undefined,
    }]
  })

  // Which loaded IFC model IfcDataPanel.tsx is currently showing the
  // spatial tree/Object Information for — a real UI decision now that more
  // than one can be loaded at once (mirrors MeshDataPanel.tsx's own
  // already-multi-item list, just with one "expanded" model at a time
  // instead of every model's tree rendered simultaneously). Set on import,
  // and whenever a click resolves a sub-element belonging to a different
  // model (see handleSelectExpressId below).
  const [activeIfcModelId, setActiveIfcModelId] = useState<string | null>(null)
  const [selectedExpressId, setSelectedExpressId] = useState<number | null>(null)
  // Bumped after every model-wide materializeAll call, wherever it happens
  // (2026-07-22) — see Viewport3D's own materializeVersion prop header for
  // the full "Select All leaves the whole model stuck fully visible" story.
  // Owned here, not inside Viewport3D, because materializeAll has call
  // sites outside that component too (the section box multi-select bounds
  // and Select Linked (material) handlers just below) that need the exact
  // same TimelinePlayback re-derive trigger.
  const [materializeVersion, setMaterializeVersion] = useState(0)
  // Multi-select *within* the IFC hierarchy (2026-07-08, per Maro: "i meant
  // multi selector in the hierarchy not the overall file format which has no
  // breakdown anyway") — the object-level selectedObjectIds further below is
  // a different, coarser thing (whole top-level imports, of which an IFC
  // model is only ever one entry); this is sub-element multi-select within
  // that one model's own Project Overview tree. selectedExpressId above
  // stays the single "primary" one (Object Information panel, the specific
  // blue tint) — this is the full set, for isolate/viewport highlighting.
  const [selectedExpressIds, setSelectedExpressIds] = useState<Set<number>>(new Set())
  // Whole-object selection for the Transform panel/gizmo (2026-07-11, per
  // Maro) — distinct from selectedExpressId above (an IFC sub-element,
  // shown in the IFC Data tab); see Viewport3D.tsx's handleClick for how a
  // single click resolves both at once.
  const [activeObjectId, setActiveObjectId] = useState<string | null>(null)
  // Blender-style object-mode multi-select (2026-07-08, per Maro: "select
  // all, do select box in viewport, multi individual select... checkbox to
  // multi select as well") — activeObjectId above stays the single "active"
  // object (what TransformPanel/the gizmo edit, matching Blender's own
  // active-vs-selected distinction), selectedObjectIds is the full set for
  // viewport highlighting and any future bulk actions. Always kept a
  // superset containing activeObjectId whenever activeObjectId is set — see
  // handleSelectObject below for how they're kept in sync.
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(new Set())
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate')
  // Local/Global (2026-07-22) — see TransformPanel.tsx's own Props header
  // for space's doc comment. Defaults to 'world' since that's three.js's
  // own TransformControls default, unchanged for every object until
  // someone actually sets a Pivot Rotation and switches this deliberately.
  const [gizmoSpace, setGizmoSpace] = useState<GizmoSpace>('world')
  // "Edit Pivot" (2026-07-23, per Maro: "i want a gizmo for the pivot
  // manipulations not just for the mesh") — see TransformPanel.tsx's own
  // Props header. Same plain-interaction-toggle convention as gizmoSpace/
  // snapToSurface just above/below.
  const [editPivot, setEditPivot] = useState(false)
  // "Snap to Surface" (2026-07-23) — see TransformPanel.tsx's own Props
  // header. A plain interaction toggle, not object data — deliberately
  // not persisted anywhere (same as gizmoMode/gizmoSpace above), since
  // it describes how *dragging* behaves right now, not a fact about
  // whatever's currently selected.
  const [snapToSurface, setSnapToSurface] = useState(false)
  // "Pick in Viewport" for Set Pivot (2026-07-12) — arms the same
  // PathAddPointCatcher raycast-then-ground-plane-fallback Paths/
  // Annotations already reuse verbatim (Viewport3D.tsx), just for a third
  // purpose. Turned off automatically the moment a point lands
  // (handleSetPivotPoint below), same one-shot behaviour as Annotation
  // placement, not Path's own continuous multi-point mode.
  const [pivotPicking, setPivotPicking] = useState(false)
  // Bumped by Viewport3D's TransformControls onChange (fires continuously
  // while dragging) purely to force a re-render — PropertiesPanel.tsx's
  // TransformPanel section reads live values straight off the dragged
  // THREE.Object3D each render, this is just the "please re-read it" signal
  // (2026-07-11 — lifted up here from a Viewport3D-local state once the
  // Transform panel moved out to a PropertiesPanel sibling, per Maro).
  const [, setTransformTick] = useState(0)
  // Debounced transform persistence (2026-07-11) — see
  // pendingTransformSaveRef's own declaration further down, right after
  // activeTransformObject/isElementTransform/activeIfcHandle are derived
  // (persistActiveTransform needs all three, so it's defined there, not
  // here — this ref just needs to exist before that point).
  const pendingTransformSaveRef = useRef<{ timeout: ReturnType<typeof setTimeout>; flush: () => void } | null>(null)
  // "Fix these incessant warnings" (2026-07-28, per Maro) — once a scene
  // object's underlying file is confirmed genuinely gone server-side (self-
  // heal-by-name in persistActiveTransform/persistSiblingTransform/
  // performUnloadElements below all found nothing, not even a namesake
  // re-import to recover onto), every further interaction with that same
  // object — another drag, another Unload Selected — used to re-attempt
  // the exact same doomed save and re-report the exact same failure, over
  // and over, for as long as that object stayed selected/being edited.
  // Marking its id here once, checked at the top of all three save paths,
  // means the error surfaces exactly once per object per session instead
  // of on every single subsequent edit — re-importing the file creates a
  // brand-new scene object with a brand-new id, so this never blocks a
  // real fix, only repeat noise for the same still-broken one.
  const brokenModelObjectIdsRef = useRef<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  // "Show a percentage save" (2026-07-28, per Maro) — a real byte-count
  // percentage per in-flight upload (persistModelFile's own onProgress
  // callback, model3dFiles.ts's uploadModel3DFile), keyed by scene object
  // id since more than one can be uploading at once (the concurrency-
  // capped queue above). Replaces the old plain "⏳ Saving N models…"
  // count, which said nothing about how far along any of them actually
  // were.
  const [uploadProgress, setUploadProgress] = useState<Map<string, { name: string; percent: number }>>(new Map())
  // A list, not a single string (2026-07-28, per Maro: "on refresh some 3d
  // and ifc dont return" — a 39-file batch import chains every file's own
  // handleImport3D through importQueueRef in a tight sequence now (see its
  // own multi-file-batch header), and each one's own setImportError(null)
  // at the top of that function was silently wiping out whatever error the
  // PREVIOUS file in the same batch had just reported the instant the next
  // one started — so if file #5 of 39 failed to upload, and files #6-39
  // succeeded, only ever the last thing set — usually nothing — survived
  // to be seen. The actual failure only surfaced later, confusingly, as a
  // "couldn't save the last edit" error when the user tried to move the
  // one object whose upload had genuinely never landed. Every import/save
  // failure now gets appended, not overwritten, and stays until explicitly
  // dismissed — the restore-on-load path already did its own version of
  // this (joining multiple restore failures with '\n' into one string);
  // this generalizes that same fix to every other setImportError call site
  // as a real list instead.
  const [importErrors, setImportErrors] = useState<string[]>([])
  // Deduped by exact message (2026-07-28, per Maro — a broken object (its
  // upload genuinely never landed server-side) reports the identical
  // "couldn't save the last edit" failure every time a save is retried
  // against it — every debounced sibling-transform save during a drag, for
  // instance — which used to flood this list with the same line six-plus
  // times over instead of surfacing it once. Same underlying failure
  // shouldn't grow the list just because it was hit again.
  const addImportError = (message: string) => setImportErrors(prev => (prev.includes(message) ? prev : [...prev, message]))
  // Re-importing the same file name is the user's own explicit "try again"
  // in response to a prior save-issue message (both persistModelFile's own
  // "failed to save to the server" and the animation-bake warning embed the
  // file name in quotes) — without this, a genuinely successful re-import
  // still left the old failure sitting in the badge forever, since nothing
  // ever cleared importErrors except a manual dismiss (2026-07-29, per Maro:
  // "save issue persists... even if i reimport same [file]"). Matched by
  // substring against the quoted name rather than a stored id/index, since
  // that's the only thing every one of these messages already reliably
  // carries in common.
  const clearImportErrorsForFile = (fileName: string) =>
    setImportErrors(prev => prev.filter(msg => !msg.includes(`"${fileName}"`)))
  const importInputRef = useRef<HTMLInputElement>(null)
  // Combined "Import Model" flow (2026-07-08, per Maro: "combine the two
  // import widgets to one... after selecting the model and its type, there
  // should be an option to set its axis transformations") — one file picker
  // covering both kinds' extensions. Originally showed ImportModelDialog for
  // every kind; IFC now skips it entirely (2026-07-17, per Maro: "upon
  // import of ifc remove ability to rename and the axis... use y axis as
  // default" — see handleFileSelected's own header) since this queue is
  // mesh-only these days — GLTF/OBJ/FBX axis convention genuinely varies
  // file-to-file, unlike IFC.
  // A queue of BATCHES, not a queue of files (2026-07-28, per Maro: "i said
  // i didnt want this?" — a 39-file mesh selection was showing the confirm
  // dialog 39 times in a row, "38 more queued" ticking down one file at a
  // time; every one of those confirms would've picked the identical Up
  // Axis anyway. One whole multi-select is now one dialog: confirming it
  // applies that single axis choice, and includeAnimation=false, to every
  // file in the batch at once. A single-file pick is just a batch of one —
  // same dialog, still gets the full per-file axis + animation choice
  // (isMultiFile below is false for it). This predates a 2026-07-17 fix
  // (per Maro: "allow me to bulk import ifc files not one by one") for the
  // same underlying multi-select-picker mechanism.
  const [pendingImports, setPendingImports] = useState<File[][]>([])

  const handleFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    // IFC files skip the confirm dialog entirely (2026-07-17, per Maro:
    // "upon import of ifc remove ability to rename and the axis... use y
    // axis as default") — real IFC filenames (e.g. "Snowdon Towers Sample
    // Architectural.ifc") are already a fine identity as-is, and 'y' is
    // already this app's own default guess for IFC (see
    // defaultSourceUpAxis's own header on why IFC's spec'd Z-up default
    // turned out wrong against every real test file tried), so a
    // per-file dialog was pure friction with nothing left worth
    // overriding. Still funnelled through importQueueRef (not called
    // directly) — see that ref's own header on why IFC parses must stay
    // strictly serialized against the shared WASM instance regardless of
    // how the import was triggered. Mesh imports (GLTF/OBJ/FBX) keep the
    // dialog — axis convention genuinely varies file-to-file for those,
    // unlike IFC (see ImportModelDialog.tsx's own header).
    // Reality Captures — point cloud (.xyz) and textured OBJ (.obj + its
    // .mtl + referenced textures) detection (2026-08-20) — pulled out of
    // this selection *before* the ifc/mesh split below, since neither
    // fits that split's own two buckets (a point cloud isn't parseable by
    // loadModel3DFile at all; a MatterPak's .mtl/.jpg files aren't
    // independently importable 3D files the way the existing multi-select
    // batch assumes every remaining file is). .xyz and .e57 both land here
    // — .e57 just uploads raw and stops there (see handleImportPointCloud's
    // own header on why it doesn't parse an .e57 client-side).
    const pointCloudFiles = files.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      return ext === 'xyz' || ext === 'e57'
    })
    for (const file of pointCloudFiles) {
      importQueueRef.current = importQueueRef.current.then(() => handleImportPointCloud(file))
    }
    const objFiles = files.filter(file => file.name.split('.').pop()?.toLowerCase() === 'obj')
    const consumedForObj = new Set<File>(pointCloudFiles)
    for (const objFile of objFiles) {
      const base = objFile.name.slice(0, -('.obj'.length))
      const mtlFile = files.find(f => f !== objFile && f.name === `${base}.mtl`)
      if (!mtlFile) continue // a lone .obj with no matching .mtl falls through to the normal (untextured) mesh path below, unchanged
      const textureFiles = files.filter(f => f !== objFile && f !== mtlFile && /\.(jpe?g|png)$/i.test(f.name))
      consumedForObj.add(objFile).add(mtlFile)
      textureFiles.forEach(f => consumedForObj.add(f))
      importQueueRef.current = importQueueRef.current.then(() => handleImportTexturedObj(objFile, mtlFile, textureFiles))
    }

    const remaining = files.filter(file => !consumedForObj.has(file))
    const ifcFiles = remaining.filter(file => file.name.split('.').pop()?.toLowerCase() === 'ifc')
    const meshFiles = remaining.filter(file => !ifcFiles.includes(file))
    for (const file of ifcFiles) {
      importQueueRef.current = importQueueRef.current.then(
        () => handleImportIfc(file, defaultSourceUpAxis('ifc'), file.name),
      )
    }
    if (meshFiles.length > 0) {
      setPendingImports(prev => [...prev, meshFiles])
    }
  }

  // Uploads a freshly-imported file to the backend so it survives a hard
  // refresh (2026-07-09, per Maro: "keep the models and associated data
  // similar to the persistent data in Schedule. so i dont have to repeat my
  // actions import again"). Used to be fire-and-forget relative to the
  // import itself — the model is usable in the viewport the instant it's
  // parsed locally, well before this finishes — but that's exactly what
  // let large IFC files (100MB+) sit fully loaded and seemingly fine for
  // as long as the tab stayed open, while genuinely never landing server-
  // side (2026-07-28, per Maro, after confirmed data loss: 4 of 5 Hospital
  // IFC files were never actually saved, confirmed via a direct DB check,
  // despite all 5 being fully visible/usable in the live scene). Callers
  // now await this (via enqueueUpload) before considering an import done,
  // so "Importing…" stays visible for the whole real upload, not just the
  // parse. Checks the object is still loaded once the upload resolves
  // before recording its fileId — if it was unloaded in the meantime, the
  // upload only just landed a copy nobody wants, so it's deleted right back
  // off per Maro's explicit "if i unload, i expect the data not to persist"
  // — the alternative (blocking unload on any in-flight upload) would make
  // unload feel laggy for no real benefit.
  const persistModelFile = async (
    id: string, file: File, kind: Model3DKind, sourceUpAxis: UpAxis, name: string, keepRawAnimation = false,
  ) => {
    if (!selectedProject) return
    setUploadProgress(prev => new Map(prev).set(id, { name, percent: 0 }))
    try {
      const saved = await uploadModel3DFile(selectedProject.id, name, kind, sourceUpAxis, file, percent => {
        setUploadProgress(prev => new Map(prev).set(id, { name, percent }))
      }, keepRawAnimation)
      let stillLoaded = false
      setSceneObjects(prev => {
        stillLoaded = prev.some(o => o.id === id)
        return stillLoaded ? prev.map(o => (o.id === id ? { ...o, fileId: saved.id } : o)) : prev
      })
      if (!stillLoaded) deleteModel3DFile(saved.id).catch(() => {})
    } catch (err) {
      // Used to only console.error here (2026-07-11 fix, per a real
      // incident: "imported, translated....gone on refresh" — the upload
      // had actually failed, silently, with zero indication anywhere in
      // the UI; the model displays fine locally regardless, since it's
      // already in the live THREE.js scene before this background persist
      // call even starts, so there was no way to tell "looks fine" apart
      // from "looks fine but isn't actually saved" until the next reload.
      // Surfaced as a real, visible error now, with as much of the actual
      // failure reason as axios can give (HTTP status + backend detail if
      // the request reached the server at all, or the raw network error
      // if it never did) — needed to actually diagnose which one this is,
      // not just know that *something* failed.
      const detail = axios.isAxiosError(err)
        ? (typeof err.response?.data?.detail === 'string'
            ? `${err.response.status}: ${err.response.data.detail}`
            : err.response
              ? `HTTP ${err.response.status}`
              : `Network error: ${err.message}`)
        : err instanceof Error ? err.message : 'Unknown error'
      console.error('Failed to persist imported model — it will not survive a hard refresh', err)
      addImportError(`"${file.name}" imported but failed to save to the server — it will NOT survive a refresh (${detail}). Try again, or check your connection.`)
    } finally {
      setUploadProgress(prev => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next })
    }
  }

  // Re-importing a name/kind that's already loaded removes the old scene
  // object first (2026-07-28, per Maro, after a real incident: re-
  // importing a permanently-broken "2018_Hospital_Electrical.ifc" without
  // unloading the old one first left TWO scene objects with the identical
  // name in the list — the old one, forever fileId: null, and the new one
  // actually uploading. Several self-heal paths elsewhere (persist
  // ActiveTransform/persistSiblingTransform/performUnloadElements) look up
  // "the file with this name" via listModel3DFiles and attach whatever
  // they find to *whichever scene object triggered the save*, with no way
  // to tell the two apart by name alone — so the instant the real upload
  // landed server-side, an unrelated interaction against the OLD, still-
  // broken object could self-heal onto the NEW file's real id, making the
  // wrong object show as saved while the actual new import stayed
  // disconnected. Backend model3d_file.py already treats same name/kind as
  // "this is a re-import, replace it" for the persisted row (create_file's
  // own docstring) — this just makes the *client-side* scene object follow
  // the identical rule, so name+kind stays a genuinely unique key and that
  // whole class of misattachment can't happen at all.
  const unloadExistingNamesake = async (name: string, kind: Model3DKind) => {
    const existing = sceneObjects.find(o => o.name === name && o.kind === kind)
    if (!existing) return
    if (kind === 'ifc') await performUnloadIfc(existing.id)
    else performUnloadMesh(existing.id)
  }

  const handleImport3D = async (file: File, sourceUpAxis: UpAxis, name: string, includeAnimation: boolean = true) => {
    setImporting(true)
    clearImportErrorsForFile(file.name)
    try {
      await unloadExistingNamesake(name, 'mesh')
      const object = await loadModel3DFile(file)
      const id = crypto.randomUUID()
      object.name = name
      object.userData.sceneObjectId = id
      // "Include this file's animation" (ImportModelDialog.tsx) — bakes
      // whatever clip(s) import3d.ts's own parse attached into real, dated
      // ElementKeyframe rows (2026-07-23, per Maro: "we discussed normal 3d
      // animation before, being able to animate the keyframes independent
      // of schedule activities. the same thing" — see
      // embeddedAnimationBake.ts's own header for the full story, including
      // why an earlier always-looping AnimationMixer preview was scrapped
      // in favour of this). Starts "today" at local midnight, one calendar
      // day per clip-second — Maro's own confirmed choice over an explicit
      // start-date/duration dialog.
      //
      // keepRawAnimation (2026-08-22, per Maro's own real Blender particle-
      // VFX export, "Water Spray.glb") — a clip that animates more than
      // one node independently (findSingleAnimatedNode's own multi-node
      // case) can NEVER become keyframes at all, not just "wasn't this
      // time" — this app's ElementKeyframe schema has no way to express a
      // per-particle animation, full stop. Rather than just discard it
      // (the old, only behaviour: object.animations always cleared
      // afterward, baked or not), that specific case now keeps the raw
      // clip on the object for Viewport3D.tsx's own EmbeddedAnimationLoop
      // to play back as an always-looping preview instead — the one case
      // the earlier "always-looping AnimationMixer" design (scrapped
      // above) was actually right for. Every other case (baked
      // successfully, no animation at all, or the checkbox unchecked)
      // still clears object.animations exactly as before, so a single
      // rigid-body import stays fully driven by its own real keyframes,
      // never double-animated by both systems at once.
      let keepRawAnimation = false
      if (includeAnimation && object.animations.length > 0) {
        const startDate = new Date()
        startDate.setHours(0, 0, 0, 0)
        const baked = bakeEmbeddedAnimationToKeyframes(object, settings.upAxis, startDate)
        if (baked === null) {
          keepRawAnimation = true
          addImportError(`"${name}" imported — its animation moves more than one part independently (e.g. a particle effect or a rig), which can't become schedule keyframes, so it's playing back as a raw, always-looping preview instead.`)
        } else {
          for (const kf of baked) await elementKeyframes.upsert('mesh', name, kf.field, kf.date, kf.value)
        }
      }
      if (!keepRawAnimation) object.animations = []
      setSceneObjects(prev => [...prev, { id, name, kind: 'mesh', sourceUpAxis, object, fileId: null }])
      setDataTab('3d')
      await enqueueUpload(() => persistModelFile(id, file, 'mesh', sourceUpAxis, name, keepRawAnimation))
    } catch (err) {
      addImportError(err instanceof Error ? err.message : 'Failed to import 3D file')
    } finally {
      setImporting(false)
    }
  }

  // Reality Captures — dragging/picking a .xyz or .e57 straight into the
  // "Import 3D" flow (2026-08-20) now persists it as a real SiteCapture
  // (site_capture.py's backend, siteCaptures.ts), same as uploading via
  // the Progress Variance panel's own "+ Upload Scan" — a second entry
  // point to the identical result, not a second behaviour, so a scan
  // dropped in here doesn't silently disappear on refresh the way it did
  // before that backend existed (Maro's own "how do i use" prompted the
  // very first, genuinely session-only version of this). captured_at
  // defaults to today (the import date) — rename/re-date via the panel if
  // the scan is actually from an earlier site visit.
  //
  // .xyz gets the immediate parse+preview+cache treatment (safe — that's
  // exactly the format/scale this app's streaming parser was built for).
  // .e57 does NOT (2026-08-20, per Maro's own real 14.4GB, 105-scan
  // export) — it just uploads the raw bytes and stops there; converting
  // it into something loadable happens server-side, explicitly, via the
  // Progress Variance panel's own "Convert" button (site_capture.py's
  // POST .../convert) — see that endpoint's own header for why that
  // conversion has no safe way to happen in a browser tab at this scale.
  const handleImportPointCloud = async (file: File) => {
    if (!selectedProject) return
    setImporting(true)
    clearImportErrorsForFile(file.name)
    try {
      const name = file.name
      const kind: SiteCaptureKind = name.toLowerCase().endsWith('.e57') ? 'e57' : 'xyz'
      const sourceUpAxis = defaultSourceUpAxis('mesh')
      const capturedAt = new Date().toISOString().slice(0, 10)

      if (kind === 'e57') {
        const capture = await uploadSiteCapture(selectedProject.id, name, capturedAt, kind, sourceUpAxis, file)
        setSiteCaptures(prev => [...prev, capture])
        addImportError(`"${name}" uploaded as a raw Site Capture dated today — open the Point Cloud panel and click "Convert" before it can be loaded in the viewport (can take several minutes for a large scan).`)
        return
      }

      await unloadExistingNamesake(name, 'mesh')
      const cloud = await parseXyzFile(file)
      const capture = await uploadSiteCapture(selectedProject.id, name, capturedAt, kind, sourceUpAxis, file)
      setSiteCaptures(prev => [...prev, capture])
      setCachedPointCloud(capture.id, cloud)
      const object = createPointCloudObject(cloud)
      const id = crypto.randomUUID()
      object.name = name
      object.userData.sceneObjectId = id
      object.userData.siteCaptureId = capture.id
      setSceneObjects(prev => [...prev, { id, name, kind: 'mesh', sourceUpAxis, object, fileId: null }])
      setCaptureSceneObjectIds(prev => ({ ...prev, [capture.id]: id }))
      setDataTab('3d')
      addImportError(`"${name}" (${cloud.count.toLocaleString()} points) imported and saved as a Site Capture dated today — open the Point Cloud panel to rename/re-date it or run a variance test against it.`)
    } catch (err) {
      addImportError(err instanceof Error ? err.message : 'Failed to import point cloud')
    } finally {
      setImporting(false)
    }
  }

  // Unlike handleImportPointCloud just above, Part A's textured OBJ+MTL+
  // texture set still has no backend of its own (site_capture.py's
  // SiteCapture holds a single file — the .xyz point cloud — see that
  // model's own docstring on why: it's the precision source variance
  // testing needs, where this decimated, photographic mesh is a quick
  // visual overlay only) — deliberately still session-only, same "fileId
  // stays null, won't survive a refresh" fallback path.
  const handleImportTexturedObj = async (objFile: File, mtlFile: File, textureFiles: File[]) => {
    setImporting(true)
    clearImportErrorsForFile(objFile.name)
    try {
      const name = objFile.name
      await unloadExistingNamesake(name, 'mesh')
      const object = await loadTexturedObj(objFile, mtlFile, textureFiles)
      const id = crypto.randomUUID()
      object.name = name
      object.userData.sceneObjectId = id
      setSceneObjects(prev => [...prev, { id, name, kind: 'mesh', sourceUpAxis: defaultSourceUpAxis('mesh'), object, fileId: null }])
      setDataTab('3d')
      addImportError(`Note: "${name}" is a live preview only — Reality Capture storage isn't built yet, so this won't survive a page refresh.`)
    } catch (err) {
      addImportError(err instanceof Error ? err.message : 'Failed to import textured OBJ')
    } finally {
      setImporting(false)
    }
  }

  const handleImportIfc = async (file: File, sourceUpAxis: UpAxis, name: string) => {
    setImporting(true)
    clearImportErrorsForFile(file.name)
    try {
      await unloadExistingNamesake(name, 'ifc')
      const { loadIfcModel } = await import('./ifcModel')
      const handle = await loadIfcModel(file)
      const id = `ifc-${handle.modelID}`
      handle.object.name = name
      handle.object.userData.sceneObjectId = id
      setIfcHandles(prev => [...prev, handle])
      setActiveIfcModelId(id)
      setSelectedExpressId(null)
      setSelectedExpressIds(new Set())
      setSceneObjects(prev => [...prev, { id, name, kind: 'ifc', sourceUpAxis, object: handle.object, fileId: null }])
      setDataTab('ifc')
      await enqueueUpload(() => persistModelFile(id, file, 'ifc', sourceUpAxis, name))
    } catch (err) {
      addImportError(err instanceof Error ? err.message : 'Failed to import IFC file — see console for detail')
      console.error(err)
    } finally {
      setImporting(false)
    }
  }

  // Chained, not fire-and-forget (2026-07-17, per Maro's bulk-import
  // request) — the dialog queue below advances the instant each file is
  // confirmed, so a user breezing through 6 confirms back-to-back could
  // otherwise trigger 6 truly-overlapping loadIfcModel() calls into
  // ifcModel.ts's single shared web-ifc WASM instance (getApi()), which has
  // no prior art in this codebase for concurrent OpenModel/LoadAllGeometry
  // calls — same reasoning as the restore-on-reload fix just above. This
  // ref is a promise chain acting as a mutex: each confirmed import is
  // appended to run only after the previous one has fully finished
  // (success or failure), so actual parsing stays strictly one-at-a-time no
  // matter how fast the confirm clicks come in — only the review dialog
  // itself (name/axis, no WASM involved) is instant per file.
  const importQueueRef = useRef<Promise<void>>(Promise.resolve())

  // Caps how many persistModelFile uploads run at once (2026-07-28, per
  // Maro: "the warning doesnt persist" — a 39-file batch import used to
  // fire all 39 uploads simultaneously (persistModelFile is deliberately
  // fire-and-forget relative to import itself — see its own header — but
  // that was always one file at a time before batch import existed). A
  // thundering herd of that many concurrent large uploads can genuinely
  // overwhelm the browser's own per-origin connection limit or the
  // backend, causing some to fail from overload rather than from any
  // refresh at all — indistinguishable from the "you closed the tab mid-
  // upload" case this whole mechanism exists to warn about, and it made
  // the "⏳ Saving N models…" counter collapse almost immediately (most
  // finishing together) instead of counting down meaningfully while a
  // batch was genuinely still in flight. Capped at 3 concurrent uploads;
  // the rest queue and start as slots free up.
  const MAX_CONCURRENT_UPLOADS = 3
  const uploadQueueRef = useRef<(() => Promise<void>)[]>([])
  const activeUploadsRef = useRef(0)
  const runNextUpload = () => {
    if (activeUploadsRef.current >= MAX_CONCURRENT_UPLOADS) return
    const next = uploadQueueRef.current.shift()
    if (!next) return
    activeUploadsRef.current++
    next().finally(() => {
      activeUploadsRef.current--
      runNextUpload()
    })
  }
  // Returns a promise that resolves only once the upload has genuinely
  // finished (2026-07-28, per Maro, after confirmed data loss: 4 of 5
  // Hospital IFC files never actually persisted — direct DB check found
  // only 1 real row — while all 5 sat fully loaded and usable in the live
  // scene). handleImport3D/handleImportIfc now await this instead of
  // firing it and moving on immediately, so "Importing…" stays visible for
  // the real upload duration too, not just the parse — by the time it
  // clears, the file is actually saved, not "probably saved by now."
  // Trades some throughput on a big batch import for the one guarantee
  // that actually matters here: nothing you can already see in the
  // viewport is secretly still unsaved behind your back.
  const enqueueUpload = (task: () => Promise<void>): Promise<void> => {
    return new Promise((resolve, reject) => {
      uploadQueueRef.current.push(() => task().then(resolve, reject))
      runNextUpload()
    })
  }

  // Mesh-only now (2026-07-17) — IFC files bypass this dialog entirely,
  // see handleFileSelected's own header. One confirm applies sourceUpAxis
  // (and includeAnimation, always false for a real multi-file batch — see
  // ImportModelDialog's own header) to every file in the batch at once
  // (2026-07-28) — not just pendingImports[0] itself.
  const handleConfirmImport = (sourceUpAxis: UpAxis, includeAnimation: boolean) => {
    const batch = pendingImports[0]
    if (!batch) return
    setPendingImports(prev => prev.slice(1))
    for (const file of batch) {
      importQueueRef.current = importQueueRef.current.then(() => handleImport3D(file, sourceUpAxis, file.name, includeAnimation))
    }
  }

  // Restores every persisted model on load (2026-07-09, per Maro: "if i hard
  // refresh please keep the models and associated data similar to the
  // persistent data in Schedule. so i dont have to repeat my actions import
  // again") — downloads each Model3DFile's stored bytes and feeds them back
  // through the exact same loaders a fresh import uses, so a restored model
  // ends up in an identical state (baseline transform captured, original
  // materials captured, etc.) to one the user just imported by hand.
  // Deliberately does *not* call persistModelFile — these files already
  // exist server-side, re-uploading would just duplicate storage — instead
  // wires fileId straight from the listing response so handleUnloadIfc/
  // handleUnloadMesh can still delete it later.
  //
  // Runs once per project (PersistentFourD keeps this component mounted for
  // the whole session, per this component's own header comment on `active`
  // — a hard refresh is the only thing that actually re-triggers this).
  // Sequential (`for` + `await`), not Promise.all, so one failed/corrupt
  // file can't take the rest of the restore down with it — each is wrapped
  // in its own try/catch.
  // Manual position/rotation/scale edits (2026-07-11, per a real incident:
  // confirmed via a full audit that this had never been persisted anywhere
  // — no DB column, no update endpoint — so every gizmo drag/Properties-
  // panel edit was silently thrown away on every reload). Fetched here
  // alongside the models themselves (not a separate effect) so the restore
  // loop below can apply each one to its freshly-loaded object/element in
  // the same pass, using the local `transforms` array directly rather than
  // the `elementTransforms` state (which wouldn't be populated yet inside
  // this same async run due to React's own state-update timing).
  // A ref, not state — nothing renders based on this list directly (unlike
  // e.g. customTextures, which affects materials every render), it only
  // ever needs to be read at save-time (to dedupe an upsert into the local
  // cache) and at restore-time, so there's no reason to trigger a
  // re-render every time it changes.
  const elementTransformsRef = useRef<ElementTransform[]>([])

  // Guards against this effect's restore work actually running twice for
  // the same project (2026-07-20, real symptom: the same single persisted
  // IFC file loading 4 separate times, each handle appearing one after
  // another as its own slow parse finished — "IFC Data (4)" for one saved
  // file). React 18 StrictMode (enabled in main.tsx, deliberately, to catch
  // exactly this class of bug) double-invokes every effect in development —
  // run, cleanup, run again — and this effect's own cleanup only sets
  // `cancelled`, which the loop below only checks *between* files, not
  // while one file's load is already in flight; a file whose restore had
  // already started past that check when cleanup fired still finishes and
  // gets pushed into state, so the second (real) invocation restoring
  // everything again duplicates it. A ref (not state — this must be set
  // synchronously, before the first `await`, and refs alone survive
  // StrictMode's cleanup/remount within the same true mount) makes every
  // invocation past the first a no-op for this project, however many times
  // React happens to fire it.
  const restoreStartedForProjectIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    if (restoreStartedForProjectIdRef.current === selectedProject.id) return
    restoreStartedForProjectIdRef.current = selectedProject.id
    // Checked at every yield point below instead of a plain per-invocation
    // `cancelled` boolean (2026-07-21 fix, per Maro: "the ifc model has
    // disappeared again" — a real, silent regression from the ref-guard
    // above, added 2026-07-20 to stop React 18 StrictMode's dev-only
    // mount->cleanup->mount double-invoke from restoring the same file
    // twice. StrictMode's cleanup still fires for the *first* invocation
    // exactly as before, and a plain `cancelled` flag closed over that
    // first invocation still flips true on that cleanup — but now the
    // ref-guard also stops the *second* invocation (the one StrictMode
    // intends to keep) from ever starting its own run at all, since the
    // ref was already claimed. Net effect: every restore's real work
    // belonged to the one invocation StrictMode was about to cancel, and
    // nothing else was left to pick it up — models loaded, but every
    // setIfcHandles/setSceneObjects call after the next `cancelled` check
    // silently no-opped, so the viewport simply never showed them.
    // Reading the ref's own current value instead of a closed-over
    // boolean survives that exact double-invoke transparently (this run's
    // project id is still what the ref holds, so every check below keeps
    // passing) while still correctly stopping stale work the moment a
    // genuinely different project's own restore effect claims the ref.
    const projectIdForThisRestore = selectedProject.id
    const stale = () => restoreStartedForProjectIdRef.current !== projectIdForThisRestore
    ;(async () => {
      // Clears every previous project's own 3D scene state before this
      // (possibly new) project's own restore runs below (2026-07-28, per
      // Maro: "fix the root cause i only imported some glb objects" — a
      // Hospital IFC dataset from a completely different, earlier-viewed
      // project was still sitting in sceneObjects/ifcHandles, still
      // rendered and interactive, its fileId now meaningless to whatever
      // project is actually selected. FourD.tsx stays mounted across a
      // project switch (PersistentFourD, see this effect's own header) and
      // nothing ever reset these — a switch away and back just kept
      // appending the new project's own files on top of the old one's,
      // forever, for the life of the tab). Harmless on a project's first-
      // ever activation too (everything's already empty then).
      setSceneObjects([])
      setIfcHandles([])
      setActiveIfcModelId(null)
      setSelectedExpressId(null)
      setSelectedExpressIds(new Set())
      setActiveObjectId(null)
      setSelectedObjectIds(new Set())
      setHiddenExpressIds(new Set())
      setIsolatedExpressIds(new Set())
      setUnloadedElementsByFileId(new Map())
      brokenModelObjectIdsRef.current.clear()
      // Reset first (2026-07-19), before any model for this (possibly new)
      // project gets restored/loaded below — see ifcModel.ts's own
      // sharedRecenterOffset/resetRecenterOffset header for why a project
      // switch specifically needs this: without it, a second project's own
      // first file would silently reuse whichever unrelated site
      // coordinates the previous project's own offset happened to be.
      const { resetRecenterOffset } = await import('./ifcModel')
      resetRecenterOffset()
      let listFailure: unknown = null
      const [files, transforms] = await Promise.all([
        listModel3DFiles(selectedProject.id).catch(err => { listFailure = err; return [] }),
        listElementTransforms(selectedProject.id).catch(err => { listFailure ??= err; return [] }),
      ])
      if (stale()) return
      // "Unload Selected"/"Reload IFC" (2026-07-26) — seeded here so
      // performUnloadElements/the "Reload IFC" dialog have this file's
      // already-unloaded elements without a second round-trip; each file's
      // own persisted removals get re-applied to its handle right after
      // loadIfcModel below.
      setUnloadedElementsByFileId(new Map(files.map(f => [f.id, f.unloaded_elements ?? []])))
      // Distinguishes "you genuinely have no saved models" from "the
      // request to check failed" (2026-07-11) — these two used to look
      // identical (both landed on an empty `files` array), which is
      // exactly how a real 401/403 on refresh read as "no model loaded"
      // with no error anywhere, even after the try/catch below got its own
      // visible-error fix — there was nothing left in that loop to fail.
      // Includes the real status/detail (not just a generic message) —
      // the first version of this fix used a static string, which meant
      // reproducing the bug again told us nothing new we didn't already
      // know (2026-07-11, per Maro pasting back the exact static text).
      if (listFailure) {
        console.error('Failed to list persisted models/transforms', listFailure)
        addImportError(`Failed to check for your saved models (${sectionBoxErrorMessage(listFailure, 'unknown error')}) — try refreshing again. If this keeps happening, try signing out and back in.`)
      }
      elementTransformsRef.current = transforms

      const applyTransform = applyElementTransform

      // Downloads are kicked off for every file up front, in parallel
      // (2026-07-17, per Maro: "only loaded 3 out of 6 ifc files" on
      // reload — this used to await each file's network download AND its
      // web-ifc parse, one whole file at a time, before even starting the
      // next file's download; for 6 real building-scale IFC files that's
      // 6x the network latency stacked up serially before the last file's
      // parse even begins). The actual web-ifc parse below (OpenModel/
      // LoadAllGeometry) stays sequential, one file at a time — those run
      // against the single shared IfcAPI WASM instance (getApi(), same
      // module), and unlike a plain fetch there's no prior art in this
      // codebase for calling into it from more than one file's load at
      // once, so this only overlaps the safe, side-effect-free part
      // (pure network I/O) rather than gambling on WASM concurrency it's
      // never been exercised under.
      const downloads = files.map(file => downloadModel3DFile(file.id).then(
        blob => ({ file, blob, error: null as unknown }),
        error => ({ file, blob: null as Blob | null, error }),
      ))

      // Every restore failure gets its own entry in importErrors instead of
      // overwriting the last one (silently losing files was impossible to
      // diagnose because only the LAST failure ever survived).
      const reportRestoreFailure = addImportError

      for (const download of downloads) {
        if (stale()) return
        const { file, blob, error: downloadError } = await download
        if (downloadError) {
          console.error(`Failed to download persisted model "${file.name}"`, downloadError)
          const detail = downloadError instanceof Error ? downloadError.message : String(downloadError)
          reportRestoreFailure(`"${file.name}" was saved but failed to download on reload (${detail}).`)
          continue
        }
        try {
          const restoredFile = new File([blob as Blob], file.name)
          const wholeFileTransform = transforms.find(t => t.model3d_file_id === file.id && t.element_ref === null)
          if (file.kind === 'ifc') {
            const { loadIfcModel } = await import('./ifcModel')
            const handle = await loadIfcModel(restoredFile)
            if (stale()) { const { disposeIfcModel } = await import('./ifcModel'); disposeIfcModel(handle); return }
            applyTransform(handle.object, wholeFileTransform)
            // Element-scoped transforms (2026-07-11) — a specific IFC
            // sub-element repositioned independently of its parent model,
            // matching how TransformPanel/the gizmo already resolve a
            // specific selected sub-element as the edit target (see
            // Viewport3D.tsx's own activeObject derivation).
            const elementTransforms_ = transforms.filter(t => t.model3d_file_id === file.id && t.element_ref !== null)
            if (elementTransforms_.length > 0) {
              const { getExpressIdFromGuid } = await import('./ifcModel')
              const byExpressId = new Map<number, ElementTransform>()
              for (const t of elementTransforms_) {
                const expressId = getExpressIdFromGuid(handle, t.element_ref as string)
                if (expressId !== undefined) byExpressId.set(expressId, t)
              }
              if (byExpressId.size > 0) {
                handle.object.traverse(child => {
                  const t = byExpressId.get(child.userData.expressID)
                  if (t) applyTransform(child, t)
                })
              }
            }
            // "Unload Selected"/"Reload IFC" (2026-07-26, per Maro: "if i
            // refresh, i expect the elements i unloaded to stay unloaded")
            // — re-applies this file's own persisted removals to the fresh
            // handle before it's ever shown, the same getExpressIdFromGuid
            // resolution elementTransforms_ just above already uses (a
            // GUID that no longer resolves — the file changed since — is
            // silently skipped, not an error: there's nothing left to
            // remove).
            const persistedUnloaded = file.unloaded_elements ?? []
            if (persistedUnloaded.length > 0) {
              const { getExpressIdFromGuid } = await import('./ifcModel')
              const unloadedExpressIds = persistedUnloaded
                .map(e => getExpressIdFromGuid(handle, e.guid))
                .filter((expressId): expressId is number => expressId !== undefined)
              if (unloadedExpressIds.length > 0) removeElementsFromModel(handle.object, unloadedExpressIds)
            }
            const id = `ifc-${handle.modelID}`
            handle.object.userData.sceneObjectId = id
            setIfcHandles(prev => [...prev, handle])
            setSceneObjects(prev => [...prev, {
              id, name: file.name, kind: 'ifc', sourceUpAxis: file.source_up_axis, object: handle.object, fileId: file.id,
            }])
          } else {
            const object = await loadModel3DFile(restoredFile)
            if (stale()) return
            applyTransform(object, wholeFileTransform)
            // Any embedded clip was already baked into real ElementKeyframe
            // rows once, at original import time (handleImport3D's own
            // header) — those persisted rows come back on their own via
            // useElementKeyframes' own fetch, so re-parsing the raw file
            // here must not re-bake (would duplicate keyframes dated from
            // today instead of the original import day) or leave a stray
            // live clip sitting unused on the restored object.
            //
            // EXCEPT when file.keep_raw_animation is set (2026-08-22, per
            // Maro's own real Blender particle-VFX export) — that clip was
            // never baked in the first place (it can't be — see
            // Model3DFile.keep_raw_animation's own docstring), so there are
            // no keyframes coming back to replace it with. Keeping it here
            // is what lets Viewport3D.tsx's EmbeddedAnimationLoop still
            // have something to play after a refresh, not just right after
            // the original import.
            if (!file.keep_raw_animation) object.animations = []
            const id = crypto.randomUUID()
            object.name = file.name
            object.userData.sceneObjectId = id
            setSceneObjects(prev => [...prev, {
              id, name: file.name, kind: 'mesh', sourceUpAxis: file.source_up_axis, object, fileId: file.id,
            }])
          }
        } catch (err) {
          // Same silent-failure gap as persistModelFile's own 2026-07-11 fix
          // (see its comment) — this loop's try/catch kept one bad file from
          // taking the rest of the restore down, which is right, but the
          // catch itself only ever logged to a console nobody watches. A
          // real building IFC file is parsed by web-ifc for the very first
          // time right here, client-side — none of this session's backend
          // tests exercise real IFC parsing at all (they post placeholder
          // bytes the server never opens), so a parse failure specific to a
          // real file could only ever have shown up here, and never did.
          console.error(`Failed to restore persisted model "${file.name}"`, err)
          const detail = err instanceof Error ? err.message : String(err)
          reportRestoreFailure(`"${file.name}" was saved but failed to restore on reload (${detail}).`)
        }
      }
    })()
    // No cleanup here (2026-07-21) — see stale()'s own header just above:
    // restoreStartedForProjectIdRef is the real guard against both stale
    // work (a later project switch) and StrictMode's double-invoke (a
    // same-project remount), so there's nothing left for an unmount
    // cleanup to correctly do — a plain `cancelled = true` here is exactly
    // the bug this fix removes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id, hasEverBeenActive])

  // Unloads one specific IFC model, by its scene-object id (2026-07-09 —
  // now that more than one can be loaded at once, "unload" has to say
  // *which*; previously this always meant "the" single global handle).
  // Renamed from handleUnloadIfc — requestUnloadModel below is what
  // DataPanel actually calls now, this is just the part that does the
  // disposal once a decision about any attached links/keyframes is made.
  const performUnloadIfc = async (id: string) => {
    const handle = ifcHandles.find(h => `ifc-${h.modelID}` === id)
    if (!handle) return
    const { disposeIfcModel } = await import('./ifcModel')
    disposeIfcModel(handle)
    setIfcHandles(prev => prev.filter(h => h !== handle))
    // Per Maro's explicit follow-up: "ofcourse if i unload, i expect the
    // data not to persist so you dont endlessly store unneccessary data" —
    // no fileId yet means the upload is still in flight; persistModelFile's
    // own post-upload check cleans that case up once it lands instead.
    const fileId = sceneObjects.find(o => o.id === id)?.fileId
    if (fileId) deleteModel3DFile(fileId).catch(() => {})
    setSceneObjects(prev => prev.filter(o => o.id !== id))
    setActiveIfcModelId(prev => (prev === id ? (ifcHandles.find(h => h !== handle) ? `ifc-${ifcHandles.find(h => h !== handle)!.modelID}` : null) : prev))
    if (activeIfcModelId === id) {
      setSelectedExpressId(null)
      setSelectedExpressIds(new Set())
    }
    setActiveObjectId(prev => (prev === id ? null : prev))
    setSelectedObjectIds(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next })
  }

  // Plain click: replace the selection with just this one. Ctrl/Cmd+click
  // (2026-07-08, per Maro: "multi individual select (maybe hold control and
  // click)"): toggle membership, last-toggled-on becomes the new active
  // object — same convention Blender uses for ctrl/shift-click.
  //
  // Shift+click (2026-07-28, per Maro: "click shift and hold and click the
  // bottom should select inclusive") — rangeIds is the full ordered list
  // of ids the clicked checkbox's own panel is showing (MeshDataPanel/
  // IfcDataPanel), only passed when shift was actually held; every id
  // between the current active object and the one just shift-clicked,
  // inclusive, gets added to the selection — same file-manager convention
  // as everywhere else this gesture exists. activeObjectId is the anchor
  // (the last plain-clicked object), matching Blender's own "active
  // object" as the shift-range start. Falls through to the plain
  // additive-toggle behaviour if there's no active object yet to anchor
  // from, or the ids involved aren't both in rangeIds for some reason.
  const handleSelectObject = (id: string | null, additive = false, rangeIds?: string[]) => {
    if (id === null) { setSelectedObjectIds(new Set()); setActiveObjectId(null); return }
    if (rangeIds && activeObjectId) {
      const fromIndex = rangeIds.indexOf(activeObjectId)
      const toIndex = rangeIds.indexOf(id)
      if (fromIndex !== -1 && toIndex !== -1) {
        const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
        setSelectedObjectIds(prev => new Set([...prev, ...rangeIds.slice(start, end + 1)]))
        setActiveObjectId(id)
        return
      }
    }
    if (!additive) { setSelectedObjectIds(new Set([id])); setActiveObjectId(id); return }
    const next = new Set(selectedObjectIds)
    const turningOn = !next.has(id)
    if (turningOn) next.add(id); else next.delete(id)
    setSelectedObjectIds(next)
    const remaining = [...next]
    setActiveObjectId(turningOn ? id : (remaining.length ? remaining[remaining.length - 1] : null))
  }

  // AnimationActorsList's own "click an actor's name to select it"
  // (2026-07-12) — mesh resolves its scene-object id from the actor's own
  // filename ref the same way TimelinePlayback's Mode A resolution already
  // does; annotation just needs its own id (already the element_ref). IFC
  // is deliberately not selectable from here (see AnimationActorsList.tsx's
  // own onSelect prop — null for 'ifc') — the actor list only has a
  // GlobalId, and resolving that to a specific sub-element to select needs
  // the same async web-ifc GUID->expressID lookup TimelinePlayback's Mode A
  // resolution does, which isn't worth pulling into a click handler for a
  // v1 pass, same "IFC sub-element identity is out of scope for now"
  // precedent Follow Path/manual keyframing already set.
  // path/zone (2026-07-30) — no viewport "selection" concept exists for
  // either yet (PathsPanel.tsx/ZonesPanel.tsx have no selected-row
  // highlight), so this is a deliberate no-op for now rather than a gap —
  // same treatment as 'ifc' above, just for a different reason.
  const handleSelectActor = (sourceKind: 'mesh' | 'ifc' | 'annotation' | 'path' | 'zone' | 'camera', elementRef: string) => {
    if (sourceKind === 'mesh') {
      const match = sceneObjects.find(o => o.kind === 'mesh' && o.name === elementRef)
      if (match) handleSelectObject(match.id)
    } else if (sourceKind === 'annotation') {
      setSelectedAnnotationId(elementRef)
    } else if (sourceKind === 'camera') {
      const camera = cameras.find(c => c.id === elementRef)
      if (camera) handleLookThroughCamera(camera)
    }
  }

  const handleSelectAll = (objectIds: string[], expressIdsByObject: Map<string, number[]>) => {
    // Isolated to a specific element subset — Select All picks up exactly
    // what's currently isolated/visible instead of jumping back out to "the
    // whole model(s)" (2026-07-15, per Maro: "same with select all", same
    // fix as box-select's own element-level rework above — Isolate already
    // hides everything else, so "all" and "the isolated subset" mean the
    // same thing on screen). isolatedExpressIds is implicitly scoped to
    // whichever one IFC model was active when Isolate was switched on (see
    // isolatedExpressIds' own declaration comment) — activeIfcModelId is
    // that same model.
    if (isolateMode && isolatedExpressIds.size > 0 && activeIfcModelId) {
      const expressIds = [...isolatedExpressIds]
      setSelectedExpressIds(new Set(expressIds))
      // Only a genuine single-element result gets a "primary" element
      // (2026-07-17 fix — see handleBoxSelect's own header for why).
      setSelectedExpressId(expressIds.length === 1 ? expressIds[0] : null)
      setSelectedObjectIds(new Set([...isolatedObjectIds, activeIfcModelId]))
      setActiveObjectId(activeIfcModelId)
      return
    }
    // Viewport3D.tsx resolves every visible whole object AND every visible
    // IFC sub-element within each ifc-kind import (2026-07-17 fix, per Maro:
    // "selecting all only selects the object not the elements... I care
    // about elements" — this used to only ever populate selectedObjectIds,
    // same bug class box-select's own element-level rework fixed earlier).
    const allExpressIds = [...expressIdsByObject.values()].flat()
    setSelectedExpressIds(new Set(allExpressIds))
    // Only a genuine single-element result gets a "primary" element
    // (2026-07-17 fix — see handleBoxSelect's own header for why).
    setSelectedExpressId(allExpressIds.length === 1 ? allExpressIds[0] : null)
    setSelectedObjectIds(new Set([...objectIds, ...expressIdsByObject.keys()]))
    const lastObjectId = allExpressIds.length > 0 ? [...expressIdsByObject.keys()].pop()! : (objectIds.length ? objectIds[objectIds.length - 1] : null)
    setActiveObjectId(lastObjectId)
    if (lastObjectId && expressIdsByObject.has(lastObjectId)) setActiveIfcModelId(lastObjectId)
  }

  // Box-select (2026-07-08, per Maro: "select box in viewport") always adds
  // to the current selection, same as Blender's default B-key behaviour —
  // Viewport3D.tsx resolves which objects/elements fall inside the dragged
  // rectangle and hands back both in one batch (never loops
  // handleSelectObject/handleSelectExpressId per id — each of those calls
  // would read the same stale selectedObjectIds/selectedExpressIds from this
  // closure and clobber each other).
  //
  // expressIdsByObject (2026-07-14 fix, per Maro: "boc select doesnt select
  // elements, just object") — Viewport3D.tsx now hit-tests individual IFC
  // elements inside the drag rectangle instead of only ever resolving to the
  // whole model; every matched element's parent model still gets ensured
  // (not toggled) into selectedObjectIds too, same convention
  // handleSelectExpressId already uses, so it shows up (gizmo, highlight) in
  // the viewport the same way a single element click already does.
  const handleBoxSelect = (objectIds: string[], expressIdsByObject: Map<string, number[]>) => {
    if (objectIds.length === 0 && expressIdsByObject.size === 0) return
    const allExpressIds = [...expressIdsByObject.values()].flat()
    if (allExpressIds.length > 0) {
      const nextExpressIds = new Set([...selectedExpressIds, ...allExpressIds])
      setSelectedExpressIds(nextExpressIds)
      // Only a genuine single-element result gets a "primary" element
      // (2026-07-17 fix, per Maro: "select all elements and sectioning
      // doesn't work" — box-select was setting this to whichever element
      // happened to be "last" even across a multi-element drag, which
      // handleCreateSectionBox's own selectedExpressId !== null check
      // (and the TransformPanel gizmo's own target resolution) both read
      // as "exactly one element is selected," silently misrouting any
      // multi-element box-select into a bogus single-element scope. Same
      // "null unless exactly one" convention handleSelectCollection/
      // handleSelectCollectionMember already use.
      setSelectedExpressId(nextExpressIds.size === 1 ? [...nextExpressIds][0] : null)
    }
    setSelectedObjectIds(prev => new Set([...prev, ...objectIds, ...expressIdsByObject.keys()]))
    const lastObjectId = allExpressIds.length > 0 ? [...expressIdsByObject.keys()].pop()! : objectIds[objectIds.length - 1]
    if (lastObjectId) {
      setActiveObjectId(lastObjectId)
      if (expressIdsByObject.has(lastObjectId)) setActiveIfcModelId(lastObjectId)
    }
  }

  // Selects an IFC sub-element — shared by both the Project Overview tree
  // (IfcDataPanel) and a direct viewport click (Viewport3D.tsx's own
  // handleClick). Plain click replaces; ctrl/Cmd+click (2026-07-08, per
  // Maro: "i meant multi selector in the hierarchy") toggles membership in
  // selectedExpressIds, same last-toggled-on-becomes-primary convention as
  // handleSelectObject below. Also ensures (never toggles) the whole IFC
  // model's own membership in the coarser object-level selectedObjectIds,
  // so it shows up (gizmo, highlight) in the viewport too (2026-07-08 —
  // originally "when i select an object in the project overview, it should
  // be selected in the viewport as well") — membership, not a toggle,
  // specifically so ctrl-clicking a *second* sub-element of the same model
  // doesn't flip the model itself back out of the selection.
  // `objectId` (2026-07-09, per federated/assembly modeling — more than one
  // IFC model can be loaded now) — which model this expressID actually
  // belongs to; Viewport3D.tsx's handleClick resolves it via the usual
  // sceneObjectId walk (now done unconditionally, not just when nothing
  // more specific was hit), IfcDataPanel.tsx's tree is told which model's
  // tree it's rendering. Without this there'd be no way to tell "expressID
  // 5 in the structural model" from "expressID 5 in the architectural
  // one" — expressIDs are only unique *within* one web-ifc session/model.
  const handleSelectExpressId = (expressID: number | null, additive = false, objectId?: string) => {
    if (expressID === null) {
      setSelectedExpressId(null)
      setSelectedExpressIds(new Set())
      return
    }
    if (!additive) {
      setSelectedExpressId(expressID)
      setSelectedExpressIds(new Set([expressID]))
    } else {
      const next = new Set(selectedExpressIds)
      if (next.has(expressID)) next.delete(expressID); else next.add(expressID)
      setSelectedExpressIds(next)
      // Only a genuine single-element result gets a "primary" element
      // (2026-07-17 fix — see handleBoxSelect's own header for why) — a
      // ctrl+click that leaves (or lands on) more than one element selected
      // must not pin selectedExpressId to whichever one was just toggled.
      setSelectedExpressId(next.size === 1 ? [...next][0] : null)
    }
    if (objectId) {
      setActiveIfcModelId(objectId)
      setSelectedObjectIds(prev => (prev.has(objectId) ? prev : new Set([...prev, objectId])))
      setActiveObjectId(objectId)
    }
  }

  // Bulk sibling of handleSelectExpressId above (2026-07-11, per Maro:
  // Select by Type / Select by Storey — "select all the doors" without
  // ctrl-clicking each one) — deliberately NOT a loop calling the single-id
  // handler above, same stale-closure reasoning handleBoxSelect's own
  // comment already gives for box-select: looping a setState-from-previous-
  // state handler N times in one synchronous pass means every iteration
  // after the first reads the *original* pre-click selectedExpressIds, not
  // what the previous iteration just set.
  const handleSelectExpressIds = (expressIDs: number[], additive: boolean, objectId: string) => {
    if (expressIDs.length === 0) return
    // Filtered down to expressIDs that actually have placeable geometry
    // (2026-07-21, per Maro: "select from spatial/class select... turned
    // up empty everytime" on a real hotel model, but "works fine when i
    // click directly in viewport" — see hasGeometry's own header in
    // elementBatching.ts for the full mechanism. Select by Storey/Type
    // reads straight off the IFC data model and can legitimately name
    // entities (an IfcCurtainWall container, most commonly) that were
    // never placed as real geometry at all — a raycast click could never
    // select one of those in the first place, since there's nothing there
    // to click. Selecting one anyway and hitting Isolate hid literally
    // everything else with nothing of its own to show in exchange, which
    // is exactly the empty viewport this was reported against. Falls back
    // to the unfiltered list only if filtering would leave nothing at all
    // selected (e.g. every match this time genuinely lacks geometry) —
    // still selects *something* rather than silently doing nothing, even
    // though isolating it would still show empty.
    const handle = getIfcHandleFor(objectId)
    const geometryFiltered = handle ? expressIDs.filter(id => hasGeometry(handle.object, id)) : expressIDs
    const resolvedIds = geometryFiltered.length > 0 ? geometryFiltered : expressIDs
    const next = additive ? new Set([...selectedExpressIds, ...resolvedIds]) : new Set(resolvedIds)
    setSelectedExpressIds(next)
    // Only a genuine single-element result gets a "primary" element
    // (2026-07-17 fix — see handleBoxSelect's own header for why); "select
    // all the doors" matching more than one must not pin selectedExpressId
    // to whichever door happened to resolve last.
    setSelectedExpressId(next.size === 1 ? [...next][0] : null)
    setActiveIfcModelId(objectId)
    setSelectedObjectIds(prev => (prev.has(objectId) ? prev : new Set([...prev, objectId])))
    setActiveObjectId(objectId)
  }

  // Renamed from handleUnloadMesh — see performUnloadIfc's matching comment.
  const performUnloadMesh = (id: string) => {
    setSceneObjects(prev => {
      const target = prev.find(o => o.id === id)
      if (target) {
        disposeObject3D(target.object)
        // Per Maro: "if i unload, i expect the data not to persist so you
        // dont endlessly store unneccessary data" — see handleUnloadIfc's
        // matching comment for the in-flight-upload race this leaves to
        // persistModelFile itself to clean up.
        if (target.fileId) deleteModel3DFile(target.fileId).catch(() => {})
      }
      return prev.filter(o => o.id !== id)
    })
    setHiddenIds(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setActiveObjectId(prev => (prev === id ? null : prev))
    setSelectedObjectIds(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next })
    setCustomTextures(prev => {
      const current = prev[id]
      if (!current) return prev
      disposeCustomTextureSet(current)
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // Which ModelElementLinks/ElementKeyframes belong to a specific loaded
  // model's own elements (2026-07-XX, per Maro: "if i unload a model and it
  // still has linkages with other module data like an activity, this might
  // cause an activity to store unnecessary amounts of data... I should be
  // able to break all connection if I want") — both tables are keyed by a
  // loose (source_kind, element_ref) string, not an FK to Model3DFile (see
  // ModelElementLink's own docstring for why: it's what lets re-importing
  // the exact same file silently reattach its old links), so nothing
  // currently tells us which rows "belong" to a given loaded model without
  // actually checking. Mesh-kind matches by filename — the only stable
  // identity a plain mesh import has. ifc-kind tests whether each link/
  // keyframe's own GlobalId resolves inside *this specific* handle, not just
  // any loaded model — a GlobalId could coincidentally exist in more than
  // one separately-imported IFC file.
  const resolveLinkedDataForModel = async (target: SceneObject): Promise<{ linkIds: string[]; keyframeIds: string[] }> => {
    if (target.kind === 'mesh') {
      return {
        linkIds: modelElementLinks.filter(l => l.source_kind === 'mesh' && l.element_ref === target.name).map(l => l.id),
        keyframeIds: elementKeyframes.keyframes.filter(k => k.source_kind === 'mesh' && k.element_ref === target.name).map(k => k.id),
      }
    }
    const ifcLinks = modelElementLinks.filter(l => l.source_kind === 'ifc')
    const ifcKeyframes = elementKeyframes.keyframes.filter(k => k.source_kind === 'ifc')
    const handle = getIfcHandleFor(target.id)
    if (!handle || (ifcLinks.length === 0 && ifcKeyframes.length === 0)) return { linkIds: [], keyframeIds: [] }
    const { getExpressIdFromGuid } = await import('./ifcModel')
    return {
      linkIds: ifcLinks.filter(l => getExpressIdFromGuid(handle, l.element_ref) !== undefined).map(l => l.id),
      keyframeIds: ifcKeyframes.filter(k => getExpressIdFromGuid(handle, k.element_ref) !== undefined).map(k => k.id),
    }
  }

  // Confirmation state for unloading a model that still has links/keyframes
  // attached — null means no prompt is showing. Set by requestUnloadModel
  // below once it knows there's actually something to ask about; the dialog
  // itself (UnloadModelDialog.tsx, rendered in this component's JSX) reads
  // this to show the counts and calls handleConfirmUnload with the user's
  // choice.
  const [pendingUnload, setPendingUnload] = useState<{
    id: string; name: string; kind: 'ifc' | 'mesh'; linkIds: string[]; keyframeIds: string[]
  } | null>(null)

  // What DataPanel.tsx's Unload buttons actually call now (2026-07-XX, per
  // Maro's "break all connection if i want" request) — wraps
  // performUnloadIfc/performUnloadMesh with a check for attached links/
  // keyframes first. Skips the prompt entirely when there's nothing to
  // lose (the common case — most imports are never linked to anything, or
  // this is the first time this particular model's been unloaded), so this
  // only ever interrupts when it actually matters. One function for both
  // kinds — DataPanel only needs to pass an id, the target's own `kind`
  // decides which performUnload... to eventually call.
  const requestUnloadModel = async (id: string) => {
    const target = sceneObjects.find(o => o.id === id)
    if (!target) return
    const { linkIds, keyframeIds } = await resolveLinkedDataForModel(target)
    if (linkIds.length === 0 && keyframeIds.length === 0) {
      if (target.kind === 'ifc') performUnloadIfc(id); else performUnloadMesh(id)
      return
    }
    setPendingUnload({ id, name: target.name, kind: target.kind, linkIds, keyframeIds })
  }

  // deleteLinks=false is "Unload Only" (keep them dormant, ready to
  // reattach if the exact same file comes back later); true is "Unload and
  // Delete Links" — reuses the exact same single-item delete calls the
  // manual per-element Unlink button already uses (handleUnlinkElement,
  // elementKeyframes.remove), just looped, rather than adding a new bulk
  // endpoint for what's normally a handful of rows.
  const handleConfirmUnload = (deleteLinks: boolean) => {
    if (!pendingUnload) return
    const { id, kind, linkIds, keyframeIds } = pendingUnload
    setPendingUnload(null)
    if (kind === 'ifc') performUnloadIfc(id); else performUnloadMesh(id)
    if (deleteLinks) {
      linkIds.forEach(handleUnlinkElement)
      keyframeIds.forEach(keyframeId => elementKeyframes.remove(keyframeId))
    }
  }

  // "Unload Selected" (2026-07-26, per Maro: "i need to be able to unload
  // selected elements" — distinct from the IFC Data panel's own per-model
  // Unload, which only ever drops a *whole* loaded file, and from Hide
  // Selected above, which is reversible/still fully allocated). Same
  // link/keyframe confirmation shape as requestUnloadModel/handleConfirmUnload
  // just above (per Maro's answer when asked: "warn, then let me choose"),
  // just resolved against a specific expressID subset instead of every
  // element in the file — resolveLinkedDataForModel's own getExpressIdFromGuid
  // check, inlined here against a target Set instead of "any expressID at
  // all". Only ever targets specific IFC sub-elements (selectedExpressIds) —
  // a whole mesh-kind object or whole-IFC-model selection with no
  // sub-elements picked is already covered by that model/object's own
  // Unload button elsewhere, so this stays a no-op for that case rather than
  // duplicating it.
  const resolveLinkedDataForElements = async (
    handle: IfcModelHandle, expressIds: number[],
  ): Promise<{ linkIds: string[]; keyframeIds: string[] }> => {
    const ifcLinks = modelElementLinks.filter(l => l.source_kind === 'ifc')
    const ifcKeyframes = elementKeyframes.keyframes.filter(k => k.source_kind === 'ifc')
    if (ifcLinks.length === 0 && ifcKeyframes.length === 0) return { linkIds: [], keyframeIds: [] }
    const { getExpressIdFromGuid } = await import('./ifcModel')
    const targetIds = new Set(expressIds)
    const matches = (elementRef: string) => {
      const expressID = getExpressIdFromGuid(handle, elementRef)
      return expressID !== undefined && targetIds.has(expressID)
    }
    return {
      linkIds: ifcLinks.filter(l => matches(l.element_ref)).map(l => l.id),
      keyframeIds: ifcKeyframes.filter(k => matches(k.element_ref)).map(k => k.id),
    }
  }

  // Real disposal (elementBatching.ts's own removeElementsFromModel — see
  // its header for exactly what "real" means: BatchedMesh.deleteInstance or
  // a disposed individual Mesh, either way the expressID stops existing in
  // this rootObject at all), plus the same selection/hidden/isolated
  // bookkeeping cleanup Deselect All-adjacent flows already do for expressIDs
  // that no longer resolve to anything — hiddenExpressIds is keyed by the
  // composite `${objectId}::${expressID}` (Hide Selected's own convention
  // above), isolatedExpressIds is a bare expressID Set (same "implicitly
  // scoped to the one active IFC model" assumption Isolate itself relies on).
  const performUnloadElements = async (objectId: string, expressIds: number[]) => {
    const handle = getIfcHandleFor(objectId)
    if (!handle) return
    removeElementsFromModel(handle.object, expressIds)
    const removedSet = new Set(expressIds)
    setSelectedExpressIds(prev => {
      if (![...removedSet].some(id => prev.has(id))) return prev
      const next = new Set(prev)
      removedSet.forEach(id => next.delete(id))
      return next
    })
    setSelectedExpressId(prev => (prev !== null && removedSet.has(prev) ? null : prev))
    const removedKeys = new Set(expressIds.map(id => `${objectId}::${id}`))
    setHiddenExpressIds(prev => {
      if (![...removedKeys].some(key => prev.has(key))) return prev
      const next = new Set(prev)
      removedKeys.forEach(key => next.delete(key))
      return next
    })
    setIsolatedExpressIds(prev => {
      if (![...removedSet].some(id => prev.has(id))) return prev
      const next = new Set(prev)
      removedSet.forEach(id => next.delete(id))
      return next
    })

    // "Unload Selected"/"Reload IFC" persistence (2026-07-26, per Maro: "if
    // i refresh, i expect the elements i unloaded to stay unloaded... give
    // me an option to reload ifc which can identify the elements
    // unloaded") — captured here, once, while handle.api is still the
    // live/open WASM session for this exact file (removeElementsFromModel
    // above never touches it, only the three.js side), so the "Reload IFC"
    // picker can show a real name/type list later without ever re-parsing
    // anything. Merged with (not replacing) whatever this file already had
    // unloaded — Unload Selected is additive across repeated uses, same as
    // Hide Selected already is.
    const target = sceneObjects.find(o => o.id === objectId)
    if (!target) return
    if (brokenModelObjectIdsRef.current.has(objectId)) return
    // Self-heals a stale/never-persisted fileId the same way
    // persistActiveTransform/persistSiblingTransform already do (2026-07-28
    // — this path used to just read target.fileId directly with no
    // fallback at all, so a stale id from a since-replaced/re-imported
    // namesake file 404'd here with no recovery, and a null fileId
    // silently gave up with no error and no retry even if the upload had
    // actually just finished concurrently).
    let fileId = target.fileId
    const modelFiles = await listModel3DFiles(selectedProject!.id).catch(() => null)
    const currentFile = modelFiles?.find(f => f.name === target.name && f.kind === target.kind)
    if (currentFile && currentFile.id !== fileId) {
      fileId = currentFile.id
      setSceneObjects(prev => prev.map(o => (o.id === objectId ? { ...o, fileId: currentFile.id } : o)))
    } else if (!currentFile) {
      brokenModelObjectIdsRef.current.add(objectId)
      addImportError(
        `Couldn't save the last edit to "${target.name}" — this model was never fully saved to the server ` +
        `(likely a reload or navigation away while a large file was still uploading). Re-import it to fix this ` +
        `and any other unsaved position/rotation/scale edits made since.`,
      )
      return
    }
    if (!fileId) return
    const { getGuidFromExpressId, getElementTypeName, getElementName } = await import('./ifcModel')
    const newEntries = await Promise.all(expressIds.map(async expressID => ({
      guid: getGuidFromExpressId(handle, expressID) ?? String(expressID),
      name: await getElementName(handle, expressID).catch(() => ''),
      type_name: getElementTypeName(handle, expressID),
    })))
    const existing = unloadedElementsByFileId.get(fileId) ?? []
    const merged = [...existing.filter(e => !newEntries.some(n => n.guid === e.guid)), ...newEntries]
    try {
      const updated = await updateUnloadedElements(fileId, merged)
      setUnloadedElementsByFileId(prev => new Map(prev).set(fileId!, updated.unloaded_elements ?? merged))
    } catch (err) {
      // Non-fatal (2026-07-26, same "fire-and-forget persistence, tell the
      // user, don't roll back a scene edit that already visibly happened"
      // convention as performUnloadIfc/persistModelFile elsewhere in this
      // file) — the element really is unloaded either way; only "stays
      // unloaded after a refresh" is at risk if this specific save failed.
      console.error('Failed to persist unloaded elements', err)
      addImportError(`"${target.name}": removed from view, but couldn't save that so it stays gone after a refresh (${err instanceof Error ? err.message : String(err)}).`)
    }
  }

  // Confirmation state for unloading specific selected elements that still
  // have links/keyframes attached — the element-scoped sibling of
  // pendingUnload above; null means no prompt showing. UnloadModelDialog.tsx
  // is fully generic (name/linkCount/keyframeCount + 3 callbacks), reused
  // as-is rather than building a second near-identical modal.
  const [pendingElementUnload, setPendingElementUnload] = useState<{
    objectId: string; expressIds: number[]; linkIds: string[]; keyframeIds: string[]
  } | null>(null)

  const handleUnloadSelected = async () => {
    if (!activeObjectId || selectedExpressIds.size === 0) return
    const handle = getIfcHandleFor(activeObjectId)
    if (!handle) return
    const expressIds = [...selectedExpressIds]
    const { linkIds, keyframeIds } = await resolveLinkedDataForElements(handle, expressIds)
    if (linkIds.length === 0 && keyframeIds.length === 0) {
      await performUnloadElements(activeObjectId, expressIds)
      return
    }
    setPendingElementUnload({ objectId: activeObjectId, expressIds, linkIds, keyframeIds })
  }

  const handleConfirmElementUnload = (deleteLinks: boolean) => {
    if (!pendingElementUnload) return
    const { objectId, expressIds, linkIds, keyframeIds } = pendingElementUnload
    setPendingElementUnload(null)
    performUnloadElements(objectId, expressIds)
    if (deleteLinks) {
      linkIds.forEach(handleUnlinkElement)
      keyframeIds.forEach(keyframeId => elementKeyframes.remove(keyframeId))
    }
  }

  // "Reload IFC" (2026-07-26, per Maro: "give me an option to reload ifc
  // which can identify the elements unloaded and i can choose which ones
  // to reload") — which model's own ReloadIfcDialog is currently open;
  // null means none. IfcDataPanel.tsx's own per-model row only shows the
  // button that sets this when unloadedElementsByFileId actually has
  // something for that file, so there's always something to pick from
  // once this is non-null.
  const [reloadIfcTarget, setReloadIfcTarget] = useState<{ objectId: string; fileId: string; fileName: string } | null>(null)

  // Full re-download + re-parse of the same file (2026-07-26, per Maro's
  // own answer when asked to choose over a live-patch: "simple and safe...
  // reuses the exact same loading path as a normal import"), not a splice
  // into the already-loaded batch — see viewport3D's/elementBatching.ts's
  // own already-fragile BatchedMesh instancing internals for why that
  // alternative was avoided. guidsToRestore are the ones the dialog's
  // checkboxes marked "bring back"; anything in this file's own
  // unloadedElementsByFileId NOT in that list stays excluded on the fresh
  // handle, same as a normal restore-on-mount would apply it.
  //
  // Any selection/isolate/hide state that referenced the *old* object id
  // is dropped rather than migrated to the new one (the old model's own
  // WASM session — and its expressID numbering — genuinely doesn't exist
  // anymore once a fresh loadIfcModel replaces it) — the same "you'll
  // need to re-select afterward" trade-off a plain unload-then-reimport
  // already has today, and this is a deliberate, occasional action, not a
  // hot-path click that trade-off would actually sting on.
  const handleReloadIfc = async (guidsToRestore: string[]) => {
    if (!reloadIfcTarget) return
    const { objectId, fileId, fileName } = reloadIfcTarget
    setReloadIfcTarget(null)
    const oldHandle = getIfcHandleFor(objectId)
    if (!oldHandle) return
    try {
      const blob = await downloadModel3DFile(fileId)
      const freshFile = new File([blob], fileName)
      const { loadIfcModel, disposeIfcModel, getExpressIdFromGuid } = await import('./ifcModel')
      const handle = await loadIfcModel(freshFile)

      const wholeFileTransform = elementTransformsRef.current.find(t => t.model3d_file_id === fileId && t.element_ref === null)
      applyElementTransform(handle.object, wholeFileTransform)
      const perElementTransforms = elementTransformsRef.current.filter(t => t.model3d_file_id === fileId && t.element_ref !== null)
      if (perElementTransforms.length > 0) {
        const byExpressId = new Map<number, ElementTransform>()
        for (const t of perElementTransforms) {
          const expressId = getExpressIdFromGuid(handle, t.element_ref as string)
          if (expressId !== undefined) byExpressId.set(expressId, t)
        }
        if (byExpressId.size > 0) {
          handle.object.traverse(child => {
            const t = byExpressId.get(child.userData.expressID)
            if (t) applyElementTransform(child, t)
          })
        }
      }

      const stillExcluded = (unloadedElementsByFileId.get(fileId) ?? []).filter(e => !guidsToRestore.includes(e.guid))
      const excludeExpressIds = stillExcluded
        .map(e => getExpressIdFromGuid(handle, e.guid))
        .filter((expressId): expressId is number => expressId !== undefined)
      if (excludeExpressIds.length > 0) removeElementsFromModel(handle.object, excludeExpressIds)

      const oldSourceUpAxis = sceneObjects.find(o => o.id === objectId)?.sourceUpAxis ?? 'z'
      disposeIfcModel(oldHandle)
      const newId = `ifc-${handle.modelID}`
      handle.object.userData.sceneObjectId = newId
      setIfcHandles(prev => [...prev.filter(h => h !== oldHandle), handle])
      setSceneObjects(prev => [
        ...prev.filter(o => o.id !== objectId),
        { id: newId, name: fileName, kind: 'ifc' as const, sourceUpAxis: oldSourceUpAxis, object: handle.object, fileId },
      ])
      setActiveIfcModelId(prev => (prev === objectId ? newId : prev))
      setActiveObjectId(prev => (prev === objectId ? newId : prev))
      setSelectedObjectIds(prev => { if (!prev.has(objectId)) return prev; const next = new Set(prev); next.delete(objectId); return next })
      setSelectedExpressIds(new Set())
      setSelectedExpressId(null)
      setIsolatedObjectIds(prev => { if (!prev.has(objectId)) return prev; const next = new Set(prev); next.delete(objectId); return next })
      setHiddenIds(prev => { if (!prev.has(objectId)) return prev; const next = new Set(prev); next.delete(objectId); return next })

      const updated = await updateUnloadedElements(fileId, stillExcluded)
      setUnloadedElementsByFileId(prev => new Map(prev).set(fileId, updated.unloaded_elements ?? stillExcluded))
    } catch (err) {
      console.error('Failed to reload IFC model', err)
      addImportError(`Failed to reload "${fileName}" (${err instanceof Error ? err.message : String(err)}).`)
    }
  }

  const toggleMeshVisible = (id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Fixes a wrongly-guessed import axis without re-importing (2026-07-08,
  // per Maro: picking Y up worked for an IFC file, Z up worked for an FBX —
  // both go through the exact same axisCorrectionRotation, so that's not an
  // inconsistency in how kinds are handled, it's just that different files
  // are genuinely authored differently, especially FBX — unlike glTF, it has
  // no single spec-mandated up-axis, so it varies by exporting tool). A
  // wrong guess at import time used to mean unload-and-reimport; this makes
  // it a single click on the same object already in the scene.
  const handleSetSourceUpAxis = (id: string, sourceUpAxis: UpAxis) => {
    setSceneObjects(prev => prev.map(o => (o.id === id ? { ...o, sourceUpAxis } : o)))
  }

  const handleToggleIsolate = () => {
    setIsolateMode(prev => {
      const turningOn = !prev
      // Snapshot whatever's currently selected *once*, right as Isolate
      // switches on — see this state's own comment above for why this
      // can't just keep reading the live selection afterward.
      if (turningOn) {
        setIsolatedObjectIds(new Set(selectedObjectIds))
        setIsolatedExpressIds(new Set(selectedExpressIds))
      }
      return turningOn
    })
  }
  const handleShowAll = () => {
    setIsolateMode(false)
    setIsolatedObjectIds(new Set())
    setIsolatedExpressIds(new Set())
    setHiddenIds(new Set())
    setHiddenExpressIds(new Set())
  }

  // "Isolate Linked Elements" — activities -> elements (2026-07-09, per
  // Maro: "if i click on an activity or activities, i can click to
  // isolate/filter the elements assigned to those activities alone"). Sits
  // in the Activity Table window's own header, enabled whenever at least
  // one activity is selected there. No-op (per "if not assigned to any then
  // nothing happens") if none of the selected activities have any linked
  // element at all — isolate simply doesn't turn on rather than isolating
  // an empty/everything set.
  const [isolatingLinked, setIsolatingLinked] = useState(false)
  const handleIsolateLinkedElements = async () => {
    if (selectedActivityIds.size === 0) return
    setIsolatingLinked(true)
    try {
      const { objectIds, expressIds } = await resolveActivityLinksToIsolationTargets(
        selectedActivityIds, modelElementLinks, sceneObjects, ifcHandles,
      )
      if (objectIds.size === 0) return
      setIsolatedObjectIds(objectIds)
      setIsolatedExpressIds(expressIds)
      setIsolateMode(true)
    } finally {
      setIsolatingLinked(false)
    }
  }

  // The reverse direction — "Linked Activities" widget (2026-07-09, per
  // Maro: "there should be a widget to filter the activities the isolated
  // elements are assigned to, if not assigned to any then nothing
  // happens") — recomputed whenever the isolated set or the link list
  // itself changes; empty (and the widget renders nothing at all, see its
  // own header) whenever isolate is off or nothing isolated has a link.
  const [isolatedLinkedActivityIds, setIsolatedLinkedActivityIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!isolateMode || isolatedObjectIds.size === 0) { setIsolatedLinkedActivityIds(new Set()); return }
    let cancelled = false
    resolveIsolationTargetsToActivityIds(isolatedObjectIds, isolatedExpressIds, modelElementLinks, sceneObjects, ifcHandles)
      .then(ids => { if (!cancelled) setIsolatedLinkedActivityIds(ids) })
    return () => { cancelled = true }
  }, [isolateMode, isolatedObjectIds, isolatedExpressIds, modelElementLinks, sceneObjects, ifcHandles])

  // Manual per-model texture override (2026-07-11, per Maro: "if I cant get
  // this natively, allow me to import textures per model") — see
  // customTextures.ts's own header for the colorSpace/whole-object-scope
  // reasoning.
  const [customTextures, setCustomTextures] = useState<Record<string, CustomTextureSet>>({})
  const [textureError, setTextureError] = useState<string | null>(null)
  // Manual per-element Opacity (2026-07-26, per Maro: "allow for
  // transparency setting (0-1) for materials so i can simply make the
  // window surfaces less opaque instead of replacing the materials
  // completely") — a plain scalar sibling to customTextures, not a new
  // CustomTextureSet slot: opacity is a real material property with no
  // asset to upload/clear/link/preset, so it doesn't need any of that
  // machinery. Same ownerKey convention (`${objectId}::${expressID}` for
  // one IFC sub-element, else the whole object id) — absent = 1 (fully
  // opaque, unchanged from before this existed). Applied directly to every
  // currently-selected element at once (resolveActiveTextureKeys, below —
  // the same bulk-target resolution Clear Materials/Apply to Linked
  // already use), not gated behind a separate "Apply to Linked" click:
  // unlike an uploaded texture (a distinct asset worth deliberately
  // choosing to share), a single 0-1 slider value has no real "just the
  // primary element" use case worth a second step.
  const [customOpacity, setCustomOpacity] = useState<Record<string, number>>({})
  // Adapters for PropertiesPanel's Material/Texture section (2026-07-11,
  // per Maro: "move... object material and texture settings in the 3d view
  // properties... so if i select an object, 3d or ifc, i can see and
  // change them there") — that section only ever edits whichever object is
  // currently active, so it works with the simpler (slot, file) shape
  // rather than threading an objectId through every call site; these just
  // supply activeObjectId to the id-keyed handlers above. A no-op if
  // nothing's selected (the section isn't rendered in that case anyway).
  // Multi-target (2026-07-29 fix, per Maro, after a real incident: box-
  // selecting only the columns and applying a material changed the slabs
  // too, even though they were never selected) — a real multi-element
  // selection has no single primary expressID (isElementTransform/
  // activeTextureKey both fall back to the *whole object* the instant more
  // than one sub-element is picked, see resolveActiveTextureKeys' own
  // header), so writing through activeTextureKey alone landed every one of
  // these edits on the whole-model override instead of the elements
  // actually selected. Loops resolveActiveTextureKeys() the same way
  // handleClearAllActiveTextures/handleOpacityChange already do, sharing one
  // loaded texture across every selected element's own key — same sharing
  // convention handleApplyToLinkedMaterial below already established.
  const handleUploadActiveTexture = async (slot: TextureSlot, file: File) => {
    const keys = resolveActiveTextureKeys()
    if (keys.length === 0) return
    try {
      setTextureError(null)
      const value = await loadCustomTexture(file, slot)
      setCustomTextures(prev => {
        const next = { ...prev }
        for (const key of keys) next[key] = { ...next[key], [slot]: value }
        return next
      })
    } catch (err) {
      setTextureError(err instanceof Error ? err.message : 'Failed to load texture file')
    }
  }
  const handleClearActiveTexture = (slot: TextureSlot) => {
    const keys = resolveActiveTextureKeys()
    if (keys.length === 0) return
    setCustomTextures(prev => {
      const next = { ...prev }
      let changed = false
      for (const key of keys) {
        const current = next[key]
        if (!current?.[slot]) continue
        current[slot]?.texture.dispose()
        const nextSet = { ...current }
        delete nextSet[slot]
        next[key] = nextSet
        changed = true
      }
      return changed ? next : prev
    })
  }
  // Tile Size/Rotation's own forced re-render (2026-07-11) — TextureFields.tsx
  // mutates each slot's live THREE.Texture.repeat/.rotation directly (its
  // own Props header explains why: the renderer reads both every frame
  // regardless, no React state needs to own either number itself), so
  // nothing about `customTextures` actually changed shape here — this only
  // exists to give those fields' own controlled inputs a fresh top-level
  // object reference to re-render from, same trick TransformPanel.tsx's
  // onFieldChange uses for object.position. Deliberately not
  // onTransformChange (which also queues a debounced save to the
  // element_transform endpoint) — a texture edit has nothing to do with
  // that.
  const handleTextureFieldChange = () => setCustomTextures(prev => ({ ...prev }))

  // Material Preset library (2026-07-09, per Maro: "Save the default
  // materials for the whole model... I can then add a new preset which
  // allows me to change the materials, i can save it, edit and delete. So
  // if i choose i can toggle between different materials I've saved and
  // apply the one i want while not losing the original ones") — same
  // project-scoped library pattern as animationProfiles above. Applying a
  // preset writes into the exact same customTextures slots per-element
  // texture editing already uses (resolveActiveTextureKeys — every
  // currently-selected element, not just the primary one; 2026-07-29 fix,
  // see that function's own header for the box-select-columns-recolours-
  // slabs incident this fixes), so it's indistinguishable from a fresh
  // manual upload from this point on, and the element's true original
  // material (elementBaseline.ts) is never touched by it either way.
  const materialPresets = useMaterialPresets(selectedProject?.id)
  const handleApplyMaterialPreset = async (preset: MaterialPreset) => {
    const keys = resolveActiveTextureKeys()
    if (keys.length === 0) return
    try {
      setTextureError(null)
      const textureSet = await loadPresetAsTextureSet(preset)
      setCustomTextures(prev => {
        const next = { ...prev }
        for (const key of keys) next[key] = { ...next[key], ...textureSet }
        return next
      })
    } catch {
      setTextureError('Failed to load material preset')
    }
  }

  // Select Linked / Apply to Linked, per material channel (2026-07-09, per
  // Maro: "select an element for example and select its material, then a
  // button called Select Linked (material), which then selects all the
  // elements with that material... apply to linked... this should
  // obviously be channel specific"). Both only make sense for a specific
  // IFC sub-element (isElementTransform) — mesh-kind imports have no
  // per-sub-element identity to select/apply to at all — see
  // linkedMaterials.ts's own header for exactly what "linked" means per
  // channel.
  const handleSelectLinkedMaterial = (slot: TextureSlot) => {
    const handle = getIfcHandleFor(activeObjectId)
    if (!handle || !activeObjectId || selectedExpressId === null) return
    // findLinkedExpressIds (2026-08-24 perf fix) no longer materializeAll's
    // the whole model just to search — it scans still-batched elements
    // straight off their own batch data, so nothing here changes the set of
    // real meshes and no materializeVersion bump is needed (unlike Apply to
    // Linked just below, which does).
    const matches = findLinkedExpressIds(handle, activeObjectId, slot, selectedExpressId, customTextures)
    setSelectedExpressIds(new Set(matches))
  }
  const handleApplyToLinkedMaterial = (slot: TextureSlot) => {
    if (!activeTextureKey || !activeObjectId) return
    const sourceValue = customTextures[activeTextureKey]?.[slot]
    if (!sourceValue) return
    // Materializes exactly the elements actually receiving this override,
    // not the whole model (2026-08-24 perf fix, per Maro: "changing the
    // textures makes the viewport laggy while orbiting" — see
    // linkedMaterials.ts's own findLinkedExpressIds header for the full
    // story). A still-batched instance has no way to carry its own texture
    // at all — THREE.BatchedMesh shares one material across every
    // instance — so an element that's actually getting a per-element
    // texture override unavoidably has to become a real, individual mesh;
    // this just scopes that unavoidable cost to only the elements this
    // click is actually touching, the same as clicking each one
    // individually would.
    const handle = getIfcHandleFor(activeObjectId)
    if (handle) {
      for (const expressID of selectedExpressIds) ensureMaterialized(handle.object, expressID)
      setMaterializeVersion(v => v + 1)
    }
    setCustomTextures(prev => {
      const next = { ...prev }
      for (const expressID of selectedExpressIds) {
        const key = `${activeObjectId}::${expressID}`
        next[key] = { ...next[key], [slot]: sourceValue }
      }
      return next
    })
  }

  // Independent local state for the embedded Resource Tracking/Usage
  // windows — these are standalone windows here, not the linked pair they
  // are on the Resources tab, so they don't share selection/scroll state
  // with Scheduling.tsx's own.
  const [zoom] = useState<GanttZoom>(loadGanttZoom)
  const [layoutPrefs] = useState(loadResourcesLayout)
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set())
  const toggleResourceSelected = (id: string) => {
    setSelectedResourceIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<string>>(new Set())
  const toggleActivitySelected = (id: string) => {
    setSelectedActivityIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  // Row/bar click in the Schedule or Gantt window (2026-07-09, per Maro:
  // "the gantt in the 4d doesnt interact with the schedule in the 4d") —
  // both windows share this same selectedActivityIds set (also what scopes
  // the Resource Tracking/Usage widgets via the checkbox-driven
  // toggleActivitySelected above), so clicking a row highlights the
  // matching Gantt bar and vice versa. Plain click replaces the whole
  // selection with just this one; Ctrl/Cmd+click toggles membership instead
  // (delegates to the existing toggle for that case).
  const handleSelectActivity = (id: string, additive: boolean) => {
    if (additive) { toggleActivitySelected(id); return }
    setSelectedActivityIds(new Set([id]))
  }
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const toggleCollapsed = (id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // WBS outline collapse for the Activity Table/Gantt window pair
  // (2026-07-09, per Maro: "I want full sync capabilities regarding the 4d
  // windows") — a *separate* set from collapsedIds above (that one's the
  // Resource Tracking widget's own resource-group tree, an unrelated
  // hierarchy). Lifted up from ScheduleWindow.tsx's own former local state
  // so the exact same ordered+filtered row list can be computed once here
  // and fed to *both* windows — a prerequisite for their rows to actually
  // correspond 1:1, which is what makes scrollTop-syncing them meaningful
  // rather than just mechanically matching two unrelated pixel offsets.
  const [scheduleCollapsedIds, setScheduleCollapsedIds] = useState<Set<string>>(new Set())
  const toggleScheduleCollapsed = (id: string) => {
    setScheduleCollapsedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  // Respects the same "Hide Archived" preference Scheduling.tsx's own
  // Activities tab already persists (2026-07-26 fix, per Maro: "i hid it
  // but i see still see it in table in 4d" — this window fetches its own
  // separate `activities` list entirely independent of Scheduling's, so
  // toggling Hide Archived there never touched what the 4D Activity Table/
  // Gantt Chart windows render at all). A plain, uncached localStorage read
  // rather than useState — FourD stays persistently mounted across
  // navigation (App.tsx's PersistentFourD) while Scheduling is a normal
  // route that mounts/unmounts, so caching this in state here would go
  // stale the moment the user toggles it over on the Scheduling page and
  // comes back without this component ever re-mounting to pick up a fresh
  // initial read.
  const hideArchivedInViewport = localStorage.getItem('prosota_scheduling_hide_archived') === 'true'
  const scheduleWindowActivities = useMemo(
    () => (hideArchivedInViewport ? activities.filter(a => !a.is_archived && !a.is_archive_container) : activities),
    [activities, hideArchivedInViewport],
  )
  const scheduleVisibleActivities = useMemo(
    () => computeVisibleActivities(scheduleWindowActivities, scheduleCollapsedIds),
    [scheduleWindowActivities, scheduleCollapsedIds],
  )

  // Native scrollTop mirroring between the Activity Table and Gantt windows
  // (2026-07-09, per Maro) — plain DOM scroll-sync between two independent,
  // freely-resizable/dockable WindowChrome panes, not GanttChart.tsx's own
  // transform-based GanttChartHandle trick (that one assumes a fixed-height
  // clipped viewport paired with exactly one partner, matching Scheduling.tsx's
  // dual-pane layout — not the case here, where either window can be closed,
  // resized, or moved to the other dock independently).
  //
  // Last-known-value guards (2026-08-30 fix, per Maro: "jittering... table
  // trying to scroll down but resisting and staying up") — a boolean
  // syncingScrollRef used to guard this, but that broke two ways: (1) the
  // Gantt pane's own container is *also* GanttChart's horizontalScrollContainerRef
  // (see its own render below), which gets scrollLeft ticked every rAF frame
  // by that component's playhead-follow effect; a scrollLeft-only change
  // still fires this container's onScroll with an unchanged scrollTop, which
  // a boolean-guarded handler would still forward as a fresh assignment onto
  // the Activity Table pane — and directly assigning scrollTop, even to its
  // current value, cancels any in-flight scrollTo({behavior:'smooth'}), so
  // ScheduleWindow's own auto-scroll-to-current-row animation got reset on
  // every single animation frame and could never actually travel. (2) even
  // for genuine vertical mirroring, the boolean flag was set true then
  // false *synchronously* around the scrollTop assignment, but the resulting
  // 'scroll' event on the other pane fires asynchronously — so the guard was
  // already false again by the time it needed to suppress the echo,
  // producing a feedback loop. Tracking each pane's last-known scrollTop
  // instead fixes both: a same-value scroll event (case 1) is a no-op, and
  // an echoed value (case 2) is recognized and dropped regardless of when
  // the async event actually arrives.
  const scheduleScrollRef = useRef<HTMLDivElement>(null)
  const ganttScrollRef = useRef<HTMLDivElement>(null)
  const lastScheduleScrollTopRef = useRef(0)
  const lastGanttScrollTopRef = useRef(0)
  const handleScheduleScroll = (scrollTop: number) => {
    if (scrollTop === lastScheduleScrollTopRef.current) return
    lastScheduleScrollTopRef.current = scrollTop
    lastGanttScrollTopRef.current = scrollTop
    if (ganttScrollRef.current) ganttScrollRef.current.scrollTop = scrollTop
  }
  const handleGanttScroll = (scrollTop: number) => {
    if (scrollTop === lastGanttScrollTopRef.current) return
    lastGanttScrollTopRef.current = scrollTop
    lastScheduleScrollTopRef.current = scrollTop
    if (scheduleScrollRef.current) scheduleScrollRef.current.scrollTop = scrollTop
  }

  const resourcesTabData = useResourcesTabData(
    resources, resourceAssignments, activities, selectedResourceIds, zoom, null, null,
  )

  // Cost Profile (2026-07-25, per Maro: "the resource usage profile but
  // showing cost across the time period... it's in the Resource-Scheduling
  // tab" — pointed at this exact widget's own "cost" unit as the
  // reference, not a bespoke EVM calculation). Reuses resourcesTabData's
  // own already-fetched spreadByResource (the one network call this whole
  // hook makes) with a fixed month-zoom bucket set of its own — independent
  // of whatever zoom the live Resource Usage window happens to be showing,
  // so the 4D export always gets a stable monthly chart regardless — and
  // computeUsageProfileBars, the exact function ResourceUsageProfileWidget
  // itself calls for its own bars, so this can never drift from what that
  // tab would show for the same data with Cost selected.
  const costProfileBuckets = useMemo(
    () => computePeriodBuckets(resourcesTabData.rangeStart, resourcesTabData.rangeEnd, 'month'),
    [resourcesTabData.rangeStart, resourcesTabData.rangeEnd],
  )
  const costProfileValues = useMemo(
    () => computeUsageProfileBars(
      resourcesTabData.trackedResources, resourcesTabData.assignmentsByResource,
      costProfileBuckets, resourcesTabData.spreadByResource, new Set(), 'cost',
    ).barValues,
    [resourcesTabData.trackedResources, resourcesTabData.assignmentsByResource, costProfileBuckets, resourcesTabData.spreadByResource],
  )
  // Per-resource breakdown (2026-07-25, second pass, per Maro: "an
  // indication of the resources driving the cost profile not just the
  // bars") — same computeUsageProfileBars call as costProfileValues just
  // above, just scoped to a single resource at a time so exportOverlays.ts
  // can show which resources actually have cost in whichever bucket the
  // export's own playhead currently sits in. One call per tracked
  // resource, same cost as computing the combined total once per resource
  // — cheap at the handful-of-resources scale a real project's Resources
  // tab tracks.
  const costProfileResourceBreakdown = useMemo(
    () => resourcesTabData.trackedResources.map(resource => ({
      name: resource.name,
      values: computeUsageProfileBars(
        [resource], resourcesTabData.assignmentsByResource,
        costProfileBuckets, resourcesTabData.spreadByResource, new Set(), 'cost',
      ).barValues,
    })),
    [resourcesTabData.trackedResources, resourcesTabData.assignmentsByResource, costProfileBuckets, resourcesTabData.spreadByResource],
  )

  // Memoized (2026-07-20, optimization pass — a confirmed regression, not a
  // new suggestion): Viewport3D.tsx's own "heavyDeps" reference-equality
  // check (built specifically because a real 5k+-element IFC model was
  // "struggling") skips its expensive full-mesh pass — geometry
  // subdivision, texture, variance/clash colour, render-mode sync — unless
  // this array's own reference actually changes. Without useMemo here, a
  // brand-new array of brand-new object literals was built on every FourD
  // render (this component has dozens of useState hooks and stays
  // permanently mounted), so that check always saw "changed" and the
  // expensive pass reran on every unrelated render — typing in a field,
  // opening a side panel, anything — silently defeating the fix it exists
  // to honour.
  const viewportObjects: ImportedObject[] = useMemo(() => sceneObjects.map(o => ({
    id: o.id, kind: o.kind, sourceUpAxis: o.sourceUpAxis, object: o.object, name: o.name,
    visible: !hiddenIds.has(o.id) && (!isolateMode || isolatedObjectIds.has(o.id)),
  })), [sceneObjects, hiddenIds, isolateMode, isolatedObjectIds])
  const meshImports = sceneObjects.filter(o => o.kind === 'mesh').map(o => ({ id: o.id, name: o.name }))
  const activeSceneObject = sceneObjects.find(o => o.id === activeObjectId) ?? null

  // Element Parenting / rigging (2026-07-12, per Maro's crane-rigging
  // request: base -> jib -> trolley -> hook) — mesh-kind only, one parent
  // per child, upsert-repoints (element_parents.py's own docstring on why,
  // mirroring PathFollower). Viewport3D.tsx's own resolution effect
  // (ModelObjects) does the actual three.js reparenting; this block is
  // purely CRUD + the "don't combine with Follow Path" guard (see this
  // session's own scope boundary — Mode C's toLocalPoint deliberately
  // fights a moving parent, so an object can't be both a Path target and a
  // rigged child at once).
  //
  const [elementParents, setElementParents] = useState<ElementParentType[]>([])
  const [elementParentError, setElementParentError] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedProject || !hasEverBeenActive) return
    let cancelled = false
    listElementParents(selectedProject.id).then(eps => { if (!cancelled) setElementParents(eps) })
    return () => { cancelled = true }
  }, [selectedProject, hasEverBeenActive])

  const elementParentErrorMessage = (err: unknown, fallback: string): string => {
    if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') return err.response.data.detail
    return err instanceof Error ? err.message : fallback
  }

  // Whatever's currently the "active" whole mesh-kind object — same
  // candidate-target shape pathBindTarget elsewhere already uses, since
  // both panels bind against "whatever you've got selected right now," not
  // a separate picker.
  const rigChildTarget = activeSceneObject?.kind === 'mesh'
    ? { ref: activeSceneObject.name, label: activeSceneObject.name || 'Object' }
    : null

  const handleSetElementParent = async (parentElementRef: string) => {
    if (!selectedProject || !rigChildTarget) return
    if (pathFollowers.some(f => f.target_kind === 'mesh' && f.element_ref === rigChildTarget.ref)) {
      setElementParentError('This element already follows a Path — unbind it first (Paths panel) before rigging it to a parent')
      return
    }
    try {
      setElementParentError(null)
      const created = await upsertElementParent({
        project_id: selectedProject.id, child_element_ref: rigChildTarget.ref, parent_element_ref: parentElementRef,
      })
      setElementParents(prev => [...prev.filter(ep => ep.child_element_ref !== rigChildTarget.ref), created])
    } catch (err) {
      setElementParentError(elementParentErrorMessage(err, 'Failed to set parent'))
    }
  }
  const handleClearElementParent = async (id: string) => {
    try {
      setElementParentError(null)
      await deleteElementParent(id)
      setElementParents(prev => prev.filter(ep => ep.id !== id))
    } catch (err) {
      setElementParentError(elementParentErrorMessage(err, 'Failed to clear parent'))
    }
  }

  // Mirrors Viewport3D.tsx's own activeObject resolution (its TransformControls
  // gizmo target) so the Properties panel's number fields edit the exact
  // same thing the gizmo does (2026-07-08, per Maro: "the whole ifc model
  // is grouped, even though i select an individual object. using any of the
  // transforms affect the model") — the specific selected sub-element when
  // one's picked, falling back to the whole model otherwise.
  let activeTransformObject: Object3D | null = activeSceneObject?.object ?? null
  let isElementTransform = false
  const activeIfcHandle = activeSceneObject?.kind === 'ifc' ? getIfcHandleFor(activeObjectId) : null

  // TransformPanel's own Location-field unit factor (2026-07-11, per Maro:
  // "rewire units") — re-derived from the active IFC handle's own spatial
  // tree root (same getLengthUnitToMetres call IfcDataPanel.tsx's own
  // ModelItem already makes for its Spatial Decomposition list; a second,
  // cheap getSpatialStructure round trip here rather than threading that
  // panel's own per-model state across to this unrelated one). Stays null
  // — TransformPanel's own no-op passthrough — for a plain mesh import,
  // which has no IfcUnitAssignment to read at all.
  const [activeIfcLengthUnitToMetres, setActiveIfcLengthUnitToMetres] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    setActiveIfcLengthUnitToMetres(null)
    if (!activeIfcHandle) return
    import('./ifcModel').then(({ getSpatialTree, getLengthUnitToMetres }) => {
      getSpatialTree(activeIfcHandle).then(tree => {
        if (cancelled) return
        setActiveIfcLengthUnitToMetres(getLengthUnitToMetres(activeIfcHandle, tree.expressID))
      })
    })
    return () => { cancelled = true }
  }, [activeIfcHandle])
  if (activeIfcHandle && selectedExpressId !== null) {
    // ensureMaterialized, not a plain traverse (2026-07-17) — the
    // TransformPanel gizmo's actual target; a repeated-geometry element
    // selected some way other than a click (handleClick's own materialize
    // call covers that path) could otherwise still be sitting in
    // ifcModel.ts's shared BatchedMesh, silently leaving no gizmo target
    // at all. Safe to call unconditionally every render — idempotent, and
    // a no-op after the first materialization.
    const found = ensureMaterialized(activeIfcHandle.object, selectedExpressId)
    if (found) { activeTransformObject = found; isElementTransform = true }
  }

  // Persists whatever handleTransformChange below just bumped the tick
  // for (2026-07-11, per a real incident — see element_transform.py's own
  // docstring: transform edits had never been saved anywhere at all).
  // Debounced 700ms so a gizmo drag (many onChange calls per second)
  // doesn't fire a save per frame — only once dragging/editing actually
  // stops. modelFileId/object/elementScoped/handle/expressId are captured
  // by closure at the moment of the *call*, not re-read when the timeout
  // fires, so switching the active selection mid-debounce can't corrupt
  // which object's data actually gets saved.
  //
  // flush() lets the selection-change effect further down force this
  // pending save through immediately rather than losing it outright if
  // the user switches to editing something else within the 700ms window
  // — a single shared timeout ref would otherwise just clearTimeout the
  // still-pending save for whatever was being edited before.
  const persistActiveTransform = () => {
    // Deliberately does NOT bail here just because fileId is currently
    // null (2026-07-22 fix, per a real incident found while testing Pivot
    // Rotation: a plain, pre-existing Rotation field edit on "Snowdon
    // Towers Sample Site.ifc" produced zero network activity at all, no
    // error, nothing — this same guard used to also require
    // activeSceneObject.fileId, which silently skipped doSave (and the
    // self-heal/error-surfacing logic inside it, a few lines down) for
    // every single edit on any object whose fileId hadn't resolved yet.
    // That's exactly the "nothing found at all" case doSave's own
    // self-heal comment already says it needs to cover — it just never
    // got the chance to run.
    if (!activeTransformObject || !activeSceneObject) return
    if (brokenModelObjectIdsRef.current.has(activeSceneObject.id)) return
    const modelFileId = activeSceneObject.fileId
    const sceneObjectId = activeSceneObject.id
    const sceneObjectName = activeSceneObject.name
    const sceneObjectKind = activeSceneObject.kind
    const object = activeTransformObject
    const elementScoped = isElementTransform
    const handle = activeIfcHandle
    const expressId = selectedExpressId

    const doSave = async () => {
      let elementRef: string | null = null
      if (elementScoped && handle && expressId !== null) {
        const { getGuidFromExpressId } = await import('./ifcModel')
        elementRef = getGuidFromExpressId(handle, expressId) ?? null
      }
      // Self-heals a stale/never-persisted fileId the same way
      // handleCreateSectionBox's own 2026-07-09 fix already does (2026-07-22,
      // per a real incident: a gizmo drag on "Snowdon Towers Sample
      // Structural.ifc" 404'd on every single save, repeatedly, with the
      // only trace being a console.error nobody would ever see — confirmed
      // directly against the real dev database: model3d_files had zero rows
      // for that file at all, meaning persistModelFile's own fire-and-
      // forget upload — see its own header on why it's fire-and-forget in
      // the first place — never actually landed, most likely a reload or
      // navigation away mid-upload for a real building-scale file. Unlike
      // the Section Box fix, "re-check by name and correct the id" isn't
      // guaranteed to find anything here — the file may never have been
      // persisted under any id — so this also has to cover that case
      // (nothing found at all), not just "found under a different id."
      // Either way, the one thing this must never go back to doing is
      // failing this same edit silently: the whole point of this fix is
      // that a user actively editing an object deserves to know their work
      // isn't being saved, not find out on the next reload.
      let modelFileIdToUse = modelFileId
      const files = await listModel3DFiles(selectedProject!.id).catch(() => null)
      const current = files?.find(f => f.name === sceneObjectName && f.kind === sceneObjectKind)
      if (current && current.id !== modelFileIdToUse) {
        modelFileIdToUse = current.id
        setSceneObjects(prev => prev.map(o => (o.id === sceneObjectId ? { ...o, fileId: current.id } : o)))
      } else if (!current) {
        brokenModelObjectIdsRef.current.add(sceneObjectId)
        addImportError(
          `Couldn't save the last edit to "${sceneObjectName}" — this model was never fully saved to the server ` +
          `(likely a reload or navigation away while a large file was still uploading). Re-import it to fix this ` +
          `and any other unsaved position/rotation/scale edits made since.`,
        )
        return
      }
      // Unreachable in practice — the branches above either heal
      // modelFileIdToUse to a real id or return early — but modelFileId
      // itself is typed string | null (2026-07-22 fix, see this
      // function's own header), so this satisfies the type checker too.
      if (!modelFileIdToUse) return
      try {
        // Carries object.userData.pivotPoint/pivotRotation forward on
        // *every* save, not just a Set Pivot/Pivot Rotation edit itself
        // (2026-07-12, extended 2026-07-22) — a plain gizmo drag must not
        // silently clear a previously-set pivot back to null; see
        // element_transform.py's own schema doc comment on why the backend
        // can't distinguish "not provided" from "explicitly cleared" here.
        const currentPivot = getPivot(object)
        const currentPivotRotation = getPivotRotation(object)
        const saved = await saveElementTransform({
          model3d_file_id: modelFileIdToUse, element_ref: elementRef,
          position_x: object.position.x, position_y: object.position.y, position_z: object.position.z,
          rotation_x: object.rotation.x, rotation_y: object.rotation.y, rotation_z: object.rotation.z,
          scale_x: object.scale.x, scale_y: object.scale.y, scale_z: object.scale.z,
          pivot_x: currentPivot?.x ?? null, pivot_y: currentPivot?.y ?? null, pivot_z: currentPivot?.z ?? null,
          pivot_rotation_x: currentPivotRotation?.x ?? null,
          pivot_rotation_y: currentPivotRotation?.y ?? null,
          pivot_rotation_z: currentPivotRotation?.z ?? null,
        })
        elementTransformsRef.current = [
          ...elementTransformsRef.current.filter(t => !(t.model3d_file_id === saved.model3d_file_id && t.element_ref === saved.element_ref)),
          saved,
        ]
      } catch (err) {
        console.error('Failed to save transform', err)
        addImportError(`Couldn't save the last edit to "${sceneObjectName}" (${sectionBoxErrorMessage(err, 'unknown error')}).`)
      }
    }

    if (pendingTransformSaveRef.current) clearTimeout(pendingTransformSaveRef.current.timeout)
    pendingTransformSaveRef.current = {
      flush: doSave,
      timeout: setTimeout(() => { pendingTransformSaveRef.current = null; doSave() }, 700),
    }
  }

  // Sibling transforms from a multi-object gizmo drag (2026-07-28, per
  // Maro — see Viewport3D.tsx's own handleGizmoChange header: dragging
  // with several objects selected now moves all of them, not just the
  // single active one). Mirrors persistActiveTransform's own self-heal +
  // save logic above, but always whole-object (element_ref null) — a
  // sibling in a multi-select is itself a whole scene object, never an IFC
  // sub-element (selectedExpressIds is a separate, single-object-scoped
  // concept unrelated to this). One independent debounce timer per
  // sibling id, keyed in this Map, so several objects moved in the same
  // drag each get their own 700ms window instead of clobbering a single
  // shared timer the way persistActiveTransform's own ref would.
  const pendingSiblingTransformSavesRef = useRef<Map<string, { timeout: ReturnType<typeof setTimeout>; flush: () => void }>>(new Map())
  const persistSiblingTransform = (sceneObject: SceneObject) => {
    if (brokenModelObjectIdsRef.current.has(sceneObject.id)) return
    const doSave = async () => {
      let modelFileIdToUse = sceneObject.fileId
      const files = await listModel3DFiles(selectedProject!.id).catch(() => null)
      const current = files?.find(f => f.name === sceneObject.name && f.kind === sceneObject.kind)
      if (current && current.id !== modelFileIdToUse) {
        modelFileIdToUse = current.id
        setSceneObjects(prev => prev.map(o => (o.id === sceneObject.id ? { ...o, fileId: current.id } : o)))
      } else if (!current) {
        brokenModelObjectIdsRef.current.add(sceneObject.id)
        addImportError(
          `Couldn't save the last edit to "${sceneObject.name}" — this model was never fully saved to the server ` +
          `(likely a reload or navigation away while a large file was still uploading). Re-import it to fix this ` +
          `and any other unsaved position/rotation/scale edits made since.`,
        )
        return
      }
      if (!modelFileIdToUse) return
      try {
        const object = sceneObject.object
        const currentPivot = getPivot(object)
        const currentPivotRotation = getPivotRotation(object)
        const saved = await saveElementTransform({
          model3d_file_id: modelFileIdToUse, element_ref: null,
          position_x: object.position.x, position_y: object.position.y, position_z: object.position.z,
          rotation_x: object.rotation.x, rotation_y: object.rotation.y, rotation_z: object.rotation.z,
          scale_x: object.scale.x, scale_y: object.scale.y, scale_z: object.scale.z,
          pivot_x: currentPivot?.x ?? null, pivot_y: currentPivot?.y ?? null, pivot_z: currentPivot?.z ?? null,
          pivot_rotation_x: currentPivotRotation?.x ?? null,
          pivot_rotation_y: currentPivotRotation?.y ?? null,
          pivot_rotation_z: currentPivotRotation?.z ?? null,
        })
        elementTransformsRef.current = [
          ...elementTransformsRef.current.filter(t => !(t.model3d_file_id === saved.model3d_file_id && t.element_ref === saved.element_ref)),
          saved,
        ]
      } catch (err) {
        console.error('Failed to save sibling transform', err)
        addImportError(`Couldn't save the last edit to "${sceneObject.name}" (${sectionBoxErrorMessage(err, 'unknown error')}).`)
      }
    }
    const existing = pendingSiblingTransformSavesRef.current.get(sceneObject.id)
    if (existing) clearTimeout(existing.timeout)
    pendingSiblingTransformSavesRef.current.set(sceneObject.id, {
      flush: doSave,
      timeout: setTimeout(() => { pendingSiblingTransformSavesRef.current.delete(sceneObject.id); doSave() }, 700),
    })
  }

  const handleTransformChange = () => {
    setTransformTick(t => t + 1)
    persistActiveTransform()
    // Every other selected object moved right alongside the active one
    // this frame (Viewport3D.tsx's own handleGizmoChange) — persist each
    // of them too, not just the active object persistActiveTransform
    // already covers.
    if (selectedObjectIds.size > 1 && activeObjectId) {
      for (const id of selectedObjectIds) {
        if (id === activeObjectId) continue
        const sceneObject = sceneObjects.find(o => o.id === id)
        if (sceneObject) persistSiblingTransform(sceneObject)
      }
    }
  }

  // Timeline playback's own per-frame re-render signal (TimelinePlayback's
  // onTick, forwarded through Viewport3D's onTimelineTick) — deliberately
  // does NOT call persistActiveTransform (2026-07-22 fix, per a real
  // incident found while testing Pivot Rotation: this used to share
  // handleTransformChange with a real gizmo edit, and since this fires
  // every frame for as long as anything is selected, it perpetually reset
  // persistActiveTransform's own 700ms save-debounce — a manual edit only
  // ever actually saved the moment you deselected the object, letting the
  // last-queued timer finally survive long enough to run). This one only
  // needs TransformPanel's number fields to reflect what playback is doing
  // live; there is nothing here for persistActiveTransform to save in the
  // first place — playback-driven position/rotation is never itself
  // persisted as a manual transform.
  const handleTransformTick = () => setTransformTick(t => t + 1)

  // "Edit Pivot" (2026-07-23) — ensures elementPivot.ts's own pre-pivot
  // snapshot (prePivotPosition/prePivotQuaternion) exists *before* a drag
  // can start mutating position/quaternion, both the moment the toggle
  // arms and again on every selection change while it's already armed
  // (activeTransformObject is a plain per-render value, not memoized, but
  // its identity is still stable across unrelated re-renders of the same
  // selection — same convention the activeIfcHandle effect just above
  // already relies on). ensurePivotSnapshot is idempotent (elementPivot.ts's
  // own ensureSnapshot guard), so re-arming on an object that already has
  // one is a no-op, same as setPivot/setPivotRotation's own first call
  // always was.
  useEffect(() => {
    if (editPivot && activeTransformObject) ensurePivotSnapshot(activeTransformObject)
  }, [editPivot, activeTransformObject])

  // "Set Pivot" (2026-07-12) — see elementPivot.ts's own header. Shared by
  // both the typed X/Y/Z fields (already-local-space point) and the
  // viewport-click catcher (handlePickPivotPoint below, which does the
  // world-to-local conversion first).
  const handleSetPivotPoint = (point: Vector3 | null) => {
    if (!activeTransformObject) return
    setPivot(activeTransformObject, point)
    setPivotPicking(false)
    handleTransformChange()
  }

  // "Pivot Rotation" (2026-07-22) — mirrors handleSetPivotPoint exactly;
  // see PivotRotationSupport's own header for why there's no picking mode.
  const handleSetPivotRotation = (euler: Euler | null) => {
    if (!activeTransformObject) return
    setPivotRotation(activeTransformObject, euler)
    handleTransformChange()
  }

  // Converts the PathAddPointCatcher's world-space hit (Viewport3D.tsx,
  // reused verbatim per its own header) into activeTransformObject's own
  // local space — geometry.translate() and the compensating
  // translateX/Y/Z inside elementPivot.ts's setPivot both operate in that
  // space, the same one TransformPanel's Location fields already read/
  // write.
  const handlePickPivotPoint = (worldPoint: { x: number; y: number; z: number }) => {
    if (!activeTransformObject) return
    activeTransformObject.updateWorldMatrix(true, false)
    const local = activeTransformObject.worldToLocal(new Vector3(worldPoint.x, worldPoint.y, worldPoint.z))
    handleSetPivotPoint(local)
  }

  // "Pivot to Center"/"Pivot to Base" (2026-07-23, per Maro: Snap to
  // Surface resting the *pivot* on a surface isn't useful if the pivot
  // sits at the object's own geometric middle, the default for most
  // imported meshes — the object visibly sinks in halfway instead of
  // resting on its base) — see PivotSupport's own header
  // (TransformPanel.tsx). Computed in world space: Box3().setFromObject
  // already walks every descendant's real geometry with its current
  // transform applied (correct for a multi-mesh Group, not just a single
  // Mesh), and "vertical" is unambiguous in world space (world Z or Y,
  // whichever upAxis says) — unlike guessing which of the object's own
  // *local* axes is "up," which is exactly the reasoning that produced a
  // real bug elsewhere in this same feature (see snapObjectToSurface's own
  // header, Viewport3D.tsx). activeTransformObject.worldToLocal (not its
  // parent's) matches handlePickPivotPoint's own established conversion
  // just above — the space setPivot's own geometry.translate/child-
  // position math expects.
  const handleSetPivotPreset = (mode: 'center' | 'base') => {
    if (!activeTransformObject) return
    // Clears any pivot *position* already set, first (2026-07-23 fix, per
    // a real incident: Box3().setFromObject/worldToLocal below read the
    // object's CURRENT position — if a pivot was already active, that's
    // its pivot-compensated position, not its true pre-pivot one, and
    // worldToLocal silently bakes in whatever offset the existing pivot
    // already introduced. Confirmed live: clicking Center then Base back
    // to back landed Base nowhere near the object at all. setPivot's own
    // null case restores the true pre-pivot position/geometry exactly —
    // same effect as the user clicking Reset first, just automatic here.
    // Synchronous, so there's no visible flash before the real target
    // pivot lands a few lines down.
    setPivot(activeTransformObject, null)
    activeTransformObject.updateWorldMatrix(true, true)
    const box = new Box3().setFromObject(activeTransformObject)
    if (box.isEmpty()) return
    const point = box.getCenter(new Vector3())
    if (mode === 'base') {
      if (settings.upAxis === 'z') point.z = box.min.z
      else point.y = box.min.y
    }
    handleSetPivotPoint(activeTransformObject.worldToLocal(point))
  }

  // Flushes a still-pending debounced transform save immediately if the
  // active selection changes before the 700ms debounce would otherwise
  // fire on its own (2026-07-11) — without this, editing object A then
  // switching to object B within that window would clearTimeout A's
  // still-pending save (persistActiveTransform above) and silently lose
  // it. Also covers unmount, via the same cleanup mechanism. Extended
  // 2026-07-28 to flush every still-pending sibling save too (a multi-
  // object drag's own persistSiblingTransform, above) — same reasoning,
  // one Map entry per sibling instead of the single ref the active object
  // uses.
  useEffect(() => {
    return () => {
      if (pendingTransformSaveRef.current) {
        clearTimeout(pendingTransformSaveRef.current.timeout)
        pendingTransformSaveRef.current.flush()
        pendingTransformSaveRef.current = null
      }
      for (const pending of pendingSiblingTransformSavesRef.current.values()) {
        clearTimeout(pending.timeout)
        pending.flush()
      }
      pendingSiblingTransformSavesRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeObjectId, selectedExpressId])

  // Same specific-element-or-whole-model target as activeTransformObject
  // above, applied to Material/Texture too (2026-07-09 fix, per Maro:
  // "changing a material for one element still changes the whole") —
  // customTextures was always keyed by activeObjectId alone (the whole
  // top-level import), so setting a texture while one specific IFC
  // sub-element was selected still landed on the *whole model*'s override
  // slot, same one used for a deliberate whole-model edit — there was
  // simply no way to address just one element. Elementwise edits now key
  // under `${activeObjectId}::${selectedExpressId}` instead, read by
  // Viewport3D.tsx's ModelObjects per-mesh (checked before falling back to
  // the whole-object key), so the two really are independent overrides now
  // — editing one specific slab's texture no longer touches the model's
  // own whole-object override, or any other element's.
  const activeTextureKey = isElementTransform && activeObjectId ? `${activeObjectId}::${selectedExpressId}` : activeObjectId

  // Clear Materials (2026-07-11, per Maro: "add a clear materials button so
  // i can bulk wipe materials back to imported default") — the existing per-
  // slot ✕ button already restores one channel to its captured original
  // (see this file's own handleClearTexture and elementBaseline.ts's own
  // header on what "original" means), this just does all six at once
  // instead of six separate clicks. Removing each key entirely (rather than
  // looping handleClearTexture per slot, which would leave a now-empty `{}`
  // CustomTextureSet sitting in state) matches handleUnloadModel's own
  // disposeCustomTextureSet usage elsewhere in this file — "no override at
  // all" and "an override object with every slot cleared" should be the
  // exact same state, not two representations of it.
  //
  // 2026-07-11 fix, per Maro: "clear materials doesnt work on bulk" — the
  // very first version only ever cleared activeTextureKey, the *one*
  // primary/last-clicked element. A multi-element pick (e.g. Select by Type
  // scoped to a storey — IfcDataPanel.tsx's own Spatial Decomposition
  // feature) very much expects "clear" to mean every selected element, not
  // just the one that happened to be clicked last — exactly the same
  // bulk-target resolution handleApplyToLinkedMaterial above already solved
  // for the same "one action, many selected elements" shape, so this reuses
  // that identical `${activeObjectId}::${expressID}` per selectedExpressIds
  // key construction. hasAnyActiveTextureOverride shares the same
  // resolution so the button's own visibility can't disagree with what
  // clicking it would actually clear (a second, follow-up fix to the same
  // report — the button was still only checking the *primary* element's
  // own textures, so it could stay hidden entirely when the primary
  // happened to carry no override but other selected elements did).
  //
  // Deliberately declared here, after activeTextureKey/isElementTransform
  // above rather than up near this file's other texture handlers
  // (2026-07-11 fix, per a real crash: "Cannot access 'isElementTransform'
  // before initialization") — hasAnyActiveTextureOverride calls
  // resolveActiveTextureKeys() *immediately*, during render, unlike
  // handleClearAllActiveTextures itself (only invoked later, on click,
  // by which point the whole render's `let`/`const` chain has already run
  // once top-to-bottom) — so it genuinely needs activeIfcHandle to
  // already exist at the point this line executes, not just by the time a
  // user clicks something.
  //
  // Gated on activeIfcHandle, NOT isElementTransform (2026-07-29 fix, per
  // Maro, after a real incident: box-selecting only the columns and
  // applying a material changed the slabs too) — isElementTransform is only
  // ever true for a genuine single-primary-element selection
  // (handleSelectExpressId/handleSelectExpressIds both null out
  // selectedExpressId the instant more than one expressID ends up selected,
  // by design, so a click doesn't pin "primary" to whichever one happened
  // to resolve last). That made this multi-key branch dead code for every
  // *real* multi-element selection — a box-select or Select by Type/Storey
  // covering more than one element always fell through to the
  // single-activeTextureKey branch below, which resolves to the *whole
  // object* the moment isElementTransform is false. Every write that used
  // to go through this (Clear Materials, Opacity, and now Material Preset/
  // texture upload/clear too) landed on the whole-model override instead of
  // just the selected elements. activeIfcHandle only requires "this
  // selection belongs to some loaded IFC model" — the actual per-element
  // fan-out still depends on selectedExpressIds itself, same as before.
  const resolveActiveTextureKeys = (): string[] =>
    activeIfcHandle && activeObjectId && selectedExpressIds.size > 0
      ? [...selectedExpressIds].map(expressID => `${activeObjectId}::${expressID}`)
      : activeTextureKey ? [activeTextureKey] : []
  const hasAnyActiveTextureOverride = resolveActiveTextureKeys().some(key => {
    const set = customTextures[key]
    return (set && Object.keys(set).length > 0) || customOpacity[key] !== undefined
  })
  const handleClearAllActiveTextures = () => {
    const keys = resolveActiveTextureKeys()
    if (keys.length === 0) return
    setCustomTextures(prev => {
      const next = { ...prev }
      let changed = false
      for (const key of keys) {
        const current = next[key]
        if (!current) continue
        disposeCustomTextureSet(current)
        delete next[key]
        changed = true
      }
      return changed ? next : prev
    })
    // Opacity rides along with Clear Materials (2026-07-26) — it's a
    // manual departure from "this element's original imported appearance"
    // same as any texture slot, even though it lives in its own sibling
    // map rather than a CustomTextureSet.
    setCustomOpacity(prev => {
      const next = { ...prev }
      let changed = false
      for (const key of keys) {
        if (next[key] === undefined) continue
        delete next[key]
        changed = true
      }
      return changed ? next : prev
    })
  }

  // See customOpacity's own declaration header for the full "why a bulk,
  // no-separate-apply-step slider" reasoning.
  const handleOpacityChange = (value: number) => {
    const keys = resolveActiveTextureKeys()
    if (keys.length === 0) return
    setCustomOpacity(prev => {
      const next = { ...prev }
      for (const key of keys) next[key] = value
      return next
    })
  }

  // Select Linked / Apply to Linked only make sense for one specific IFC
  // sub-element — see handleSelectLinkedMaterial's own comment above.
  const linkedMaterialsAvailable = isElementTransform && !!activeIfcHandle

  // Keyframe support for whichever object is active (2026-07-08, per Maro:
  // "the blender way with the keyframes as long as you have 3d/ifc object
  // in the scene") — null (keying disabled, TransformPanel greys the dots
  // out) for an IFC selection (whole-model, not a stable per-sub-element
  // identity — same v1 scope as ElementKeyframe itself) or before
  // timelineDateRef has ever been seeded. Recomputed every render rather
  // than memoized: cheap (one filter over a per-project keyframe list), and
  // needs to pick up timelineDateRef.current fresh each time anyway (a ref,
  // not state — see this file's own note by timelineDateRef's declaration).
  let keyframeSupport: KeyframeSupport | null = null
  if (activeSceneObject?.kind === 'mesh' && timelineDateRef.current) {
    const currentDate = timelineDateRef.current
    const keyframesByField: Partial<Record<KeyframeField, ElementKeyframe[]>> = {}
    for (const kf of elementKeyframes.keyframes) {
      if (kf.source_kind !== 'mesh' || kf.element_ref !== activeSceneObject.name) continue
      const arr = keyframesByField[kf.field] ?? (keyframesByField[kf.field] = [])
      arr.push(kf)
    }
    keyframeSupport = {
      currentDate,
      keyframesByField,
      onToggle: (field, currentValue) => {
        const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
        const existing = keyframesByField[field]?.find(k => sameDay(new Date(k.date), currentDate))
        if (existing) elementKeyframes.remove(existing.id)
        else elementKeyframes.upsert('mesh', activeSceneObject.name, field, currentDate, currentValue)
      },
    }
  }
  // Diamond markers on the Timeline scrubber (2026-07-08, per Maro's earlier
  // confirmed scoping answer: "Track markers on the Timeline window's
  // scrubber") — every date the active object is keyed on, across all ten
  // fields (nine transform + path_progress), grouped by day since several
  // fields keyed on the same date is the common case and shouldn't draw
  // overlapping markers. Each group carries its own full ElementKeyframe
  // rows now, not just the bare date (2026-07-12, per Maro: "the keyframes
  // on the timeline need to be movable, editable, deletable") — dragging or
  // deleting a marker acts on every field keyed that day at once, the same
  // "summary row" convention Blender's own dopesheet uses for a per-object
  // track when multiple channels share a frame; editing a single field's own
  // value already goes through TransformPanel's own per-field keyframe dot
  // once you've jumped to that date (which clicking a marker already does).
  const activeObjectKeyframesByDay: { date: Date; keyframes: ElementKeyframe[] }[] = useMemo(() => {
    if (activeSceneObject?.kind !== 'mesh') return []
    const byDay = new Map<string, ElementKeyframe[]>()
    for (const k of elementKeyframes.keyframes) {
      if (k.source_kind !== 'mesh' || k.element_ref !== activeSceneObject.name) continue
      const day = k.date.slice(0, 10)
      const group = byDay.get(day) ?? []
      group.push(k)
      byDay.set(day, group)
    }
    return [...byDay.entries()].map(([day, keyframes]) => ({ date: new Date(day), keyframes }))
  }, [activeSceneObject, elementKeyframes.keyframes])

  // Reschedules every field keyed on dayKeyframes' shared date to newDate —
  // create-at-new-date-then-delete-old, upsert's own "insert or overwrite at
  // this exact date" semantics have no separate "move" operation, matching
  // element_keyframes.py's own POST route (no PATCH exists for this table).
  const handleMoveKeyframes = async (dayKeyframes: ElementKeyframe[], newDate: Date) => {
    for (const k of dayKeyframes) {
      await elementKeyframes.upsert(k.source_kind, k.element_ref, k.field, newDate, k.value)
      await elementKeyframes.remove(k.id)
    }
  }
  const handleDeleteKeyframes = async (dayKeyframes: ElementKeyframe[]) => {
    for (const k of dayKeyframes) await elementKeyframes.remove(k.id)
  }

  // Paste (2026-07-23, per Maro: "allow me to drag and select all keyframe
  // and delete or copy and paste") — AnimationActorsList.tsx's own
  // clipboard already worked out each pasted row's target date (the
  // playhead plus that keyframe's own offset from the earliest copied one)
  // and value; this just does the actual upsert() calls, same "the list
  // component computes what, FourD.tsx does the actual API call" split
  // handleMoveKeyframes/handleDeleteKeyframes just above already use.
  const handleCreateKeyframes = async (
    rows: { sourceKind: ElementKeyframe['source_kind']; elementRef: string; field: KeyframeField; date: Date; value: number }[],
  ) => {
    for (const r of rows) await elementKeyframes.upsert(r.sourceKind, r.elementRef, r.field, r.date, r.value)
  }

  // Reverse (2026-07-23, per Maro: "reverse too") — mirrors the given set
  // in time: groups by (element, field) track, sorts each by date, then
  // swaps every keyframe's own value for the one at its mirrored position
  // (first <-> last, second <-> second-to-last, ...) — dates never move,
  // only which value sits on which date. Same upsert-at-an-existing-date
  // semantics as every other bulk op here; skips a track entirely once it's
  // already symmetric (a 2-keyframe reverse is its own inverse — a second
  // click would otherwise just write back the exact same values it read).
  const handleReverseKeyframes = async (keyframes: ElementKeyframe[]) => {
    const byTrack = new Map<string, ElementKeyframe[]>()
    for (const k of keyframes) {
      const key = `${k.source_kind}:${k.element_ref}:${k.field}`
      const arr = byTrack.get(key)
      if (arr) arr.push(k); else byTrack.set(key, [k])
    }
    for (const track of byTrack.values()) {
      const sorted = [...track].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      const values = sorted.map(k => k.value)
      for (let i = 0; i < sorted.length; i++) {
        const mirrored = values[values.length - 1 - i]
        if (mirrored !== sorted[i].value) {
          await elementKeyframes.upsert(sorted[i].source_kind, sorted[i].element_ref, sorted[i].field, new Date(sorted[i].date), mirrored)
        }
      }
    }
  }

  // Paths panel's "Bind selected" target (2026-07-11) — mesh-kind only
  // this pass, same v1 scope as keyframeSupport just above (a mesh scene
  // object's own filename is a stable identity; an IFC selection has no
  // per-sub-element one yet). Whatever's currently the "active" whole
  // object (same target TransformPanel itself edits), not a bulk/multi
  // selection — a Path binds exactly one target.
  const pathBindTarget = activeSceneObject?.kind === 'mesh'
    ? { kind: 'mesh' as const, ref: activeSceneObject.name, label: activeSceneObject.name || 'Object' }
    : null

  // Path Progress support for the active object (2026-07-11) — mirrors
  // keyframeSupport's own shape/gating exactly, just for the single
  // path_progress field instead of the nine Transform ones. Only non-null
  // when the active mesh object actually has a PathFollower binding —
  // TransformPanel renders nothing extra otherwise.
  let pathProgressSupport: PathProgressSupport | null = null
  if (activeSceneObject?.kind === 'mesh' && timelineDateRef.current) {
    const follower = pathFollowers.find(f => f.target_kind === 'mesh' && f.element_ref === activeSceneObject.name)
    if (follower) {
      const currentDate = timelineDateRef.current
      const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
      const points = elementKeyframes.keyframes.filter(
        k => k.source_kind === 'mesh' && k.field === 'path_progress' && k.element_ref === activeSceneObject.name,
      )
      const exact = points.find(p => sameDay(new Date(p.date), currentDate))
      const value = exact ? exact.value : (points.length > 0 ? points[points.length - 1].value : 0)
      pathProgressSupport = {
        value,
        keyState: exact ? 'exact' : points.length > 0 ? 'other' : 'none',
        onChange: v => elementKeyframes.upsert('mesh', activeSceneObject.name, 'path_progress', currentDate, v),
        onToggleKey: () => {
          if (exact) elementKeyframes.remove(exact.id)
          else elementKeyframes.upsert('mesh', activeSceneObject.name, 'path_progress', currentDate, value)
        },
      }
    }
  }

  // Set Pivot support for the active object (2026-07-12) — see
  // TransformPanel.tsx's own PivotSupport header. Always constructed (not
  // conditionally null like keyframes/pathProgress above) since every
  // object supports pivoting; `point` itself is undefined until one's
  // actually been set.
  const pivotSupport: PivotSupport = {
    point: activeTransformObject ? getPivot(activeTransformObject) : undefined,
    picking: pivotPicking,
    onTogglePicking: () => setPivotPicking(prev => !prev),
    onChange: handleSetPivotPoint,
    onReset: () => handleSetPivotPoint(null),
    onSetToCenter: () => handleSetPivotPreset('center'),
    onSetToBase: () => handleSetPivotPreset('base'),
  }

  // "Pivot Rotation" support (2026-07-22) — mirrors pivotSupport exactly.
  const pivotRotationSupport: PivotRotationSupport = {
    euler: activeTransformObject ? getPivotRotation(activeTransformObject) : undefined,
    onChange: handleSetPivotRotation,
    onReset: () => handleSetPivotRotation(null),
  }

  // Body per window key — WindowChrome (below) owns the shared header/dock-
  // toggle/close, this is just what goes inside it (2026-07-11, per Maro:
  // bring in the Gantt chart + an Animation Timeline placeholder alongside
  // the existing Schedule/Resource Tracking/Resource Usage windows).
  function renderWindowContent(key: WindowKey): React.ReactNode {
    switch (key) {
      case 'schedule':
        return (
          <ScheduleWindow
            activities={scheduleWindowActivities}
            visibleActivities={scheduleVisibleActivities}
            collapsedIds={scheduleCollapsedIds}
            onToggleCollapsed={toggleScheduleCollapsed}
            selectedActivityIds={selectedActivityIds}
            onSelectActivity={handleSelectActivity}
            scrollContainerRef={scheduleScrollRef}
            onScroll={handleScheduleScroll}
            animationProfiles={animationProfiles.profiles}
            modelElementLinks={modelElementLinks}
            subscribeFocusDate={subscribeTimelineFocus}
          />
        )
      case 'gantt':
        // Own scroll container here (2026-07-09, per Maro: "full sync
        // capabilities") rather than letting WindowChrome's outer
        // overflow-auto body scroll it directly — needs a ref + onScroll to
        // wire into the Activity Table's own scrollTop mirror below. Fed
        // scheduleVisibleActivities (the *same* outline-ordered, collapse-
        // filtered list the Activity Table renders), not the raw activities
        // list — same row set/order in both, so a given scrollTop actually
        // lines up the same activities in each pane, and collapsing a WBS
        // summary in the Activity Table also hides its bars here (matching
        // Scheduling.tsx's own paired grid+chart behaviour). No
        // viewportHeight — that GanttChart.tsx prop is for its own
        // transform-based ref handle, a different (single-partner,
        // fixed-height) sync mechanism than the plain native scroll-mirror
        // used here.
        return (
          <div ref={ganttScrollRef} onScroll={e => handleGanttScroll(e.currentTarget.scrollTop)} className="h-full overflow-auto">
            <GanttChart
              activities={scheduleVisibleActivities}
              relationships={relationships}
              resourceAssignments={resourceAssignments}
              selectedActivityIds={selectedActivityIds}
              onSelectActivity={handleSelectActivity}
              zoom={ganttWindowZoom}
              onZoomChange={setGanttWindowZoom}
              subscribeFocusDate={subscribeTimelineFocus}
              horizontalScrollContainerRef={ganttScrollRef}
            />
          </div>
        )
      case 'tracking':
        return (
          <ResourceTrackingWidget
            calendars={calendars}
            trackedResources={resourcesTabData.trackedResources}
            assignmentsByResource={resourcesTabData.assignmentsByResource}
            buckets={resourcesTabData.buckets}
            spreadByResource={resourcesTabData.spreadByResource}
            loading={resourcesTabData.loading}
            spreadFetchError={resourcesTabData.spreadFetchError}
            onRefetchResource={resourcesTabData.refetchResource}
            unit="hours"
            layoutPrefs={layoutPrefs}
            selectedResourceIds={selectedResourceIds}
            onToggleResourceSelected={toggleResourceSelected}
            selectedActivityIds={selectedActivityIds}
            onToggleActivitySelected={toggleActivitySelected}
            collapsedIds={collapsedIds}
            onToggleCollapsed={toggleCollapsed}
          />
        )
      case 'usage':
        return (
          <ResourceUsageProfileWidget
            calendars={calendars}
            trackedResources={resourcesTabData.trackedResources}
            assignmentsByResource={resourcesTabData.assignmentsByResource}
            buckets={resourcesTabData.buckets}
            spreadByResource={resourcesTabData.spreadByResource}
            loading={resourcesTabData.loading}
            layoutPrefs={layoutPrefs}
            unit="hours"
            selectedResourceIds={selectedResourceIds}
            onToggleResourceSelected={toggleResourceSelected}
            selectedActivityIds={selectedActivityIds}
            leftPaneWidth={300}
          />
        )
      case 'timeline':
        return (
          <TimelineWindow
            scheduleStart={timelineRange?.start ?? null}
            scheduleEnd={timelineRange?.end ?? null}
            dateRef={timelineDateRef}
            onDateChange={publishTimelineFocus}
            activities={activities}
            links={modelElementLinks}
            keyframesByDay={activeObjectKeyframesByDay}
            onMoveKeyframes={handleMoveKeyframes}
            onDeleteKeyframes={handleDeleteKeyframes}
            onCreateKeyframes={handleCreateKeyframes}
            onReverseKeyframes={handleReverseKeyframes}
            elementKeyframes={elementKeyframes.keyframes}
            pathFollowers={pathFollowers}
            annotations={resolvedAnnotations}
            animationProfiles={animationProfiles.profiles}
            paths={paths}
            zones={zones}
            cameras={cameras}
            onSelectActor={handleSelectActor}
            seekRequest={timelineSeekRequest}
            speedDaysPerSecond={speedDaysPerSecond}
            onSpeedChange={setSpeedDaysPerSecond}
            timeDisplayMode={timeDisplayMode}
            onTimeDisplayModeChange={handleTimeDisplayModeChange}
            fps={fps}
            onFpsChange={handleFpsChange}
            rawAnimationMeshNames={rawAnimationMeshNames}
            onKeyAnimStart={id => handleKeyAnim('mesh', id, 'anim_start')}
            onKeyAnimEnd={id => handleKeyAnim('mesh', id, 'anim_end')}
          />
        )
    }
  }

  function renderWindow(key: WindowKey) {
    return (
      <WindowChrome
        key={key}
        title={WINDOW_LABELS[key]}
        subtitle={key === 'schedule' ? `${scheduleWindowActivities.length} activit${scheduleWindowActivities.length === 1 ? 'y' : 'ies'} · read-only` : undefined}
        headerActions={(
          <>
            {(key === 'schedule' || key === 'gantt') && (
              // Manual refresh (2026-07-09, per Maro: "sometimes it doesn't
              // pull exactly the activities from the schedule"; then "still
              // doesnt show what's in the schedule even clicking the
              // refresh icon") — re-resolves the live schedule period first
              // (refetchPeriod), not just re-fetching activities under
              // whatever period id was already cached — see this
              // component's own comment on the refetchPeriod effect above
              // for why that distinction is exactly what made the first
              // version of this button not actually fix a stale-period
              // case. refreshSchedule() also runs immediately alongside it
              // (using whatever period is *currently* known) so there's no
              // dead-feeling delay before something visibly happens; if
              // refetchPeriod() turns out to have found a *different* live
              // period, the effect watching `period` fires a second,
              // corrected fetch right after.
              <button
                onClick={() => { refetchPeriod(); refreshSchedule() }}
                disabled={scheduleLoading}
                title="Refresh schedule data from the server"
                className="text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper disabled:opacity-50"
              >
                {scheduleLoading ? '…' : '⟳'}
              </button>
            )}
            {key === 'schedule' && selectedActivityIds.size > 0 && (
              // "Isolate Linked Elements" (2026-07-09, per Maro: "if i
              // click on an activity or activities, i can click to
              // isolate/filter the elements assigned to those activities
              // alone") — only shown at all once something's actually
              // selected in the table, since it's otherwise a guaranteed
              // no-op.
              <button
                onClick={handleIsolateLinkedElements}
                disabled={isolatingLinked}
                title="Isolate the 3D/IFC elements linked to the selected activit(y/ies)"
                className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-prosota-line text-gray-500 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-50"
              >
                {isolatingLinked ? 'Isolating…' : 'Isolate Linked'}
              </button>
            )}
          </>
        )}
        dock={windowDock[key]}
        onToggleDock={() => toggleWindowDock(key)}
        onClose={() => toggleWindow(key)}
      >
        {renderWindowContent(key)}
      </WindowChrome>
    )
  }

  // One ComparisonViewportPane per active slot (2026-08-03) — see
  // paneConfigs' own header for the "why", and comparisonPane.ts for what
  // each contentMode actually resolves to. `active`/props mirrored from
  // the main Viewport3D's own render call just below in the JSX.
  function renderComparisonPane(index: number) {
    const config = paneConfigs[index]
    return (
      <ComparisonViewportPane
        key={index}
        importedObjects={viewportObjects}
        timelineSceneObjects={sceneObjects}
        ifcHandles={ifcHandles}
        upAxis={settings.upAxis}
        fieldOfView={settings.fieldOfView}
        clipStart={settings.clipStart}
        clipEnd={settings.clipEnd}
        environmentUrl={customEnvironment?.url ?? null}
        environmentBackground={settings.environmentBackground}
        whiteBackground={settings.whiteBackground}
        shadows={settings.shadows}
        sunAzimuth={settings.sunAzimuth}
        sunElevation={settings.sunElevation}
        captureBackgroundOverride={baselineBackgroundOverride}
        timelineDateRef={timelineDateRef}
        cameraSyncRef={cameraSyncRef}
        canvasRef={comparisonCanvasRefs[index]}
        dprMultiplier={baselineDprMultiplier}
        activities={activities}
        links={modelElementLinks}
        profiles={animationProfiles.profiles}
        elementKeyframes={elementKeyframes.keyframes}
        paths={resolvedPaths}
        pathFollowers={pathFollowers}
        active={active}
        isolation={config.contentMode === 'baseline' ? null : paneIsolations[index]}
        dateField={config.contentMode === 'baseline' ? 'baseline' : 'live'}
        config={config}
        onConfigChange={next => updatePaneConfig(index, next)}
        onClose={() => removeComparisonPane(index)}
        collections={collections}
        udfDefinitions={activityUdfDefinitions.definitions}
        getUdfValue={activityUdfValues.getValue}
      />
    )
  }

  const topWindows = ALL_WINDOW_KEYS.filter(k => openWindows.has(k) && windowDock[k] === 'top')
  const bottomWindows = ALL_WINDOW_KEYS.filter(k => openWindows.has(k) && windowDock[k] === 'bottom')

  // Every currently-open dockable side panel, tagged with its own preferred
  // side (2026-07-09, per Maro: "make section contextual like profiles...
  // effectively sharing a side dock if i want") — grouped by side just
  // below into what SideDock.tsx actually renders. Adding a third dockable
  // panel later is just a third entry here, not a new rendering path.
  const dockablePanels: (DockedPanel & { dock: PanelSide })[] = []
  if (profilePanelOpen) {
    dockablePanels.push({
      id: 'profiles', label: 'Animation Profiles', dock: profilePanelDock,
      onToggleDock: toggleProfilePanelDock, onClose: toggleProfilePanel,
      content: (
        <AnimationProfilePanel
          profiles={animationProfiles.profiles}
          loading={animationProfiles.loading}
          onCreate={animationProfiles.create}
          onUpdate={animationProfiles.update}
          onDelete={animationProfiles.remove}
        />
      ),
    })
  }
  if (sectionPanelOpen) {
    dockablePanels.push({
      id: 'sections', label: 'Sections', dock: sectionPanelDock,
      onToggleDock: toggleSectionPanelDock, onClose: toggleSectionPanel,
      content: (
        <SectionBoxPanel
          boxes={sectionBoxes}
          canCreate={activeObjectId !== null}
          error={sectionBoxError}
          tool={sectionBoxTool}
          onToolChange={setSectionBoxTool}
          onCreate={handleCreateSectionBox}
          onRename={handleRenameSectionBox}
          onToggleActive={handleToggleSectionBoxActive}
          onToggleVisible={handleToggleSectionBoxVisible}
          onDelete={handleDeleteSectionBox}
        />
      ),
    })
  }
  if (cameraPanelOpen) {
    dockablePanels.push({
      id: 'cameras', label: 'Camera Views', dock: cameraPanelDock,
      onToggleDock: toggleCameraPanelDock, onClose: toggleCameraPanel,
      content: (
        <CameraViewPanel
          views={cameraViews}
          error={cameraViewError}
          onApply={handleApplyCameraView}
          onRename={handleRenameCameraView}
          onDelete={handleDeleteCameraView}
        />
      ),
    })
  }
  if (camerasPanelOpen) {
    dockablePanels.push({
      id: 'cinematic-cameras', label: 'Cameras', dock: camerasPanelDock,
      onToggleDock: toggleCamerasPanelDock, onClose: toggleCamerasPanel,
      content: (
        <CamerasPanel
          cameras={cameras}
          activeCameraId={activeCameraId}
          error={cameraError}
          elementKeyframes={elementKeyframes.keyframes}
          format={timelineRange ? { scheduleStart: timelineRange.start, timeDisplayMode, speedDaysPerSecond, fps } : null}
          onLookThrough={handleLookThroughCamera}
          onExitLookThrough={handleExitCameraView}
          onRename={handleRenameCamera}
          onDelete={handleDeleteCamera}
          onUpdateBase={handleUpdateCameraBase}
          onDeleteKeyframeDate={handleDeleteCameraKeyframeDate}
          onSeekTo={handleSeekTimelineTo}
        />
      ),
    })
  }
  if (collectionsPanelOpen) {
    dockablePanels.push({
      id: 'collections', label: 'Collections', dock: collectionsPanelDock,
      onToggleDock: toggleCollectionsPanelDock, onClose: toggleCollectionsPanel,
      content: (
        <CollectionsPanel
          collections={collections}
          error={collectionError}
          canAddSelected={selectedObjectIds.size > 0 || selectedExpressIds.size > 0}
          onCreate={handleCreateCollection}
          onRename={handleRenameCollection}
          onReparent={handleReparentCollection}
          onDelete={handleDeleteCollection}
          onAddSelected={handleAddSelectedToCollection}
          onRemoveSelected={handleRemoveSelectedFromCollection}
          onSelect={handleSelectCollection}
          onHide={handleHideCollection}
          onUnhide={handleUnhideCollection}
          onIsolate={handleIsolateCollection}
          onSelectMember={handleSelectCollectionMember}
        />
      ),
    })
  }
  if (splitPanelOpen) {
    dockablePanels.push({
      id: 'split', label: 'Split by Level', dock: splitPanelDock,
      onToggleDock: toggleSplitPanelDock, onClose: toggleSplitPanel,
      content: (
        <SplitByLevelPanel
          projectId={selectedProject?.id ?? ''}
          handle={activeIfcHandle}
          selectedExpressIds={selectedExpressIds}
          elementSplits={elementSplits}
          collections={collections}
          onCollectionsChanged={refreshCollections}
          upAxis={settings.upAxis}
          onClose={toggleSplitPanel}
          onSplitsChanged={refreshElementSplits}
        />
      ),
    })
  }
  if (pathsPanelOpen) {
    dockablePanels.push({
      id: 'paths', label: 'Paths', dock: pathsPanelDock,
      onToggleDock: togglePathsPanelDock, onClose: togglePathsPanel,
      content: (
        <PathsPanel
          paths={resolvedPaths}
          error={pathError}
          addingPointsForPathId={addingPointsForPathId}
          upAxis={settings.upAxis}
          bindTarget={pathBindTarget}
          followers={pathFollowers}
          onCreate={handleCreatePath}
          onRename={handleRenamePath}
          onToggleClosed={handleTogglePathClosed}
          onToggleVisible={handleTogglePathVisible}
          onDelete={handleDeletePath}
          onToggleAddPoints={handleToggleAddPathPoints}
          onRemoveLastPoint={handleRemoveLastPathPoint}
          onBind={pathId => { if (pathBindTarget) handleBindPathFollower(pathId, pathBindTarget.kind, pathBindTarget.ref) }}
          onUnbind={handleUnbindPathFollower}
          onToggleOrient={handleTogglePathFollowerOrient}
          onSetHeadingOffset={handleSetPathFollowerHeadingOffset}
          onUpdateStyle={handleUpdatePath}
          onSetElevation={handleSetPathElevation}
          animWindows={pathAnimWindows}
          format={timelineRange ? { scheduleStart: timelineRange.start, timeDisplayMode, speedDaysPerSecond, fps } : null}
          onKeyAnimStart={id => handleKeyAnim('path', id, 'anim_start')}
          onKeyAnimEnd={id => handleKeyAnim('path', id, 'anim_end')}
        />
      ),
    })
  }
  if (zonesPanelOpen) {
    dockablePanels.push({
      id: 'zones', label: 'Zones', dock: zonesPanelDock,
      onToggleDock: toggleZonesPanelDock, onClose: toggleZonesPanel,
      content: (
        <ZonesPanel
          zones={resolvedZones}
          error={zoneError}
          addingPointsForZoneId={addingPointsForZoneId}
          onCreate={handleCreateZone}
          onRename={handleRenameZone}
          onToggleVisible={handleToggleZoneVisible}
          onDelete={handleDeleteZone}
          onToggleAddPoints={handleToggleAddZonePoints}
          onRemoveLastPoint={handleRemoveLastZonePoint}
          onUpdateStyle={handleUpdateZone}
          animWindows={zoneAnimWindows}
          format={timelineRange ? { scheduleStart: timelineRange.start, timeDisplayMode, speedDaysPerSecond, fps } : null}
          onKeyAnimStart={id => handleKeyAnim('zone', id, 'anim_start')}
          onKeyAnimEnd={id => handleKeyAnim('zone', id, 'anim_end')}
        />
      ),
    })
  }
  if (radialChartsPanelOpen) {
    dockablePanels.push({
      id: 'radial-charts', label: 'Radial Charts', dock: radialChartsPanelDock,
      onToggleDock: toggleRadialChartsPanelDock, onClose: toggleRadialChartsPanel,
      content: (
        <RadialChartsPanel
          charts={radialCharts}
          error={radialChartError}
          udfDefinitions={activityUdfDefinitions.definitions}
          activities={activities}
          getUdfValue={activityUdfValues.getValue}
          onCreate={handleCreateRadialChart}
          onRename={handleRenameRadialChart}
          onToggleVisible={handleToggleRadialChartVisible}
          onDelete={handleDeleteRadialChart}
          onUpdateStyle={handleUpdateRadialChart}
          onUpdateScope={handleUpdateRadialChartScope}
          onUploadIcon={handleUploadRadialChartIcon}
        />
      ),
    })
  }
  if (timelineStripPanelOpen && timelineStrip) {
    dockablePanels.push({
      id: 'timeline-strip', label: 'Timeline Strip', dock: timelineStripPanelDock,
      onToggleDock: toggleTimelineStripPanelDock, onClose: toggleTimelineStripPanel,
      content: (
        <TimelineStripPanel
          strip={timelineStrip}
          error={timelineStripError}
          udfDefinitions={activityUdfDefinitions.definitions}
          activities={activities}
          getUdfValue={activityUdfValues.getValue}
          onUpdate={handleUpdateTimelineStrip}
          onUpdateScope={handleUpdateTimelineStripScope}
        />
      ),
    })
  }
  if (siteContextPanelOpen && siteContext) {
    dockablePanels.push({
      id: 'site-context', label: 'Site Context', dock: siteContextPanelDock,
      onToggleDock: toggleSiteContextPanelDock, onClose: toggleSiteContextPanel,
      content: (
        <SiteContextPanel
          ctx={siteContext}
          error={siteContextError}
          apiKey={siteTilesApiKey}
          onUpdate={handleUpdateSiteContext}
          onSaveApiKey={handleSaveSiteTilesApiKey}
        />
      ),
    })
  }
  if (annotationsPanelOpen) {
    dockablePanels.push({
      id: 'annotations', label: '3D Notations', dock: annotationsPanelDock,
      onToggleDock: toggleAnnotationsPanelDock, onClose: toggleAnnotationsPanel,
      content: (
        <AnnotationsPanel
          annotations={resolvedAnnotations}
          error={annotationError}
          addingKind={addingAnnotationKind}
          bindTarget={pathBindTarget}
          activities={activities}
          modelElementLinks={modelElementLinks}
          animationProfiles={animationProfiles.profiles}
          onStartAdding={kind => setAddingAnnotationKind(prev => (prev === kind ? null : kind))}
          onUpdate={handleUpdateAnnotation}
          onDelete={handleDeleteAnnotation}
          onBindLeader={handleBindAnnotationLeader}
          onUnbindLeader={handleUnbindAnnotationLeader}
          onLinkActivity={handleLinkAnnotationToActivity}
          onUnlinkActivity={handleUnlinkElement}
          onAssignProfile={handleAssignProfile}
          animWindows={annotationAnimWindows}
          format={timelineRange ? { scheduleStart: timelineRange.start, timeDisplayMode, speedDaysPerSecond, fps } : null}
          onKeyAnimStart={id => handleKeyAnim('annotation', id, 'anim_start')}
          onKeyAnimEnd={id => handleKeyAnim('annotation', id, 'anim_end')}
        />
      ),
    })
  }
  if (clashPanelOpen) {
    dockablePanels.push({
      id: 'clash', label: 'Clash Detective', dock: clashPanelDock,
      onToggleDock: toggleClashPanelDock, onClose: toggleClashPanel,
      content: (
        <ClashDetectionPanel
          collections={collections}
          clashTests={clashTests}
          error={clashError}
          runProgress={clashRunProgress}
          onCreate={handleCreateClashTest}
          onDelete={handleDeleteClashTest}
          onRun={handleRunClashTest}
          onUpdateResult={handleUpdateClashResult}
          onSelectPair={handleSelectClashPair}
        />
      ),
    })
  }
  if (progressVariancePanelOpen) {
    dockablePanels.push({
      id: 'progress-variance', label: 'Point Cloud', dock: progressVariancePanelDock,
      onToggleDock: toggleProgressVariancePanelDock, onClose: toggleProgressVariancePanel,
      content: (
        <ProgressVariancePanel
          collections={collections}
          siteCaptures={siteCaptures}
          tests={progressVarianceTests}
          error={progressVarianceError}
          runProgress={progressVarianceRunProgress}
          loadedCaptureIds={loadedCaptureIds}
          uploadingCapture={uploadingCapture}
          convertingCaptureId={convertingCaptureId}
          generatingIfcCaptureId={generatingIfcCaptureId}
          onUploadCapture={handleUploadSiteCapture}
          onDeleteCapture={handleDeleteSiteCapture}
          onToggleLoadCapture={handleToggleLoadCapture}
          onConvertCapture={handleConvertSiteCapture}
          onGenerateIfc={handleGenerateIfcFromCapture}
          onCreateTest={handleCreateProgressVarianceTest}
          onDeleteTest={handleDeleteProgressVarianceTest}
          onRunTest={handleRunProgressVarianceTest}
          onUpdateThreshold={handleUpdateProgressVarianceThreshold}
          onUpdateResult={handleUpdateProgressVarianceResult}
          onSelectElement={handleSelectVarianceElement}
          activityProgressSuggestions={activityProgressSuggestions}
          applyingActivityId={applyingActivityId}
          onApplyActivityProgress={handleApplyActivityProgress}
        />
      ),
    })
  }
  if (rigPanelOpen) {
    dockablePanels.push({
      id: 'rigging', label: 'Rigging', dock: rigPanelDock,
      onToggleDock: toggleRigPanelDock, onClose: toggleRigPanel,
      content: (
        <ElementRigPanel
          elementParents={elementParents}
          error={elementParentError}
          childTarget={rigChildTarget}
          selectedButUnsupported={!!activeSceneObject && activeSceneObject.kind !== 'mesh'}
          meshOptions={meshImports.map(o => ({ ref: o.name, label: o.name || 'Object' }))}
          onSetParent={handleSetElementParent}
          onClearParent={handleClearElementParent}
        />
      ),
    })
  }
  if (measurementsPanelOpen) {
    dockablePanels.push({
      id: 'measurements', label: 'Measurements', dock: measurementsPanelDock,
      onToggleDock: toggleMeasurementsPanelDock, onClose: toggleMeasurementsPanel,
      content: (
        <MeasurementsPanel
          measurements={measurements}
          error={measurementError}
          unitPreference={ifcUnitDisplay}
          measuringTool={measuringTool}
          measuringPointCount={measuringPoints.length}
          selectedId={selectedMeasurementId}
          onStart={handleStartMeasuring}
          onRename={handleRenameMeasurement}
          onToggleVisible={handleToggleMeasurementVisible}
          onDelete={handleDeleteMeasurement}
          onSelect={setSelectedMeasurementId}
        />
      ),
    })
  }
  const leftDockPanels = dockablePanels.filter(p => p.dock === 'left')
  const rightDockPanels = dockablePanels.filter(p => p.dock === 'right')

  // Pulled out to a plain variable (2026-07-12, per the Compare Baseline
  // feature below) rather than inlined in the JSX — needs to render in one
  // of several different structural positions (standalone, or as
  // SplitRow's first child alongside one or more ComparisonViewportPane
  // panes) depending on how many comparison panes are open
  // (paneConfigs.length), and JSX itself can't express "reuse this exact
  // element in two different spots" without either a variable or
  // duplicating the entire prop list.
  const viewport3DElement = (
    <Viewport3D
      key="primary"
      settings={settings}
      importedObjects={viewportObjects}
      meshAnimWindows={meshAnimWindows}
      selectedExpressId={selectedExpressId}
      selectedExpressIds={selectedExpressIds}
      onSelect={handleSelectExpressId}
      activeObjectId={activeObjectId}
      selectedObjectIds={selectedObjectIds}
      onSelectObject={handleSelectObject}
      onSelectAll={handleSelectAll}
      materializeVersion={materializeVersion}
      onMaterializeAll={() => setMaterializeVersion(v => v + 1)}
      onBoxSelect={handleBoxSelect}
      linkedObjectIds={linkedMeshObjectIds}
      linkedElementKeys={linkedIfcElementKeys}
      onSelectUnassigned={handleSelectUnassigned}
      onFilterApply={handleFilterApply}
      isolateMode={isolateMode}
      isolatedObjectIds={isolatedObjectIds}
      isolatedExpressIds={isolatedExpressIds}
      hiddenExpressIds={hiddenExpressIds}
      onToggleIsolate={handleToggleIsolate}
      onShowAll={handleShowAll}
      onHideSelected={handleHideSelected}
      onUnloadSelected={handleUnloadSelected}
      linkedActivitiesWidget={
        <LinkedActivitiesWidget
          activities={activities.filter(a => isolatedLinkedActivityIds.has(a.id))}
          selectedActivityIds={selectedActivityIds}
          onSelectActivity={handleSelectActivity}
        />
      }
      gizmoMode={gizmoMode}
      gizmoSpace={gizmoSpace}
      editPivot={editPivot}
      snapToSurface={snapToSurface}
      onTransformChange={handleTransformChange}
      onTimelineTick={handleTransformTick}
      environmentUrl={customEnvironment?.url ?? null}
      onEnvironmentError={handleEnvironmentError}
      customTextures={customTextures}
      customOpacity={customOpacity}
      cameraSyncRef={cameraSyncRef}
      comparisonCanvasRefs={comparisonCanvasRefs.slice(0, paneConfigs.length)}
      onCaptureQualityChange={setBaselineDprMultiplier}
      onCaptureBackgroundChange={setBaselineBackgroundOverride}
      costProfileBuckets={costProfileBuckets}
      costProfileValues={costProfileValues}
      costProfileResourceBreakdown={costProfileResourceBreakdown}
      timelineDateRef={timelineDateRef}
      timelineSceneObjects={sceneObjects}
      timelineActivities={activities}
      timelineLinks={modelElementLinks}
      timelineProfiles={animationProfiles.profiles}
      timelineElementKeyframes={elementKeyframes.keyframes}
      scheduleStart={timelineRange?.start ?? null}
      scheduleEnd={timelineRange?.end ?? null}
      ifcHandles={ifcHandles}
      active={active}
      sectionBoxes={resolvedSectionBoxes}
      onSectionBoxDragMove={handleSectionBoxDragMove}
      onSectionBoxDragEnd={handleSectionBoxDragEnd}
      onSectionBoxRotateMove={handleSectionBoxRotateMove}
      onSectionBoxRotateEnd={handleSectionBoxRotateEnd}
      sectionBoxTool={sectionBoxTool}
      onSaveCameraView={handleSaveCameraView}
      applyCameraViewRequest={applyCameraViewRequest}
      cameras={cameras}
      activeCameraId={activeCameraId}
      onAddCamera={handleAddCamera}
      onExitCameraView={handleExitCameraView}
      onKeyCameraPose={handleKeyCameraPose}
      siteContext={siteContext}
      siteTilesApiKey={siteTilesApiKey}
      onExportVideo={handleExportVideoUpload}
      paths={resolvedPaths}
      pathAnimWindows={pathAnimWindows}
      pathFollowers={pathFollowers}
      addingPointsForPathId={addingPointsForPathId}
      onPathDragMove={handlePathDragMove}
      onPathDragEnd={handlePathDragEnd}
      onAddPathPoint={handleAddPathPoint}
      zones={resolvedZones}
      zoneAnimWindows={zoneAnimWindows}
      addingPointsForZoneId={addingPointsForZoneId}
      onZoneDragMove={handleZoneDragMove}
      onZoneDragEnd={handleZoneDragEnd}
      onAddZonePoint={handleAddZonePoint}
      radialCharts={radialCharts}
      radialChartMatchingIds={radialChartMatchingIds}
      onCommitRadialChartPosition={handleCommitRadialChartPosition}
      timelineStrip={timelineStrip}
      timelineStripMatchingIds={timelineStripMatchingIds}
      onCommitTimelineStripPosition={handleCommitTimelineStripPosition}
      annotations={resolvedAnnotations}
      addingAnnotationKind={addingAnnotationKind}
      onPlaceAnnotation={handlePlaceAnnotation}
      selectedAnnotationId={selectedAnnotationId}
      onSelectAnnotation={setSelectedAnnotationId}
      onAnnotationDragMove={handleAnnotationDragMove}
      onAnnotationDragEnd={handleAnnotationDragEnd}
      onAnnotationLeaderDragStart={handleAnnotationLeaderDragStart}
      onAnnotationLeaderDragMove={handleAnnotationLeaderDragMove}
      onAnnotationLeaderDragEnd={handleAnnotationLeaderDragEnd}
      annotationAnimWindows={annotationAnimWindows}
      varianceByElementKey={varianceByElementKey}
      clashByElementKey={clashByElementKey}
      pivotPicking={pivotPicking}
      onPickPivotPoint={handlePickPivotPoint}
      elementParents={elementParents}
      measurements={measurements}
      unitPreference={ifcUnitDisplay}
      selectedMeasurementId={selectedMeasurementId}
      onSelectMeasurement={setSelectedMeasurementId}
      measuringTool={measuringTool}
      measuringPoints={measuringPoints}
      measuringToMetres={measuringToMetres}
      onMeasurementHit={handleMeasurementHit}
      measurementHoverPoint={measurementHoverPoint}
      onMeasurementHoverPoint={setMeasurementHoverPoint}
    />
  )

  if (!selectedProject) return null

  return (
    <div className="h-screen flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-prosota-line bg-white dark:bg-prosota-panel shrink-0 flex-wrap">
        <h1 className="text-sm font-bold text-gray-900 dark:text-prosota-paper mr-2">4D</h1>
        {ALL_WINDOW_KEYS.map(key => (
          <button
            key={key}
            onClick={() => toggleWindow(key)}
            className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
              openWindows.has(key) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            {WINDOW_LABELS[key]}
          </button>
        ))}
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <DockLayoutMenu
          layouts={dockLayouts.layouts}
          loading={dockLayouts.loading}
          onApply={handleApplyDockLayout}
          onSaveNew={handleSaveDockLayout}
          onOverwrite={handleOverwriteDockLayout}
          onDelete={dockLayouts.remove}
          onReset={handleResetDockLayout}
        />
        <button
          onClick={toggleProfilePanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            profilePanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Profiles
        </button>
        <button
          onClick={toggleSectionPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            sectionPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Sections
        </button>
        <button
          onClick={toggleCameraPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            cameraPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Camera Views
        </button>
        <button
          onClick={toggleCamerasPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            camerasPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Cameras
        </button>
        <button
          onClick={toggleCollectionsPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            collectionsPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Collections
        </button>
        <button
          onClick={toggleSplitPanel}
          title="Split a selected element by level — cut a tall vertical element into independently-linkable, independently-animating per-storey pieces"
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            splitPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Split by Level
        </button>
        <button
          onClick={togglePathsPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            pathsPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Paths
        </button>
        <button
          onClick={toggleZonesPanel}
          title="Filled, labeled ground-plane areas — project boundary, laydown/exclusion zones"
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            zonesPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Zones
        </button>
        <button
          onClick={toggleRadialChartsPanel}
          title="Draggable radial progress-ring HUD overlays, e.g. one per discipline, filterable by a User Defined Field"
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            radialChartsPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Radial Charts
        </button>
        <button
          onClick={toggleTimelineStripPanel}
          disabled={!timelineStrip}
          title="A draggable year/month timeline HUD strip with a live playhead"
          className={`text-xs px-2.5 py-1 rounded-md border font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
            timelineStripPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Timeline Strip
        </button>
        <button
          onClick={toggleSiteContextPanel}
          disabled={!siteContext}
          title="Real-world Google Photorealistic 3D Tiles around the model"
          className={`text-xs px-2.5 py-1 rounded-md border font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
            siteContextPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Site Context
        </button>
        <button
          onClick={toggleAnnotationsPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            annotationsPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          3D Notations
        </button>
        <button
          onClick={toggleClashPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            clashPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Clash Detective
        </button>
        <button
          onClick={toggleProgressVariancePanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            progressVariancePanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Point Cloud
        </button>
        <button
          onClick={toggleRigPanel}
          title="Rig one part as the child of another (crane base -> jib -> trolley -> hook) — rotating/moving the parent carries the child along"
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            rigPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Rigging
        </button>
        <button
          onClick={toggleMeasurementsPanel}
          title="Measure a length between 2 points, an area across several, or an area straight off a clicked element surface"
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            measurementsPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Measure
        </button>
        <button
          onClick={toggleCompareBaseline}
          title="Dock a second, read-only viewport alongside this one — Baseline by default, or set it to isolate a Collection/UDF/WBS scope instead (see the pane's own header controls)"
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            paneConfigs.length > 0 ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          Compare Baseline
        </button>
        {paneConfigs.length > 0 && paneConfigs.length < MAX_COMPARISON_PANES && (
          <button
            onClick={addComparisonPane}
            title="Add another comparison viewport (up to 3 total, stacked on the right)"
            className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-prosota-line text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 font-medium"
          >
            +
          </button>
        )}
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <input ref={importInputRef} type="file" accept=".glb,.gltf,.obj,.fbx,.ifc,.mtl,.jpg,.jpeg,.png,.xyz,.e57" multiple onChange={handleFileSelected} className="hidden" />
        <button
          onClick={() => importInputRef.current?.click()}
          disabled={importing}
          title="Import a GLTF/GLB, OBJ, FBX, or IFC model into the viewport. Exporting from Revit? File type IFC (not IfcXML/zip) — turn on Export base quantities (Property Sets tab) and Keep Tessellated Geometry as Triangulation (Advanced tab)."
          className="text-xs px-2.5 py-1 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-50"
        >
          ⬆ Import Model
        </button>
        {importing && uploadProgress.size === 0 && <span className="text-xs text-gray-400 dark:text-prosota-muted">Importing…</span>}
        {/* Visible counterpart to the beforeunload guard above (2026-07-17,
            per Maro: "force a save and recall ifc after every refresh") —
            the browser prompt only ever fires at the moment of an actual
            refresh/close, which tells the user nothing while they're still
            deciding whether it's safe to leave. A real byte-count
            percentage per upload (2026-07-28, per Maro: "show a percentage
            save") replaces the old plain "Saving N models…" count, which
            said nothing about how far along any of them actually were. */}
        {[...uploadProgress.values()].map(({ name, percent }, i) => (
          <span
            key={i}
            className="text-xs text-amber-600"
            title={`"${name}" is still uploading to the server — refreshing now would lose it. Wait for this to clear before reloading.`}
          >
            ⏳ {name} {percent}%
          </span>
        ))}
        {ifcHandles.length > 0 && (
          <button
            onClick={() => setScheduleWizardOpen(true)}
            title="Scan the loaded IFC model's structural elements and generate a first-draft, resource-loaded schedule from them"
            className="text-xs px-2.5 py-1 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
          >
            Generate Schedule
          </button>
        )}
        {textureError && <span className="text-xs text-red-600 dark:text-red-400">{textureError}</span>}
        {linkError && <span className="text-xs text-red-600 dark:text-red-400">{linkError}</span>}
        {/* A collapsed badge, not a stack of permanent full-width banners
            (2026-07-28, per Maro: "dont print that nonsense any more, its
            unsightly" — see ImportErrorsBadge.tsx's own header). Same
            toolbar row the old inline version used to sit below. */}
        <ImportErrorsBadge
          errors={importErrors}
          onDismissOne={i => setImportErrors(prev => prev.filter((_, j) => j !== i))}
          onDismissAll={() => setImportErrors([])}
        />
      </div>

      <div className="flex flex-1 min-h-0">
        <PropertiesPanel
          open={propertiesOpen}
          onToggle={toggleProperties}
          settings={settings}
          onSettingsChange={setSettings}
          environmentName={customEnvironment?.name ?? null}
          onUploadEnvironment={handleUploadEnvironment}
          onClearEnvironment={handleClearEnvironment}
          environmentError={environmentError}
          activeObject={activeSceneObject && activeTransformObject ? {
            id: activeSceneObject.id, name: activeSceneObject.name, sourceUpAxis: activeSceneObject.sourceUpAxis, object: activeTransformObject,
          } : null}
          isElementTransform={isElementTransform}
          onTransformChange={handleTransformChange}
          lengthUnitToMetres={activeIfcLengthUnitToMetres}
          unitDisplay={ifcUnitDisplay}
          gizmoMode={gizmoMode}
          onGizmoModeChange={setGizmoMode}
          gizmoSpace={gizmoSpace}
          onGizmoSpaceChange={setGizmoSpace}
          editPivot={editPivot}
          onEditPivotChange={setEditPivot}
          snapToSurface={snapToSurface}
          onSnapToSurfaceChange={setSnapToSurface}
          /* First of resolveActiveTextureKeys(), not activeTextureKey (2026-07-29
             fix, alongside the same function's write-path fix above) — for a
             real multi-element selection activeTextureKey resolves to the
             whole-object key, which nothing here writes to any more, so the
             panel would otherwise show "no override" even right after
             applying one. Showing the primary/first selected element's own
             state keeps this preview honest about what a Clear click would
             actually remove. */
          activeObjectTextures={resolveActiveTextureKeys()[0] ? customTextures[resolveActiveTextureKeys()[0]] : undefined}
          activeOpacity={resolveActiveTextureKeys()[0] ? customOpacity[resolveActiveTextureKeys()[0]] : undefined}
          onOpacityChange={handleOpacityChange}
          onUploadTexture={handleUploadActiveTexture}
          onTextureFieldChange={handleTextureFieldChange}
          onClearAllTextures={handleClearAllActiveTextures}
          hasAnyActiveTextureOverride={hasAnyActiveTextureOverride}
          onClearTexture={handleClearActiveTexture}
          materialPresets={materialPresets.presets}
          materialPresetsLoading={materialPresets.loading}
          onApplyMaterialPreset={handleApplyMaterialPreset}
          onCreateMaterialPreset={materialPresets.create}
          onUpdateMaterialPreset={materialPresets.update}
          onDeleteMaterialPreset={materialPresets.remove}
          linkedMaterialsAvailable={linkedMaterialsAvailable}
          onSelectLinkedMaterial={handleSelectLinkedMaterial}
          onApplyToLinkedMaterial={handleApplyToLinkedMaterial}
          keyframeSupport={keyframeSupport}
          pathProgress={pathProgressSupport}
          pivot={pivotSupport}
          pivotRotation={pivotRotationSupport}
          onChangeSourceUpAxis={axis => { if (activeObjectId) handleSetSourceUpAxis(activeObjectId, axis) }}
        />
        <SideDock side="left" panels={leftDockPanels} />

        <div className="flex-1 flex flex-col min-w-0 p-3">
          {topWindows.length > 0 && (
            <>
              <div className="flex flex-col overflow-hidden" style={{ height: topDockHeight }}>
                <SplitRow ratios={topSplitRatios} onRatiosChange={setTopSplitRatios}>{topWindows.map(key => renderWindow(key))}</SplitRow>
              </div>
              <DockDivider onDrag={dy => setTopDockHeight(h => Math.max(120, h + dy))} />
            </>
          )}

          {paneConfigs.length > 0 ? (
            <SplitRow ratios={compareSplitRatios} onRatiosChange={setCompareSplitRatios}>
              {[
                viewport3DElement,
                paneConfigs.length === 1
                  ? renderComparisonPane(0)
                  : (
                    <SplitRow key="comparison-stack" orientation="column" ratios={paneColumnRatios} onRatiosChange={setPaneColumnRatios}>
                      {paneConfigs.map((_, index) => renderComparisonPane(index))}
                    </SplitRow>
                  ),
              ]}
            </SplitRow>
          ) : viewport3DElement}

          {bottomWindows.length > 0 && (
            <>
              <DockDivider onDrag={dy => setBottomDockHeight(h => Math.max(120, h - dy))} />
              <div className="flex flex-col overflow-hidden" style={{ height: bottomDockHeight }}>
                <SplitRow ratios={bottomSplitRatios} onRatiosChange={setBottomSplitRatios}>{bottomWindows.map(key => renderWindow(key))}</SplitRow>
              </div>
            </>
          )}
        </div>

        <SideDock side="right" panels={rightDockPanels} />
        <DataPanel
          open={dataPanelOpen}
          onToggle={toggleDataPanel}
          activeTab={dataTab}
          onTabChange={setDataTab}
          ifcHandles={ifcHandles}
          activeObjectId={activeObjectId}
          selectedExpressId={selectedExpressId}
          selectedExpressIds={selectedExpressIds}
          onSelectExpressId={handleSelectExpressId}
          onSelectMany={handleSelectExpressIds}
          onUnloadIfc={requestUnloadModel}
          unloadedCountByModelId={unloadedCountByModelId}
          onReloadIfc={id => {
            const target = sceneObjects.find(o => o.id === id)
            if (target?.fileId) setReloadIfcTarget({ objectId: id, fileId: target.fileId, fileName: target.name })
          }}
          meshImports={meshImports}
          hiddenIds={hiddenIds}
          onToggleMeshVisible={toggleMeshVisible}
          onUnloadMesh={requestUnloadModel}
          selectedObjectIds={selectedObjectIds}
          onSelectObject={handleSelectObject}
          unsavedObjectIds={unsavedObjectIds}
          unitDisplay={ifcUnitDisplay}
          onUnitDisplayChange={setIfcUnitDisplay}
          activities={activities}
          modelElementLinks={modelElementLinks}
          animationProfiles={animationProfiles.profiles}
          onLinkElement={handleLinkElement}
          onUnlinkElement={handleUnlinkElement}
          onAssignProfile={handleAssignProfile}
        />
      </div>
      {pendingImports[0] && (
        <ImportModelDialog
          files={pendingImports[0]}
          kind="mesh"
          queuePosition={pendingImports.length > 1 ? { remaining: pendingImports.length } : undefined}
          onConfirm={handleConfirmImport}
          onCancel={() => setPendingImports(prev => prev.slice(1))}
        />
      )}
      {scheduleWizardOpen && selectedProject && period && (
        <IfcScheduleWizard
          models={ifcHandles.map(handle => ({
            handle,
            name: sceneObjects.find(o => o.id === `ifc-${handle.modelID}`)?.name ?? handle.object.name ?? 'Imported Model',
          }))}
          calendars={calendars}
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          schedulePeriodId={period.id}
          onCancel={() => setScheduleWizardOpen(false)}
          onGenerated={() => {
            setScheduleWizardOpen(false)
            refreshSchedule()
            listModelElementLinks(selectedProject.id).then(links => setModelElementLinks(links))
          }}
        />
      )}
      {pendingUnload && (
        <UnloadModelDialog
          name={pendingUnload.name}
          linkCount={pendingUnload.linkIds.length}
          keyframeCount={pendingUnload.keyframeIds.length}
          onUnloadOnly={() => handleConfirmUnload(false)}
          onUnloadAndDelete={() => handleConfirmUnload(true)}
          onCancel={() => setPendingUnload(null)}
        />
      )}
      {pendingElementUnload && (
        <UnloadModelDialog
          name={`${pendingElementUnload.expressIds.length} selected element${pendingElementUnload.expressIds.length === 1 ? '' : 's'}`}
          linkCount={pendingElementUnload.linkIds.length}
          keyframeCount={pendingElementUnload.keyframeIds.length}
          onUnloadOnly={() => handleConfirmElementUnload(false)}
          onUnloadAndDelete={() => handleConfirmElementUnload(true)}
          onCancel={() => setPendingElementUnload(null)}
        />
      )}
      {reloadIfcTarget && (
        <ReloadIfcDialog
          fileName={reloadIfcTarget.fileName}
          unloadedElements={unloadedElementsByFileId.get(reloadIfcTarget.fileId) ?? []}
          onReload={handleReloadIfc}
          onCancel={() => setReloadIfcTarget(null)}
        />
      )}
    </div>
  )
}
