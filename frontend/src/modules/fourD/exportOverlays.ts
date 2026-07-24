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
}

// Base sizes at scale=1 — multiplied by `scale` (the same effective
// devicePixelRatio × resolutionMultiplier already used to boost the 3D
// canvases themselves) everywhere below, so overlay text/line weights stay
// proportionate to the 3D content at 2x/4x output instead of becoming
// illegibly tiny.
const GANTT_BAND_HEIGHT = 130
// Time-interval ruler along the top of the Gantt strip (2026-07-25, per
// Maro: "time interval at the top would be useful") — a separate reserved
// header row above the bars themselves, tall enough for month/year tick
// labels; see drawGanttStrip's own header for how the tick interval is
// chosen.
const TIME_AXIS_HEIGHT = 22
const TABLE_COLUMN_WIDTH = 420
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
  mainWidth: number, mainHeight: number,
  baselineWidth: number, baselineHeight: number,
  scale: number,
  opts: { includeGanttChart: boolean; includeActivityTable: boolean; includeBaseline: boolean },
): ExportLayout {
  const ganttHeight = opts.includeGanttChart ? Math.round((GANTT_BAND_HEIGHT + TIME_AXIS_HEIGHT) * scale) : 0
  const tableWidth = opts.includeActivityTable ? Math.round(TABLE_COLUMN_WIDTH * scale) : 0

  // Viewport area sized off the source canvas(es)' own combined width —
  // whatever main (+ baseline, side by side) would naturally occupy —
  // rather than an arbitrary constant, so the 3D content never gets
  // stretched/squashed relative to what's actually on screen. Each source
  // canvas keeps its own native width/height in its own rect (top-aligned
  // within the shared viewport row) rather than being forced to a shared
  // height — same "never stretch, just top-align" behaviour
  // compositeCanvasesSideBySide already had for the baseline-only case,
  // now generalised to also leave room for the Gantt/Table bands.
  const viewportWidth = opts.includeBaseline ? mainWidth + baselineWidth : mainWidth
  const viewportHeight = opts.includeBaseline ? Math.max(mainHeight, baselineHeight) : mainHeight

  const totalWidth = tableWidth + viewportWidth
  const totalHeight = ganttHeight + viewportHeight

  const ganttRect: Rect | null = opts.includeGanttChart
    ? { x: tableWidth, y: 0, width: viewportWidth, height: ganttHeight }
    : null
  const tableRect: Rect | null = opts.includeActivityTable
    ? { x: 0, y: ganttHeight, width: tableWidth, height: viewportHeight }
    : null

  const mainViewRect: Rect = { x: tableWidth, y: ganttHeight, width: mainWidth, height: mainHeight }
  const baselineViewRect: Rect | null = opts.includeBaseline
    ? { x: tableWidth + mainWidth, y: ganttHeight, width: baselineWidth, height: baselineHeight }
    : null

  return { totalWidth, totalHeight, ganttRect, tableRect, mainViewRect, baselineViewRect }
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
  // (2026-07-25, per Maro: "activity name text is cut off") — "T-0044"
  // and a short date never need much room, so most of the column now goes
  // to the name, which still truncates on a genuinely long activity name
  // but far less eagerly than before.
  const gap = COLUMN_GAP * scale
  const codeWidth = rect.width * 0.16
  const dateWidth = rect.width * 0.22
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
}

// Orchestrator — white background, whichever bands/overlays are enabled,
// then the real 3D canvas(es) drawImage'd (scaled to fit) into their own
// viewport rect(s). Called once for a still capture and every step() tick
// for a video recording — see Viewport3D.tsx's own handleCaptureImage/
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

  const mv = layout.mainViewRect
  ctx.drawImage(opts.mainCanvas, mv.x, mv.y, mv.width, mv.height)
  if (layout.baselineViewRect && opts.baselineCanvas) {
    const bv = layout.baselineViewRect
    ctx.drawImage(opts.baselineCanvas, bv.x, bv.y, bv.width, bv.height)
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
