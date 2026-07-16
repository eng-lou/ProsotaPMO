import type { IfcModelHandle } from './ifcModel'
import type { LinkableSceneObject } from './linkedElements'
import { getSplitElementRef } from './splitElementRefs'

export interface MemberRefDraft {
  source_kind: 'ifc' | 'mesh' | 'ifc_split'
  element_ref: string
  element_label: string
}

// The reverse direction of linkedElements.ts's resolvers (2026-07-11, for
// Collections' "Add Selected to Collection") — live selection state ->
// loose (source_kind, element_ref) refs, rather than ref -> live target.
// Kept in its own file rather than added to linkedElements.ts, whose own
// header is framed entirely around the forward direction.
//
// Async + dynamic-imports ifcModel.ts only when actually needed (an IFC
// selection is present) — a *static* import here would pull web-ifc into
// the main bundle, breaking the dynamic-import discipline every other
// consumer of ifcModel.ts in this module already follows (see this file's
// own import of the *type* IfcModelHandle above, which is compile-time
// only and erased, versus the actual functions below).
//
// activeIfcHandle is passed in already-resolved (FourD.tsx's own
// getIfcHandleFor(activeIfcModelId)), not re-derived here from ifcHandles +
// an id — IfcDataPanel.tsx already establishes that selectedExpressIds is
// implicitly scoped to whichever model is "active," so one handle lookup
// is correct, not an approximation; re-deriving the same `ifc-${modelID}`
// id convention a second time in this file would just be duplicating
// FourD.tsx's own getIfcHandleFor for no reason.
export async function resolveSelectionToMemberRefs(
  selectedObjectIds: Set<string>,
  selectedExpressIds: Set<number>,
  sceneObjects: LinkableSceneObject[],
  activeIfcHandle: IfcModelHandle | null,
): Promise<MemberRefDraft[]> {
  const drafts: MemberRefDraft[] = []

  for (const objectId of selectedObjectIds) {
    const match = sceneObjects.find(o => o.id === objectId && o.kind === 'mesh')
    if (match) drafts.push({ source_kind: 'mesh', element_ref: match.name, element_label: match.name })
  }

  if (activeIfcHandle && selectedExpressIds.size > 0) {
    const { getGuidFromExpressId, getElementTypeName } = await import('./ifcModel')
    for (const expressId of selectedExpressIds) {
      // A level-slice's expressID is synthetic — never a real web-ifc line
      // id, so getGuidFromExpressId/getElementTypeName below would be
      // calling into web-ifc with a made-up number (undefined at best,
      // an uncaught native-binding throw at worst — see this function's
      // own review notes). Checked first via the same synthetic-id map
      // elementSplitTargets.ts populates; falls through to the real-GUID
      // path below for every ordinary element.
      const splitRef = getSplitElementRef(activeIfcHandle, expressId)
      if (splitRef) {
        drafts.push({ source_kind: 'ifc_split', element_ref: splitRef, element_label: `Slice (${splitRef.slice(-12)})` })
        continue
      }
      const guid = getGuidFromExpressId(activeIfcHandle, expressId)
      if (!guid) continue
      const typeName = getElementTypeName(activeIfcHandle, expressId)
      drafts.push({ source_kind: 'ifc', element_ref: guid, element_label: `${typeName} (${guid.slice(0, 8)})` })
    }
  }

  return drafts
}
