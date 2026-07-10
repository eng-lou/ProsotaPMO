import type { Activity, Calendar } from './types'

// duration_hours is still the wire field the backend's hour-precision CPM engine
// (Phase 10) actually stores and computes with — this just lets the UI collect
// duration the way planners normally think about it (days), converting through
// whichever calendar governs the activity. Never sent to the backend as "days".
export function resolveHoursPerDay(activity: Pick<Activity, 'calendar_id'>, calendars: Calendar[]): number {
  const calendar = activity.calendar_id
    ? calendars.find(c => c.id === activity.calendar_id)
    : calendars.find(c => c.is_project_default)
  const hoursPerDay = calendar ? Number(calendar.hours_per_day) : NaN
  return Number.isFinite(hoursPerDay) && hoursPerDay > 0 ? hoursPerDay : 8
}

// Total/Free/Sub Total Float are only ever stored and served in hours (the
// CPM engine's real precision, Phase 10) — there's no "_days" counterpart
// the way duration_days exists, so days is a client-side display conversion
// only, same calendar-aware divisor as Duration's own days display. Rounded
// to a whole number, no decimals — showing "1.33d" of float never actually
// meant anything to read (2026-07-06, per Maro, same call already made for
// Duration on 2026-07-05).
export function formatFloatDays(hours: number | string | null, activity: Pick<Activity, 'calendar_id'>, calendars: Calendar[]): string {
  if (hours === null) return '—'
  const n = Number(hours)
  if (Number.isNaN(n)) return '—'
  return String(Math.round(n / resolveHoursPerDay(activity, calendars)))
}
