import type { Activity } from '@/modules/scheduling/types'
import { activitiesForPaneDates } from './comparisonPane'
import type { RadialChart } from './radialCharts'
import { computeRadialChartProgress } from './radialChartProgress'
import { buildMonthCells, groupByYear, type MonthCell, type YearGroup } from './TimelineStripHud'
import { computeScheduleRange } from './timelinePlayback'
import type { TimelineStrip } from './timelineStrips'

// One timeline strip ready to draw into an export frame — cells/year groups
// are fixed for the whole capture, only the playhead moves with `now`.
export interface ExportTimelineStrip {
  strip: TimelineStrip
  cells: MonthCell[]
  yearGroups: YearGroup[]
  playheadIndex: number
}

// The Radial Charts / Timeline Strips a Capture or Export Video should draw
// (2026-10-03, per Maro: HUDs "per baseline views"). Each widget belongs to
// one viewport (viewport_slot: null = main, 0..2 = a comparison view); a
// widget whose comparison view isn't part of this export (fewer views open,
// or Include Comparison Panes off) is left out rather than drawn over the
// main view. Widgets in a Baseline view read the planned dates, matching
// what that view plays (activitiesForPaneDates).
export function prepareExportHuds(opts: {
  radialCharts: RadialChart[]
  radialChartMatchingIds: Map<string, Set<string>>
  timelineStrips: TimelineStrip[]
  timelineStripMatchingIds: Map<string, Set<string>>
  activities: Activity[]
  includeRadialCharts: boolean
  includeTimelineStrip: boolean
  comparisonViewCount: number
  comparisonViewIsBaseline: boolean[]
}) {
  const inExport = (slot: number | null) => slot === null || slot < opts.comparisonViewCount
  const live = opts.activities
  const baseline = opts.comparisonViewIsBaseline.some(Boolean) ? activitiesForPaneDates(live, true) : live
  const activitiesFor = (slot: number | null) => (slot !== null && opts.comparisonViewIsBaseline[slot] ? baseline : live)

  const radialCharts = opts.includeRadialCharts
    ? opts.radialCharts.filter(c => c.visible && inExport(c.viewport_slot))
    : []
  const strips = opts.includeTimelineStrip
    ? opts.timelineStrips.filter(s => s.visible && inExport(s.viewport_slot)).map(strip => {
      const matching = opts.timelineStripMatchingIds.get(strip.id) ?? new Set<string>()
      const domain = computeScheduleRange(activitiesFor(strip.viewport_slot).filter(a => matching.has(a.id)))
      const cells = domain ? buildMonthCells(domain.start, domain.end) : []
      return { strip, cells, yearGroups: groupByYear(cells) }
    })
    : []

  return {
    radialCharts,
    radialChartProgressAt: (now: Date) => new Map(radialCharts.map(c => [
      c.id, computeRadialChartProgress(activitiesFor(c.viewport_slot), opts.radialChartMatchingIds.get(c.id) ?? new Set(), now),
    ])),
    timelineStripsAt: (now: Date | null): ExportTimelineStrip[] => strips.map(s => ({
      ...s,
      playheadIndex: now && s.cells.length > 0
        ? s.cells.findIndex(c => c.year === now.getFullYear() && c.month === now.getMonth())
        : -1,
    })),
  }
}
