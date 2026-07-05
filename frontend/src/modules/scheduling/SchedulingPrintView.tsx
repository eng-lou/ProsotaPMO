import { useMemo } from 'react'
import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import { DEFAULT_GANTT_STYLE, FONT_FAMILY_CSS, wbsLevelColor, wbsRowBackground, withAlpha, type GanttStyle } from '@/lib/ganttLayout'
import type { ProjectLetterhead } from '@/lib/letterhead'
import { formatDateTime } from './dateTime'
import { GANTT_ROW_HEIGHT, HEADER_HEIGHT } from './GanttChart'
import { computeTimeMarks, type GanttZoom } from './ganttZoom'
import { formatMoney, formatRatio, type ColumnKey } from './Scheduling'
import type { Activity, ActivityRelationship, ResourceAssignment } from './types'

// The gantt column always gets the leftover 58% of the table's width — data
// columns are pinned to 42% between them (see the <colgroup> below). Used to
// convert a position that's local to the gantt column (0-100, its own day
// range) into one relative to the whole table, for the connector overlay.
const DATA_PCT = 42
const GANTT_PCT = 58
function toTableXPct(colPct: number): number {
  return DATA_PCT + (colPct / 100) * GANTT_PCT
}

interface Props {
  activities: Activity[]
  relationships: ActivityRelationship[]
  resourceAssignments: ResourceAssignment[]
  visibleColumns: Set<ColumnKey>
  columnWidths: Record<string, number>
  projectName: string
  letterhead: ProjectLetterhead | null
  ganttStyle?: GanttStyle
  ganttZoom?: GanttZoom
}

function depthOf(a: Activity): number {
  return a.wbs_path ? a.wbs_path.split('.').length - 1 : 0
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000
}

// Same range-finding logic as GanttChart.tsx's internal useMemo — duplicated
// rather than imported since GanttChart doesn't export it. Print positions
// everything as a percentage of totalDays (see xGeometryPct below), not
// pixels, so this doesn't need GanttChart's own zoom-driven pixel constant.
function computeGanttRange(activities: Activity[]): { rangeStart: Date; totalDays: number } {
  const dates = activities
    .flatMap(a => [a.start, a.finish, a.bl_start, a.bl_finish])
    .filter((v): v is string => v !== null)
    .map(v => new Date(v))
    .filter(d => !Number.isNaN(d.getTime()))
  const today = new Date()
  const min = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : today
  const max = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : today
  min.setDate(min.getDate() - 7)
  max.setDate(max.getDate() + 7)
  return { rangeStart: min, totalDays: Math.max(daysBetween(min, max), 42) }
}

// Percentages of the gantt column's own width (0-100, spanning rangeStart to
// rangeStart+totalDays) rather than pixels — see the file-level comment for
// why this can never be a *measured* pixel width in this app's print flow.
function xGeometryPct(start: string | null, finish: string | null, isMilestone: boolean, rangeStart: Date, totalDays: number) {
  const s = parseDate(start)
  const f = parseDate(finish)
  if (isMilestone) {
    const at = s ?? f
    if (!at) return null
    const pct = (daysBetween(rangeStart, at) / totalDays) * 100
    return { leftPct: pct, rightPct: pct }
  }
  if (!s || !f) return null
  const leftPct = (daysBetween(rangeStart, s) / totalDays) * 100
  const rightPct = leftPct + (daysBetween(s, f) / totalDays) * 100
  return { leftPct, rightPct }
}

// Same fixed pixel stub as GanttChart.tsx's own elbowPath (10px) — NOT a
// percentage of the table width. A percentage-based stub scales with however
// wide the printed page happens to render, which produced a zigzag many
// times larger than on-screen's tight one once the print table rendered
// wider than assumed (2026-07-05, per Maro — compared side-by-side
// screenshots: same data, same routing logic, wildly different proportions).
// CSS calc()/min()/max() resolve a genuine "percent ± pixels" position and
// pick whichever of two mixed-unit expressions is larger, entirely at
// render time — exactly what's needed here, since JS never learns the
// table's real rendered pixel width (see the file-level comment).
const STUB_PX = 10

