import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
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

// Fetches each present slot's actual image bytes from the new download
// endpoint (an authenticated blob fetch, same shape model3dFiles.ts's own
// downloadModel3DFile already uses) and turns each into a live THREE.Texture,
// same TextureSlotValue shape loadCustomTexture already returns — applying
// a preset is indistinguishable from a fresh manual upload from this point
// on, same as before this fix.
export async function loadPresetAsTextureSet(preset: MaterialPreset): Promise<CustomTextureSet> {
  const result: CustomTextureSet = {}
  await Promise.all(preset.textures.map(async t => {
    const res = await api.get<Blob>(`/api/v1/material-presets/${preset.id}/textures/${t.slot}`, { responseType: 'blob' })
    result[t.slot] = await loadTextureFromBlob(res.data, t.slot, t.name)
  }))
  return result
}

function buildFormData(name: string, files: Partial<Record<TextureSlot, Blob>>, clearedSlots?: TextureSlot[]): FormData {
  const form = new FormData()
  form.append('name', name)
  if (clearedSlots !== undefined) form.append('cleared_slots', clearedSlots.join(','))
  for (const [slot, blob] of Object.entries(files)) {
    if (blob) form.append(slot, blob, slot)
  }
  return form
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
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // multipart/form-data, not JSON (2026-07-13 fix) — see this module's own
  // header. project_id/name arrive as plain form fields alongside up to six
  // optional texture files, mirroring model3dFiles.ts's own
  // uploadModel3DFile.
  const create = async (name: string, files: Partial<Record<TextureSlot, Blob>>): Promise<MaterialPreset> => {
    const form = buildFormData(name, files)
    form.append('project_id', projectId ?? '')
    const { data } = await api.post<MaterialPreset>('/api/v1/material-presets/', form)
    await load()
    return data
  }

  // clearedSlots explicitly nulls a slot with no replacement file; any
  // slot in neither `files` nor `clearedSlots` is left completely
  // untouched server-side — renaming a preset with several large existing
  // textures doesn't re-upload any of them.
  const update = async (presetId: string, name: string, files: Partial<Record<TextureSlot, Blob>>, clearedSlots: TextureSlot[]) => {
    const form = buildFormData(name, files, clearedSlots)
    await api.patch(`/api/v1/material-presets/${presetId}`, form)
    await load()
  }

  const remove = async (presetId: string) => {
    await api.delete(`/api/v1/material-presets/${presetId}`)
    await load()
  }

  return { presets, loading, create, update, remove, refetch: load }
}
