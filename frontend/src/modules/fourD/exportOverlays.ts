import * as THREE from 'three'
import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'
import type { ExportLabel, ExportLabelRegistry } from './exportLabels'
import type { RadialChart } from './radialCharts'
import type { TimelineStrip } from './timelineStrips'
import { MONTH_LETTERS, type MonthCell, type YearGroup } from './TimelineStripHud'

// Export Content overlays for Capture/Export Video (2026-07-25, per Maro's
// Synchro "Export Animation" reference: a Gantt bar strip, an Activity
// Table, an Appearance Profile legend, and a burnt-in current-date readout,
// composited alongside the 3D view(s) — "gantt bar on top, activity table
// on the left... 3d on the right"). Deliberately a purpose-built rendition,
// not a screenshot of the real GanttChart.tsx/ScheduleWindow.tsx DOM
// windows (confirmed with Maro): those are HTML+SVG, not canvas, and
// rasterizing them live (html2canvas or similar) is both a new dependency
// and far too slow to re-run every frame of a recorded video (100ms+ per
// snapshot at 30fps would never keep up). Plain Canvas 2D drawing here
// instead — cheap enough to redraw every single video frame — reusing the
// exact same `activities`/`profiles` data already driving the animation,
// so the "now" line/highlighted row are wired to the real scrub position
// (unlike GanttChart.tsx's own today-line, which is hardcoded to wall-clock
// `new Date()` and has no scrub input at all).
//
// No React here — these are pure functions called identically from
// Viewport3D.tsx's still-capture path (once) and its video-recording
// step() loop (every frame), so there's exactly one implementation of the
// layout/drawing math for both.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ExportLayout {
  totalWidth: number
  totalHeight: number
  ganttRect: Rect | null
  tableRect: Rect | null
  mainViewRect: Rect
  // Up to 3 comparison panes (2026-08-03, generalized from the old single
  // baselineViewRect: Rect | null — see Viewport3D.tsx's own
  // comparisonCanvasRefs header) — stacked vertically in the same column
  // to the right of mainViewRect, mirroring the live on-screen
  // SplitRow(row)[main, SplitRow(column)[...panes]] layout. Empty array =
  // no comparison pane open, same meaning the old `null` had.
  comparisonViewRects: Rect[]
  costRect: Rect | null
  titleBlockRect: Rect | null
}

// Base sizes at scale=1 (a 1080p-tall output) — multiplied by `scale`
// (resolutionHeight / 1080, computed by Viewport3D.tsx's own
// handleCaptureImage/handleExportVideo) everywhere below, so overlay
// text/line weights stay proportionate to the requested output resolution
// instead of becoming illegibly tiny at 4K or oversized at 720p.
const GANTT_BAND_HEIGHT = 130
// Time-interval ruler along the top of the Gantt strip (2026-07-25, per
// Maro: "time interval at the top would be useful") — a separate reserved
// header row above the bars themselves, tall enough for month/year tick
// labels; see drawGanttStrip's own header for how the tick interval is
// chosen.
const TIME_AXIS_HEIGHT = 22
const TABLE_COLUMN_WIDTH = 420
// Full-width footer band (2026-07-25, per Maro: "include... the cost
// profile over time at the bottom") — see drawCostProfileChart's own
// header for where the values themselves come from (P6-style Resource
// Usage Profile, reused verbatim rather than a bespoke EVM calculation).
// Tall enough to comfortably fit the Active Resources box (title + up to
// 4 rows + a "+N more" tail) inside the same vertical space as the bars,
// without it spilling down into the month-label row below (2026-07-25 fix
// — the original 150 was sized only for the bars/labels, before the
// resources box existed).
const COST_BAND_HEIGHT = 180
// Reserved strip for the Active Resources box, to the right of the bars
// (2026-07-25 fix, per Maro: "good touch with the active resources, but
// its overlapping with the bars a bit" — anchoring the box to a fixed
// corner of the whole chart meant a tall bar landing under that corner
// (which one, varies bucket to bucket as `now` advances through the
// video) could grow right up into it). Always reserved, whether or not a
// box actually has anything to draw this frame, so the bars themselves
// never shift width as resources come and go through the video — only
// the box's own contents change, never the chart's layout.
const RESOURCE_BOX_WIDTH = 200
const OVERLAY_PADDING = 10
const ROW_HEIGHT = 20
// Breathing room between adjacent text columns (2026-07-25 fix, per Maro:
// "needs some formatting" — a screenshot showed Code/Name/Date running
// straight into each other with zero gap, and long names rendering at
// visibly inconsistent sizes). The gap is on top of drawTruncatedText's own
// fix below, which is the actual root cause of the size inconsistency: see
// that function's own header.
const COLUMN_GAP = 10

// ctx.fillText(text, x, y, maxWidth) does NOT clip or wrap long text to
// maxWidth — per the Canvas 2D spec, the browser instead *squishes* the
// glyphs horizontally (adjusting character spacing/font size) to force the
// full string into that width. That's what produced the overlapping,
// inconsistently-sized text in Maro's screenshot: every activity name
// exceeding its column's width got compressed by a different amount
// depending on how much it overflowed, rather than being cut off cleanly.
// This measures the text first and truncates with an ellipsis instead,
// exactly like CSS text-overflow: ellipsis — used everywhere below in
// place of the raw fillText(...,maxWidth) call.
function drawTruncatedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number): void {
  if (maxWidth <= 0) return
  if (ctx.measureText(text).width <= maxWidth) { ctx.fillText(text, x, y); return }
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid; else hi = mid - 1
  }
  ctx.fillText(text.slice(0, lo) + ellipsis, x, y)
}

// Schedulable activities only (real dates, not a WBS rollup), sorted by
// start, windowed to `maxRows` centered on whichever are currently active
// relative to `now` — shared by drawGanttStrip/drawActivityTableStrip so
// both show the same relevant slice of a schedule that can run to
// thousands of activities, not just the first N alphabetically/by id.
export function selectExportActivities(activities: Activity[], now: Date | null, maxRows: number): Activity[] {
  const schedulable = activities
    .filter(a => a.activity_type !== 'wbs_summary' && a.start && a.finish)
    .sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime())
  if (schedulable.length <= maxRows) return schedulable

  const nowMs = now?.getTime()
  let centerIndex = 0
  if (nowMs !== undefined) {
    const activeIndex = schedulable.findIndex(a => nowMs >= new Date(a.start!).getTime() && nowMs <= new Date(a.finish!).getTime())
    centerIndex = activeIndex >= 0 ? activeIndex : schedulable.findIndex(a => new Date(a.start!).getTime() >= nowMs)
    if (centerIndex < 0) centerIndex = schedulable.length - 1
  }
  const half = Math.floor(maxRows / 2)
  const start = Math.max(0, Math.min(schedulable.length - maxRows, centerIndex - half))
  return schedulable.slice(start, start + maxRows)
}

