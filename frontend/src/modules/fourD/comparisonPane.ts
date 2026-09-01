import { useEffect, useState } from 'react'
import * as THREE from 'three'
import type { Activity, UserDefinedFieldValue } from '@/modules/scheduling/types'
import type { Collection } from './collections'
import { flattenCollectionMemberRefs } from './collections'
import type { IfcModelHandle } from './ifcModel'
import { resolveActivityLinksToIsolationTargets, resolveElementRefsToTargets, type LinkableSceneObject, type ResolvedIsolationTarget } from './linkedElements'
import type { ModelElementLink } from './modelElementLinks'
import { resolveScopeActivityIds, type ScopeFilter } from './scheduleScope'

// A generalized "Compare Baseline" (2026-08-03, per Maro: "compare
// baseline goes beyond just the one baseline view") — up to 3 extra
// dockable viewport panes (ComparisonViewportPane.tsx), each independently
// showing either the existing Baseline comparison (full model, bl_start/
// bl_finish dates) or a filtered subset of the *current* schedule: a named
// Collection's own membership, or every element linked to Activities
// matching a UDF value or WBS-node scope (scheduleScope.ts — the exact
// same scope concept Radial Chart/Timeline Strip already use).
//
// Deliberately NOT combinable — 'collection'/'scope' always use the live
// schedule dates, 'baseline' always shows the whole model — matching what
// Maro actually asked for (alternative *views*, not a cross product of
// "which dates" x "which elements"). Local browser-only state (same
// localStorage convention as the original compareBaselineOpen), no new
// backend resource — every actual resolution reuses functions this
// codebase already had for other purposes (collection isolate, activity-
// linked isolate), just called with a different id set.
//
// Three top-level modes, not four — 'scope' folds UDF/WBS together
// (rather than being separate top-level siblings of 'collection') because
// ScopeFilterFields.tsx (Radial Chart/Timeline Strip's own shared scope
// UI) already provides an All/UDF/WBS selector *inside itself*; a second,
// separate top-level UDF-vs-WBS toggle here would just be the same choice
// asked twice. This also gets "same elements, current dates instead of
// baseline dates" as a free, coherent third option (ScopeFilterFields'
// own "All Activities" sub-choice) rather than something needing its own
// bespoke content mode.
export type PaneContentMode = 'baseline' | 'collection' | 'scope'

export interface PaneConfig {
  contentMode: PaneContentMode
  collectionId: string | null
  // 'udf'/'wbs' modes reuse ScopeFilter wholesale (scope_mode mirrors
  // contentMode, so this is redundant with the outer contentMode field
  // when contentMode is 'udf'/'wbs' — kept as one object rather than
  // three separate optional fields so ScopeFilterFields.tsx can be handed
  // this directly, same as Radial Chart/Timeline Strip already do).
  scope: ScopeFilter
  cameraDisconnected: boolean
}

export const DEFAULT_PANE_CONFIG: PaneConfig = {
  contentMode: 'baseline',
  collectionId: null,
  scope: { scope_mode: 'all', udf_field_definition_id: null, udf_value: null, wbs_node_activity_id: null },
  cameraDisconnected: false,
}

// Resolves one pane's own content-mode config into a live isolation
// target — null means "no isolation, show the whole model" (baseline
// mode's own meaning; also the "not configured yet" default for
// collection/udf/wbs before a target is actually chosen, same "half-
// configured reads as empty, not everything" convention scheduleScope.ts's
// own resolveScopeActivityIds already established, so a freshly-switched
// pane doesn't briefly flash the *entire* model before its own scope gets
// picked).
export function useResolvedPaneIsolation(
  config: PaneConfig,
  activities: Activity[],
  collections: Collection[],
  links: ModelElementLink[],
  sceneObjects: LinkableSceneObject[],
  ifcHandles: IfcModelHandle[],
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined,
): ResolvedIsolationTarget | null {
  const [resolved, setResolved] = useState<ResolvedIsolationTarget | null>(null)

  useEffect(() => {
    if (config.contentMode === 'baseline') {
      setResolved(null)
      return
    }
    let cancelled = false
    const resolve = async () => {
      if (config.contentMode === 'collection') {
        if (!config.collectionId) {
          setResolved({ objectIds: new Set(), expressIds: new Set(), expressKeys: new Set() })
          return
        }
        const refs = flattenCollectionMemberRefs(config.collectionId, collections)
        const target = await resolveElementRefsToTargets(refs, sceneObjects, ifcHandles)
        if (!cancelled) setResolved(target)
        return
      }
      // 'scope' — same two-step resolution "Isolate Linked Elements"
      // already uses (activities -> linked scene targets), just fed a
      // scope-filtered activity id set (config.scope's own All/UDF/WBS
      // sub-choice) instead of a hand-picked one.
      const activityIds = resolveScopeActivityIds(activities, config.scope, getUdfValue)
      const target = await resolveActivityLinksToIsolationTargets(activityIds, links, sceneObjects, ifcHandles)
      if (!cancelled) setResolved(target)
    }
    resolve()
    return () => { cancelled = true }
  }, [config.contentMode, config.collectionId, config.scope, activities, collections, links, sceneObjects, ifcHandles, getUdfValue])

  return resolved
}

