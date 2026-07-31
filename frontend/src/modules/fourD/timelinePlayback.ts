import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfileConfig, Axis, Interpolation } from './animationProfiles'
import type { ElementKeyframe } from './elementKeyframes'
import { resolveDisplayAxis, type UpAxis } from './upAxis'

// Moved here from Viewport3D.tsx (2026-07-12) so AnnotationMarker.tsx can
// resolve its own Mode A link the identical way meshes/IFC elements do,
// without a circular import (Viewport3D.tsx renders AnnotationMarker.tsx,
// so the reverse import isn't possible) — the previous one had set. Every
// link now gets kept, and pickActiveLink() at apply-time chooses whichever
// activity is chronologically current for `now` — the same idea as a
// Blender NLA strip stack, minus any blending: activities before their own
// start still correctly show "at rest" (computeAppliedAnimationStateAt
// already clamps that), so falling back to the earliest link when `now`
// precedes every link's start is safe, not just a default-of-convenience.
export interface ResolvedTimelineLink {
  activity: Pick<Activity, 'start' | 'finish'>
  // Epoch-ms of activity.start/finish, parsed once when the link is built
  // (Viewport3D.tsx's Mode A resolution / AnnotationMarker.tsx's own
  // useMemo), not per frame — see pickActiveLink/computeAppliedAnimationStateAt's
  // own headers below for why that used to matter at real schedule scale.
  startMs: number
  finishMs: number
  profile: AnimationProfileConfig
  axis: Axis
}

// Rewritten (2026-07-21, per Maro: "the animation timeline is still
// dragging" even after the geometry-batching fix landed and was confirmed
// live via ifcModel.ts's own console.info — a real, separate bottleneck:
// this used to spread-clone `links` into a new array and `.sort()` it with
// a comparator that called `new Date(a.activity.start!)` — genuine ISO
// *string parsing*, not just object construction — on every single
// comparison, then re-parsed every link's start a second time in the loop
// below. Called once per schedule-linked element (batched or materialized)
// every frame the timeline's date changes, i.e. essentially every frame
// during actual Play/scrub (the cachedActiveLink/cachedState gate a few
// hundred lines below only helps while *paused*) — at six-combined-
// discipline-file scale (confirmed ~55,000 total placements via that same
// console.info) that was tens of thousands of array allocations, sorts, and
// ISO-string reparses of the exact same two date strings, every frame,
// 60 times a second. Now a single O(links-per-element) linear scan (that
// count is normally 1) over already-numeric startMs, with zero allocation
// and zero Date construction — semantics unchanged: the link with the
// latest start at-or-before `now`, falling back to the earliest-starting
// link if `now` precedes every one of them (activities before their own
// start already read as "at rest" via computeAppliedAnimationStateAt's own
// clamping, so that fallback is correctness, not just convenience — see
// this file's own header above).
export function pickActiveLink(links: ResolvedTimelineLink[], now: Date): ResolvedTimelineLink | null {
  if (links.length === 0) return null
  const nowMs = now.getTime()
  let earliest = links[0]
  let active: ResolvedTimelineLink | null = null
  for (const link of links) {
    if (link.startMs < earliest.startMs) earliest = link
    if (link.startMs <= nowMs && (active === null || link.startMs > active.startMs)) active = link
  }
  return active ?? earliest
}

const DAY_MS = 86_400_000

// Shared between TimelineWindow.tsx's own fps <select> and FourD.tsx's
// lifted-state validation of a stored localStorage value (2026-07-30) — one
// definition so the two can never drift apart.
export const FPS_OPTIONS = [24, 25, 30, 60]