export function computeExportLayout(
  resolutionWidth: number, resolutionHeight: number,
  scale: number,
  opts: {
    includeGanttChart: boolean; includeActivityTable: boolean; comparisonPaneCount: number; includeCostProfile: boolean
    // Title & Narrative independence (2026-09-01, per Maro: "the title &
    // narrative is currently tied to the activity table which shouldn't
    // be the case") — see titleBlockRect's own comment below for how
    // these two now drive the same corner reservation Gantt Chart/
    // Activity Table used to be the only way to get.
    exportTitle: string; exportNarrative: string
  },
): ExportLayout {
  // Reserves the same corner size (tableWidth x ganttHeight) whenever
  // Title/Narrative wants it, even with Gantt Chart and/or Activity Table
  // both off — previously this corner only ever existed as leftover space
  // when both those bands were independently on, wrongly coupling an
  // unrelated feature to two others. Gantt/Table still only ever *draw*
  // their own content when their own toggle is on (see composeExportFrame
  // below) — this only changes how much space gets reserved for the
  // corner, never what fills the rest of a reserved-but-toggle-off band.
  const titleBlockWantsSpace = opts.exportTitle.trim() !== '' || opts.exportNarrative.trim() !== ''
  const ganttHeight = (opts.includeGanttChart || titleBlockWantsSpace) ? Math.round((GANTT_BAND_HEIGHT + TIME_AXIS_HEIGHT) * scale) : 0
  const tableWidth = (opts.includeActivityTable || titleBlockWantsSpace) ? Math.round(TABLE_COLUMN_WIDTH * scale) : 0
  const costHeight = opts.includeCostProfile ? Math.round(COST_BAND_HEIGHT * scale) : 0

  // Explicit target output size (2026-07-25 rework, per Maro: "the
  // resolution options we have are very simplistic and insufficient
  // compared to blender") — resolutionWidth/Height (RenderCaptureSettings)
  // are now the literal output pixel dimensions, independent of either
  // source canvas's own on-screen size. Each 3D view's own rect is
  // cover-fit (drawCoverFit in composeExportFrame below) rather than
  // stretched to match — the "never distort the 3D content" principle
  // this function always had, just achieved by cropping now instead of by
  // sizing the frame around the source canvases.
  const totalWidth = resolutionWidth
  const totalHeight = resolutionHeight

  const viewportWidth = totalWidth - tableWidth
  const viewportHeight = totalHeight - ganttHeight - costHeight

  const ganttRect: Rect | null = opts.includeGanttChart
    ? { x: tableWidth, y: 0, width: viewportWidth, height: ganttHeight }
    : null
  const tableRect: Rect | null = opts.includeActivityTable
    ? { x: 0, y: ganttHeight, width: tableWidth, height: viewportHeight }
    : null

  // Split evenly between main and the comparison column when any
  // comparison pane is open — same 50/50 split the old single-baseline
  // case always used, now shared by however many panes stack in that
  // right-hand column (2026-08-03) — each still gets cover-fit into its
  // own rect independently, so neither the split nor any source canvas's
  // own native aspect ratio distorts another.
  const hasComparisonPanes = opts.comparisonPaneCount > 0
  const mainWidth = hasComparisonPanes ? Math.round(viewportWidth / 2) : viewportWidth
  const comparisonWidth = viewportWidth - mainWidth

  const mainViewRect: Rect = { x: tableWidth, y: ganttHeight, width: mainWidth, height: viewportHeight }
  // Stacked vertically within the comparison column, matching the live
  // SplitRow(orientation="column") layout of however many panes are open.
  const comparisonViewRects: Rect[] = hasComparisonPanes
    ? Array.from({ length: opts.comparisonPaneCount }, (_, i) => ({
      x: tableWidth + mainWidth,
      y: ganttHeight + Math.round((viewportHeight / opts.comparisonPaneCount) * i),
      width: comparisonWidth,
      height: Math.round(viewportHeight / opts.comparisonPaneCount),
    }))
    : []
  // Full-width footer, below the table+viewport row entirely (not scoped
  // to just the viewport's own width the way ganttRect is) — a status-bar
  // style band makes more sense spanning everything underneath it, since
  // cost data isn't specifically tied to the table column beside it.
  const costRect: Rect | null = opts.includeCostProfile
    ? { x: 0, y: ganttHeight + viewportHeight, width: totalWidth, height: costHeight }
    : null
  // The corner above the table/left of the Gantt strip (2026-07-25, per
  // Maro: "there's a corner at left which is empty. Allow me to add a
  // title... and a description or narrative") — originally only ever
  // existed when both bands were on, since it was exactly their
  // intersection. Independent since 2026-09-01 (titleBlockWantsSpace
  // above already forces ganttHeight/tableWidth to reserve this same
  // corner size even with Gantt Chart/Activity Table both off), so this
  // now only needs to check the text itself, matching the "blank text is
  // off" convention every other title field already uses.
  const titleBlockRect: Rect | null = titleBlockWantsSpace
    ? { x: 0, y: 0, width: tableWidth, height: ganttHeight }
    : null

  return { totalWidth, totalHeight, ganttRect, tableRect, mainViewRect, comparisonViewRects, costRect, titleBlockRect }
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// How many months apart the Gantt strip's own time-axis ticks land —
// monthly for anything up to ~13 months, quarterly up to ~4 years, yearly
// beyond that, so the ruler never gets so dense the labels overlap on a
// multi-year schedule.
function pickTickIntervalMonths(totalDays: number): number {
  if (totalDays <= 400) return 1
  if (totalDays <= 1500) return 3
  return 12
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1)
}