function cssX(pct: number, pxOffset = 0): string {
  return pxOffset === 0 ? `${pct}%` : `calc(${pct}% + ${pxOffset}px)`
}

// A connector's elbow route as a list of straight segments (x as a CSS
// length-percentage expression, y in real pixels) rather than one SVG path
// string — plain positioned <div>s handle a %-x/px-y mix natively, whereas
// an SVG viewBox scaled non-uniformly to fake that mix would also warp
// stroke widths (2026-07-05, per Maro — see the file-level comment). Same
// routing logic as GanttChart.tsx's own elbowPath (stub out, across, stub
// in), just emitting segments instead of a `d` string. Each 'h' segment's
// two x's aren't assumed to be in left-to-right order (a resolved calc()
// value can't be compared in JS) — the renderer uses CSS min()/max() to
// sort them at layout time instead.
type Segment =
  | { kind: 'h'; x1: string; x2: string; y: number }
  | { kind: 'v'; x: string; yStart: number; yEnd: number }

function elbowSegments(x1Pct: number, y1: number, x2Pct: number, y2: number): Segment[] {
  // Purely a routing heuristic ("is the target clearly ahead, or basically
  // same-x/backward") — doesn't need to precisely match STUB_PX, just needs
  // to be a small percentage.
  const routeThresholdPct = 0.5
  // Same branch condition as GanttChart.tsx's own elbowPath (a full stub-width
  // gap required before taking the simple route) — same-date milestone-to-
  // milestone links intentionally get the loop-out "S" route below, same as
  // on-screen (2026-07-05, per Maro: wanted print to match the on-screen
  // zigzag, not a plain vertical line).
  if (x2Pct >= x1Pct + routeThresholdPct || (y1 === y2 && x2Pct >= x1Pct)) {
    const midX = cssX(x1Pct, STUB_PX)
    return [
      { kind: 'h', x1: cssX(x1Pct), x2: midX, y: y1 },
      { kind: 'v', x: midX, yStart: Math.min(y1, y2), yEnd: Math.max(y1, y2) },
      { kind: 'h', x1: midX, x2: cssX(x2Pct), y: y2 },
    ]
  }
  const outX = `min(100%, ${cssX(x1Pct, STUB_PX)})`
  // Clamped to DATA_PCT — the gantt column's own left edge within the
  // table-wide 0-100 scale. Without this, a stub subtracted from an x that's
  // already close to that edge (e.g. two early-dated, nearly same-date
  // activities) pushes the route left of DATA_PCT, spilling the connector
  // visibly into the data columns (2026-07-05, per Maro).
  const inX = `max(${DATA_PCT}%, ${cssX(x2Pct, -STUB_PX)})`
  const midY = (y1 + y2) / 2
  return [
    { kind: 'h', x1: cssX(x1Pct), x2: outX, y: y1 },
    { kind: 'v', x: outX, yStart: Math.min(y1, midY), yEnd: Math.max(y1, midY) },
    { kind: 'h', x1: outX, x2: inX, y: midY },
    { kind: 'v', x: inX, yStart: Math.min(midY, y2), yEnd: Math.max(midY, y2) },
    { kind: 'h', x1: inX, x2: cssX(x2Pct), y: y2 },
  ]
}

// Centered on the full row height — unlike the on-screen Gantt, print doesn't
// reserve a lower "baseline zone" (baseline ghosts aren't rendered in print
// at all, see the trade-off note below), so there's no reason to sit the bar
// in an upper zone the way the interactive view does (2026-07-05, per Maro).
const BAR_ZONE_HEIGHT = 22
const BAR_CENTER_Y = GANTT_ROW_HEIGHT / 2
const BAR_ZONE_TOP = BAR_CENTER_Y - BAR_ZONE_HEIGHT / 2
const MILESTONE_SIZE = 12

