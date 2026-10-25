import type { AnimationProfileConfig } from './animationProfiles'
import { computeAppliedAnimationStateAt } from './timelinePlayback'
export const PROFILE_FAMILIES = ['All', 'Fade', 'Move', 'Scale / Grow', 'Rotate', 'Pop / Spiral', 'Demolish']
export function profileFamily(c: AnimationProfileConfig) {
  if (c.grow_mode === 'remove' || c.trigger === 'on_finish') return 'Demolish'
  return ({none:'Fade',translate:'Move',fall:'Move',scale:'Scale / Grow',grow:'Scale / Grow',rotate:'Rotate',pop:'Pop / Spiral',spiral:'Pop / Spiral'})[c.transform_kind]
}
export function previewProfile(c: AnimationProfileConfig, progress: number, fraction = 0) {
  const days = Math.max(1, (c.duration_frames ?? 1) * 2)
  return computeAppliedAnimationStateAt({startMs:0, finishMs:days*86400000, profile:c, staggerFraction:fraction}, new Date(progress*days*86400000), 'y')!
}
export function durationValue(days: number, unit: string, speed: number, fps: number) {
  return unit === 'days' ? days : days / speed * (unit === 'frames' ? fps : 1)
}
export function durationDays(value: number, unit: string, speed: number, fps: number) {
  return unit === 'days' ? value : value * speed / (unit === 'frames' ? fps : 1)
}