// Thin horizontal bars, one per selected activity, positioned
// proportionally between scheduleStart/scheduleEnd — the same range the
// whole export/scrub already runs over — with a time-interval ruler along
// the top (2026-07-25, per Maro: "time interval at the top would be
// useful"), a vertical "now" line, and critical-path activities tinted red
// (same convention the Controls Dashboard already uses for is_critical).
export function drawGanttStrip(
  ctx: CanvasRenderingContext2D, rect: Rect,
  activities: Activity[], scheduleStart: Date | null, scheduleEnd: Date | null, now: Date | null,
  scale: number,
): void {
  ctx.save()
  ctx.fillStyle = '#f9fafb'
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

  if (!scheduleStart || !scheduleEnd) { ctx.restore(); return }
  const totalMs = scheduleEnd.getTime() - scheduleStart.getTime()
  if (totalMs <= 0) { ctx.restore(); return }

  const padding = OVERLAY_PADDING * scale
  const axisHeight = TIME_AXIS_HEIGHT * scale
  const rowHeight = ROW_HEIGHT * scale
  const innerWidth = rect.width - padding * 2
  const barsTop = rect.y + axisHeight
  const maxRows = Math.max(1, Math.floor((rect.height - axisHeight - padding * 2) / rowHeight))
  const rows = selectExportActivities(activities, now, maxRows)

  const xFor = (d: Date) => rect.x + padding + Math.min(1, Math.max(0, (d.getTime() - scheduleStart.getTime()) / totalMs)) * innerWidth

  // Time-interval ruler — a separate header band above the bars, ticked at
  // whatever interval pickTickIntervalMonths picks for this schedule's own
  // total span, using the exact same xFor mapping the bars/now-line use
  // below so everything lines up on one shared date axis.
  ctx.fillStyle = '#eef2f7'
  ctx.fillRect(rect.x, rect.y, rect.width, axisHeight)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1, scale)
  ctx.beginPath()
  ctx.moveTo(rect.x, rect.y + axisHeight)
  ctx.lineTo(rect.x + rect.width, rect.y + axisHeight)
  ctx.stroke()

  const intervalMonths = pickTickIntervalMonths(totalMs / 86_400_000)
  ctx.font = `${Math.round(9 * scale)}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#4b5563'
  ctx.strokeStyle = '#c7d0dc'
  let tick = new Date(scheduleStart.getFullYear(), scheduleStart.getMonth(), 1)
  while (tick.getTime() <= scheduleEnd.getTime()) {
    if (tick.getTime() >= scheduleStart.getTime()) {
      const x = xFor(tick)
      ctx.beginPath()
      ctx.moveTo(x, rect.y + axisHeight * 0.4)
      ctx.lineTo(x, rect.y + axisHeight)
      ctx.stroke()
      drawTruncatedText(ctx, tick.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), x + 3 * scale, rect.y + axisHeight * 0.6, 65 * scale)
    }
    tick = addMonths(tick, intervalMonths)
  }

  ctx.font = `${Math.round(10 * scale)}px system-ui, sans-serif`
  rows.forEach((a, i) => {
    const y = barsTop + padding + i * rowHeight
    const barStart = xFor(new Date(a.start!))
    const barEnd = Math.max(barStart + scale, xFor(new Date(a.finish!)))
    ctx.fillStyle = a.is_critical ? '#ef4444' : '#60a5fa'
    ctx.fillRect(barStart, y + rowHeight * 0.2, barEnd - barStart, rowHeight * 0.6)
    ctx.fillStyle = '#374151'
    drawTruncatedText(ctx, a.task_name, rect.x + padding, y + rowHeight / 2, innerWidth * 0.4)
  })

  if (now) {
    const nowX = xFor(now)
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = Math.max(1, 1.5 * scale)
    ctx.setLineDash([4 * scale, 3 * scale])
    ctx.beginPath()
    ctx.moveTo(nowX, barsTop)
    ctx.lineTo(nowX, rect.y + rect.height - padding * 0.5)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()
}

// Plain Code/Name/Start/Finish text rows, highlighting whichever
// activity(ies) are currently active relative to `now` — a feature the
// live ScheduleWindow.tsx doesn't have at all (selection-only highlight
// there), genuinely new rather than a re-derivation.
export function drawActivityTableStrip(
  ctx: CanvasRenderingContext2D, rect: Rect, activities: Activity[], now: Date | null, scale: number,
): void {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

  const padding = OVERLAY_PADDING * scale
  const rowHeight = ROW_HEIGHT * scale
  const maxRows = Math.max(1, Math.floor((rect.height - padding * 2) / rowHeight))
  const rows = selectExportActivities(activities, now, maxRows)
  const nowMs = now?.getTime()

  // Column bounds are the same for every row — hoisted out of the loop
  // below (2026-07-25 fix) rather than recomputed per row, and also used
  // afterward to draw two visible vertical divider lines: the gap alone
  // (COLUMN_GAP) wasn't a reliably visible break once a long name got
  // truncated right up against its own allotted width (Maro's screenshot
  // still showed the date running into the name at that boundary) — an
  // actual ruled line, the same convention a real data table would use,
  // makes the column boundary unambiguous regardless of how close any one
  // row's text happens to sit next to it. Code/date shares kept small
  // (2026-07-25, per Maro: "activity name text is cut off", then "the
  // column and date... has too much space, give the extra to the activity
  // name column") — "T-0044" and a short date never need much room, so
  // most of the column now goes to the name, which still truncates on a
  // genuinely long activity name but far less eagerly than before.
  const gap = COLUMN_GAP * scale
  const codeWidth = rect.width * 0.13
  const dateWidth = rect.width * 0.16
  const nameX = rect.x + padding + codeWidth + gap
  const nameWidth = rect.width - padding * 2 - codeWidth - dateWidth - gap * 2
  const dateX = rect.x + rect.width - padding - dateWidth

  ctx.font = `${Math.round(10 * scale)}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  rows.forEach((a, i) => {
    const y = rect.y + padding + i * rowHeight
    const active = nowMs !== undefined && nowMs >= new Date(a.start!).getTime() && nowMs <= new Date(a.finish!).getTime()
    if (active) {
      ctx.fillStyle = '#dbeafe'
      ctx.fillRect(rect.x + 1, y, rect.width - 2, rowHeight)
    }
    ctx.fillStyle = a.is_critical ? '#b91c1c' : '#374151'
    drawTruncatedText(ctx, a.code, rect.x + padding, y + rowHeight / 2, codeWidth - gap)
    drawTruncatedText(ctx, a.task_name, nameX, y + rowHeight / 2, nameWidth)
    ctx.fillStyle = '#6b7280'
    drawTruncatedText(ctx, formatShortDate(new Date(a.finish!)), dateX, y + rowHeight / 2, dateWidth)
  })

  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = Math.max(1, scale)
  const dividerTop = rect.y + padding * 0.4
  const dividerBottom = rect.y + rect.height - padding * 0.4
  for (const dividerX of [rect.x + padding + codeWidth + gap / 2, dateX - gap / 2]) {
    ctx.beginPath()
    ctx.moveTo(dividerX, dividerTop)
    ctx.lineTo(dividerX, dividerBottom)
    ctx.stroke()
  }
  ctx.restore()
}

// Which bucket `now` currently falls in — shared by the "dim the future,
// highlight the present" bar treatment and the active-resources box below,
// so both agree on exactly the same period. Falls back to -1 (nothing
// current) once `now` is past every bucket or there's no date at all.
function findCurrentBucketIndex(buckets: { start: Date; end: Date }[], now: Date | null): number {
  if (!now) return -1
  const nowMs = now.getTime()
  return buckets.findIndex(b => nowMs >= b.start.getTime() && nowMs < b.end.getTime())
}