// Applied AFTER cloning (2026-08-03) — cloneSceneHierarchy (sceneClone.ts)
// has no filter param, it clones everything unconditionally, and it
// expands any still-batched IFC instance into its own individual plain
// THREE.Mesh tagged with `userData.expressID` (see that file's own
// header), which is exactly what makes per-sub-element isolation possible
// on a clone at all — no BatchedMesh.setVisibleAt()-style API needed here,
// just a plain `.visible` walk. `null` isolation (baseline mode) leaves
// everything untouched. Every real resolver this module calls
// (resolveElementRefsToTargets/resolveActivityLinksToIsolationTargets)
// always pairs an ifc-kind objectId with at least one matching expressId
// when anything in that model actually resolved — so "this model's own
// objectId is present" always means "check expressIds," never "show the
// whole model with nothing to filter."
export function applyPaneIsolationVisibility(
  clonedImportedObjects: { id: string; kind: 'ifc' | 'mesh'; object: THREE.Object3D }[],
  isolation: ResolvedIsolationTarget | null,
): void {
  if (!isolation) return
  for (const { id, kind, object } of clonedImportedObjects) {
    if (kind === 'mesh') {
      // Same baseVisible convention as the 'ifc' branch below — see that
      // branch's own comment for the real "why" (2026-09-01 fix).
      const shown = isolation.objectIds.has(id)
      object.visible = shown
      object.userData.baseVisible = shown
      continue
    }
    if (!isolation.objectIds.has(id)) {
      object.visible = false
      object.userData.baseVisible = false
      continue
    }
    object.visible = true
    object.userData.baseVisible = true
    object.traverse(child => {
      if (child instanceof THREE.Mesh && child.userData.expressID !== undefined) {
        const shown = isolation.expressIds.has(child.userData.expressID)
        child.visible = shown
        // The real fix (2026-09-01, per Maro: isolation resolved correctly
        // — confirmed live via diagnostic logging, 756/3706 real elements
        // matched, and this mutation genuinely did run — yet nothing ever
        // showed on screen) — TimelinePlayback (mounted in this same pane,
        // just below) runs a real per-*frame* pass over every schedule-
        // linked mesh: `mesh.visible = (mesh.userData.baseVisible ?? true)
        // && state.opacity > ANIMATION_VISIBILITY_EPSILON` (Viewport3D.tsx,
        // its own comment: "Every frame, so leaving the 'before start'
        // pose... reliably re-hides a mesh some other effect had last set
        // visible"). That convention exists specifically so the *primary*
        // viewport's own Isolate mode survives TimelinePlayback's
        // continuous overwrite — Viewport3D.tsx's ModelObjects effect
        // caches its own isolate-aware verdict into this exact
        // `userData.baseVisible` field, which is the only reason Isolate
        // and the Animation Timeline coexist there at all. This pane's own
        // isolation effect never adopted that same convention — it set
        // `.visible` directly and nothing else, so on the very next
        // animation frame TimelinePlayback read `baseVisible ?? true`
        // (never set, always the `true` fallback) and stomped every
        // schedule-linked mesh straight back to fully visible, forever,
        // even though this function's own mutation was — and always
        // had been — completely correct in isolation.
        child.userData.baseVisible = shown
      }
    })
  }
}
