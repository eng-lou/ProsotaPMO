import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfileConfig, Interpolation } from './animationProfiles'
import type { ElementKeyframe } from './elementKeyframes'

const DAY_MS = 86_400_000

// Earliest start / latest finish across real work (2026-07-11) — the
// timeline's own date-range bounds, same "Guess" concept as Bonsai's own
// Animation Settings. WBS summary rows are excluded — their dates are
// roll-ups of their children, not real activities to scrub through.
export function computeScheduleRange(activities: Activity[]): { start: Date; end: Date } | null {
  let start: Date | null = null
  let end: Date | null = null
  for (const a of activities) {
    if (a.activity_type === 'wbs_summary' || !a.start || !a.finish) continue
    const s = new Date(a.start)
    const f = new Date(a.finish)
    if (!start || s < start) start = s
    if (!end || f > end) end = f
  }
  return start && end ? { start, end } : null
}

// Earliest/latest keyframe date across the whole project (2026-07-08, per
// Maro: "I need to be able to animate also independently from the activity
// schedule... basically what im trying to avoid is adding a simple cube and
// i cant do animation because its asking for a dated activity"). Unioned
// with computeScheduleRange above via unionRanges so the Timeline window
// still has something to scrub even in a project with no dated activities
// at all — a schedule and free-form keyframes are two independent sources
// for the same one scrubber, not a schedule prerequisite for the other.
export function computeKeyframeRange(keyframes: ElementKeyframe[]): { start: Date; end: Date } | null {
  let start: Date | null = null
  let end: Date | null = null
  for (const k of keyframes) {
    const d = new Date(k.date)
    if (!start || d < start) start = d
    if (!end || d > end) end = d
  }
  return start && end ? { start, end } : null
}

export function unionRanges(
  a: { start: Date; end: Date } | null,
  b: { start: Date; end: Date } | null,
): { start: Date; end: Date } | null {
  if (!a) return b
  if (!b) return a
  return { start: a.start < b.start ? a.start : b.start, end: a.end > b.end ? a.end : b.end }
}

// A single keyframe (or a schedule with same-day start/finish) collapses the
// range to a single point, which makes for an unusable scrubber — pad it out
// to a reasonable minimum window, centred on that point.
export function padDegenerateRange(range: { start: Date; end: Date } | null, minDays = 14): { start: Date; end: Date } | null {
  if (!range || range.end.getTime() > range.start.getTime()) return range
  const half = (minDays * DAY_MS) / 2
  return { start: new Date(range.start.getTime() - half), end: new Date(range.end.getTime() + half) }
}

// Linear interpolation between the two nearest keyframes in a single
// field's track (2026-07-08) — holds the first value before it, the last
// value after it, same "before/after the range" convention as Blender's own
// keyframe extrapolation default. No easing curve per segment (yet) —
// keyframes are direct value control, unlike AnimationProfileConfig's own
// duration-wide easing.
export function interpolateKeyframeTrack(points: { date: Date; value: number }[], now: Date): number | null {
  if (points.length === 0) return null
  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime())
  const nowMs = now.getTime()
  if (nowMs <= sorted[0].date.getTime()) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (nowMs >= last.date.getTime()) return last.value
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1]
    if (nowMs >= a.date.getTime() && nowMs <= b.date.getTime()) {
      const span = b.date.getTime() - a.date.getTime()
      const t = span > 0 ? (nowMs - a.date.getTime()) / span : 1
      return a.value + (b.value - a.value) * t
    }
  }
  return last.value
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

// Named easing curves matching AnimationProfileConfig.interpolation — plain
// 0..1 -> 0..1 remaps, applied to the raw linear window-progress before
// it's used to drive transform/opacity (2026-07-11). "bounce" is a cheap
// overshoot-and-settle approximation, not literally Blender's own bounce
// curve — close enough for a first pass; worth revisiting once this is
// actually seen in motion.
export function applyEasing(t: number, interpolation: Interpolation): number {
  const x = clamp01(t)
  switch (interpolation) {
    case 'ease_in': return x * x
    case 'ease_out': return 1 - (1 - x) * (1 - x)
    case 'ease_in_out': return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
    case 'bounce': {
      const c = 1.70158 + 1
      return 1 + c * Math.pow(x - 1, 3) + (c - 1) * Math.pow(x - 1, 2)
    }
    default: return x
  }
}

export interface AppliedAnimationState {
  // Added to the object's captured base position (world-space-agnostic,
  // just along the profile's chosen local axis).
  positionOffset: [number, number, number]
  // Added to the base rotation on the profile's axis, in degrees.
  rotationOffsetDeg: number
  // Multiplied against the base scale, uniformly on all three axes.
  scaleMultiplier: number
  opacity: number
  // null = don't touch the material's own colour.
  color: string | null
}

const AXIS_VECTOR: Record<string, [number, number, number]> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

