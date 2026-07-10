import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

export type TransformKind = 'none' | 'translate' | 'scale' | 'rotate' | 'pop' | 'spiral' | 'fall'
export type Axis = 'x' | 'y' | 'z'
export type Direction = 1 | -1
export type Trigger = 'on_start' | 'on_finish' | 'over_duration'
export type Interpolation = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' | 'bounce'

// Mirrors backend app/schemas/animation_profile.py:AnimationProfileConfig
// exactly.
export interface AnimationProfileConfig {
  trigger: Trigger
  transform_kind: TransformKind
  axis: Axis
  direction: Direction
  distance: number
  bounce: boolean
  twist: boolean
  opacity_from: number
  opacity_to: number
  color_from: string | null
  color_to: string | null
  interpolation: Interpolation
  duration_frames: number | null
}

export const DEFAULT_ANIMATION_CONFIG: AnimationProfileConfig = {
  trigger: 'over_duration',
  transform_kind: 'none',
  axis: 'z',
  direction: 1,
  distance: 1,
  bounce: false,
  twist: false,
  opacity_from: 0,
  opacity_to: 1,
  color_from: null,
  color_to: null,
  interpolation: 'linear',
  duration_frames: null,
}

export interface AnimationProfile {
  id: string
  project_id: string
  name: string
  config: AnimationProfileConfig
  created_at: string
  updated_at: string
}

// Built-in named presets (2026-07-11, per Maro, referencing a Blender
// add-on's own preset library — "Pop Up Y", "Fall Down Z", "Spiral In X",
// "Rotate In Bounce -Z" — plus Bonsai's demolition/red-while-ongoing
// example) — frontend-only constants, not database rows (see
// animation_profile.py's own header for why). Shown alongside a project's
// saved custom profiles in AnimationProfilePanel.tsx; "Save as new" from one
// of these turns it into an editable row.
export const BUILTIN_PRESETS: { name: string; config: AnimationProfileConfig }[] = [
  { name: 'Fade In', config: { ...DEFAULT_ANIMATION_CONFIG } },
  { name: 'Animate In X', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'translate', axis: 'x' } },
  { name: 'Animate In Y', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'translate', axis: 'y' } },
  { name: 'Animate In Z', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'translate', axis: 'z' } },
  { name: 'Scale In', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'scale' } },
  { name: 'Fall Down Z', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'fall', axis: 'z', direction: -1 } },
  { name: 'Pop Up X', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'pop', axis: 'x' } },
  { name: 'Pop Up Y', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'pop', axis: 'y' } },
  { name: 'Pop Up Z', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'pop', axis: 'z' } },
  { name: 'Pop Up -X', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'pop', axis: 'x', direction: -1 } },
  { name: 'Pop Up -Y', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'pop', axis: 'y', direction: -1 } },
  { name: 'Pop Up -Z', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'pop', axis: 'z', direction: -1 } },
  { name: 'Pop Up Twist', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'pop', axis: 'z', twist: true } },
  { name: 'Spiral In X', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'spiral', axis: 'x' } },
  { name: 'Spiral In Y', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'spiral', axis: 'y' } },
  { name: 'Spiral In Z', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'spiral', axis: 'z' } },
  { name: 'Rotate In X', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'rotate', axis: 'x' } },
  { name: 'Rotate In Y', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'rotate', axis: 'y' } },
  { name: 'Rotate In Z', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'rotate', axis: 'z' } },
  { name: 'Rotate In Bounce X', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'rotate', axis: 'x', bounce: true } },
  { name: 'Rotate In Bounce Y', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'rotate', axis: 'y', bounce: true } },
  { name: 'Rotate In Bounce Z', config: { ...DEFAULT_ANIMATION_CONFIG, transform_kind: 'rotate', axis: 'z', bounce: true } },
  // Maro's own "remove site office" example — red while the demolition task
  // is ongoing, then gone: an on_finish trigger (the disappearance itself
  // is instant at the end of the task) with the colour held red across the
  // whole window (color_from === color_to) and a downward fall + fade.
  {
    name: 'Demolish (Fade Red, Fall)',
    config: { ...DEFAULT_ANIMATION_CONFIG, trigger: 'on_finish', transform_kind: 'fall', axis: 'z', direction: -1, opacity_from: 1, opacity_to: 0, color_from: '#ef4444', color_to: '#ef4444' },
  },
]

export function useAnimationProfiles(projectId: string | undefined) {
  const [profiles, setProfiles] = useState<AnimationProfile[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<AnimationProfile[]>('/api/v1/animation-profiles/', { params: { project_id: projectId } })
      setProfiles(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const create = async (name: string, config: AnimationProfileConfig): Promise<AnimationProfile> => {
    const { data } = await api.post<AnimationProfile>('/api/v1/animation-profiles/', { project_id: projectId, name, config })
    await load()
    return data
  }

  const update = async (profileId: string, name: string, config: AnimationProfileConfig) => {
    await api.patch(`/api/v1/animation-profiles/${profileId}`, { name, config })
    await load()
  }

  const remove = async (profileId: string) => {
    await api.delete(`/api/v1/animation-profiles/${profileId}`)
    await load()
  }

  return { profiles, loading, create, update, remove, refetch: load }
}
