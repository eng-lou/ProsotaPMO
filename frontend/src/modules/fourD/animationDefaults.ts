import type { AnimationProfileConfig } from './animationProfiles'

// Shared by viewport defaults and the worker-safe IFC exporter.
export const DEFAULT_ANIMATION_COLOR_FROM = '#22c55e'

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
  color_from: DEFAULT_ANIMATION_COLOR_FROM,
  color_to: null,
  interpolation: 'linear',
  duration_frames: null,
  stagger: 0,
  stagger_order: 'along_x',
  stagger_reverse: false,
}