// Monthly cost bar chart along the bottom (2026-07-25, per Maro: "the
// resource usage profile but showing cost across the time period... it's
// in the Resource-Scheduling tab"). Deliberately NOT a bespoke EVM/cash-
// flow calculation invented for this chart — Maro pointed at
// ResourceUsageProfileWidget.tsx's own already-shipped "cost" unit
// (P6-style Resource Usage Profile, computeUsageProfileBars in
// useResourcesTabData.ts), so FourD.tsx calls that exact same function
// with unit: 'cost' and month-zoom buckets and passes the result straight
// through here — this file only ever draws whatever numbers it's handed,
// the same "not this module's job to invent PM math" discipline
// exportOverlays.ts already applies to the Gantt/Table content above.
//
// `now`-aware (2026-07-25, second pass, per Maro: "i want to see the cost
// profile bars be dynamic right now its just static, showing the bars for
// the whole period") — the *data* is still the whole schedule's profile
// (that's genuinely correct context, same reasoning drawGanttStrip already
// shows the whole timeline rather than just "so far"), but the chart now
// visibly reacts to playback the same way the Gantt strip's own "now" line
// and the Activity Table's own active-row highlight already do: a matching
// dashed "now" line, the current month's bar outlined, and every month
// still in the future rendered at low opacity rather than full colour —
// so scrubbing/playing the video visibly moves this chart instead of it
// sitting static throughout the whole export.
export function drawCostProfileChart(
  ctx: CanvasRenderingContext2D, rect: Rect,
  buckets: { start: Date; end: Date; label: string }[], values: number[], now: Date | null,
  resourceBreakdown: { name: string; values: number[] }[], scale: number,
): void {
  ctx.save()
  ctx.fillStyle = '#f9fafb'
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

  if (buckets.length === 0) { ctx.restore(); return }

  const padding = OVERLAY_PADDING * scale
  const axisWidth = 56 * scale
  // S-Curve (2026-07-25, per Maro: "add an s curve to the cost profile")
  // — the classic PMBOK cumulative-cost overlay (Rita Mulcahy PMP Exam
  // Prep, Ch.7 "the S-curve": cumulative planned cost plotted against
  // time, named for the shape a normal project's slow-start/ramp-up/
  // wind-down spend produces). Its own right-hand axis, since a running
  // total is on a completely different scale to any single period's own
  // bar — sharing the left axis would either flatten every bar to nothing
  // or send the line off the top of the chart.
  const rightAxisWidth = 46 * scale
  const legendHeight = 16 * scale
  const labelHeight = 16 * scale
  const resourceBoxWidth = RESOURCE_BOX_WIDTH * scale
  const chartX = rect.x + axisWidth
  const chartWidth = Math.max(0, rect.width - axisWidth - rightAxisWidth - padding - resourceBoxWidth - padding)
  const chartTop = rect.y + padding + legendHeight
  const chartHeight = Math.max(0, rect.height - padding * 2 - legendHeight - labelHeight)
  const maxValue = Math.max(...values, 1) * 1.1
  const bucketWidth = chartWidth / buckets.length
  const currentBucketIndex = findCurrentBucketIndex(buckets, now)

  const cumulative: number[] = []
  let running = 0
  for (const v of values) { running += v ?? 0; cumulative.push(running) }
  const maxCumulative = Math.max(running, 1) * 1.05

  const formatAbbreviated = (value: number): string => {
    const rounded = Math.round(value)
    const abs = Math.abs(rounded)
    const short = abs >= 1_000_000 ? `${(rounded / 1_000_000).toFixed(1)}M` : abs >= 1_000 ? `${(rounded / 1_000).toFixed(1)}k` : String(rounded)
    return `£${short}`
  }

  // Legend — distinguishes the bars from the S-Curve line, since both
  // now share the chart and only differ by colour/axis.
  ctx.font = `${Math.round(9 * scale)}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#eab308'
  ctx.fillRect(chartX, rect.y + padding + legendHeight / 2 - 4 * scale, 8 * scale, 8 * scale)
  ctx.fillStyle = '#6b7280'
  ctx.fillText('Period Cost', chartX + 11 * scale, rect.y + padding + legendHeight / 2)
  const sCurveLegendX = chartX + 90 * scale
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = Math.max(1, 2 * scale)
  ctx.beginPath()
  ctx.moveTo(sCurveLegendX, rect.y + padding + legendHeight / 2)
  ctx.lineTo(sCurveLegendX + 14 * scale, rect.y + padding + legendHeight / 2)
  ctx.stroke()
  ctx.fillStyle = '#6b7280'
  ctx.fillText('S-Curve (cumulative)', sCurveLegendX + 18 * scale, rect.y + padding + legendHeight / 2)

  // Gridlines + dual £ axis labels — left is per-period (same abbreviate-
  // to-k/M convention as ResourceUsageProfileWidget's own formatAxisValue,
  // so a value here reads the same way it would in the live Resource
  // Usage tab), right is the S-Curve's own cumulative scale. Both share
  // the same horizontal gridlines (an even fraction of chartHeight),
  // reading off whichever axis's own max applies at that same fraction —
  // the standard dual-axis-chart trick, rather than drawing two
  // independent sets of lines on top of each other.
  const gridlineCount = 4
  for (let i = 0; i <= gridlineCount; i++) {
    const frac = i / gridlineCount
    const y = chartTop + chartHeight - frac * chartHeight
    ctx.strokeStyle = i === gridlineCount ? '#111827' : '#e5e7eb'
    ctx.lineWidth = Math.max(1, scale)
    ctx.beginPath()
    ctx.moveTo(chartX, y)
    ctx.lineTo(chartX + chartWidth, y)
    ctx.stroke()
    ctx.fillStyle = '#9ca3af'
    drawTruncatedText(ctx, formatAbbreviated(maxValue * frac), rect.x + padding * 0.3, y, axisWidth - padding * 0.6)
    ctx.fillStyle = '#2563eb'
    drawTruncatedText(ctx, formatAbbreviated(maxCumulative * frac), chartX + chartWidth + padding * 0.4, y, rightAxisWidth - padding * 0.4)
  }

  // Bars, one per bucket — same yellow "Budgeted" tint
  // RESOURCE_USAGE_COLORS.budgeted uses live, so a viewer already familiar
  // with that tab recognises this as the same figure. Already-passed/
  // current months stay full colour; anything still ahead of `now` fades
  // to a faint tint instead — the whole profile is still visible (useful
  // context for what's coming), just visually deferred.
  const barGap = Math.max(2, 4 * scale)
  const barWidth = Math.max(scale, bucketWidth - barGap)
  const nowMs = now?.getTime()
  buckets.forEach((bucket, i) => {
    const value = values[i] ?? 0
    if (value <= 0) return
    const barHeight = (value / maxValue) * chartHeight
    const x = chartX + i * bucketWidth + barGap / 2
    const y = chartTop + chartHeight - barHeight
    const isFuture = nowMs !== undefined && bucket.start.getTime() > nowMs
    ctx.fillStyle = isFuture ? 'rgba(234,179,8,0.3)' : '#eab308'
    ctx.fillRect(x, y, barWidth, barHeight)
    if (i === currentBucketIndex) {
      ctx.strokeStyle = '#92400e'
      ctx.lineWidth = Math.max(1, 2 * scale)
      ctx.strokeRect(x, y, barWidth, barHeight)
    }
  })

  // S-Curve line — cumulative cost, one point per bucket centre, plotted
  // against its own right-hand scale (maxCumulative) computed above.
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = Math.max(1, 2 * scale)
  ctx.beginPath()
  buckets.forEach((_bucket, i) => {
    const x = chartX + i * bucketWidth + bucketWidth / 2
    const y = chartTop + chartHeight - (cumulative[i] / maxCumulative) * chartHeight
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.fillStyle = '#2563eb'
  buckets.forEach((_bucket, i) => {
    const x = chartX + i * bucketWidth + bucketWidth / 2
    const y = chartTop + chartHeight - (cumulative[i] / maxCumulative) * chartHeight
    ctx.beginPath()
    ctx.arc(x, y, Math.max(1.5, 2 * scale), 0, Math.PI * 2)
    ctx.fill()
  })

  // "Now" line — same dashed-amber convention as drawGanttStrip's own,
  // positioned across the *whole* bucket range (not just up to the last
  // bucket boundary) so it still reads correctly for a date past the very
  // last bucket's end.
  if (now && buckets.length > 0) {
    const rangeStart = buckets[0].start.getTime()
    const rangeEnd = buckets[buckets.length - 1].end.getTime()
    const rangeMs = rangeEnd - rangeStart
    if (rangeMs > 0) {
      const nowX = chartX + Math.min(1, Math.max(0, (now.getTime() - rangeStart) / rangeMs)) * chartWidth
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = Math.max(1, 1.5 * scale)
      ctx.setLineDash([4 * scale, 3 * scale])
      ctx.beginPath()
      ctx.moveTo(nowX, chartTop)
      ctx.lineTo(nowX, chartTop + chartHeight)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // X-axis month labels, thinned out so they never overlap regardless of
  // how many months the schedule spans — same "skip every Nth" idea
  // drawGanttStrip's own time axis uses, just driven by available pixel
  // width instead of a fixed calendar interval since these buckets are
  // always exactly one month apart already.
  ctx.fillStyle = '#6b7280'
  ctx.font = `${Math.round(8 * scale)}px system-ui, sans-serif`
  // Wide enough for the longest real label ("Sept 2027") at this font size
  // (2026-07-25 fix — a narrower box here was truncating month labels with
  // an ellipsis, e.g. "Sept 2..."/"Oct 20...", even though there was
  // plenty of room between bars for the full text).
  const labelDrawWidth = 50 * scale
  const labelStride = Math.max(1, Math.ceil(labelDrawWidth / bucketWidth))
  buckets.forEach((bucket, i) => {
    if (i % labelStride !== 0) return
    const x = chartX + i * bucketWidth + bucketWidth / 2 - labelDrawWidth / 2
    drawTruncatedText(ctx, bucket.label, x, chartTop + chartHeight + labelHeight / 2 + padding * 0.2, labelDrawWidth)
  })

  // Active Resources box (2026-07-25, per Maro: "an indication of the
  // resources driving the cost profile not just the bars") — whichever
  // resources actually have cost in the *current* bucket, sorted by
  // contribution. Drawn in its own reserved strip to the right of the
  // bars (see RESOURCE_BOX_WIDTH's own header for why it's no longer just
  // anchored to a corner that a tall bar could grow into) — genuinely
  // dynamic: this list changes bucket to bucket as `now` advances, same as
  // the bars above and the Gantt/Table's own live highlights.
  if (currentBucketIndex >= 0) {
    const contributing = resourceBreakdown
      .map(r => ({ name: r.name, value: r.values[currentBucketIndex] ?? 0 }))
      .filter(r => r.value > 0)
      .sort((a, b) => b.value - a.value)
    if (contributing.length > 0) {
      drawActiveResourcesBox(ctx, chartX + chartWidth + rightAxisWidth + padding, chartTop, resourceBoxWidth, contributing, scale)
    }
  }
  ctx.restore()
}

// Small boxed list — resource name + its own £ contribution — for
// whichever resources are actually driving the currently-active bucket's
// cost, capped to a handful of rows with a "+N more" tail so a real
// project's full resource list can't blow out the box's height. Same
// white/bordered convention drawAppearanceLegend/drawDateOverlay already
// use, for visual consistency across every overlay box in this file.
function drawActiveResourcesBox(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, resources: { name: string; value: number }[], scale: number): void {
  const padding = OVERLAY_PADDING * scale
  const rowHeight = ROW_HEIGHT * 0.85 * scale
  const titleHeight = rowHeight * 1.1
  const maxRows = 4
  const shown = resources.slice(0, maxRows)
  const overflow = resources.length - shown.length
  const rowCount = shown.length + (overflow > 0 ? 1 : 0)
  const height = titleHeight + rowCount * rowHeight + padding * 2

  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(x, y, width, height)

  ctx.fillStyle = '#111827'
  ctx.font = `bold ${Math.round(11 * scale)}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  drawTruncatedText(ctx, 'Active Resources', x + padding, y + padding + titleHeight / 2, width - padding * 2)

  ctx.font = `${Math.round(9 * scale)}px system-ui, sans-serif`
  shown.forEach((resource, i) => {
    const rowY = y + padding + titleHeight + i * rowHeight
    const rounded = Math.round(resource.value)
    const abs = Math.abs(rounded)
    const short = abs >= 1_000_000 ? `${(rounded / 1_000_000).toFixed(1)}M` : abs >= 1_000 ? `${(rounded / 1_000).toFixed(1)}k` : String(rounded)
    const valueLabel = `£${short}`
    const valueWidth = ctx.measureText(valueLabel).width
    ctx.fillStyle = '#374151'
    drawTruncatedText(ctx, resource.name, x + padding, rowY + rowHeight / 2, width - padding * 2 - valueWidth - padding * 0.5)
    ctx.fillStyle = '#6b7280'
    ctx.fillText(valueLabel, x + width - padding - valueWidth, rowY + rowHeight / 2)
  })
  if (overflow > 0) {
    const rowY = y + padding + titleHeight + shown.length * rowHeight
    ctx.fillStyle = '#9ca3af'
    drawTruncatedText(ctx, `+${overflow} more`, x + padding, rowY + rowHeight / 2, width - padding * 2)
  }
  ctx.restore()
}

