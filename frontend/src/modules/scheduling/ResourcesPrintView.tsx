import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import { FONT_FAMILY_CSS } from '@/lib/ganttLayout'
import type { ProjectLetterhead } from '@/lib/letterhead'
import type { ResourceSpread } from '@/lib/resourceAssignmentSpread'
import { ResourcePoolPrintView } from './ResourcePoolPrintView'
import { ResourceTrackingPrintView, type PrintResourceGroup } from './ResourceTrackingPrintView'
import { ResourceUsageProfilePrintView } from './ResourceUsageProfilePrintView'
import type { ResourcesPrintFontPrefs, ResourcesPrintTable } from './resourcesLayout'
import type { AssignmentRow } from './useResourcesTabData'
import type { Calendar, Resource } from './types'

interface Props {
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
  trackedResources, assignmentsByResource, buckets, spreadByResource, selectedActivityIds, unit,
}: Props) {
  if (tables.size === 0) return null
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
      {tables.has('tracking') && <ResourceTrackingPrintView groups={printGroups} bucketLabels={bucketLabels} unit={unit} />}
      {tables.has('profile') && (
        <ResourceUsageProfilePrintView
          trackedResources={trackedResources} assignmentsByResource={assignmentsByResource}
          buckets={buckets} spreadByResource={spreadByResource} selectedActivityIds={selectedActivityIds} unit={unit}
        />
      )}
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={tokens} />}
    </div>
  )
}
