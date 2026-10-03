import type { IfcModelHandle } from './ifcModel'
import type { ModelElementLink } from './modelElementLinks'
import { getSplitExpressId } from './splitElementRefs'

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
  // Composite `${objectId}::${expressID}` keys, one per resolved IFC
  // sub-element (2026-07-11, for Collections' hide-by-sub-element) —
  // objectIds/expressIds above are both flat, so once more than one IFC
  // model is involved there's no way to recover *which* model a given
  // expressID actually belongs to from them alone. Viewport3D.tsx's
  // hiddenExpressIds needs exactly that pairing (see its own Props doc
  // comment on why hide can't reuse a flat Set<number> the way isolate
  // does); this is computed once, right here, where both halves of the
  // pair are already known together — not re-derived later.
  expressKeys: Set<string>
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

// A federated IFC element's identity (2026-10-03): `${objectId}::${expressId}`.
// expressIDs are only unique inside one IFC file, so any set of isolated/
// hidden elements must carry the model too — a bare number matches the
// same-numbered, unrelated element in every other loaded model.
export function elementKey(objectId: string, expressId: number): string {
  return `${objectId}::${expressId}`
}

export function parseElementKey(key: string): { objectId: string; expressId: number } | null {
  const at = key.lastIndexOf('::')
  if (at < 0) return null
  const expressId = Number(key.slice(at + 2))
  return Number.isFinite(expressId) ? { objectId: key.slice(0, at), expressId } : null
}

// The models that have at least one element key in `keys` — a model that's
// isolated but has none is isolated whole.
export function modelsWithElementKeys(keys: Iterable<string>): Set<string> {
  const models = new Set<string>()
  for (const key of keys) {
    const parsed = parseElementKey(key)
    if (parsed) models.add(parsed.objectId)
  }
  return models
}

// Turns the live selection (still bare expressIDs + the selected model ids)
// into element keys, for Isolate Selected's snapshot. Each number goes to
// the selected IFC model(s) that actually contain it; with one IFC model
// selected — the usual case — that's simply that model. Only a selection
// spanning several models that share a number stays ambiguous, because the
// selection itself doesn't record which model each number came from.
export function selectionToElementKeys(
  expressIds: Iterable<number>,
  selectedObjectIds: Iterable<string>,
  ifcObjectIds: Set<string>,
  hasElement: (objectId: string, expressId: number) => boolean,
): Set<string> {
  const models = [...selectedObjectIds].filter(id => ifcObjectIds.has(id))
  const keys = new Set<string>()
  for (const expressId of expressIds) {
    const owners = models.length === 1 ? models : models.filter(m => hasElement(m, expressId))
    for (const m of owners) keys.add(elementKey(m, expressId))
  }
  return keys
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
  refs: { source_kind: 'ifc' | 'mesh' | 'ifc_split'; element_ref: string }[],
  sceneObjects: LinkableSceneObject[],
  ifcHandles: IfcModelHandle[],
): Promise<ResolvedIsolationTarget> {
  const objectIds = new Set<string>()
  const expressIds = new Set<number>()
  const expressKeys = new Set<string>()
  if (refs.length === 0) return { objectIds, expressIds, expressKeys }

  const needsIfc = refs.some(r => r.source_kind === 'ifc') && ifcHandles.length > 0
  const ifcModel = needsIfc ? await import('./ifcModel') : null

  for (const ref of refs) {
    if (ref.source_kind === 'mesh') {
      const match = sceneObjects.find(o => o.kind === 'mesh' && o.name === ref.element_ref)
      if (match) objectIds.add(match.id)
    } else if (ref.source_kind === 'ifc_split') {
      // A level-slice — same resolution shape as the real-ifc branch below,
      // just against the synthetic expressID map (splitElementRefs.ts)
      // instead of a real GlobalId, so it doesn't need `ifcModel` loaded at
      // all (getSplitExpressId is a plain synchronous lookup).
      for (const handle of ifcHandles) {
        const expressId = getSplitExpressId(handle, ref.element_ref)
        if (expressId === undefined) continue
        const objectId = `ifc-${handle.modelID}`
        expressIds.add(expressId)
        objectIds.add(objectId)
        expressKeys.add(`${objectId}::${expressId}`)
        break
      }
    } else if (ifcModel) {
      const resolved = await resolveInAnyHandle(ifcHandles, ref.element_ref, ifcModel)
      if (resolved) {
        const objectId = `ifc-${resolved.handle.modelID}`
        expressIds.add(resolved.expressId)
        objectIds.add(objectId)
        expressKeys.add(`${objectId}::${resolved.expressId}`)
      }
    }
  }
  return { objectIds, expressIds, expressKeys }
}

