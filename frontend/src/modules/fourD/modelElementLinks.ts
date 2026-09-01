import { api } from '@/lib/api'

export type SourceKind = 'ifc' | 'mesh'

// "annotation" (2026-07-12) — element_ref is an Annotation row's own id
// (annotations.ts), letting a Placemark/Footnote link to an Activity +
// AnimationProfile exactly like a mesh/IFC element does. A distinct,
// wider type from SourceKind rather than widening SourceKind itself —
// every existing SourceKind consumer (Collections member refs, DataPanel's
// own link-to-activity UI) deals exclusively in real mesh/IFC geometry and
// should keep statically rejecting anything else; only ModelElementLink's
// own source_kind actually needs the third option.
// "ifc_split" (2026-07-15) — element_ref is a level-slice's own synthetic
// ref (`${parentGlobalId}::split:N`, see elementSplitTargets.ts's own
// header), not a real IFC element's GlobalId. Note CollectionMember
// (collections.ts) widens its *own* independently-declared source_kind
// literal to include this too — it's not derived from SourceKind either,
// so both need updating in step whenever a new kind is added.
export type ModelElementLinkSourceKind = SourceKind | 'annotation' | 'ifc_split'

export interface ModelElementLink {
  id: string
  project_id: string
  activity_id: string
  source_kind: ModelElementLinkSourceKind
  element_ref: string
  element_label: string
  animation_profile_id: string | null
  created_at: string
  updated_at: string
}

// Frontend for model_element_link.py's backend (built earlier this session
// — table/schema/service/API/tests — with no UI until now, 2026-07-11).
// element_ref is an IFC element's GlobalId (source_kind="ifc") or an
// imported mesh's filename (source_kind="mesh") — see the backend model's
// own header for why: element_ref is a loose string identity, not an FK to
// Model3DFile, so a link only re-attaches once its source file is back in
// the viewport under the same identifier — and can outlive the underlying
// Model3DFile being deleted (Unload) entirely. FourD.tsx's
// requestUnloadModel/UnloadModelDialog.tsx give the user an explicit way to
// delete a model's own links instead of leaving them dangling forever.
export async function listModelElementLinks(projectId: string): Promise<ModelElementLink[]> {
  const res = await api.get<ModelElementLink[]>('/api/v1/model-element-links/', { params: { project_id: projectId } })
  return res.data
}

export async function createModelElementLink(data: {
  activity_id: string
  source_kind: ModelElementLinkSourceKind
  element_ref: string
  element_label: string
  // Optional at create time (2026-08-30, per Maro: "why cant i set the
  // profile at the same time") — previously only settable via a follow-up
  // assignAnimationProfile PATCH.
  animation_profile_id?: string | null
}): Promise<ModelElementLink> {
  const res = await api.post<ModelElementLink>('/api/v1/model-element-links/', data)
  return res.data
}

export async function deleteModelElementLink(id: string): Promise<void> {
  await api.delete(`/api/v1/model-element-links/${id}`)
}

// Bulk link (2026-09-01, per Maro: "optimise and reduce waste, improve
// speed") — one request instead of one POST per element (see the
// backend's own create_links_bulk docstring). Already-linked-to-this-
// activity elements are silently skipped server-side, same "benign
// no-op" precedent createModelElementLink's own one-at-a-time 409-
// catching callers already established.
export async function createModelElementLinksBulk(data: {
  activity_id: string
  members: { source_kind: ModelElementLinkSourceKind; element_ref: string; element_label: string }[]
  animation_profile_id?: string | null
}): Promise<{ created: ModelElementLink[]; skipped_duplicates: number }> {
  const res = await api.post<{ created: ModelElementLink[]; skipped_duplicates: number }>('/api/v1/model-element-links/bulk', data)
  return res.data
}

// Assigns/clears which AnimationProfile drives this link (2026-07-11, per
// Maro) — the only thing about a link worth changing after creation.
export async function assignAnimationProfile(linkId: string, animationProfileId: string | null): Promise<ModelElementLink> {
  const res = await api.patch<ModelElementLink>(`/api/v1/model-element-links/${linkId}`, { animation_profile_id: animationProfileId })
  return res.data
}
