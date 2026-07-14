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
  // Abbreviated, not full comma-formatted — see the screen widget's own
  // formatAxisValue for why (2026-07-14, per Maro).
  const formatAxisValue = (value: number): string => {
    const rounded = Math.round(value)
    const abs = Math.abs(rounded)
    const short = abs >= 1_000_000 ? `${(rounded / 1_000_000).toFixed(1)}M`
      : abs >= 1_000 ? `${(rounded / 1_000).toFixed(1)}k`
      : String(rounded)
    return unit === 'cost' ? `£${short}` : short
  }

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
            {/* Top label top-aligned, not center-aligned like the rest —
                see the screen widget's own comment on this same pattern
                (2026-07-14, per Maro: overlapped the legend above it when
                centred via -translate-y-1/2, since that pushes it half its
                own height above this container's top edge). */}
            {Array.from({ length: GRIDLINE_COUNT + 1 }, (_, i) => {
              const value = (maxValue / GRIDLINE_COUNT) * i
              const bottom = (value / maxValue) * CHART_HEIGHT
              const isTopLabel = i === GRIDLINE_COUNT
              return (
                <span
                  key={i}
                  className={`absolute right-1 text-gray-400 ${isTopLabel ? '' : '-translate-y-1/2'}`}
                  style={isTopLabel ? { top: 0 } : { bottom }}
                >
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
