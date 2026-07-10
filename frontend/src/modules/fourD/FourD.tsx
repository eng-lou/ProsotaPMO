import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { Object3D } from 'three'
import axios from 'axios'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { GanttChart } from '@/modules/scheduling/GanttChart'
import { loadGanttZoom, saveGanttZoom, type GanttZoom } from '@/modules/scheduling/ganttZoom'
import { loadResourcesLayout } from '@/modules/scheduling/resourcesLayout'
import { ResourceTrackingWidget } from '@/modules/scheduling/ResourceTrackingWidget'
import { ResourceUsageProfileWidget } from '@/modules/scheduling/ResourceUsageProfileWidget'
import { useResourcesTabData } from '@/modules/scheduling/useResourcesTabData'
import type { Activity, ActivityRelationship, Calendar, Resource, ResourceAssignment } from '@/modules/scheduling/types'
import { disposeObject3D, loadModel3DFile } from './import3d'
import { loadCustomEnvironment } from './environmentHdr'
import { disposeCustomTextureSet, loadCustomTexture, type CustomTextureSet, type TextureSlot } from './customTextures'
import {
  loadPresetAsTextureSet, textureSetToPresetConfig, useMaterialPresets,
  EMPTY_MATERIAL_PRESET_CONFIG, type MaterialPresetConfig,
} from './materialPresets'
import { findLinkedExpressIds } from './linkedMaterials'
import { resolveActivityLinksToIsolationTargets, resolveElementRefsToTargets, resolveIsolationTargetsToActivityIds } from './linkedElements'
import { LinkedActivitiesWidget } from './LinkedActivitiesWidget'
import { assignAnimationProfile, createModelElementLink, deleteModelElementLink, listModelElementLinks, type ModelElementLink, type SourceKind } from './modelElementLinks'
import { deleteModel3DFile, downloadModel3DFile, listModel3DFiles, uploadModel3DFile, type Model3DKind } from './model3dFiles'
import { createSectionBox, deleteSectionBox, listSectionBoxes, updateSectionBox, type SectionBox, type SectionBoxBounds } from './sectionBoxes'
import { computeLocalBoundsForObject } from './sectionBoxGeometry'
import { AnimationProfilePanel } from './AnimationProfilePanel'
import { SideDock, type DockedPanel, type PanelSide } from './SideDock'
import { SectionBoxPanel } from './SectionBoxPanel'
import { createCameraView, deleteCameraView, listCameraViews, updateCameraView, type CameraView, type CameraViewPose } from './cameraViews'
import { CameraViewPanel } from './CameraViewPanel'
import {
  addCollectionMember, createCollection, deleteCollection, listCollections, updateCollection,
  type Collection as CollectionType, type CollectionMember,
} from './collections'
import { CollectionsPanel } from './CollectionsPanel'
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
import { DataPanel, type DataPanelTab } from './DataPanel'
import { DockDivider } from './DockDivider'
import { PropertiesPanel } from './PropertiesPanel'
import { computeVisibleActivities, ScheduleWindow } from './ScheduleWindow'
import { SplitRow } from './SplitRow'
import { TimelineWindow } from './TimelineWindow'
import { computeKeyframeRange, computeScheduleRange, padDegenerateRange, unionRanges } from './timelinePlayback'
import type { GizmoMode, KeyframeSupport } from './TransformPanel'
import { Viewport3D, type ImportedObject, type ResolvedSectionBox } from './Viewport3D'
import { ImportModelDialog } from './ImportModelDialog'
import { UnloadModelDialog } from './UnloadModelDialog'
import type { UpAxis } from './upAxis'
import { loadViewerSettings, saveViewerSettings, type ViewerSettings } from './viewerSettings'
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
const COLLECTIONS_PANEL_OPEN_KEY = 'prosota_4d_collections_panel_open'
const COLLECTIONS_PANEL_DOCK_KEY = 'prosota_4d_collections_panel_dock'
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
export function FourD({ active = true }: { active?: boolean } = {}) {
  const { selectedProject } = useProject()
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
    if (!selectedProject) return
    let cancelled = false
    listModelElementLinks(selectedProject.id).then(links => { if (!cancelled) setModelElementLinks(links) })
    return () => { cancelled = true }
  }, [selectedProject])

  const handleLinkElement = async (sourceKind: SourceKind, elementRef: string, elementLabel: string, activityId: string) => {
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
    if (!selectedProject) return
    let cancelled = false
    listSectionBoxes(selectedProject.id).then(boxes => { if (!cancelled) setSectionBoxes(boxes) })
    return () => { cancelled = true }
  }, [selectedProject])

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
      // session, see ifcModel.ts).
      let elementRef: string | null = null
      let boundsTarget = target.object
      if (target.kind === 'ifc' && selectedExpressId !== null) {
        const handle = getIfcHandleFor(target.id)
        if (handle) {
          let found: Object3D | null = null
          handle.object.traverse(child => { if (!found && child.userData.expressID === selectedExpressId) found = child })
          if (found) {
            boundsTarget = found
            const { getElementInfo } = await import('./ifcModel')
            elementRef = (await getElementInfo(handle, selectedExpressId)).globalId
          }
        }
      }
      const bounds = computeLocalBoundsForObject(boundsTarget)
      const box = await createSectionBox({ model3d_file_id: fileId, element_ref: elementRef, ...bounds })
      setSectionBoxes(prev => [...prev, box])
    } catch (err) {
      setSectionBoxError(sectionBoxErrorMessage(err, 'Failed to create section box'))
    }
  }

  const handleUpdateSectionBox = async (id: string, data: Partial<SectionBoxBounds> & { name?: string; active?: boolean; visible?: boolean }) => {
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
    if (!selectedProject) return
    let cancelled = false
    listCollections(selectedProject.id).then(cs => { if (!cancelled) setCollections(cs) })
    return () => { cancelled = true }
  }, [selectedProject])

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

  // Select/Hide/Isolate by collection (2026-07-11) — recurse into nested
  // sub-collections, same as Blender's own outliner (right-click "Select
  // Objects" on a collection selects its sub-collections' contents too) —
  // matches the "Doors" example from Maro's own request: a parent
  // collection with per-floor sub-collections should still isolate every
  // door at once, not just whichever happen to be direct members.
  const flattenCollectionMemberRefs = (collectionId: string): { source_kind: SourceKind; element_ref: string }[] => {
    const subtreeIds = new Set<string>([collectionId])
    const stack = [collectionId]
    while (stack.length > 0) {
      const current = stack.pop() as string
      for (const c of collections) {
        if (c.parent_collection_id === current && !subtreeIds.has(c.id)) {
          subtreeIds.add(c.id)
          stack.push(c.id)
        }
      }
    }
    return collections
      .filter(c => subtreeIds.has(c.id))
      .flatMap(c => c.members.map(m => ({ source_kind: m.source_kind, element_ref: m.element_ref })))
  }

  const handleSelectCollection = async (collectionId: string) => {
    const refs = flattenCollectionMemberRefs(collectionId)
    const { objectIds, expressIds } = await resolveElementRefsToTargets(refs, sceneObjects, ifcHandles)
    if (objectIds.size === 0 && expressIds.size === 0) return
    setSelectedObjectIds(objectIds)
    setSelectedExpressIds(expressIds)
    setSelectedExpressId(null)  // no single "primary" element in a bulk collection select
    const ifcObjectIds = [...objectIds].filter(id => id.startsWith('ifc-'))
    setActiveIfcModelId(ifcObjectIds.length === 1 ? ifcObjectIds[0] : null)
    setActiveObjectId(objectIds.size === 1 ? [...objectIds][0] : null)
  }

  const handleHideCollection = async (collectionId: string) => {
    const refs = flattenCollectionMemberRefs(collectionId)
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

  const handleIsolateCollection = async (collectionId: string) => {
    const refs = flattenCollectionMemberRefs(collectionId)
    const { objectIds, expressIds } = await resolveElementRefsToTargets(refs, sceneObjects, ifcHandles)
    if (objectIds.size === 0) return
    setIsolatedObjectIds(objectIds)
    setIsolatedExpressIds(expressIds)
    setIsolateMode(true)
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
    if (!selectedProject) return
    let cancelled = false
    listCameraViews(selectedProject.id).then(views => { if (!cancelled) setCameraViews(views) })
    return () => { cancelled = true }
  }, [selectedProject])

  const handleSaveCameraView = async (pose: CameraViewPose) => {
    if (!selectedProject) return
    try {
      setCameraViewError(null)
      const view = await createCameraView({ project_id: selectedProject.id, ...pose })
      setCameraViews(prev => [...prev, view])
    } catch (err) {
      setCameraViewError(err instanceof Error ? err.message : 'Failed to save camera view')
    }
  }
  const handleApplyCameraView = (view: CameraView) => {
    setApplyCameraViewRequest({ pose: view, nonce: Date.now() })
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
  const scheduleRange = computeScheduleRange(activities)
  const keyframeRange = computeKeyframeRange(elementKeyframes.keyframes)
  const timelineRange = padDegenerateRange(unionRanges(scheduleRange, keyframeRange))
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
    return [{
      id: box.id, sceneObjectId: sceneObject.id, active: box.active, visible: box.visible, bounds,
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
  // Bumped by Viewport3D's TransformControls onChange (fires continuously
  // while dragging) purely to force a re-render — PropertiesPanel.tsx's
  // TransformPanel section reads live values straight off the dragged
  // THREE.Object3D each render, this is just the "please re-read it" signal
  // (2026-07-11 — lifted up here from a Viewport3D-local state once the
  // Transform panel moved out to a PropertiesPanel sibling, per Maro).
  const [, setTransformTick] = useState(0)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  // Combined "Import Model" flow (2026-07-08, per Maro: "combine the two
  // import widgets to one... after selecting the model and its type, there
  // should be an option to set its axis transformations") — one file picker
  // covering both kinds' extensions; picking a file doesn't import it
  // immediately, it opens ImportModelDialog (below, in the JSX) with the
  // kind auto-detected from the extension, so the user can override the
  // axis guess before anything actually loads.
  const [pendingImport, setPendingImport] = useState<{ file: File; kind: 'ifc' | 'mesh' } | null>(null)

  const handleFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    setPendingImport({ file, kind: ext === 'ifc' ? 'ifc' : 'mesh' })
  }

  // Uploads a freshly-imported file to the backend so it survives a hard
  // refresh (2026-07-09, per Maro: "keep the models and associated data
  // similar to the persistent data in Schedule. so i dont have to repeat my
  // actions import again") — deliberately fire-and-forget relative to the
  // import itself, since the model is already usable in the viewport the
  // moment it's parsed locally; this just catches the backend up in the
  // background. Checks the object is still loaded once the upload resolves
  // before recording its fileId — if it was unloaded in the meantime, the
  // upload only just landed a copy nobody wants, so it's deleted right back
  // off per Maro's explicit "if i unload, i expect the data not to persist"
  // — the alternative (blocking unload on any in-flight upload) would make
  // unload feel laggy for no real benefit.
  const persistModelFile = async (id: string, file: File, kind: Model3DKind, sourceUpAxis: UpAxis) => {
    if (!selectedProject) return
    try {
      const saved = await uploadModel3DFile(selectedProject.id, file.name, kind, sourceUpAxis, file)
      let stillLoaded = false
      setSceneObjects(prev => {
        stillLoaded = prev.some(o => o.id === id)
        return stillLoaded ? prev.map(o => (o.id === id ? { ...o, fileId: saved.id } : o)) : prev
      })
      if (!stillLoaded) deleteModel3DFile(saved.id).catch(() => {})
    } catch (err) {
      console.error('Failed to persist imported model — it will not survive a hard refresh', err)
    }
  }

  const handleImport3D = async (file: File, sourceUpAxis: UpAxis) => {
    setImporting(true)
    setImportError(null)
    try {
      const object = await loadModel3DFile(file)
      const id = crypto.randomUUID()
      object.name = file.name
      object.userData.sceneObjectId = id
      setSceneObjects(prev => [...prev, { id, name: file.name, kind: 'mesh', sourceUpAxis, object, fileId: null }])
      setDataTab('3d')
      persistModelFile(id, file, 'mesh', sourceUpAxis)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import 3D file')
    } finally {
      setImporting(false)
    }
  }

  const handleImportIfc = async (file: File, sourceUpAxis: UpAxis) => {
    setImporting(true)
    setImportError(null)
    try {
      const { loadIfcModel } = await import('./ifcModel')
      const handle = await loadIfcModel(file)
      const id = `ifc-${handle.modelID}`
      handle.object.userData.sceneObjectId = id
      setIfcHandles(prev => [...prev, handle])
      setActiveIfcModelId(id)
      setSelectedExpressId(null)
      setSelectedExpressIds(new Set())
      setSceneObjects(prev => [...prev, { id, name: file.name, kind: 'ifc', sourceUpAxis, object: handle.object, fileId: null }])
      setDataTab('ifc')
      persistModelFile(id, file, 'ifc', sourceUpAxis)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import IFC file — see console for detail')
      console.error(err)
    } finally {
      setImporting(false)
    }
  }

  const handleConfirmImport = (sourceUpAxis: UpAxis) => {
    if (!pendingImport) return
    const { file, kind } = pendingImport
    setPendingImport(null)
    if (kind === 'ifc') handleImportIfc(file, sourceUpAxis)
    else handleImport3D(file, sourceUpAxis)
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
  useEffect(() => {
    if (!selectedProject) return
    let cancelled = false
    ;(async () => {
      const files = await listModel3DFiles(selectedProject.id).catch(() => [])
      for (const file of files) {
        if (cancelled) return
        try {
          const blob = await downloadModel3DFile(file.id)
          const restoredFile = new File([blob], file.name)
          if (file.kind === 'ifc') {
            const { loadIfcModel } = await import('./ifcModel')
            const handle = await loadIfcModel(restoredFile)
            if (cancelled) { const { disposeIfcModel } = await import('./ifcModel'); disposeIfcModel(handle); return }
            const id = `ifc-${handle.modelID}`
            handle.object.userData.sceneObjectId = id
            setIfcHandles(prev => [...prev, handle])
            setSceneObjects(prev => [...prev, {
              id, name: file.name, kind: 'ifc', sourceUpAxis: file.source_up_axis, object: handle.object, fileId: file.id,
            }])
          } else {
            const object = await loadModel3DFile(restoredFile)
            if (cancelled) return
            const id = crypto.randomUUID()
            object.name = file.name
            object.userData.sceneObjectId = id
            setSceneObjects(prev => [...prev, {
              id, name: file.name, kind: 'mesh', sourceUpAxis: file.source_up_axis, object, fileId: file.id,
            }])
          }
        } catch (err) {
          console.error(`Failed to restore persisted model "${file.name}"`, err)
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id])

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
  const handleSelectObject = (id: string | null, additive = false) => {
    if (id === null) { setSelectedObjectIds(new Set()); setActiveObjectId(null); return }
    if (!additive) { setSelectedObjectIds(new Set([id])); setActiveObjectId(id); return }
    const next = new Set(selectedObjectIds)
    const turningOn = !next.has(id)
    if (turningOn) next.add(id); else next.delete(id)
    setSelectedObjectIds(next)
    const remaining = [...next]
    setActiveObjectId(turningOn ? id : (remaining.length ? remaining[remaining.length - 1] : null))
  }

  const handleSelectAll = () => {
    const ids = sceneObjects.map(o => o.id)
    setSelectedObjectIds(new Set(ids))
    setActiveObjectId(ids.length ? ids[ids.length - 1] : null)
    // Selecting every whole object is another "I mean the model(s), not a
    // specific sub-element" action — same fix and same reasoning as
    // DataPanel.tsx's IFC checkbox handler (2026-07-09, per Maro: Apply
    // Transform on "the parent" kept targeting a stale individually-picked
    // sub-element instead).
    setSelectedExpressId(null)
    setSelectedExpressIds(new Set())
  }

  // Box-select (2026-07-08, per Maro: "select box in viewport") always adds
  // to the current selection, same as Blender's default B-key behaviour —
  // Viewport3D.tsx resolves which objects fall inside the dragged rectangle
  // and hands back the id list in one batch (never loops handleSelectObject
  // per id — each of those calls would read the same stale
  // selectedObjectIds from this closure and clobber each other).
  const handleBoxSelect = (ids: string[]) => {
    if (ids.length === 0) return
    setSelectedObjectIds(prev => new Set([...prev, ...ids]))
    setActiveObjectId(ids[ids.length - 1])
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
      const turningOn = !next.has(expressID)
      if (turningOn) next.add(expressID); else next.delete(expressID)
      setSelectedExpressIds(next)
      const remaining = [...next]
      setSelectedExpressId(turningOn ? expressID : (remaining.length ? remaining[remaining.length - 1] : null))
    }
    if (objectId) {
      setActiveIfcModelId(objectId)
      setSelectedObjectIds(prev => (prev.has(objectId) ? prev : new Set([...prev, objectId])))
      setActiveObjectId(objectId)
    }
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
  const handleUploadTexture = async (objectId: string, slot: TextureSlot, file: File) => {
    try {
      setTextureError(null)
      const value = await loadCustomTexture(file, slot)
      setCustomTextures(prev => ({ ...prev, [objectId]: { ...prev[objectId], [slot]: value } }))
    } catch (err) {
      setTextureError(err instanceof Error ? err.message : 'Failed to load texture file')
    }
  }
  const handleClearTexture = (objectId: string, slot: TextureSlot) => {
    setCustomTextures(prev => {
      const current = prev[objectId]
      if (!current?.[slot]) return prev
      current[slot]?.texture.dispose()
      const nextSet = { ...current }
      delete nextSet[slot]
      return { ...prev, [objectId]: nextSet }
    })
  }
  // Adapters for PropertiesPanel's Material/Texture section (2026-07-11,
  // per Maro: "move... object material and texture settings in the 3d view
  // properties... so if i select an object, 3d or ifc, i can see and
  // change them there") — that section only ever edits whichever object is
  // currently active, so it works with the simpler (slot, file) shape
  // rather than threading an objectId through every call site; these just
  // supply activeObjectId to the id-keyed handlers above. A no-op if
  // nothing's selected (the section isn't rendered in that case anyway).
  const handleUploadActiveTexture = (slot: TextureSlot, file: File) => {
    if (activeTextureKey) handleUploadTexture(activeTextureKey, slot, file)
  }
  const handleClearActiveTexture = (slot: TextureSlot) => {
    if (activeTextureKey) handleClearTexture(activeTextureKey, slot)
  }

  // Material Preset library (2026-07-09, per Maro: "Save the default
  // materials for the whole model... I can then add a new preset which
  // allows me to change the materials, i can save it, edit and delete. So
  // if i choose i can toggle between different materials I've saved and
  // apply the one i want while not losing the original ones") — same
  // project-scoped library pattern as animationProfiles above. Applying a
  // preset writes into the exact same customTextures slot per-element
  // texture editing already uses (activeTextureKey), so it's
  // indistinguishable from a fresh manual upload from this point on, and
  // the element's true original material (elementBaseline.ts) is never
  // touched by it either way.
  const materialPresets = useMaterialPresets(selectedProject?.id)
  const handleApplyMaterialPreset = async (config: MaterialPresetConfig) => {
    if (!activeTextureKey) return
    try {
      setTextureError(null)
      const textureSet = await loadPresetAsTextureSet(config)
      setCustomTextures(prev => ({ ...prev, [activeTextureKey]: { ...prev[activeTextureKey], ...textureSet } }))
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
    const matches = findLinkedExpressIds(handle, activeObjectId, slot, selectedExpressId, customTextures)
    setSelectedExpressIds(new Set(matches))
  }
  const handleApplyToLinkedMaterial = (slot: TextureSlot) => {
    if (!activeTextureKey || !activeObjectId) return
    const sourceValue = customTextures[activeTextureKey]?.[slot]
    if (!sourceValue) return
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
  const scheduleVisibleActivities = useMemo(
    () => computeVisibleActivities(activities, scheduleCollapsedIds),
    [activities, scheduleCollapsedIds],
  )

  // Native scrollTop mirroring between the Activity Table and Gantt windows
  // (2026-07-09, per Maro) — plain DOM scroll-sync between two independent,
  // freely-resizable/dockable WindowChrome panes, not GanttChart.tsx's own
  // transform-based GanttChartHandle trick (that one assumes a fixed-height
  // clipped viewport paired with exactly one partner, matching Scheduling.tsx's
  // dual-pane layout — not the case here, where either window can be closed,
  // resized, or moved to the other dock independently). syncingScrollRef
  // guards against the infinite feedback loop that would otherwise happen:
  // setting one pane's scrollTop programmatically fires *its own* onScroll
  // too, which would otherwise immediately echo back onto the pane that
  // triggered it in the first place.
  const scheduleScrollRef = useRef<HTMLDivElement>(null)
  const ganttScrollRef = useRef<HTMLDivElement>(null)
  const syncingScrollRef = useRef(false)
  const handleScheduleScroll = (scrollTop: number) => {
    if (syncingScrollRef.current) return
    syncingScrollRef.current = true
    if (ganttScrollRef.current) ganttScrollRef.current.scrollTop = scrollTop
    syncingScrollRef.current = false
  }
  const handleGanttScroll = (scrollTop: number) => {
    if (syncingScrollRef.current) return
    syncingScrollRef.current = true
    if (scheduleScrollRef.current) scheduleScrollRef.current.scrollTop = scrollTop
    syncingScrollRef.current = false
  }

  const resourcesTabData = useResourcesTabData(
    resources, resourceAssignments, activities, selectedResourceIds, zoom, null, null,
  )

  const viewportObjects: ImportedObject[] = sceneObjects.map(o => ({
    id: o.id, kind: o.kind, sourceUpAxis: o.sourceUpAxis, object: o.object,
    visible: !hiddenIds.has(o.id) && (!isolateMode || isolatedObjectIds.has(o.id)),
  }))
  const meshImports = sceneObjects.filter(o => o.kind === 'mesh').map(o => ({ id: o.id, name: o.name }))
  const activeSceneObject = sceneObjects.find(o => o.id === activeObjectId) ?? null
  // Mirrors Viewport3D.tsx's own activeObject resolution (its TransformControls
  // gizmo target) so the Properties panel's number fields edit the exact
  // same thing the gizmo does (2026-07-08, per Maro: "the whole ifc model
  // is grouped, even though i select an individual object. using any of the
  // transforms affect the model") — the specific selected sub-element when
  // one's picked, falling back to the whole model otherwise.
  let activeTransformObject: Object3D | null = activeSceneObject?.object ?? null
  let isElementTransform = false
  const activeIfcHandle = activeSceneObject?.kind === 'ifc' ? getIfcHandleFor(activeObjectId) : null
  if (activeIfcHandle && selectedExpressId !== null) {
    let found: Object3D | null = null
    activeIfcHandle.object.traverse(child => { if (!found && child.userData.expressID === selectedExpressId) found = child })
    if (found) { activeTransformObject = found; isElementTransform = true }
  }
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
  // What's currently applied to the active element/object, in preset shape
  // — the starting point for "Save Current as Preset" (MaterialPresetPicker's
  // 💾 button).
  const activeMaterialPresetConfig = activeTextureKey && customTextures[activeTextureKey]
    ? textureSetToPresetConfig(customTextures[activeTextureKey])
    : EMPTY_MATERIAL_PRESET_CONFIG
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
  // scrubber") — every date the active object is keyed on, across all nine
  // fields, deduped by day since several fields keyed on the same date is
  // the common case and shouldn't draw overlapping markers.
  const activeObjectKeyframeDates: Date[] = activeSceneObject?.kind === 'mesh'
    ? [...new Set(
        elementKeyframes.keyframes
          .filter(k => k.source_kind === 'mesh' && k.element_ref === activeSceneObject.name)
          .map(k => k.date.slice(0, 10)),
      )].map(d => new Date(d))
    : []

  // Body per window key — WindowChrome (below) owns the shared header/dock-
  // toggle/close, this is just what goes inside it (2026-07-11, per Maro:
  // bring in the Gantt chart + an Animation Timeline placeholder alongside
  // the existing Schedule/Resource Tracking/Resource Usage windows).
  function renderWindowContent(key: WindowKey): React.ReactNode {
    switch (key) {
      case 'schedule':
        return (
          <ScheduleWindow
            activities={activities}
            visibleActivities={scheduleVisibleActivities}
            collapsedIds={scheduleCollapsedIds}
            onToggleCollapsed={toggleScheduleCollapsed}
            selectedActivityIds={selectedActivityIds}
            onSelectActivity={handleSelectActivity}
            scrollContainerRef={scheduleScrollRef}
            onScroll={handleScheduleScroll}
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
            activities={activities}
            links={modelElementLinks}
            keyframeDates={activeObjectKeyframeDates}
          />
        )
    }
  }

  function renderWindow(key: WindowKey) {
    return (
      <WindowChrome
        key={key}
        title={WINDOW_LABELS[key]}
        subtitle={key === 'schedule' ? `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} · read-only` : undefined}
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
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
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
                className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
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
          onSelect={handleSelectCollection}
          onHide={handleHideCollection}
          onIsolate={handleIsolateCollection}
        />
      ),
    })
  }
  const leftDockPanels = dockablePanels.filter(p => p.dock === 'left')
  const rightDockPanels = dockablePanels.filter(p => p.dock === 'right')

  if (!selectedProject) return null

  return (
    <div className="h-screen flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white shrink-0 flex-wrap">
        <h1 className="text-sm font-bold text-gray-900 mr-2">4D</h1>
        {ALL_WINDOW_KEYS.map(key => (
          <button
            key={key}
            onClick={() => toggleWindow(key)}
            className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
              openWindows.has(key) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
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
            profilePanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Profiles
        </button>
        <button
          onClick={toggleSectionPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            sectionPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Sections
        </button>
        <button
          onClick={toggleCameraPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            cameraPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Camera Views
        </button>
        <button
          onClick={toggleCollectionsPanel}
          className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
            collectionsPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Collections
        </button>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <input ref={importInputRef} type="file" accept=".glb,.gltf,.obj,.fbx,.ifc" onChange={handleFileSelected} className="hidden" />
        <button
          onClick={() => importInputRef.current?.click()}
          disabled={importing}
          title="Import a GLTF/GLB, OBJ, FBX, or IFC model into the viewport"
          className="text-xs px-2.5 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          ⬆ Import Model
        </button>
        {importing && <span className="text-xs text-gray-400">Importing…</span>}
        {importError && <span className="text-xs text-red-600">{importError}</span>}
        {textureError && <span className="text-xs text-red-600">{textureError}</span>}
        {linkError && <span className="text-xs text-red-600">{linkError}</span>}
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
          onTransformChange={() => setTransformTick(t => t + 1)}
          gizmoMode={gizmoMode}
          onGizmoModeChange={setGizmoMode}
          activeObjectTextures={activeTextureKey ? customTextures[activeTextureKey] : undefined}
          onUploadTexture={handleUploadActiveTexture}
          onClearTexture={handleClearActiveTexture}
          materialPresets={materialPresets.presets}
          materialPresetsLoading={materialPresets.loading}
          activeMaterialPresetConfig={activeMaterialPresetConfig}
          onApplyMaterialPreset={handleApplyMaterialPreset}
          onCreateMaterialPreset={materialPresets.create}
          onUpdateMaterialPreset={materialPresets.update}
          onDeleteMaterialPreset={materialPresets.remove}
          linkedMaterialsAvailable={linkedMaterialsAvailable}
          onSelectLinkedMaterial={handleSelectLinkedMaterial}
          onApplyToLinkedMaterial={handleApplyToLinkedMaterial}
          keyframeSupport={keyframeSupport}
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

          <Viewport3D
            settings={settings}
            importedObjects={viewportObjects}
            selectedExpressId={selectedExpressId}
            selectedExpressIds={selectedExpressIds}
            onSelect={handleSelectExpressId}
            activeObjectId={activeObjectId}
            selectedObjectIds={selectedObjectIds}
            onSelectObject={handleSelectObject}
            onSelectAll={handleSelectAll}
            onBoxSelect={handleBoxSelect}
            isolateMode={isolateMode}
            isolatedObjectIds={isolatedObjectIds}
            isolatedExpressIds={isolatedExpressIds}
            hiddenExpressIds={hiddenExpressIds}
            onToggleIsolate={handleToggleIsolate}
            onShowAll={handleShowAll}
            linkedActivitiesWidget={
              <LinkedActivitiesWidget
                activities={activities.filter(a => isolatedLinkedActivityIds.has(a.id))}
                selectedActivityIds={selectedActivityIds}
                onSelectActivity={handleSelectActivity}
              />
            }
            gizmoMode={gizmoMode}
            onTransformChange={() => setTransformTick(t => t + 1)}
            environmentUrl={customEnvironment?.url ?? null}
            onEnvironmentError={handleEnvironmentError}
            customTextures={customTextures}
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
            onSaveCameraView={handleSaveCameraView}
            applyCameraViewRequest={applyCameraViewRequest}
          />

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
          onUnloadIfc={requestUnloadModel}
          meshImports={meshImports}
          hiddenIds={hiddenIds}
          onToggleMeshVisible={toggleMeshVisible}
          onUnloadMesh={requestUnloadModel}
          selectedObjectIds={selectedObjectIds}
          onSelectObject={handleSelectObject}
          activities={activities}
          modelElementLinks={modelElementLinks}
          animationProfiles={animationProfiles.profiles}
          onLinkElement={handleLinkElement}
          onUnlinkElement={handleUnlinkElement}
          onAssignProfile={handleAssignProfile}
        />
      </div>
      {pendingImport && (
        <ImportModelDialog
          file={pendingImport.file}
          kind={pendingImport.kind}
          onConfirm={handleConfirmImport}
          onCancel={() => setPendingImport(null)}
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
    </div>
  )
}