// One row per profile: colour swatch (config.color_from ?? config.color_to,
// falling back to neutral grey for a profile with no colour animation at
// all — most BUILTIN_PRESETS leave both null) + profile.name. Draws
// nothing with zero profiles in the project ("if set", per Maro).
export function drawAppearanceLegend(ctx: CanvasRenderingContext2D, x: number, y: number, profiles: AnimationProfile[], scale: number): void {
  if (profiles.length === 0) return
  const padding = OVERLAY_PADDING * scale
  const rowHeight = ROW_HEIGHT * scale
  const swatchSize = rowHeight * 0.6
  const titleHeight = rowHeight * 1.1
  const width = 180 * scale
  const height = titleHeight + profiles.length * rowHeight + padding * 2

  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(x, y, width, height)

  ctx.fillStyle = '#111827'
  ctx.font = `bold ${Math.round(11 * scale)}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillText('Appearance', x + padding, y + padding + titleHeight / 2)

  ctx.font = `${Math.round(10 * scale)}px system-ui, sans-serif`
  profiles.forEach((profile, i) => {
    const rowY = y + padding + titleHeight + i * rowHeight
    ctx.fillStyle = profile.config.color_from ?? profile.config.color_to ?? '#9ca3af'
    ctx.fillRect(x + padding, rowY + (rowHeight - swatchSize) / 2, swatchSize, swatchSize)
    ctx.strokeStyle = '#d1d5db'
    ctx.lineWidth = Math.max(1, scale)
    ctx.strokeRect(x + padding, rowY + (rowHeight - swatchSize) / 2, swatchSize, swatchSize)
    ctx.fillStyle = '#374151'
    drawTruncatedText(ctx, profile.name, x + padding + swatchSize + padding * 0.6, rowY + rowHeight / 2, width - swatchSize - padding * 2.6)
  })
  ctx.restore()
}

// Burnt-in "current date" text + elapsed-week count, bottom-corner box —
// matching the Synchro reference's "04.01.2018 / Week: 179" readout.
export function drawDateOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, now: Date | null, scheduleStart: Date | null, scale: number): void {
  if (!now) return
  const padding = OVERLAY_PADDING * scale
  const width = 150 * scale
  const height = (ROW_HEIGHT * 2 + 4) * scale

  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(x, y, width, height)

  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#111827'
  ctx.font = `bold ${Math.round(13 * scale)}px system-ui, sans-serif`
  ctx.fillText(formatShortDate(now), x + padding, y + height * 0.35)

  if (scheduleStart) {
    const weeks = Math.max(0, Math.floor((now.getTime() - scheduleStart.getTime()) / (7 * 86_400_000)))
    ctx.fillStyle = '#6b7280'
    ctx.font = `${Math.round(10 * scale)}px system-ui, sans-serif`
    ctx.fillText(`Week ${weeks}`, x + padding, y + height * 0.75)
  }
  ctx.restore()
}

// Radial Progress Chart (2026-07-31, per Maro's own Synchro-style
// reference screenshot) — the canvas-export equivalent of
// RadialChartHud.tsx's own live SVG ring, same geometry (stroke centered on
// r = radius_px - thickness_px/2, progress arc drawn clockwise from 12
// o'clock via a -90° start angle) so a baked-in export matches what was
// actually on screen. x/y is the ring's own top-left anchor — same
// convention RadialChartHud.tsx's `left/top` percentages use — with the
// title label bar drawn immediately above it.
export function drawRadialChart(
  ctx: CanvasRenderingContext2D, x: number, y: number, chart: RadialChart, progress: number,
  iconImage: HTMLImageElement | null, scale: number,
): void {
  const radius = chart.radius_px * scale
  const thickness = chart.thickness_px * scale
  const labelHeight = 18 * scale
  const cx = x + radius
  const cy = y + labelHeight + radius

  ctx.save()
  ctx.font = `bold ${Math.round(10 * scale)}px system-ui, sans-serif`
  const textWidth = ctx.measureText(chart.title).width
  const labelPaddingX = 6 * scale
  const labelWidth = textWidth + labelPaddingX * 2
  ctx.fillStyle = '#000000'
  ctx.fillRect(cx - labelWidth / 2, y, labelWidth, labelHeight)
  ctx.fillStyle = chart.text_color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(chart.title, cx, y + labelHeight / 2)

  const r = radius - thickness / 2
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = chart.track_color
  ctx.lineWidth = thickness
  ctx.stroke()

  const startAngle = -Math.PI / 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, startAngle, startAngle + Math.PI * 2 * progress)
  ctx.strokeStyle = chart.progress_color
  ctx.lineWidth = thickness
  ctx.stroke()

  const innerR = r - thickness / 2 - 3 * scale
  ctx.beginPath()
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2)
  ctx.fillStyle = chart.fill_color
  ctx.fill()
  ctx.strokeStyle = chart.border_color
  ctx.lineWidth = Math.max(1, 2 * scale)
  ctx.stroke()

  if (chart.center_mode === 'icon' && iconImage) {
    const iconSize = innerR * 1.4
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(iconImage, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize)
    ctx.restore()
  } else {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${Math.round(12 * scale)}px system-ui, sans-serif`
    ctx.fillStyle = chart.text_color
    ctx.fillText(`${Math.round(progress * 100)}%`, cx, cy)
  }
  ctx.restore()
}

