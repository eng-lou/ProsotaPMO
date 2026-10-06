import { resourcePeriodWidth, type ResourceSeries } from './resourceSeries'
import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import { FONT_FAMILY_CSS } from '@/lib/ganttLayout'
import type { ProjectLetterhead } from '@/lib/letterhead'
import type { ResourceSpread } from '@/lib/resourceAssignmentSpread'
import { ResourcePoolPrintView } from './ResourcePoolPrintView'
import { ResourceTrackingPrintView, type PrintResourceGroup } from './ResourceTrackingPrintView'
import { ResourceUsageProfilePrintView } from './ResourceUsageProfilePrintView'
import { PRINT_LEFT_PANE_WIDTH, RESOURCE_CHART_Y_AXIS_WIDTH, type ResourcesPrintFontPrefs, type ResourcesPrintTable } from './resourcesLayout'
import type { AssignmentRow } from './useResourcesTabData'
import type { ActualsHistoryItem, Calendar, Resource } from './types'

interface Props {
  trackingOverallocation: boolean
  profileOverallocation: boolean
  heightScale: number
  trackingSeries: ResourceSeries[]
  profileSeries: ResourceSeries[]
  tables: Set<ResourcesPrintTable>
  projectName: string
  letterhead: ProjectLetterhead | null
  printFonts: ResourcesPrintFontPrefs
  resources: Resource[]
  calendars: Calendar[]
  printGroups: PrintResourceGroup[]
  bucketLabels: string[]
  trackedResources: Resource[]
  assignmentsByResource: Map<string, AssignmentRow[]>
  buckets: { start: Date; end: Date; label: string }[]
  spreadByResource: Map<string, ResourceSpread>
  selectedActivityIds: Set<string>
  unit: 'hours' | 'days' | 'cost'
  dataDate: string | null
  actualsHistory: ActualsHistoryItem[]
}

// One shared letterhead header/footer for however many of Pool/Tracking/
// Profile are checked to print (2026-07-09 fix, per Maro: "only one header
// above for all tables") — each was previously a fully independent print
// view with its own PrintLetterheadHeader/Footer, producing one duplicate
// masthead per table. See each of the three *PrintView components for why
// their own column geometry now matches (PRINT_LEFT_PANE_WIDTH/
// PRINT_PERIOD_COL_WIDTH, resourcesLayout.ts).
export function ResourcesPrintView({
  tables, projectName, letterhead, printFonts, resources, calendars, printGroups, bucketLabels,
  trackedResources, assignmentsByResource, buckets, spreadByResource, selectedActivityIds, unit, dataDate,
  actualsHistory, trackingSeries, profileSeries, heightScale, trackingOverallocation, profileOverallocation,
}: Props) {
  if (tables.size === 0) return null
  const periodWidth = resourcePeriodWidth(unit, trackingSeries.length, true)
  // A wide timeline is shrunk by the browser to fit paper. Compensate only
  // vertically, keeping every period and the shared horizontal alignment.
  const timelineWidth = PRINT_LEFT_PANE_WIDTH + RESOURCE_CHART_Y_AXIS_WIDTH + buckets.length * periodWidth
  const verticalScale = Math.max(1, timelineWidth / 1100) * heightScale
  const rowHeight = Math.round(24 * verticalScale)
  const chartHeight = Math.round(320 * verticalScale)
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const tokens = {
    project: projectName, module: 'Resources',
    count: `${trackedResources.length} resource${trackedResources.length === 1 ? '' : 's'}`,
    printed_at: printedAt,
  }

  return (
    <div className="print-only p-8" style={{ fontFamily: FONT_FAMILY_CSS[printFonts.fontFamily], fontSize: printFonts.fontSize }}>
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={tokens} />}
      {tables.has('pool') && <ResourcePoolPrintView resources={resources} calendars={calendars} />}
      {tables.has('tracking') && <ResourceTrackingPrintView showOverallocation={trackingOverallocation} rowHeight={rowHeight} series={trackingSeries} groups={printGroups} bucketLabels={bucketLabels} unit={unit} />}
      {tables.has('profile') && (
        <ResourceUsageProfilePrintView showOverallocation={profileOverallocation} chartHeight={chartHeight} series={profileSeries} periodWidth={periodWidth}
          trackedResources={trackedResources} assignmentsByResource={assignmentsByResource}
          buckets={buckets} spreadByResource={spreadByResource} selectedActivityIds={selectedActivityIds} unit={unit}
          dataDate={dataDate} actualsHistory={actualsHistory}
        />
      )}
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={tokens} />}
    </div>
  )
}
