import type { Activity } from '@/modules/scheduling/types'

// Direct TS port of scheduling_cpm.py's own elapsed_duration_fraction — same
// degenerate-window handling (a same-day activity reads as 0 before it
// starts and 1 from the moment it finishes, never a division by ~0), kept
// in lockstep with the backend's own "Schedule % Complete" (renamed from
// "Duration % Complete" 2026-09-03) so this ring and that figure can never
// silently drift apart from each other.
export function elapsedFraction(start: Date, finish: Date, asOf: Date): number {
  const startMs = start.getTime()
  const finishMs = finish.getTime()
  const asOfMs = asOf.getTime()
  if (finishMs <= startMs) return asOfMs >= finishMs ? 1 : 0
  if (asOfMs <= startMs) return 0
  if (asOfMs >= finishMs) return 1
  return (asOfMs - startMs) / (finishMs - startMs)
}

// Duration-weighted % complete across a filtered set of Activities as of an
// arbitrary scrubbed date — longer activities move the needle more than
// short ones, matching how an S-curve/EVM percent-complete already reads
// elsewhere in this app. Activities missing a live start/finish (not yet
// scheduled) are excluded from both the numerator and denominator, not
// treated as 0% — an unscheduled activity isn't "behind," it's just not
// part of the computation yet. Returns 0 (never NaN) when nothing in the
// matched set has real dates.
export function computeRadialChartProgress(activities: Activity[], matchingIds: Set<string>, asOf: Date): number {
  let weightedSum = 0
  let totalWeight = 0
  for (const activity of activities) {
    if (!matchingIds.has(activity.id)) continue
    if (!activity.start || !activity.finish) continue
    const start = new Date(activity.start)
    const finish = new Date(activity.finish)
    const weight = finish.getTime() - start.getTime()
    if (weight <= 0) continue
    weightedSum += elapsedFraction(start, finish, asOf) * weight
    totalWeight += weight
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0
}
