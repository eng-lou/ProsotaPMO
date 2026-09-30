import { useEffect, useState } from 'react'
import { api, downloadLargeBlob } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'
import { getOrDownloadFile, pruneCachedFiles } from '@/lib/fileCache'
import { loadTextureFromBlob } from './customTextures'
import type { CustomTextureSet, TextureSlot } from './customTextures'

// Frontend for material_preset.py/material_preset_texture.py's backend
// (2026-07-13 fix — was previously one JSONB `config` blob per preset,
// each slot a base64 data: URI embedded directly in it; a real 8K texture
// blew straight through Postgres's own 256MB-per-JSONB-element ceiling.
// Each slot is now a real file on disk, referenced by id/name only here —
// see material_preset_texture.py's own docstring for the full incident).
export interface MaterialPresetTexture {
  id: string
  slot: TextureSlot
  name: string
}

export interface MaterialPreset {
  id: string
  project_id: string
  name: string
  textures: MaterialPresetTexture[]
  created_at: string
  updated_at: string
}

// Per-slot lookup, derived from `textures` — the editor/display convenience
// shape every consumer of this module actually wants, not a second stored
// representation of the same data.
export type MaterialPresetConfig = Partial<Record<TextureSlot, MaterialPresetTexture>>

export function textureListToConfig(textures: MaterialPresetTexture[]): MaterialPresetConfig {
  const config: MaterialPresetConfig = {}
  for (const t of textures) config[t.slot] = t
  return config
}

export const EMPTY_MATERIAL_PRESET_CONFIG: MaterialPresetConfig = {}

// Fetches each present slot's actual image bytes (cache-first — a texture
// id never points at different bytes, see the backend's _replace_slot; no
// total timeout, an 8K map can legitimately take longer than 25s) and turns
// each into a live THREE.Texture,
// same TextureSlotValue shape loadCustomTexture already returns — applying
// a preset is indistinguishable from a fresh manual upload from this point
// on, same as before this fix.
export async function loadPresetAsTextureSet(preset: MaterialPreset): Promise<CustomTextureSet> {
  const result: CustomTextureSet = {}
  await Promise.all(preset.textures.map(async t => {
    const blob = await getOrDownloadFile(
      'texture', preset.project_id, t.id,
      () => downloadLargeBlob(`/api/v1/material-presets/${preset.id}/textures/${t.slot}`),
    )
    result[t.slot] = await loadTextureFromBlob(blob, t.slot, t.name)
  }))
  return result
}

// Direct-to-R2 texture upload (2026-09-30) — textures used to go up as
// multipart form fields through our own backend, which Vercel caps at 4.5MB
// per request, so saving a preset with any real high-res map failed in
// production. Each texture is now PUT straight to storage (same flow as
// model3dFiles.ts's uploadModel3DFile) and create/update send only the
// resulting storage keys. Not gzipped: JPG/PNG are already compressed.
type TextureUploads = Partial<Record<TextureSlot, { storage_key: string; name: string }>>

async function uploadTextures(files: Partial<Record<TextureSlot, Blob>>): Promise<TextureUploads> {
  const out: TextureUploads = {}
  await Promise.all(Object.entries(files).map(async ([slot, blob]) => {
    if (!blob) return
    const name = blob instanceof File ? blob.name : slot
    const contentType = blob.type || 'application/octet-stream'
    const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
      '/api/v1/material-presets/presign', { name, content_type: contentType },
    )
    await uploadDirectToStorage(presigned.upload_url, blob, contentType)
    out[slot as TextureSlot] = { storage_key: presigned.storage_key, name }
  }))
  return out
}

// Named, saved, per-project custom material presets (2026-07-09, per Maro:
// "Save the default materials for the whole model... I can then add a new
// preset which allows me to change the materials, i can save it, edit and
// delete") — same create/list/update/delete shape as
// useAnimationProfiles/useSchedulingFilters, no apply/is_active concept for
// the same reason those don't have one: a preset is a reusable library
// entry applied on demand to whichever element/object is currently active,
// not "the one active look" for the whole project.
export function useMaterialPresets(projectId: string | undefined) {
  const [presets, setPresets] = useState<MaterialPreset[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<MaterialPreset[]>('/api/v1/material-presets/', { params: { project_id: projectId } })
      setPresets(data)
      void pruneCachedFiles('texture', projectId, data.flatMap(p => p.textures.map(t => t.id)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const create = async (name: string, files: Partial<Record<TextureSlot, Blob>>): Promise<MaterialPreset> => {
    const textures = await uploadTextures(files)
    const { data } = await api.post<MaterialPreset>('/api/v1/material-presets/', { project_id: projectId, name, textures })
    await load()
    return data
  }

  // clearedSlots explicitly nulls a slot with no replacement file; any
  // slot in neither `files` nor `clearedSlots` is left completely
  // untouched server-side — renaming a preset with several large existing
  // textures doesn't re-upload any of them.
  const update = async (presetId: string, name: string, files: Partial<Record<TextureSlot, Blob>>, clearedSlots: TextureSlot[]) => {
    const textures = await uploadTextures(files)
    await api.patch(`/api/v1/material-presets/${presetId}`, { name, textures, cleared_slots: clearedSlots })
    await load()
  }

  const remove = async (presetId: string) => {
    await api.delete(`/api/v1/material-presets/${presetId}`)
    await load()
  }

  return { presets, loading, create, update, remove, refetch: load }
}
