import type { IfcModelHandle } from './ifcModel'
import type { ModelElementLink } from './modelElementLinks'

// A scene object as far as this module needs it — just enough to resolve a
// mesh-kind link's element_ref (a filename) back to its own scene-object id;
// matches the shape FourD.tsx's own SceneObject already has.
export interface LinkableSceneObject {
  id: string
  kind: 'ifc' | 'mesh'
  name: string
}

export interface ResolvedIsolationTarget {
  objectIds: Set<string>
  expressIds: Set<number>
}

// Tries each loaded IFC model in turn for a GlobalId match (2026-07-09,
// per federated/assembly modeling — more than one IFC model can be loaded
// at once now) — a ModelElementLink doesn't record *which* model it
// belongs to, only the element's own GlobalId, so resolving one now means
// asking every currently-loaded model rather than assuming a single global
// handle. GlobalIds are unique within a coherent IFC dataset, so the first
// (and normally only) match wins; if the exact same GlobalId genuinely
// exists in two separately-imported models (e.g. the same file imported
// twice), this consistently picks whichever was loaded first rather than
// silently double-counting both.
async function resolveInAnyHandle(
  ifcHandles: IfcModelHandle[], guid: string, ifcModel: typeof import('./ifcModel'),
): Promise<{ handle: IfcModelHandle; expressId: number } | null> {
  for (const handle of ifcHandles) {
    const expressId = ifcModel.getExpressIdFromGuid(handle, guid)
    if (expressId !== undefined) return { handle, expressId }
  }
  return null
}

// "Isolate Linked Elements" — activities -> elements (2026-07-09, per Maro:
// "if i click on an activity or activities, i can click to isolate/filter
// the elements assigned to those activities alone"). Mirrors Viewport3D.tsx's
// own TimelinePlayback resolution (mesh-kind by filename, ifc-kind via
// GlobalId->expressID) rather than sharing code with it directly — that one
// resolves against live THREE objects already in the scene graph edit-in-
// place, this one only needs the *ids*, and folding both into one shared
// helper would mean threading THREE.Object3D through a module that
// otherwise has no reason to import three.js at all.
//
// Crucially adds the matched IFC model's own top-level scene-object id to
// objectIds whenever any of its sub-elements resolve (not just the specific
// expressIDs) — FourD.tsx's own object-level visibility check
// (`!isolateMode || isolatedObjectIds.has(o.id)`) hides an entire
// <primitive> outright if its own id isn't isolated, and three.js skips
// every descendant's own `visible` flag once its parent is hidden — without
// this, isolating an IFC element by activity would isolate the *expressID*
// correctly but the whole model would still vanish, since the model's own
// object-level entry was never added.
// The per-ref resolution shared by anything that needs to turn a set of
// loose (source_kind, element_ref) refs into live scene targets — extracted
// (2026-07-11, for the Collections feature) so Collections' own select/
// hide/isolate-by-collection can reuse the identical mesh/ifc branching
// instead of duplicating it. resolveActivityLinksToIsolationTargets below
// is now a thin wrapper around this.
export async function resolveElementRefsToTargets(
  refs: { source_kind: 'ifc' | 'mesh'; element_ref: string }[],
  sceneObjects: LinkableSceneObject[],
  ifcHandles: IfcModelHandle[],
): Promise<ResolvedIsolationTarget> {
  const objectIds = new Set<string>()
  const expressIds = new Set<number>()
  if (refs.length === 0) return { objectIds, expressIds }

  const needsIfc = refs.some(r => r.source_kind === 'ifc') && ifcHandles.length > 0
  const ifcModel = needsIfc ? await import('./ifcModel') : null

  for (const ref of refs) {
    if (ref.source_kind === 'mesh') {
      const match = sceneObjects.find(o => o.kind === 'mesh' && o.name === ref.element_ref)
      if (match) objectIds.add(match.id)
    } else if (ifcModel) {
      const resolved = await resolveInAnyHandle(ifcHandles, ref.element_ref, ifcModel)
      if (resolved) {
        expressIds.add(resolved.expressId)
        objectIds.add(`ifc-${resolved.handle.modelID}`)
      }
    }
  }
  return { objectIds, expressIds }
}

export async function resolveActivityLinksToIsolationTargets(
  activityIds: Set<string>,
  links: ModelElementLink[],
  sceneObjects: LinkableSceneObject[],
  ifcHandles: IfcModelHandle[],
): Promise<ResolvedIsolationTarget> {
  const relevant = links.filter(l => activityIds.has(l.activity_id))
  return resolveElementRefsToTargets(
    relevant.map(l => ({ source_kind: l.source_kind, element_ref: l.element_ref })),
    sceneObjects, ifcHandles,
  )
}

// The reverse direction — "Linked Activities" widget: given whatever's
// currently isolated (elements -> activities), which activities are any of
// them linked to (2026-07-09, per Maro: "there should be a widget to filter
// the activities the isolated elements are assigned to, if not assigned to
// any then nothing happens"). Returns an empty set (not an error/crash) if
// nothing isolated has any link at all — the caller (LinkedActivitiesWidget.tsx)
// renders nothing in that case, per that same instruction.
//
// A whole-model isolation (isolatedExpressIds empty, just that model's own
// object id isolated) counts *every* ifc-kind link belonging to that
// *specific* model as isolated — matches the same "whole object vs specific
// sub-elements" branching Viewport3D.tsx's own isolate visibility logic
// already uses. With multiple models loaded, only the isolated one(s)
// count — a link into a *different*, non-isolated model never matches.
export async function resolveIsolationTargetsToActivityIds(
  isolatedObjectIds: Set<string>,
  isolatedExpressIds: Set<number>,
  links: ModelElementLink[],
  sceneObjects: LinkableSceneObject[],
  ifcHandles: IfcModelHandle[],
): Promise<Set<string>> {
  const activityIds = new Set<string>()
  if (isolatedObjectIds.size === 0) return activityIds

  const needsIfc = links.some(l => l.source_kind === 'ifc') && ifcHandles.length > 0
  const ifcModel = needsIfc ? await import('./ifcModel') : null

  for (const link of links) {
    if (link.source_kind === 'mesh') {
      // mesh-kind element_ref is a filename, not a scene-object id — resolve
      // it the same way the forward direction does (LinkableSceneObject
      // lookup) before checking isolatedObjectIds.
      const match = sceneObjects.find(o => o.kind === 'mesh' && o.name === link.element_ref)
      if (match && isolatedObjectIds.has(match.id)) activityIds.add(link.activity_id)
    } else if (ifcModel) {
      const resolved = await resolveInAnyHandle(ifcHandles, link.element_ref, ifcModel)
      if (!resolved) continue
      const modelObjectId = `ifc-${resolved.handle.modelID}`
      const wholeModelIsolated = isolatedObjectIds.has(modelObjectId) && isolatedExpressIds.size === 0
      if (wholeModelIsolated || isolatedExpressIds.has(resolved.expressId)) activityIds.add(link.activity_id)
    }
  }
  return activityIds
}