function lerpColor(fromHex: string, toHex: string, t: number): string {
  const from = parseInt(fromHex.replace('#', ''), 16)
  const to = parseInt(toHex.replace('#', ''), 16)
  const fr = (from >> 16) & 0xff, fg = (from >> 8) & 0xff, fb = from & 0xff
  const tr = (to >> 16) & 0xff, tg = (to >> 8) & 0xff, tb = to & 0xff
  const r = Math.round(fr + (tr - fr) * t)
  const g = Math.round(fg + (tg - fg) * t)
  const b = Math.round(fb + (tb - fb) * t)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

// The core per-frame recipe (2026-07-11, per Maro — see animationProfiles.ts
// for the Bonsai/Blender-add-on reference this was scoped against). Two
// independent concerns, deliberately decoupled:
//
// - Colour is duration-wide: if color_from/color_to is set, it lerps across
//   the *whole* activity duration (start..finish) regardless of trigger —
//   "red while the activity is ongoing" (Maro's own example) is a duration
//   concept, not tied to a narrow start/finish transition window.
// - Transform + opacity are trigger-windowed: "over_duration" spans the
//   whole activity (a smooth build/grow across it); "on_start"/"on_finish"
//   instead use a short window (duration_frames, reinterpreted here as
//   *days* rather than literal animation frames — there's no frame-rate/
//   speed-mapping settings entity yet, so treating it as a calendar-day
//   window is the simplest thing that's still genuinely configurable)
//   anchored so the transition completes exactly at start (on_start) or
//   exactly at finish (on_finish).
//
// rawProgress is always "0 = away/displaced, 1 = settled/base" for
// on_start/over_duration, and inverted for on_finish (1 = still settled,
// ramping to 0 = fully departed) — so "Fall Down Z" assigned to an on_finish
// profile reads naturally as "falls away as the task finishes", while the
// same preset on an on_start profile reads as "falls into place as the task
// begins".
export function computeAppliedAnimationStateAt(
  activity: Pick<Activity, 'start' | 'finish'>,
  profile: AnimationProfileConfig,
  now: Date,
): AppliedAnimationState | null {
  if (!activity.start || !activity.finish) return null
  const start = new Date(activity.start)
  const finish = new Date(activity.finish)
  const nowMs = now.getTime()

  let color: string | null = null
  if (profile.color_from || profile.color_to) {
    const from = profile.color_from ?? profile.color_to!
    const to = profile.color_to ?? profile.color_from!
    if (nowMs >= start.getTime() && nowMs <= finish.getTime()) {
      const t = finish.getTime() > start.getTime() ? (nowMs - start.getTime()) / (finish.getTime() - start.getTime()) : 1
      color = lerpColor(from, to, clamp01(t))
    }
  }

  let rawProgress: number
  if (profile.trigger === 'over_duration') {
    rawProgress = finish.getTime() > start.getTime()
      ? clamp01((nowMs - start.getTime()) / (finish.getTime() - start.getTime()))
      : (nowMs >= finish.getTime() ? 1 : 0)
  } else if (profile.trigger === 'on_start') {
    const windowDays = profile.duration_frames ?? 1
    const windowEnd = start.getTime() + windowDays * DAY_MS
    rawProgress = nowMs <= start.getTime() ? 0 : nowMs >= windowEnd ? 1 : (nowMs - start.getTime()) / (windowEnd - start.getTime())
  } else {
    const windowDays = profile.duration_frames ?? 1
    const windowStart = finish.getTime() - windowDays * DAY_MS
    rawProgress = nowMs <= windowStart ? 1 : nowMs >= finish.getTime() ? 0 : 1 - (nowMs - windowStart) / (finish.getTime() - windowStart)
  }

  const eased = applyEasing(rawProgress, profile.interpolation)
  const awayAmount = 1 - eased
  const axis = AXIS_VECTOR[profile.axis]

  let positionOffset: [number, number, number] = [0, 0, 0]
  let rotationOffsetDeg = 0
  let scaleMultiplier = 1

  if (['translate', 'fall', 'pop', 'spiral'].includes(profile.transform_kind)) {
    positionOffset = [
      axis[0] * profile.direction * profile.distance * awayAmount,
      axis[1] * profile.direction * profile.distance * awayAmount,
      axis[2] * profile.direction * profile.distance * awayAmount,
    ]
  }
  if (profile.transform_kind === 'pop' || profile.transform_kind === 'scale') {
    scaleMultiplier = Math.max(0.001, eased)
  }
  if (profile.transform_kind === 'rotate') {
    rotationOffsetDeg = profile.direction * profile.distance * awayAmount
  }
  if (profile.transform_kind === 'spiral') {
    rotationOffsetDeg = profile.direction * 360 * awayAmount
  }

  const opacity = profile.opacity_from + (profile.opacity_to - profile.opacity_from) * eased

  return { positionOffset, rotationOffsetDeg, scaleMultiplier, opacity, color }
}
