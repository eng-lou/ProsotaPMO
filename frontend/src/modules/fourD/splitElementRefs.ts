import type { IfcModelHandle } from './ifcModel'

// The synthetic-expressID <-> element_ref lookup for level-slices
// (2026-07-15), split out from elementSplitTargets.ts on purpose: that
// module imports three.js to actually build/clip the clone meshes, but
// several consumers of *this* lookup alone (linkedElements.ts,
// collectionResolvers.ts) deliberately have no other reason to pull three.js
// into their own dependency graph — linkedElements.ts's own header explains
// why. See elementSplitTargets.ts's own header for the full "clipped
// virtual slice" design this is one piece of.
export interface SplitTargetMaps {
  refToExpressId: Map<string, number>
  expressIdToRef: Map<number, string>
}

export const splitTargetMapsByHandle = new WeakMap<IfcModelHandle, SplitTargetMaps>()

export function getSplitExpressId(handle: IfcModelHandle, elementRef: string): number | undefined {
  return splitTargetMapsByHandle.get(handle)?.refToExpressId.get(elementRef)
}

export function getSplitElementRef(handle: IfcModelHandle, expressId: number): string | undefined {
  return splitTargetMapsByHandle.get(handle)?.expressIdToRef.get(expressId)
}

// The one place `${parentGlobalId}::split:${index}` gets built/parsed
// (2026-07-15) — elementSplitTargets.ts builds it when generating clones,
// IfcDataPanel.tsx parses it back to show a slice's parent's real
// properties. `::` can't appear in a real IFC GlobalId (base64-derived,
// fixed 22-char alphabet with no colon) so splitting on it is safe.
export function buildSplitElementRef(parentGlobalId: string, index: number): string {
  return `${parentGlobalId}::split:${index}`
}

export function parseSplitElementRef(ref: string): { parentGlobalId: string; index: number } | null {
  const match = /^(.+)::split:(\d+)$/.exec(ref)
  if (!match) return null
  return { parentGlobalId: match[1], index: Number(match[2]) }
}
