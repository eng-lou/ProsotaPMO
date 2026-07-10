import { RESOURCE_USAGE_COLORS } from './ResourceUsageProfileWidget'
import { PRINT_LEFT_PANE_WIDTH, PRINT_PERIOD_COL_WIDTH, RESOURCE_CHART_Y_AXIS_WIDTH } from './resourcesLayout'
import { computeUsageProfileBars, type AssignmentRow } from './useResourcesTabData'
import type { Resource } from './types'
import type { ResourceSpread } from '@/lib/resourceAssignmentSpread'

interface Props {
  trackedResources: Resource[]
  assignmentsByResource: Map<string, AssignmentRow[]>
  buckets: { start: Date; end: Date; label: string }[]
  spreadByResource: Map<string, ResourceSpread>
  selectedActivityIds: Set<string>
  unit: 'hours' | 'days' | 'cost'
}

const CHART_HEIGHT = 160
const GRIDLINE_COUNT = 4

// Content only — see ResourceTrackingPrintView.tsx's own note; the shared
// letterhead header/footer now lives once in ResourcesPrintView.tsx. Legend
// included per Maro's own explicit ask ("if resource usage is being
// printed, I want a legend as well") — the screen widget only needs it once
// visible on-screen; print needs it self-contained per page. A left spacer
// exactly PRINT_LEFT_PANE_WIDTH wide (matching Resource Tracking's own left
// columns) puts the first bar under the same date column as Resource
// Tracking's first period column above it (2026-07-09, per Maro: "the
// spreadsheet timeline position and the usage profile timeline chart should
// be aligned in the same horizontal axis").
export function ResourceUsageProfilePrintView({
  trackedResources, assignmentsByResource, buckets, spreadByResource, selectedActivityIds, unit,
}: Props) {
  const { barValues, hasActuals, limitValue } = computeUsageProfileBars(
    trackedResources, assignmentsByResource, buckets, spreadByResource, selectedActivityIds, unit
  )
  const maxValue = Math.max(...barValues, limitValue, 1) * 1.1
  const axisLabel = unit === 'cost' ? '£' : unit === 'days' ? 'Days' : 'Hours'
  const formatAxisValue = (value: number): string => unit === 'cost' ? `£${Math.round(value).toLocaleString()}` : String(Math.round(value))

  return (
    <div className="mb-8">
      <p className="text-sm text-gray-500 mb-2">Resource Usage Profile · {trackedResources.length} resource{trackedResources.length === 1 ? '' : 's'}</p>

      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RESOURCE_USAGE_COLORS.budgeted }} />Budgeted</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RESOURCE_USAGE_COLORS.actual }} />Has Actuals</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RESOURCE_USAGE_COLORS.overallocated }} />Overallocated</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ backgroundColor: RESOURCE_USAGE_COLORS.limit }} />Limit (capacity)</span>
      </div>

      <div className="flex">
        <div style={{ width: PRINT_LEFT_PANE_WIDTH, flexShrink: 0 }} />
        {/* Y-axis gutter — mirrors the screen widget's own, so the numbers
            mean the same thing in both places (2026-07-09, per Maro: "add y
            axis fields, e.g in x axis you have the time periods"). */}
        <div className="flex-shrink-0 flex" style={{ width: RESOURCE_CHART_Y_AXIS_WIDTH, height: CHART_HEIGHT }}>
          <div className="flex items-center justify-center overflow-hidden" style={{ width: 14 }}>
            <span className="text-gray-500 whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{axisLabel}</span>
          </div>
          <div className="relative flex-1">
            {Array.from({ length: GRIDLINE_COUNT + 1 }, (_, i) => {
              const value = (maxValue / GRIDLINE_COUNT) * i
              const bottom = (value / maxValue) * CHART_HEIGHT
              return (
                <span key={i} className="absolute right-1 -translate-y-1/2 text-gray-400" style={{ bottom }}>
                  {formatAxisValue(value)}
                </span>
              )
            })}
          </div>
        </div>
        <div>
          <div className="relative" style={{ height: CHART_HEIGHT, width: buckets.length * PRINT_PERIOD_COL_WIDTH }}>
            {Array.from({ length: GRIDLINE_COUNT + 1 }, (_, i) => {
              const value = (maxValue / GRIDLINE_COUNT) * i
              const bottom = (value / maxValue) * CHART_HEIGHT
              return <div key={i} className="absolute left-0 right-0 border-t border-gray-100" style={{ bottom }} />
            })}
            {limitValue > 0 && (
              <div className="absolute left-0 right-0" style={{ bottom: (limitValue / maxValue) * CHART_HEIGHT, height: 1, backgroundColor: RESOURCE_USAGE_COLORS.limit }} />
            )}
            {barValues.map((value, i) => {
              const overallocated = value > limitValue && limitValue > 0
              const color = overallocated ? RESOURCE_USAGE_COLORS.overallocated : hasActuals[i] ? RESOURCE_USAGE_COLORS.actual : RESOURCE_USAGE_COLORS.budgeted
              return (
                <div
                  key={i}
                  style={{ left: i * PRINT_PERIOD_COL_WIDTH + 4, width: PRINT_PERIOD_COL_WIDTH - 8, bottom: 0, height: (value / maxValue) * CHART_HEIGHT, backgroundColor: color }}
                  className="absolute"
                />
              )
            })}
          </div>
          <div className="flex text-gray-500" style={{ width: buckets.length * PRINT_PERIOD_COL_WIDTH }}>
            {buckets.map((b, i) => <div key={i} className="text-center truncate" style={{ width: PRINT_PERIOD_COL_WIDTH }}>{b.label}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
