/** Pure shared-clock evaluation: seeking never accumulates motion or presence. */
export function presentAt(activity: { start: string | null; finish: string | null } | undefined, now: Date | null) {
  if (!activity?.start || !activity.finish || !now) return false
  return now.getTime() >= new Date(activity.start).getTime() && now.getTime() <= new Date(activity.finish).getTime()
}
