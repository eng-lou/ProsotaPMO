import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { loadTextureFromDataUri } from './customTextures'
import type { CustomTextureSet, TextureSlot } from './customTextures'

export { fileToDataUri } from './customTextures'

// Mirrors backend app/schemas/material_preset.py's MaterialPresetConfig
// exactly. Each slot is either null (not part of this preset — applying it
// leaves that channel untouched on whatever it's applied to) or a saved
// image, stored as a data: URI directly in the preset's own JSONB config
// (see material_preset.py's model docstring for why: no separate
// file-upload/serving endpoint needed, consistent with every other
// config-blob entity in this app).
export interface MaterialPresetSlot {
  data_uri: string
  name: string
}

export interface MaterialPresetConfig {
  map: MaterialPresetSlot | null
  metalnessMap: MaterialPresetSlot | null
  roughnessMap: MaterialPresetSlot | null
  normalMap: MaterialPresetSlot | null
}

export const EMPTY_MATERIAL_PRESET_CONFIG: MaterialPresetConfig = {
  map: null, metalnessMap: null, roughnessMap: null, normalMap: null,
}

export interface MaterialPreset {
  id: string
  project_id: string
  name: string
  config: MaterialPresetConfig
  created_at: string
  updated_at: string
}

// Turns a saved preset's stored data: URIs back into live THREE.Texture
// objects wired up the same shape TextureFields.tsx/customTextures.ts
// already work with (CustomTextureSet) — so applying a preset is just
// "merge this into customTextures for the active target," identical to a
// fresh manual upload from FourD.tsx's own point of view.
export async function loadPresetAsTextureSet(config: MaterialPresetConfig): Promise<CustomTextureSet> {
  const slots: TextureSlot[] = ['map', 'metalnessMap', 'roughnessMap', 'normalMap']
  const result: CustomTextureSet = {}
  await Promise.all(slots.map(async slot => {
    const value = config[slot]
    if (!value) return
    result[slot] = await loadTextureFromDataUri(value.data_uri, slot, value.name)
  }))
  return result
}

// The reverse of loadPresetAsTextureSet — reads whatever's *currently
// applied* (a live CustomTextureSet, whose TextureSlotValue already carries
// the original data: URI alongside its decoded texture, see
// customTextures.ts's own header) back into preset-shaped config, so "Save
// Current as Preset" (MaterialPresetPicker.tsx's 💾 button) never needs a
// lossy canvas re-encode of an already-decoded image.
export function textureSetToPresetConfig(set: CustomTextureSet): MaterialPresetConfig {
  const toSlot = (slot: TextureSlot): MaterialPresetSlot | null => {
    const value = set[slot]
    return value ? { data_uri: value.dataUri, name: value.name } : null
  }
  return { map: toSlot('map'), metalnessMap: toSlot('metalnessMap'), roughnessMap: toSlot('roughnessMap'), normalMap: toSlot('normalMap') }
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

  const create = async (name: string, config: MaterialPresetConfig): Promise<MaterialPreset> => {
    const { data } = await api.post<MaterialPreset>('/api/v1/material-presets/', { project_id: projectId, name, config })
    await load()
    return data
  }

  const update = async (presetId: string, name: string, config: MaterialPresetConfig) => {
    await api.patch(`/api/v1/material-presets/${presetId}`, { name, config })
    await load()
  }

  const remove = async (presetId: string) => {
    await api.delete(`/api/v1/material-presets/${presetId}`)
    await load()
  }

  return { presets, loading, create, update, remove, refetch: load }
}