// Timeline Strip (2026-08-03, per Maro's own Synchro-style reference
// screenshot) — canvas equivalent of TimelineStripHud.tsx's own live HTML
// rendering: `cells`/`yearGroups` are built by the caller once per capture
// (buildMonthCells/groupByYear, imported from that same file so there's
// only one implementation of the layout math for both), `playheadIndex` is
// the currently-active month's index into `cells` (-1 = outside the
// strip's own domain, draws no playhead at all — same as the live HUD).
export function drawTimelineStrip(
  ctx: CanvasRenderingContext2D, x: number, y: number, strip: TimelineStrip,
  cells: MonthCell[], yearGroups: YearGroup[], playheadIndex: number, scale: number,
): void {
  const width = strip.width_px * scale
  const height = strip.height_px * scale
  const halfHeight = height / 2

  ctx.save()
  ctx.fillStyle = strip.background_color
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = strip.band_border_color
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(x, y, width, height)

  if (cells.length === 0) {
    ctx.fillStyle = strip.text_color
    ctx.font = `${Math.round(strip.font_size * scale)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('No scheduled activities in scope', x + width / 2, y + height / 2)
    ctx.restore()
    return
  }

  const cellWidth = width / cells.length

  if (playheadIndex >= 0) {
    ctx.fillStyle = strip.playhead_color
    ctx.globalAlpha = 0.55
    ctx.fillRect(x + playheadIndex * cellWidth, y, cellWidth, height)
    ctx.globalAlpha = 1
    ctx.strokeStyle = strip.playhead_color
    ctx.lineWidth = Math.max(2, 2 * scale)
    ctx.strokeRect(x + playheadIndex * cellWidth, y, cellWidth, height)
  }

  ctx.fillStyle = strip.text_color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold ${Math.round(strip.font_size * scale)}px system-ui, sans-serif`
  ctx.strokeStyle = strip.band_border_color
  ctx.lineWidth = Math.max(1, scale)
  for (const g of yearGroups) {
    const groupX = x + g.startIndex * cellWidth
    const groupWidth = g.count * cellWidth
    ctx.fillText(String(g.year), groupX + groupWidth / 2, y + halfHeight / 2)
    ctx.beginPath()
    ctx.moveTo(groupX, y + halfHeight)
    ctx.lineTo(groupX + groupWidth, y + halfHeight)
    ctx.stroke()
  }

  ctx.font = `${Math.round(strip.font_size * scale)}px system-ui, sans-serif`
  cells.forEach((c, i) => {
    ctx.fillText(MONTH_LETTERS[c.month], x + i * cellWidth + cellWidth / 2, y + halfHeight + halfHeight / 2)
  })
  ctx.restore()
}

// Greedy word-wrap — breaks `text` into lines no wider than `maxWidth` at
// this ctx's own current font, same measure-first approach
// drawTruncatedText uses rather than trusting fillText's own maxWidth
// (which squishes instead of wrapping — see that function's own header
// for why that's never what's wanted here).
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

// Project title + narrative for the empty top-left corner (2026-07-25,
// per Maro: "there's a corner at left which is empty. Allow me to add a
// title (e.g project title) and a description or narrative so i can
// utilise the space properly") — only ever called when
// ExportLayout.titleBlockRect exists (see computeExportLayout's own
// header on when that corner is actually available). Draws nothing if
// both fields are blank, same "empty text = off" convention
// RenderCaptureSettings.mainViewTitle/comparisonViewTitles already established.
function drawTitleBlock(ctx: CanvasRenderingContext2D, rect: Rect, title: string, narrative: string, scale: number): void {
  const trimmedTitle = title.trim()
  const trimmedNarrative = narrative.trim()
  if (!trimmedTitle && !trimmedNarrative) return

  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)

  const padding = OVERLAY_PADDING * scale
  const maxWidth = Math.max(0, rect.width - padding * 2)
  ctx.textBaseline = 'middle'
  let cursorY = rect.y + padding

  if (trimmedTitle) {
    ctx.font = `bold ${Math.round(15 * scale)}px system-ui, sans-serif`
    ctx.fillStyle = '#111827'
    const titleLineHeight = 19 * scale
    const titleLines = wrapText(ctx, trimmedTitle, maxWidth).slice(0, 2)
    titleLines.forEach((line, i) => {
      drawTruncatedText(ctx, line, rect.x + padding, cursorY + i * titleLineHeight + titleLineHeight / 2, maxWidth)
    })
    cursorY += titleLines.length * titleLineHeight + padding * 0.5
  }

  if (trimmedNarrative) {
    ctx.font = `${Math.round(10 * scale)}px system-ui, sans-serif`
    ctx.fillStyle = '#4b5563'
    const lineHeight = 14 * scale
    const narrativeLines = wrapText(ctx, trimmedNarrative, maxWidth)
    const availableHeight = Math.max(0, rect.y + rect.height - padding - cursorY)
    const maxLines = Math.max(0, Math.floor(availableHeight / lineHeight))
    narrativeLines.slice(0, maxLines).forEach((line, i) => {
      const isTruncated = i === maxLines - 1 && narrativeLines.length > maxLines
      drawTruncatedText(ctx, isTruncated ? `${line}…` : line, rect.x + padding, cursorY + i * lineHeight + lineHeight / 2, maxWidth)
    })
  }
  ctx.restore()
}

