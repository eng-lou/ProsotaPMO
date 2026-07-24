import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'

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
  baselineViewRect: Rect | null
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
  opts: { includeGanttChart: boolean; includeActivityTable: boolean; includeBaseline: boolean; includeCostProfile: boolean },
): ExportLayout {
  const ganttHeight = opts.includeGanttChart ? Math.round((GANTT_BAND_HEIGHT + TIME_AXIS_HEIGHT) * scale) : 0
  const tableWidth = opts.includeActivityTable ? Math.round(TABLE_COLUMN_WIDTH * scale) : 0
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

  // Split evenly between main/baseline when shown side by side — each
  // gets cover-fit into its own half independently, so neither the 50/50
  // split nor either source canvas's own native aspect ratio distorts the
  // other.
  const mainWidth = opts.includeBaseline ? Math.round(viewportWidth / 2) : viewportWidth
  const baselineWidth = viewportWidth - mainWidth

  const mainViewRect: Rect = { x: tableWidth, y: ganttHeight, width: mainWidth, height: viewportHeight }
  const baselineViewRect: Rect | null = opts.includeBaseline
    ? { x: tableWidth + mainWidth, y: ganttHeight, width: baselineWidth, height: viewportHeight }
    : null
  // Full-width footer, below the table+viewport row entirely (not scoped
  // to just the viewport's own width the way ganttRect is) — a status-bar
  // style band makes more sense spanning everything underneath it, since
  // cost data isn't specifically tied to the table column beside it.
  const costRect: Rect | null = opts.includeCostProfile
    ? { x: 0, y: ganttHeight + viewportHeight, width: totalWidth, height: costHeight }
    : null
  // The empty corner above the table/left of the Gantt strip (2026-07-25,
  // per Maro: "there's a corner at left which is empty. Allow me to add a
  // title... and a description or narrative") — only ever exists when both
  // bands are on, since it's exactly their intersection (ganttRect stops
  // at x: tableWidth, tableRect starts at y: ganttHeight — the rectangle
  // neither one claims). No dedicated space to draw into otherwise, so
  // this stays null rather than inventing a new band just for it.
  const titleBlockRect: Rect | null = opts.includeGanttChart && opts.includeActivityTable
    ? { x: 0, y: 0, width: tableWidth, height: ganttHeight }
    : null

  return { totalWidth, totalHeight, ganttRect, tableRect, mainViewRect, baselineViewRect, costRect, titleBlockRect }
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
// RenderCaptureSettings.mainViewTitle/baselineViewTitle already established.
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
// RenderCaptureSettings.mainViewTitle/baselineViewTitle actually holds.
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
  baselineCanvas: HTMLCanvasElement | null
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
  baselineViewTitle: string
  includeCostProfile: boolean
  costProfileBuckets: { start: Date; end: Date; label: string }[]
  costProfileValues: number[]
  costProfileResourceBreakdown: { name: string; values: number[] }[]
  exportTitle: string
  exportNarrative: string
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
  drawViewTitle(ctx, mv, opts.mainViewTitle, opts.scale)
  if (layout.baselineViewRect && opts.baselineCanvas) {
    const bv = layout.baselineViewRect
    drawCoverFit(ctx, opts.baselineCanvas, bv)
    drawViewTitle(ctx, bv, opts.baselineViewTitle, opts.scale)
  }

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
}