// Date/Seconds/Frames display modes (2026-07-12, per Maro: "I want to
// choose to see as date or time (normal blender time secs/frames etc)...
// so i can be precise and also adjust frame rate") — this app's timeline
// is calendar-date-driven with no fixed frame rate anywhere else in it (see
// TimelineWindow.tsx's own header on why "speed" is calendar-days-per-
// real-second, not frames-per-second), so "seconds"/"frames" here are both
// derived relative to scheduleStart at the *current* Play speed setting,
// not some independent fixed clock — moving the speed dropdown changes
// what "12s" or "Frame 360" mean, exactly like scrubbing Blender's own
// timeline means something different at 24fps vs 60fps for the same frame
// number.
export type TimeDisplayMode = 'date' | 'seconds' | 'frames'

export function formatTimelineValue(
  date: Date, scheduleStart: Date, mode: TimeDisplayMode, speedDaysPerSecond: number, fps: number,
): string {
  if (mode === 'date') {
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  const elapsedDays = (date.getTime() - scheduleStart.getTime()) / DAY_MS
  const elapsedSeconds = speedDaysPerSecond > 0 ? elapsedDays / speedDaysPerSecond : 0
  return mode === 'seconds' ? `${elapsedSeconds.toFixed(1)}s` : `Frame ${Math.round(elapsedSeconds * fps)}`
}

// Inverse of the above — the numeric entry field in Seconds/Frames mode
// converts a typed value back into a real calendar Date to jump/scrub to.
export function dateFromTimelineValue(
  value: number, scheduleStart: Date, mode: 'seconds' | 'frames', speedDaysPerSecond: number, fps: number,
): Date {
  const seconds = mode === 'frames' ? (fps > 0 ? value / fps : 0) : value
  return new Date(scheduleStart.getTime() + seconds * speedDaysPerSecond * DAY_MS)
}

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

// Shared 0..1 "reveal" progress for Path/Zone draw-in and flash animations
// (2026-07-29, per Maro: "animate the line itself so it looks like its
// coming from the first point to the last... can place animation on
// loop"; "the animation will go like path to set the border then the
// fill, can also set a flashing zone animation" — PathGizmo.tsx and
// ZoneGizmo.tsx both drive their own reveal math off this one function).
// Holds at 0 before `start`, ramps linearly to 1 at `end`, then either
// holds at 1 (loop=false — the ordinary "plays once" case) or wraps back
// to 0 and repeats every (end - start) (loop=true), same sawtooth shape
// AnimationProfileConfig's own 'over_duration' trigger already uses for
// transform animation, just exposed directly instead of feeding a
// position/opacity offset. start/end null (animate off, or a path/zone
// that's never had its animation window set) reads as "fully revealed" —
// the caller should gate on `animate` itself before ever calling this,
// but a null-safe default here means a half-configured row still renders
// its whole shape rather than nothing.
export function computeRevealProgress(now: Date, start: Date | null, end: Date | null, loop: boolean): number {
  if (!start || !end) return 1
  const startMs = start.getTime()
  const endMs = end.getTime()
  if (endMs <= startMs) return 1
  const nowMs = now.getTime()
  if (nowMs <= startMs) return 0
  const duration = endMs - startMs
  if (!loop) return clamp01((nowMs - startMs) / duration)
  const elapsed = nowMs - startMs
  const wrapped = ((elapsed % duration) + duration) % duration
  return wrapped / duration
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
  // Grow X/Y (2026-07-30, per Maro's own concrete-slab reference — "how it
  // forms from the right to the left") — null unless
  // profile.transform_kind === 'grow', in which case this is the same
  // `eased` 0..1 progress every other transform_kind already derives
  // (respecting trigger/interpolation identically), but Viewport3D.tsx's
  // own per-frame loop is the one that turns it into an actual moving
  // world-space clip plane against the target's own captured bounding
  // box — this function stays position/scale/rotation/opacity-only
  // otherwise, deliberately not reaching into Three.js clipping-plane
  // territory itself (that needs the target's real Object3D, which this
  // function never receives).
  growProgress: number | null
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
// Takes the whole ResolvedTimelineLink now, not separate activity/profile
// params (2026-07-21 perf fix — see pickActiveLink's own header for the
// full "why"): reads link.startMs/link.finishMs, already parsed once at
// link-build time, instead of re-parsing link.activity.start/finish's raw
// ISO strings via `new Date(...)` on every one of these calls — this runs
// exactly as often as pickActiveLink does, same hot per-frame path, same
// six-combined-discipline-file scale.
export function computeAppliedAnimationStateAt(
  link: Pick<ResolvedTimelineLink, 'startMs' | 'finishMs' | 'profile'>,
  now: Date,
  // 2026-07-26 fix, per Maro: "the animation profiles axises are not
  // aligned to up axis... if im on z up, the animation profiles seem fixed
  // to y as up axis" — profile.axis used to map straight through
  // AXIS_VECTOR into a raw LOCAL-space offset, added directly to the
  // object's position with no awareness of the per-object up-axis-
  // correction wrapper (Viewport3D's own `<group rotation={
  // axisCorrectionRotation(sourceUpAxis, upAxis)}>`) that ALL of this app's
  // keyframed transforms already account for via resolveDisplayAxis
  // (applyKeyframedTransform, Viewport3D.tsx). Since that wrapper rotates a
  // native Y-up source (the near-universal default — defaultSourceUpAxis,
  // upAxis.ts) by +/-90° about X whenever displayUpAxis is 'z', a profile's
  // raw "local Z" offset actually lands on world -Y after that rotation —
  // exactly backwards from what "Z axis" should mean once the display is
  // Z-up. Now resolved the identical way keyframes already are.
  upAxis: UpAxis,
): AppliedAnimationState | null {
  const { startMs: start, finishMs: finish, profile } = link
  const nowMs = now.getTime()

  let color: string | null = null
  if (profile.color_from || profile.color_to) {
    const from = profile.color_from ?? profile.color_to!
    const to = profile.color_to ?? profile.color_from!
    if (nowMs >= start && nowMs <= finish) {
      const t = finish > start ? (nowMs - start) / (finish - start) : 1
      color = lerpColor(from, to, clamp01(t))
    }
  }

  let rawProgress: number
  if (profile.trigger === 'over_duration') {
    rawProgress = finish > start
      ? clamp01((nowMs - start) / (finish - start))
      : (nowMs >= finish ? 1 : 0)
  } else if (profile.trigger === 'on_start') {
    const windowDays = profile.duration_frames ?? 1
    const windowEnd = start + windowDays * DAY_MS
    rawProgress = nowMs <= start ? 0 : nowMs >= windowEnd ? 1 : (nowMs - start) / (windowEnd - start)
  } else {
    const windowDays = profile.duration_frames ?? 1
    const windowStart = finish - windowDays * DAY_MS
    rawProgress = nowMs <= windowStart ? 1 : nowMs >= finish ? 0 : 1 - (nowMs - windowStart) / (finish - windowStart)
  }

  const eased = applyEasing(rawProgress, profile.interpolation)
  const awayAmount = 1 - eased
  // Same {localAxis, sign} remap applyKeyframedTransform already applies
  // per pos_x/pos_y/pos_z keyframe field — see this function's own upAxis
  // param header for the full "why".
  const { localAxis, sign } = resolveDisplayAxis(profile.axis, upAxis, 'position')
  const axis = AXIS_VECTOR[localAxis]

  let positionOffset: [number, number, number] = [0, 0, 0]
  let rotationOffsetDeg = 0
  let scaleMultiplier = 1

  if (['translate', 'fall', 'pop', 'spiral'].includes(profile.transform_kind)) {
    positionOffset = [
      axis[0] * sign * profile.direction * profile.distance * awayAmount,
      axis[1] * sign * profile.direction * profile.distance * awayAmount,
      axis[2] * sign * profile.direction * profile.distance * awayAmount,
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
  const growProgress = profile.transform_kind === 'grow' ? eased : null

  return { positionOffset, rotationOffsetDeg, scaleMultiplier, opacity, color, growProgress }
}
