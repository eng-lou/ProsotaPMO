import type { Activity, UserDefinedFieldValue } from '@/modules/scheduling/types'
import type { RadialChart } from './radialCharts'

// Direct TS port of scheduling_cpm.py's own elapsed_duration_fraction — same
// degenerate-window handling (a same-day activity reads as 0 before it
// starts and 1 from the moment it finishes, never a division by ~0), kept
// in lockstep with the backend's own "Duration % Complete" so this ring and
// that figure can never silently drift apart from each other.
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

// Whichever of a UDF value's four value_* columns is actually populated,
// stringified — generic across data_type so a chart isn't hard-limited to
// "text" UDFs even though "Sub Discipline"-style text fields are the
// primary use case (per Maro's own example).
// Exported so RadialChartsPanel.tsx can build the "distinct values actually
// present for this field" dropdown using the exact same stringification —
// what a chart matches against and what the panel offers as choices must
// never drift apart.
export function stringifyUdfValue(value: UserDefinedFieldValue | undefined): string | null {
  if (!value) return null
  return value.value_text ?? value.value_number ?? value.value_date ?? value.value_indicator ?? null
}

// Which Activity ids a chart's own UDF filter currently matches. Null
// udf_field_definition_id = "all activities" (radial_chart.py's own
// default-before-configured behaviour); a field chosen but no udf_value yet
// matches nothing, rather than everything, so a half-configured chart reads
// as 0% instead of misleadingly 100%-of-everything.
export function matchingActivityIds(
  activities: Activity[],
  chart: Pick<RadialChart, 'udf_field_definition_id' | 'udf_value'>,
  getValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined,
): Set<string> {
  if (!chart.udf_field_definition_id) return new Set(activities.map(a => a.id))
  if (!chart.udf_value) return new Set()
  const matches = new Set<string>()
  for (const activity of activities) {
    if (stringifyUdfValue(getValue(chart.udf_field_definition_id, activity.id)) === chart.udf_value) {
      matches.add(activity.id)
    }
  }
  return matches
}