// Same priority order as Scheduling.tsx's rowBackground: archived (flat grey,
// regardless of anything else), then critical, then WBS summary (shaded by
// nesting level), then milestone, else the flat "normal activity" tint — kept
// in sync so the printed table matches the viewport exactly.
function rowBackground(a: Activity, style: GanttStyle): string | undefined {
  if (a.is_archived || a.is_archive_container) return '#f3f4f6'
  if (a.is_critical) return withAlpha(style.critical_color, 0.12)
  if (a.activity_type === 'wbs_summary') return wbsRowBackground(style, depthOf(a))
  if (a.activity_type === 'milestone') return withAlpha(style.milestone_row_color, 0.15)
  return style.activity_row_color === '#ffffff' ? undefined : withAlpha(style.activity_row_color, 1)
}

// Renders exactly whichever columns are currently toggled visible in the
// interactive table (Scheduling.tsx's "☰ Columns" menu), in the same order,
// at widths proportional to their actual on-screen (resized) pixel widths.
interface PrintColumnDef {
  key: ColumnKey
  label: string
  align?: 'right'
  render: (a: Activity, resourceAssignments: ResourceAssignment[]) => string
  cellClassName?: (a: Activity) => string
}

const NEGATIVE_RED = 'text-red-600 font-semibold'
const NORMAL_GREY = 'text-gray-600'

const PRINT_COLUMNS: PrintColumnDef[] = [
  { key: 'code', label: 'Code', render: a => a.code, cellClassName: () => 'text-gray-500 font-mono' },
  { key: 'wbs', label: 'WBS', render: a => a.wbs_path ?? '—', cellClassName: () => 'text-gray-400 font-mono' },
  { key: 'type', label: 'Type', render: a => a.activity_type.replace('_', ' ') },
  { key: 'duration', label: 'Dur (d)', align: 'right', render: a => String(a.duration_days ?? '—') },
  { key: 'start', label: 'Start', render: a => formatDateTime(a.start) },
  { key: 'bl_start', label: 'BL Start', render: a => formatDateTime(a.bl_start), cellClassName: () => 'text-gray-400' },
  { key: 'finish', label: 'Finish', render: a => formatDateTime(a.finish) },
  { key: 'bl_finish', label: 'BL Finish', render: a => formatDateTime(a.bl_finish), cellClassName: () => 'text-gray-400' },
  {
    key: 'variance', label: 'Fin. Var (d)', align: 'right', render: a => String(a.variance_days ?? '—'),
    cellClassName: a => (a.variance_days ?? 0) > 0 ? NEGATIVE_RED : NORMAL_GREY,
  },
  {
    key: 'float', label: 'Total Float', align: 'right',
    render: a => a.total_float_hours != null ? `${a.total_float_hours}h` : '—',
    cellClassName: a => a.is_critical ? NEGATIVE_RED : NORMAL_GREY,
  },
  { key: 'free_float', label: 'Free Float', align: 'right', render: a => a.free_float_hours != null ? `${a.free_float_hours}h` : '—' },
  { key: 'pct_complete', label: '% Comp', align: 'right', render: a => `${a.pct_complete ?? 0}%` },
  {
    key: 'resources', label: 'Resources',
    render: (a, resourceAssignments) => resourceAssignments.filter(ra => ra.activity_id === a.id).map(ra => ra.resource_name).join(', ') || '—',
  },
  { key: 'bac', label: 'BAC', align: 'right', render: a => formatMoney(a.bac) },
  { key: 'pv', label: 'PV', align: 'right', render: a => formatMoney(a.pv) },
  { key: 'ev', label: 'EV', align: 'right', render: a => formatMoney(a.ev) },
  { key: 'ac', label: 'AC', align: 'right', render: a => formatMoney(a.ac) },
  {
    key: 'cv', label: 'CV', align: 'right', render: a => formatMoney(a.cv),
    cellClassName: a => a.cv !== null && Number(a.cv) < 0 ? NEGATIVE_RED : NORMAL_GREY,
  },
  {
    key: 'sv', label: 'SV', align: 'right', render: a => formatMoney(a.sv),
    cellClassName: a => a.sv !== null && Number(a.sv) < 0 ? NEGATIVE_RED : NORMAL_GREY,
  },
  {
    key: 'cpi', label: 'CPI', align: 'right', render: a => formatRatio(a.cpi),
    cellClassName: a => a.cpi !== null && Number(a.cpi) < 1 ? NEGATIVE_RED : NORMAL_GREY,
  },
  {
    key: 'spi', label: 'SPI', align: 'right', render: a => formatRatio(a.spi),
    cellClassName: a => a.spi !== null && Number(a.spi) < 1 ? NEGATIVE_RED : NORMAL_GREY,
  },
  { key: 'eac', label: 'EAC', align: 'right', render: a => formatMoney(a.eac) },
  { key: 'etc', label: 'ETC', align: 'right', render: a => formatMoney(a.etc) },
]

