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