// Small centred label badge along the top of a 3D view rect — "Current"/
// "Baseline" by default (2026-07-25, per Maro: "add a title for both 3d
// views... allow me to name the titles"), but whatever text
// RenderCaptureSettings.mainViewTitle/comparisonViewTitles actually holds.
// Always drawn when non-blank rather than behind its own separate
// checkbox — see RenderCaptureSettings' own header on that call — and
// deliberately top-*centre*, not top-left, so it never collides with the
// date overlay already claiming the main view's own top-left corner.
export function drawViewTitle(ctx: CanvasRenderingContext2D, rect: Rect, title: string, scale: number): void {
  const trimmed = title.trim()
  if (!trimmed) return
  const padding = OVERLAY_PADDING * scale
  ctx.save()
  ctx.font = `bold ${Math.round(13 * scale)}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  const maxTextWidth = Math.max(0, rect.width - padding * 4)
  const textWidth = Math.min(ctx.measureText(trimmed).width, maxTextWidth)
  const boxWidth = textWidth + padding * 2
  const boxHeight = 13 * scale + padding
  const boxX = rect.x + (rect.width - boxWidth) / 2
  const boxY = rect.y + padding * 0.6

  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1, scale)
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight)
  ctx.fillStyle = '#111827'
  drawTruncatedText(ctx, trimmed, boxX + padding, boxY + boxHeight / 2, textWidth)
  ctx.restore()
}

export interface ComposeExportFrameOptions {
  mainCanvas: HTMLCanvasElement
  // Up to 3 comparison-pane canvases (2026-08-03, generalized from the old
  // single baselineCanvas: HTMLCanvasElement | null) — indices line up
  // with ExportLayout.comparisonViewRects; a `null` entry (a pane whose
  // Canvas hasn't produced a frame yet) is simply skipped, same as the old
  // `!opts.baselineCanvas` guard.
  comparisonCanvases: (HTMLCanvasElement | null)[]
  activities: Activity[]
  profiles: AnimationProfile[]
  now: Date | null
  scheduleStart: Date | null
  scheduleEnd: Date | null
  scale: number
  includeGanttChart: boolean
  includeActivityTable: boolean
  includeAppearanceLegend: boolean
  includeDateOverlay: boolean
  mainViewTitle: string
  // Index-aligned with ExportLayout.comparisonViewRects (2026-09-01,
  // replaces the old single `baselineViewTitle: string` — see
  // RenderCaptureSettings.comparisonViewTitles's own header for the full
  // "why").
  comparisonViewTitles: string[]
  includeCostProfile: boolean
  costProfileBuckets: { start: Date; end: Date; label: string }[]
  costProfileValues: number[]
  costProfileResourceBreakdown: { name: string; values: number[] }[]
  exportTitle: string
  exportNarrative: string
  // 2026-07-30, per Maro: "the text boxes and texts dont show up in the
  // captured renders" — see exportLabels.ts's own header. camera is
  // whatever's live in Viewport3D.tsx's own cameraRef at capture time;
  // null (e.g. before the first real frame) just skips this pass.
  camera: THREE.Camera | null
  exportLabels: ExportLabelRegistry
  // Radial Progress Charts (2026-07-31) — includeRadialCharts is the one
  // master opt-in switch (RenderCaptureSettings.includeRadialCharts,
  // matching includeAppearanceLegend's own precedent); each chart's own
  // `visible` still gates it individually (radialCharts here is already
  // pre-filtered to visible ones — see Viewport3D.tsx's own
  // handleCaptureImage/handleExportVideo). radialChartProgress is each
  // chart's own duration-weighted % at THIS frame's own "now" (computed by
  // the caller, not here — this file stays activity-matching-free);
  // radialChartIcons holds pre-loaded HTMLImageElements for any chart in
  // "icon" mode (canvas drawImage needs a already-loaded image, not an
  // async blob fetch mid-draw).
  includeRadialCharts: boolean
  radialCharts: RadialChart[]
  radialChartProgress: Map<string, number>
  radialChartIcons: Map<string, HTMLImageElement>
  // Timeline Strip (2026-08-03) — cells/yearGroups are computed once by the
  // caller per capture (the matched-activity set doesn't change mid-
  // recording); timelineStripPlayheadIndex is recomputed every frame for
  // video (it depends on `now`, same split Radial Chart's own progress
  // recompute already uses).
  includeTimelineStrip: boolean
  timelineStrip: TimelineStrip | null
  timelineStripCells: MonthCell[]
  timelineStripYearGroups: YearGroup[]
  timelineStripPlayheadIndex: number
}

// Cover-fit (2026-07-25, for the explicit-output-resolution rework above) —
// scales the source canvas uniformly to fill the destination rect
// completely, centre-cropping whichever axis overflows, rather than
// stretching non-uniformly to match (same convention as CSS
// object-fit: cover). This is what actually delivers computeExportLayout's
// own "never distort the 3D content" principle now that the output
// resolution's aspect ratio generally won't match either source canvas's
// own on-screen aspect ratio.
function drawCoverFit(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, dest: Rect): void {
  const scale = Math.max(dest.width / source.width, dest.height / source.height)
  const sw = dest.width / scale
  const sh = dest.height / scale
  const sx = (source.width - sw) / 2
  const sy = (source.height - sh) / 2
  ctx.drawImage(source, sx, sy, sw, sh, dest.x, dest.y, dest.width, dest.height)
}

// Rounded rect path — Canvas 2D's own native ctx.roundRect() would do this,
// but this codebase's own convention elsewhere (drawTruncatedText etc.)
// leans toward not assuming a specific newer-browser API is available;
// cheap enough to just build the path with arcs directly.
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

// Projects a world position through `camera` into the composite frame's
// own pixel space (2026-07-30, see exportLabels.ts's own header for the
// full "why" — this is the piece that makes a label land on top of
// whatever it's meant to annotate): NDC -> source-canvas pixel -> the SAME
// cover-fit crop+scale drawCoverFit already applied when it copied that
// canvas into `dest`, so this stays correct regardless of how aggressively
// cover-fit had to crop to fill the requested output resolution/aspect.
function projectToDestPixel(
  worldPos: THREE.Vector3, camera: THREE.Camera, sourceWidth: number, sourceHeight: number, dest: Rect,
): { x: number; y: number } | null {
  // In-front-of-camera check via view-space z, not the projected NDC z
  // (2026-07-30) — NDC z alone isn't a reliable "is this behind the
  // camera" signal for every camera type this app uses; view-space z is
  // unambiguous (negative = in front) for both perspective and orthographic.
  const viewSpace = worldPos.clone().applyMatrix4(camera.matrixWorldInverse)
  if (viewSpace.z > 0) return null
  const ndc = worldPos.clone().project(camera)
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null

  const px = (ndc.x + 1) / 2 * sourceWidth
  const py = (1 - ndc.y) / 2 * sourceHeight

  const scale = Math.max(dest.width / sourceWidth, dest.height / sourceHeight)
  const sw = dest.width / scale
  const sh = dest.height / scale
  const sx = (sourceWidth - sw) / 2
  const sy = (sourceHeight - sh) / 2
  return { x: dest.x + (px - sx) * scale, y: dest.y + (py - sy) * scale }
}

// Draws one ExportLabel at its already-projected screen position. The
// 'annotation-placemark' kind gets a small circular pin (its live-view
// balloon shape isn't worth replicating exactly here — see
// exportLabels.ts's own anchor header); every other kind is a plain
// rounded/square box, closely matching its own source component's CSS
// (background/border/radius/bold), not pixel-identical.
function drawExportLabel(ctx: CanvasRenderingContext2D, screenPos: { x: number; y: number }, label: ExportLabel, scale: number): void {
  ctx.save()
  if (label.kind === 'annotation-placemark') {
    const r = 12 * scale
    const cy = screenPos.y - r
    ctx.beginPath()
    ctx.arc(screenPos.x, cy, r, 0, Math.PI * 2)
    if (label.backgroundColor) { ctx.fillStyle = label.backgroundColor; ctx.fill() }
    if (label.borderColor) {
      ctx.strokeStyle = label.borderColor
      ctx.lineWidth = Math.max(1, 2 * scale)
      ctx.stroke()
    }
    ctx.font = `${Math.round(14 * scale)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = label.textColor
    ctx.fillText(label.text, screenPos.x, cy)
    ctx.restore()
    return
  }

  ctx.font = `${label.bold ? 'bold ' : ''}${Math.round(label.fontSize * scale)}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  const paddingX = 8 * scale
  const paddingY = 5 * scale
  const textWidth = ctx.measureText(label.text).width
  const boxWidth = textWidth + paddingX * 2
  const boxHeight = label.fontSize * scale + paddingY * 2

  let boxX: number
  let boxY: number
  if (label.anchor === 'bottom-left') {
    boxX = screenPos.x
    boxY = screenPos.y - boxHeight
  } else if (label.anchor === 'bottom-center') {
    boxX = screenPos.x - boxWidth / 2
    boxY = screenPos.y - boxHeight - 20 * scale
  } else {
    boxX = screenPos.x - boxWidth / 2
    boxY = screenPos.y - boxHeight / 2
  }

  if (label.backgroundColor) {
    ctx.fillStyle = label.backgroundColor
    if (label.borderRadius > 0) { roundRectPath(ctx, boxX, boxY, boxWidth, boxHeight, label.borderRadius * scale); ctx.fill() }
    else ctx.fillRect(boxX, boxY, boxWidth, boxHeight)
  }
  if (label.borderColor) {
    ctx.strokeStyle = label.borderColor
    ctx.lineWidth = Math.max(1, scale)
    if (label.borderRadius > 0) { roundRectPath(ctx, boxX, boxY, boxWidth, boxHeight, label.borderRadius * scale); ctx.stroke() }
    else ctx.strokeRect(boxX, boxY, boxWidth, boxHeight)
  }
  ctx.fillStyle = label.textColor
  ctx.fillText(label.text, boxX + paddingX, boxY + boxHeight / 2)
  ctx.restore()
}

// Draws every currently-visible entry in the shared registry on top of the
// main 3D view (2026-07-30, per Maro: "the text boxes and texts dont show
// up in the captured renders" — see exportLabels.ts's own header for the
// full root-cause/fix story). Called right after drawCoverFit/drawViewTitle
// place the real 3D canvas into `dest`, so labels land on top of it, same
// draw order the live DOM already uses (Html overlays sit above the canvas
// too).
function drawExportLabels(
  ctx: CanvasRenderingContext2D, dest: Rect, registry: ExportLabelRegistry,
  camera: THREE.Camera, sourceWidth: number, sourceHeight: number, scale: number,
): void {
  for (const label of registry.values()) {
    if (!label.visible) continue
    const screenPos = projectToDestPixel(label.worldPos, camera, sourceWidth, sourceHeight, dest)
    if (!screenPos) continue
    drawExportLabel(ctx, screenPos, label, scale)
  }
}

// Orchestrator — white background, whichever bands/overlays are enabled,
// then the real 3D canvas(es) cover-fit into their own viewport rect(s).
// Called once for a still capture and every step() tick for a video
// recording — see Viewport3D.tsx's own handleCaptureImage/
// handleExportVideo.
export function composeExportFrame(ctx: CanvasRenderingContext2D, layout: ExportLayout, opts: ComposeExportFrameOptions): void {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, layout.totalWidth, layout.totalHeight)

  if (layout.ganttRect && opts.includeGanttChart) {
    drawGanttStrip(ctx, layout.ganttRect, opts.activities, opts.scheduleStart, opts.scheduleEnd, opts.now, opts.scale)
  }
  if (layout.tableRect && opts.includeActivityTable) {
    drawActivityTableStrip(ctx, layout.tableRect, opts.activities, opts.now, opts.scale)
  }
  if (layout.costRect && opts.includeCostProfile) {
    drawCostProfileChart(ctx, layout.costRect, opts.costProfileBuckets, opts.costProfileValues, opts.now, opts.costProfileResourceBreakdown, opts.scale)
  }
  if (layout.titleBlockRect) {
    drawTitleBlock(ctx, layout.titleBlockRect, opts.exportTitle, opts.exportNarrative, opts.scale)
  }

  const mv = layout.mainViewRect
  drawCoverFit(ctx, opts.mainCanvas, mv)
  if (opts.camera) drawExportLabels(ctx, mv, opts.exportLabels, opts.camera, opts.mainCanvas.width, opts.mainCanvas.height, opts.scale)
  drawViewTitle(ctx, mv, opts.mainViewTitle, opts.scale)
  // Per-pane title (2026-09-01, replaces the old single shared
  // baselineViewTitle applied identically to every open pane) — index i
  // lines up with FourD.tsx's own paneConfigs/comparisonCanvasRefs slots.
  layout.comparisonViewRects.forEach((rect, i) => {
    const canvas = opts.comparisonCanvases[i]
    if (!canvas) return
    drawCoverFit(ctx, canvas, rect)
    drawViewTitle(ctx, rect, opts.comparisonViewTitles[i] ?? '', opts.scale)
  })

  const padding = OVERLAY_PADDING * opts.scale
  if (opts.includeAppearanceLegend) {
    const legendHeight = 40 * opts.scale + opts.profiles.length * ROW_HEIGHT * opts.scale
    drawAppearanceLegend(ctx, mv.x + padding, mv.y + mv.height - legendHeight - padding, opts.profiles, opts.scale)
  }
  // Top-left corner (2026-07-25, per Maro: "the focus date and week data
  // can be moved to the top left corner") — was bottom-right, sharing that
  // corner uneasily with the Animation Timeline's own edge; top-left is
  // clear of both the legend (bottom-left) and the Gantt/Table bands.
  if (opts.includeDateOverlay) {
    drawDateOverlay(ctx, mv.x + padding, mv.y + padding, opts.now, opts.scheduleStart, opts.scale)
  }
  // Positions stay relative to the main 3D view's own rect, not the full
  // canvas (2026-07-31) — same behaviour whether or not Gantt/Table bands
  // are also included, matching what's actually on screen live.
  if (opts.includeRadialCharts) {
    for (const chart of opts.radialCharts) {
      const xPx = mv.x + (chart.position_x_pct / 100) * mv.width
      const yPx = mv.y + (chart.position_y_pct / 100) * mv.height
      const progress = opts.radialChartProgress.get(chart.id) ?? 0
      const icon = opts.radialChartIcons.get(chart.id) ?? null
      drawRadialChart(ctx, xPx, yPx, chart, progress, icon, opts.scale)
    }
  }
  if (opts.includeTimelineStrip && opts.timelineStrip && opts.timelineStrip.visible) {
    const xPx = mv.x + (opts.timelineStrip.position_x_pct / 100) * mv.width
    const yPx = mv.y + (opts.timelineStrip.position_y_pct / 100) * mv.height
    drawTimelineStrip(ctx, xPx, yPx, opts.timelineStrip, opts.timelineStripCells, opts.timelineStripYearGroups, opts.timelineStripPlayheadIndex, opts.scale)
  }
}