// A dedicated printable rendering, shown only via @media print (see index.css
// .print-only) — same pattern as Risk/ICD/Cost Plan's own PrintView components.
//
// The Gantt is an EXTRA COLUMN of the SAME <table> as the data columns, not a
// separate scaled-down block sitting beside it (2026-07-05, per Maro: a
// milestone's bar landed on page 1 while its own table row printed as the
// first row of page 2, and the Gantt's time-mark header didn't repeat on
// each page the way the table's <thead> does). Browsers paginate real
// <table>s row-by-row and automatically repeat <thead> on every printed
// page — that's exactly the behavior the data columns already got for free,
// and the previous separate Gantt div had no equivalent, so the two sides
// paginated independently and drifted apart. Making the bars real <td>s in
// the same <tr>s means there is only one thing being paginated.
//
// Everything in the Gantt column — bars, time-marks, today-marker, and the
// predecessor/successor connector lines added 2026-07-05 (per Maro) — is
// positioned as a CSS percentage of the gantt column's own width, not a
// pixel value solved from a *measured* column width. Three things were tried
// and empirically ruled out first: a ResizeObserver on the gantt <th> never
// fired with a real value (window.print(), called directly by Scheduling.
// tsx's printSchedule(), blocks the JS thread for the whole print dialog, so
// a callback waiting for the .print-only ancestor's display:none-to-visible
// switch never gets a turn before the snapshot is taken); a 'beforeprint'
// listener (which fires precisely so scripts can adjust content right
// before printing — confirmed via a console.log) DOES fire, but still
// measured the column at 0 width, meaning the print layout genuinely isn't
// applied yet at that point in this app's flow, contrary to how that event
// is usually described. With no reliable moment to ever read a real pixel
// number, percentages resolved natively by the browser's own print layout
// are the only thing that can't race — there's no JS in the loop at all.
// Connector lines are still real elbow-routed segments (see elbowSegments),
// just rendered as plain positioned <div>s (x in %, y in real pixels) rather
// than an SVG path — an SVG viewBox scaled non-uniformly to fake that same
// %-x/px-y mix would also warp stroke widths unevenly between the
// horizontal and vertical segments. Known trade-off: connector Y-positions
// are computed from row index * GANTT_ROW_HEIGHT (real page-break gaps
// between rows on different printed pages aren't accounted for) — accurate
// within a page, approximate across a page boundary. Baseline ghost bars
// still aren't rendered in print (a baseline "ghost" comparison mark isn't
// the same kind of cross-row line a dependency connector is, and wasn't
// asked for here).
export function SchedulingPrintView({
  activities, relationships, resourceAssignments, visibleColumns, columnWidths, projectName, letterhead, ganttStyle = DEFAULT_GANTT_STYLE, ganttZoom = 'week',
}: Props) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const letterheadTokens = {
    project: projectName, module: 'Schedule',
    count: `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`,
    printed_at: printedAt,
  }

  const columns = PRINT_COLUMNS.filter(c => visibleColumns.has(c.key))
  const columnsBeforeActivity = columns.filter(c => c.key === 'code' || c.key === 'wbs')
  const columnsAfterActivity = columns.filter(c => c.key !== 'code' && c.key !== 'wbs')
  const activityWidth = columnWidths.activity ?? 224
  const totalDataWidth = activityWidth + columns.reduce((sum, c) => sum + (columnWidths[c.key] ?? 96), 0) || 1

  const { rangeStart, totalDays } = useMemo(() => computeGanttRange(activities), [activities])
  const timeMarks = useMemo(() => computeTimeMarks(rangeStart, totalDays, ganttZoom), [rangeStart, totalDays, ganttZoom])
  const todayOffsetPct = useMemo(() => {
    const pct = (daysBetween(rangeStart, new Date()) / totalDays) * 100
    return pct >= 0 && pct <= 100 ? pct : null
  }, [rangeStart, totalDays])

  // One shared x-geometry map (rather than recomputing inline per row) since
  // the connector-line overlay below needs the same left/right values the
  // rows themselves use for their bars.
  const geometryById = useMemo(() => {
    const map = new Map<string, { leftPct: number; rightPct: number }>()
    activities.forEach(a => {
      const geo = xGeometryPct(a.start, a.finish, a.activity_type === 'milestone', rangeStart, totalDays)
      if (geo) map.set(a.id, geo)
    })
    return map
  }, [activities, rangeStart, totalDays])
  const criticalById = useMemo(() => new Map(activities.map(a => [a.id, a.is_critical === true])), [activities])

  // Connector-line Y endpoints are computed analytically (index * row-height),
  // not measured off the real DOM — same principle the on-screen GanttChart
  // already uses for its own bar geometry (see GanttChart.tsx's `top = i *
  // GANTT_ROW_HEIGHT`). Every row has an explicit, deterministic pixel height
  // (GANTT_ROW_HEIGHT / HEADER_HEIGHT are inline styles, not measured), so
  // its vertical position is known the instant the row order is known.
  const rowIndexById = useMemo(() => new Map(activities.map((a, i) => [a.id, i])), [activities])

  return (
    <div className="print-only p-8">
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={letterheadTokens} />}
      <p className="text-sm text-gray-500 mb-3">
        {activities.length} activit{activities.length === 1 ? 'y' : 'ies'} (as shown, respecting search/filters/columns)
      </p>

      <div className="relative">
        {/* Connector lines overlay — sits directly above the <table> (not the
            outer letterhead+count wrapper), so its origin lines up with the
            table's own top-left with no extra offset to account for. Each
            segment is its own positioned <div> (x in % of the table width,
            y in real pixels) — see elbowSegments and the file-level comment
            for why this can't be pixel-measured or drawn as one SVG path. */}
        {relationships.map(r => {
          const predIndex = rowIndexById.get(r.predecessor_id)
          const succIndex = rowIndexById.get(r.successor_id)
          const predGeo = geometryById.get(r.predecessor_id)
          const succGeo = geometryById.get(r.successor_id)
          if (predIndex === undefined || succIndex === undefined || !predGeo || !succGeo) return null
          const predCenterY = HEADER_HEIGHT + predIndex * GANTT_ROW_HEIGHT + BAR_CENTER_Y
          const succCenterY = HEADER_HEIGHT + succIndex * GANTT_ROW_HEIGHT + BAR_CENTER_Y
          const x1Pct = toTableXPct(r.relationship_type === 'SS' || r.relationship_type === 'SF' ? predGeo.leftPct : predGeo.rightPct)
          const x2Pct = toTableXPct(r.relationship_type === 'FF' || r.relationship_type === 'SF' ? succGeo.rightPct : succGeo.leftPct)
          const critical = criticalById.get(r.predecessor_id) && criticalById.get(r.successor_id)
          const color = critical ? ganttStyle.critical_color : '#94a3b8'
          return elbowSegments(x1Pct, predCenterY, x2Pct, succCenterY).map((seg, i) => seg.kind === 'h' ? (
            // left/width via CSS min()/max() rather than Math.min/abs — seg.x1
            // and seg.x2 can be calc() strings (a fixed-pixel stub applied to
            // a percentage base), so which one is actually smaller can only
            // be resolved by the browser at layout time, not by JS.
            <div
              key={`${r.id}-${i}`} className="absolute pointer-events-none"
              style={{
                left: `min(${seg.x1}, ${seg.x2})`, width: `calc(max(${seg.x1}, ${seg.x2}) - min(${seg.x1}, ${seg.x2}))`,
                top: seg.y, height: 1, backgroundColor: color,
              }}
            />
          ) : (
            <div
              key={`${r.id}-${i}`} className="absolute pointer-events-none"
              style={{ left: seg.x, top: seg.yStart, height: Math.max(seg.yEnd - seg.yStart, 1), width: 1, backgroundColor: color }}
            />
          ))
        })}

      <table
        className="text-[9px] border-collapse w-full"
        style={{ tableLayout: 'fixed', color: ganttStyle.table_font_color, fontFamily: FONT_FAMILY_CSS[ganttStyle.table_font_family] }}
      >
        <colgroup>
          {columnsBeforeActivity.map(c => (
            <col key={c.key} style={{ width: `${((columnWidths[c.key] ?? 96) / totalDataWidth) * DATA_PCT}%` }} />
          ))}
          <col style={{ width: `${(activityWidth / totalDataWidth) * DATA_PCT}%` }} />
          {columnsAfterActivity.map(c => (
            <col key={c.key} style={{ width: `${((columnWidths[c.key] ?? 96) / totalDataWidth) * DATA_PCT}%` }} />
          ))}
          <col />
        </colgroup>
        <thead>
          {/* Same look as the viewport's header row (Scheduling.tsx) — grey
              fill, muted grey uppercase text. Being a real <thead>, this
              repeats on every printed page automatically. */}
          <tr className="text-left bg-gray-50 border-b border-gray-300 text-gray-500 font-medium uppercase tracking-wide" style={{ height: HEADER_HEIGHT }}>
            {columnsBeforeActivity.map(c => (
              <th key={c.key} className={`px-1 py-1 border-r border-gray-300 ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
            ))}
            <th className="px-1 py-1 border-r border-gray-300">Activity</th>
            {columnsAfterActivity.map(c => (
              <th key={c.key} className={`px-1 py-1 border-r border-gray-300 ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
            ))}
            <th className="p-0 relative" style={{ overflow: 'hidden' }}>
              {/* overflow:hidden here (the body row's gantt <td> already had it,
                  this one didn't) — without it, a time-mark label spills
                  leftward into the data columns' own headers instead of just
                  looking odd within its own column (2026-07-05, per Maro:
                  "Q2 2026"/"Q3 2026" showing up overlapping BL Finish/Fin.
                  Var (D)). */}
              <div className="relative" style={{ width: '100%', height: HEADER_HEIGHT }}>
                {timeMarks.map(m => (
                  <div
                    key={m.offset}
                    className="absolute top-0 border-l border-gray-200 pl-1 text-[8px] text-gray-400"
                    style={{ left: `${(m.offset / totalDays) * 100}%`, height: HEADER_HEIGHT, lineHeight: `${HEADER_HEIGHT}px` }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {activities.map((a, rowIndex) => {
            const isMilestone = a.activity_type === 'milestone'
            const isWbs = a.activity_type === 'wbs_summary'
            const geo = xGeometryPct(a.start, a.finish, isMilestone, rangeStart, totalDays)
            const critical = a.is_critical === true
            return (
              <tr
                key={a.id}
                style={{
                  height: GANTT_ROW_HEIGHT, pageBreakInside: 'avoid', backgroundColor: rowBackground(a, ganttStyle),
                  // box-shadow instead of border-bottom — a real per-row border
                  // can add a hair of extra height in some browsers' table
                  // border-collapse handling, which accumulates over many rows
                  // into the table drifting taller than intended.
                  boxShadow: rowIndex === activities.length - 1 ? undefined : 'inset 0 -1px 0 #e5e7eb',
                }}
              >
                {columnsBeforeActivity.map(c => (
                  <td key={c.key} className={`px-1 py-0.5 border-r border-gray-300 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${c.cellClassName?.(a) ?? NORMAL_GREY}`}>
                    {c.render(a, resourceAssignments)}
                  </td>
                ))}
                <td
                  className="px-1 py-0.5 border-r border-gray-300 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-gray-900"
                  style={{ paddingLeft: 4 + depthOf(a) * 10 }}
                  title={a.task_name}
                >
                  {a.task_name}
                  {(a.is_archived || a.is_archive_container) && (
                    <span className="ml-1 text-[7px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-200 rounded px-1">
                      Archived
                    </span>
                  )}
                </td>
                {columnsAfterActivity.map(c => (
                  <td key={c.key} className={`px-1 py-0.5 border-r border-gray-300 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${c.cellClassName?.(a) ?? NORMAL_GREY}`}>
                    {c.render(a, resourceAssignments)}
                  </td>
                ))}
                <td className="p-0 relative" style={{ overflow: 'hidden', height: GANTT_ROW_HEIGHT }}>
                  {/* Explicit pixel height, not height:100% — percentage heights
                      inside a <td> are unreliable across print rendering engines
                      (2026-07-05, per Maro: bars ended up clipped/shifted toward
                      one edge instead of centered after switching to %). A fixed
                      number matching the <tr>'s own explicit height removes the
                      ambiguity entirely. */}
                  <div className="relative" style={{ width: '100%', height: GANTT_ROW_HEIGHT }}>
                    {todayOffsetPct !== null && (
                      <div className="absolute inset-y-0 border-l-[1.5px] border-dashed" style={{ left: `${todayOffsetPct}%`, borderColor: '#f59e0b' }} />
                    )}
                    {geo && isMilestone && (() => {
                      const color = critical ? ganttStyle.milestone_critical_color : ganttStyle.milestone_noncritical_color
                      return (
                        <div
                          className="absolute rotate-45 border"
                          style={{
                            top: BAR_CENTER_Y - MILESTONE_SIZE / 2, left: `calc(${geo.leftPct}% - ${MILESTONE_SIZE / 2}px)`,
                            width: MILESTONE_SIZE, height: MILESTONE_SIZE,
                            backgroundColor: color, borderColor: withAlpha(color, 0.7),
                          }}
                        />
                      )
                    })()}
                    {geo && isWbs && (() => {
                      // Plain CSS bracket (top border + two fixed-size end
                      // ticks) instead of GanttChart.tsx's WbsSummaryBar — that
                      // component sizes its cap shape from a real pixel width
                      // (`w = right - left`), which print no longer has (see
                      // the file-level comment on why pixel geometry isn't
                      // available here). Ticks are fixed-size regardless of
                      // the bar's own percentage width, so this still reads as
                      // a summary "bracket" at any zoom/scale.
                      const color = wbsLevelColor(ganttStyle, depthOf(a))
                      const barTop = BAR_CENTER_Y - 6
                      return (
                        <div className="absolute" style={{ left: `${geo.leftPct}%`, width: `${Math.max(geo.rightPct - geo.leftPct, 0.3)}%`, top: barTop, height: 8 }}>
                          <div className="absolute inset-x-0" style={{ top: 6, borderTop: `2px solid ${color}` }} />
                          <div className="absolute" style={{ left: 0, top: 0, width: 2, height: 8, backgroundColor: color }} />
                          <div className="absolute" style={{ right: 0, top: 0, width: 2, height: 8, backgroundColor: color }} />
                        </div>
                      )
                    })()}
                    {geo && !isMilestone && !isWbs && (() => {
                      const pct = a.pct_complete ? Math.min(Number(a.pct_complete), 100) : 0
                      const color = critical ? ganttStyle.critical_color : ganttStyle.non_critical_color
                      return (
                        <div
                          className="absolute overflow-hidden rounded border"
                          style={{
                            top: BAR_ZONE_TOP, left: `${geo.leftPct}%`, width: `${geo.rightPct - geo.leftPct}%`, minWidth: 4, height: BAR_ZONE_HEIGHT,
                            backgroundColor: withAlpha(color, 0.25), borderColor: color,
                          }}
                        >
                          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      )
                    })()}
                  </div>
                </td>
              </tr>
            )
          })}
          {activities.length === 0 && (
            <tr><td colSpan={columns.length + 2} className="py-4 text-center text-gray-400">No activities to show.</td></tr>
          )}
        </tbody>
      </table>
      </div>
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={letterheadTokens} ganttLegend ganttStyle={ganttStyle} />}
    </div>
  )
}
