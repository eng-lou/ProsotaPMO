import { useEffect, useMemo, useRef, useState } from 'react'
import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import { DEFAULT_GANTT_STYLE, FONT_FAMILY_CSS, wbsLevelColor, wbsRowBackground, withAlpha, type GanttStyle } from '@/lib/ganttLayout'
import type { ProjectLetterhead } from '@/lib/letterhead'
import { formatDateTime } from './dateTime'
import { GANTT_ROW_HEIGHT, HEADER_HEIGHT, WbsSummaryBar } from './GanttChart'
import { computeTimeMarks, type GanttZoom } from './ganttZoom'
import { formatMoney, formatRatio, type ColumnKey } from './Scheduling'
import type { Activity, ActivityRelationship, ResourceAssignment } from './types'

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
// rather than imported since GanttChart doesn't export it, and print needs
// its own dayWidth solved from a *measured* column width (see dayWidth below),
// not GanttChart's own zoom-driven constant.
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

function xGeometry(start: string | null, finish: string | null, isMilestone: boolean, rangeStart: Date, dayWidth: number) {
  const s = parseDate(start)
  const f = parseDate(finish)
  if (isMilestone) {
    const at = s ?? f
    if (!at) return null
    const x = daysBetween(rangeStart, at) * dayWidth
    return { left: x, right: x }
  }
  if (!s || !f) return null
  const left = daysBetween(rangeStart, s) * dayWidth
  const right = left + Math.max(daysBetween(s, f) * dayWidth, 4)
  return { left, right }
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
// The Gantt is now an EXTRA COLUMN of the SAME <table> as the data columns,
// not a separate scaled-down block sitting beside it (2026-07-05, per Maro:
// a milestone's bar landed on page 1 while its own table row printed as the
// first row of page 2, and the Gantt's time-mark header didn't repeat on
// each page the way the table's <thead> does). Browsers paginate real
// <table>s row-by-row and automatically repeat <thead> on every printed
// page — that's exactly the behavior the data columns already got for free,
// and the previous separate Gantt div had no equivalent, so the two sides
// paginated independently and drifted apart. Making the bars real <td>s in
// the same <tr>s means there is only one thing being paginated.
// Trade-off: baseline ghost bars and predecessor/successor connector lines
// aren't rendered in print (both would need a cross-row overlay, which is
// exactly the kind of second coordinate space that doesn't survive
// pagination) — a deliberate scope cut, not an oversight.
export function SchedulingPrintView({
  activities, resourceAssignments, visibleColumns, columnWidths, projectName, letterhead, ganttStyle = DEFAULT_GANTT_STYLE, ganttZoom = 'week',
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

  // The Gantt column's dayWidth is *solved for*, not scaled after the fact —
  // measure how much real print width the column actually has, then divide
  // the full date range into exactly that, so the whole project fits across
  // one page width without a separate scale-then-transform step.
  const ganttColRef = useRef<HTMLTableCellElement>(null)
  const [ganttColWidth, setGanttColWidth] = useState<number | null>(null)
  useEffect(() => {
    const measure = () => {
      if (ganttColRef.current) setGanttColWidth(ganttColRef.current.clientWidth)
    }
    measure()
    window.addEventListener('beforeprint', measure)
    return () => window.removeEventListener('beforeprint', measure)
  }, [activities])

  const { rangeStart, totalDays } = useMemo(() => computeGanttRange(activities), [activities])
  const dayWidth = ganttColWidth ? ganttColWidth / totalDays : 1
  const timeMarks = useMemo(() => computeTimeMarks(rangeStart, totalDays, ganttZoom), [rangeStart, totalDays, ganttZoom])
  const todayOffset = useMemo(() => {
    const offset = daysBetween(rangeStart, new Date()) * dayWidth
    return ganttColWidth !== null && offset >= 0 && offset <= ganttColWidth ? offset : null
  }, [rangeStart, dayWidth, ganttColWidth])

  return (
    <div className="print-only p-8">
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={letterheadTokens} />}
      <p className="text-sm text-gray-500 mb-3">
        {activities.length} activit{activities.length === 1 ? 'y' : 'ies'} (as shown, respecting search/filters/columns)
      </p>

      <table
        className="text-[9px] border-collapse w-full"
        style={{ tableLayout: 'fixed', color: ganttStyle.table_font_color, fontFamily: FONT_FAMILY_CSS[ganttStyle.table_font_family] }}
      >
        <colgroup>
          {columnsBeforeActivity.map(c => (
            <col key={c.key} style={{ width: `${((columnWidths[c.key] ?? 96) / totalDataWidth) * 42}%` }} />
          ))}
          <col style={{ width: `${(activityWidth / totalDataWidth) * 42}%` }} />
          {columnsAfterActivity.map(c => (
            <col key={c.key} style={{ width: `${((columnWidths[c.key] ?? 96) / totalDataWidth) * 42}%` }} />
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
            <th ref={ganttColRef} className="p-0 relative">
              <div className="relative" style={{ width: '100%', height: HEADER_HEIGHT }}>
                {timeMarks.map(m => (
                  <div
                    key={m.offset}
                    className="absolute top-0 border-l border-gray-200 pl-1 text-[8px] text-gray-400"
                    style={{ left: m.offset * dayWidth, height: HEADER_HEIGHT, lineHeight: `${HEADER_HEIGHT}px` }}
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
            const geo = xGeometry(a.start, a.finish, isMilestone, rangeStart, dayWidth)
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
                    {todayOffset !== null && (
                      <div className="absolute inset-y-0 border-l-[1.5px] border-dashed" style={{ left: todayOffset, borderColor: '#f59e0b' }} />
                    )}
                    {geo && isMilestone && (() => {
                      const color = critical ? ganttStyle.milestone_critical_color : ganttStyle.milestone_noncritical_color
                      return (
                        <div
                          className="absolute rotate-45 border"
                          style={{
                            top: BAR_CENTER_Y - MILESTONE_SIZE / 2, left: geo.left - MILESTONE_SIZE / 2,
                            width: MILESTONE_SIZE, height: MILESTONE_SIZE,
                            backgroundColor: color, borderColor: withAlpha(color, 0.7),
                          }}
                        />
                      )
                    })()}
                    {geo && isWbs && (
                      <WbsSummaryBar left={geo.left} right={geo.right} top={0} centerY={BAR_CENTER_Y} color={wbsLevelColor(ganttStyle, depthOf(a))} />
                    )}
                    {geo && !isMilestone && !isWbs && (() => {
                      const pct = a.pct_complete ? Math.min(Number(a.pct_complete), 100) : 0
                      const color = critical ? ganttStyle.critical_color : ganttStyle.non_critical_color
                      return (
                        <div
                          className="absolute overflow-hidden rounded border"
                          style={{
                            top: BAR_ZONE_TOP, left: geo.left, width: geo.right - geo.left, height: BAR_ZONE_HEIGHT,
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
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={letterheadTokens} ganttLegend ganttStyle={ganttStyle} />}
    </div>
  )
}