export async function resolveActivityLinksToIsolationTargets(
  activityIds: Set<string>,
  links: ModelElementLink[],
  sceneObjects: LinkableSceneObject[],
  ifcHandles: IfcModelHandle[],
): Promise<ResolvedIsolationTarget> {
  // source_kind="annotation" links (2026-07-12) aren't scene objects —
  // Isolate has nothing to resolve them to, so they're excluded here rather
  // than passed through. The remaining kinds (ifc/mesh/ifc_split) are all
  // real scene targets resolveElementRefsToTargets already knows how to
  // handle — explicit filter+narrow instead of the blanket `as 'ifc'|'mesh'`
  // cast this used to have, which would have silently misrouted an
  // ifc_split link as a real ifc one (no compile error, since a cast
  // bypasses that check entirely).
  const relevant = links.filter(
    (l): l is ModelElementLink & { source_kind: 'ifc' | 'mesh' | 'ifc_split' } =>
      activityIds.has(l.activity_id) && l.source_kind !== 'annotation',
  )
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
// A whole-model isolation (that model's own object id isolated, with no
// element keys of its own) counts *every* ifc-kind link belonging to that
// *specific* model as isolated — matches the same "whole object vs specific
// sub-elements" branching Viewport3D.tsx's own isolate visibility logic
// already uses. With multiple models loaded, only the isolated one(s)
// count — a link into a *different*, non-isolated model never matches.
export async function resolveIsolationTargetsToActivityIds(
  isolatedObjectIds: Set<string>,
  isolatedElementKeys: Set<string>,
  links: ModelElementLink[],
  sceneObjects: LinkableSceneObject[],
  ifcHandles: IfcModelHandle[],
): Promise<Set<string>> {
  const activityIds = new Set<string>()
  if (isolatedObjectIds.size === 0) return activityIds
  const modelsWithElements = modelsWithElementKeys(isolatedElementKeys)

  const needsIfc = links.some(l => l.source_kind === 'ifc') && ifcHandles.length > 0
  const ifcModel = needsIfc ? await import('./ifcModel') : null

  for (const link of links) {
    if (link.source_kind === 'mesh') {
      // mesh-kind element_ref is a filename, not a scene-object id — resolve
      // it the same way the forward direction does (LinkableSceneObject
      // lookup) before checking isolatedObjectIds.
      const match = sceneObjects.find(o => o.kind === 'mesh' && o.name === link.element_ref)
      if (match && isolatedObjectIds.has(match.id)) activityIds.add(link.activity_id)
    } else if (link.source_kind === 'ifc_split') {
      for (const handle of ifcHandles) {
        const expressId = getSplitExpressId(handle, link.element_ref)
        if (expressId === undefined) continue
        const modelObjectId = `ifc-${handle.modelID}`
        const wholeModelIsolated = isolatedObjectIds.has(modelObjectId) && !modelsWithElements.has(modelObjectId)
        if (wholeModelIsolated || isolatedElementKeys.has(elementKey(modelObjectId, expressId))) activityIds.add(link.activity_id)
        break
      }
    } else if (ifcModel) {
      const resolved = await resolveInAnyHandle(ifcHandles, link.element_ref, ifcModel)
      if (!resolved) continue
      const modelObjectId = `ifc-${resolved.handle.modelID}`
      const wholeModelIsolated = isolatedObjectIds.has(modelObjectId) && !modelsWithElements.has(modelObjectId)
      if (wholeModelIsolated || isolatedElementKeys.has(elementKey(modelObjectId, resolved.expressId))) activityIds.add(link.activity_id)
    }
  }
  return activityIds
}
