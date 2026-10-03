import type { IfcModelHandle } from './ifcModel'
import type { LinkableSceneObject } from './linkedElements'
import type { ModelElementLink } from './modelElementLinks'
import { getSplitExpressId } from './splitElementRefs'

// The assignment inspector needs only existing links, not a labelled draft
// for every selected element. In particular, selecting an unlinked 130k-element
// model must never enumerate its GUIDs/types or initialise web-ifc's GUID map.
export async function selectedAssignmentKeys(
  links: Pick<ModelElementLink, 'source_kind' | 'element_ref'>[],
  objectIds: Set<string>, expressIds: Set<number>, objects: LinkableSceneObject[],
  handle: IfcModelHandle | null, signal?: AbortSignal,
): Promise<Set<string>> {
  const keys = new Set<string>()
  if (!links.length || (!objectIds.size && !expressIds.size)) return keys
  const meshNames = new Set(objects.filter(o => o.kind === 'mesh' && objectIds.has(o.id)).map(o => o.name))
  const visited = new Set<string>()
  for (let i = 0; i < links.length; i++) {
    if (i > 0 && i % 128 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
    if (signal?.aborted) throw new DOMException('Selection changed', 'AbortError')
    const link = links[i]
    const key = `${link.source_kind}::${link.element_ref}`
    if (visited.has(key)) continue
    visited.add(key)
    if (link.source_kind === 'mesh') {
      if (meshNames.has(link.element_ref)) keys.add(key)
    } else if (handle && expressIds.size) {
      const id = link.source_kind === 'ifc_split'
        ? getSplitExpressId(handle, link.element_ref)
        : handle.api.GetExpressIdFromGuid(handle.ifcModelID, link.element_ref)
      if (id !== undefined && expressIds.has(Number(id))) keys.add(key)
    }
  }
  return keys
}
