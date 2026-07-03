import { useEffect, useRef, useState } from 'react'
import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import { DEFAULT_GANTT_STYLE, FONT_FAMILY_CSS, wbsRowBackground, withAlpha, type GanttStyle } from '@/lib/ganttLayout'
import type { ProjectLetterhead } from '@/lib/letterhead'
import { formatDateTime } from './dateTime'
import { GANTT_ROW_HEIGHT, GanttChart, HEADER_HEIGHT } from './GanttChart'
import type { GanttZoom } from './ganttZoom'
import { formatMoney, formatRatio, type ColumnKey } from './Scheduling'
import type { Activity, ActivityRelationship, ResourceAssignment } from './types'

interface Props {
  activities: Activity[]
  relationships: ActivityRelationship[]
  resourceAssignments: ResourceAssignment[]
  visibleColumns: Set<ColumnKey>
  projectName: string
  letterhead: ProjectLetterhead | null
  ganttStyle?: GanttStyle
  ganttZoom?: GanttZoom
}

function depthOf(a: Activity): number {
  return a.wbs_path ? a.wbs_path.split('.').length - 1 : 0
}

// Same priority order as Scheduling.tsx's rowBackground: critical, then WBS
// summary (shaded by nesting level), then milestone, else the flat "normal
// activity" tint — kept in sync so the printed table matches the viewport.
function rowBackground(a: Activity, style: GanttStyle): string | undefined {
  if (a.is_critical) return withAlpha(style.critical_color, 0.12)
  if (a.activity_type === 'wbs_summary') return wbsRowBackground(style, depthOf(a))
  if (a.activity_type === 'milestone') return withAlpha(style.milestone_row_color, 0.15)
  return style.activity_row_color === '#ffffff' ? undefined : withAlpha(style.activity_row_color, 1)
}

// Renders exactly whichever columns are currently toggled visible in the
// interactive table (Scheduling.tsx's "☰ Columns" menu) — printing used to
// always show a fixed 7-column subset regardless of what was actually shown
// on screen, per Maro's report. weight is a relative width hint, not a fixed
// pixel/percentage value: only the columns actually printed get included in
// the normalisation below, so the table always fills its available width
// however many (or few) columns are visible.
interface PrintColumnDef {
  key: ColumnKey
  label: string
  weight: number
  align?: 'right'
  render: (a: Activity, resourceAssignments: ResourceAssignment[]) => string
}

const PRINT_COLUMNS: PrintColumnDef[] = [
  { key: 'code', label: 'Code', weight: 8, render: a => a.code },
  { key: 'wbs', label: 'WBS', weight: 6, render: a => a.wbs_path ?? '—' },
  { key: 'type', label: 'Type', weight: 8, render: a => a.activity_type.replace('_', ' ') },
  { key: 'duration', label: 'Dur', weight: 6, align: 'right', render: a => String(a.duration_days ?? '—') },
  { key: 'start', label: 'Start', weight: 11, render: a => formatDateTime(a.start) },
  { key: 'bl_start', label: 'BL Start', weight: 11, render: a => formatDateTime(a.bl_start) },
  { key: 'finish', label: 'Finish', weight: 11, render: a => formatDateTime(a.finish) },
  { key: 'bl_finish', label: 'BL Finish', weight: 11, render: a => formatDateTime(a.bl_finish) },
  { key: 'variance', label: 'Var (d)', weight: 7, align: 'right', render: a => String(a.variance_days ?? '—') },
  { key: 'float', label: 'Float', weight: 8, align: 'right', render: a => a.total_float_hours != null ? String(a.total_float_hours) : '—' },
  { key: 'free_float', label: 'Free Float', weight: 8, align: 'right', render: a => a.free_float_hours != null ? String(a.free_float_hours) : '—' },
  { key: 'pct_complete', label: '%', weight: 6, align: 'right', render: a => String(a.pct_complete ?? 0) },
  {
    key: 'resources', label: 'Resources', weight: 12,
    render: (a, resourceAssignments) => resourceAssignments.filter(ra => ra.activity_id === a.id).map(ra => ra.resource_name).join(', ') || '—',
  },
  { key: 'bac', label: 'BAC', weight: 8, align: 'right', render: a => formatMoney(a.bac) },
  { key: 'pv', label: 'PV', weight: 8, align: 'right', render: a => formatMoney(a.pv) },
  { key: 'ev', label: 'EV', weight: 8, align: 'right', render: a => formatMoney(a.ev) },
  { key: 'ac', label: 'AC', weight: 8, align: 'right', render: a => formatMoney(a.ac) },
  { key: 'cv', label: 'CV', weight: 8, align: 'right', render: a => formatMoney(a.cv) },
  { key: 'sv', label: 'SV', weight: 8, align: 'right', render: a => formatMoney(a.sv) },
  { key: 'cpi', label: 'CPI', weight: 6, align: 'right', render: a => formatRatio(a.cpi) },
  { key: 'spi', label: 'SPI', weight: 6, align: 'right', render: a => formatRatio(a.spi) },
  { key: 'eac', label: 'EAC', weight: 8, align: 'right', render: a => formatMoney(a.eac) },
  { key: 'etc', label: 'ETC', weight: 8, align: 'right', render: a => formatMoney(a.etc) },
]

// A dedicated printable rendering, shown only via @media print (see index.css
// .print-only) — same pattern as Risk/ICD/Cost Plan's own PrintView components.
// The on-screen table lives in a fixed-height scrollable pane (so the split view
// with the Gantt works), which browsers don't paginate for print — anything past
// the visible scroll position was silently cut off. This renders in normal
// document flow instead, so the browser can paginate it properly across pages.
// Table and Gantt sit side by side (mirroring the on-screen split view) so both
// land on the same printed page instead of the Gantt spilling onto a second one.
export function SchedulingPrintView({
  activities, relationships, resourceAssignments, visibleColumns, projectName, letterhead, ganttStyle = DEFAULT_GANTT_STYLE, ganttZoom = 'week',
}: Props) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const letterheadTokens = {
    project: projectName, module: 'Schedule',
    count: `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`,
    printed_at: printedAt,
  }

  const columns = PRINT_COLUMNS.filter(c => visibleColumns.has(c.key))
  const totalWeight = columns.reduce((sum, c) => sum + c.weight, 0) || 1

  // The Gantt's natural pixel width (14px/day) routinely exceeds the space
  // available beside the table, and browsers don't auto-shrink overflowing print
  // content — it just gets clipped at the page edge. Measuring and applying a
  // scale-to-fit transform avoids that. The .print-only ancestor is display:none
  // outside of printing, so layout dimensions aren't available until the browser
  // is about to print — 'beforeprint' fires synchronously just before that
  // happens, which is when the real measurement needs to happen.
  //
  // The scale is computed here (not inside a separate Gantt-only subcomponent)
  // because the table's own row heights need it too — the interactive viewport
  // keeps the grid and Gantt aligned with a shared fixed row height (see
  // GANTT_ROW_HEIGHT in Scheduling.tsx/GanttChart.tsx); the print table used a
  // different, unrelated row height, so rows drifted out of alignment with the
  // scaled-down Gantt bars next to them. Setting each printed row's height to
  // GANTT_ROW_HEIGHT * scale keeps the two grids row-for-row aligned here too.
  const ganttContainerRef = useRef<HTMLDivElement>(null)
  const ganttInnerRef = useRef<HTMLDivElement>(null)
  const [ganttDims, setGanttDims] = useState<{ scale: number; height: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const container = ganttContainerRef.current
      const inner = ganttInnerRef.current
      if (!container || !inner) return
      const naturalWidth = inner.scrollWidth
      const naturalHeight = inner.scrollHeight
      const availableWidth = container.clientWidth
      if (!naturalWidth || !availableWidth) return
      const scale = naturalWidth > availableWidth ? availableWidth / naturalWidth : 1
      setGanttDims({ scale, height: naturalHeight * scale })
    }
    measure()
    window.addEventListener('beforeprint', measure)
    return () => window.removeEventListener('beforeprint', measure)
  }, [activities, relationships])

  const scale = ganttDims?.scale ?? 1

  return (
    <div className="print-only p-8">
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={letterheadTokens} />}
      <p className="text-sm text-gray-500 mb-3">
        {activities.length} activit{activities.length === 1 ? 'y' : 'ies'} (as shown, respecting search/filters/columns)
      </p>

      <div className="flex gap-3 items-start">
        <table
          className="text-[9px] border-collapse"
          style={{ tableLayout: 'fixed', width: '42%', color: ganttStyle.table_font_color, fontFamily: FONT_FAMILY_CSS[ganttStyle.table_font_family] }}
        >
          <colgroup>
            <col style={{ width: '20%' }} />
            {columns.map(c => <col key={c.key} style={{ width: `${(c.weight / totalWeight) * 80}%` }} />)}
          </colgroup>
          <thead>
            <tr className="text-left border-b-2 border-gray-400" style={{ height: HEADER_HEIGHT * scale }}>
              <th className="py-1 pr-1">Activity</th>
              {columns.map(c => (
                <th key={c.key} className={`py-1 pr-1 ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activities.map(a => (
              <tr
                key={a.id} className="border-b border-gray-200"
                style={{ height: GANTT_ROW_HEIGHT * scale, pageBreakInside: 'avoid', backgroundColor: rowBackground(a, ganttStyle) }}
              >
                <td
                  className="py-0.5 pr-1 overflow-hidden text-ellipsis whitespace-nowrap"
                  style={{ paddingLeft: depthOf(a) * 6 }}
                  title={a.task_name}
                >
                  {a.task_name}
                </td>
                {columns.map(c => (
                  <td key={c.key} className={`py-0.5 pr-1 overflow-hidden text-ellipsis whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}>
                    {c.render(a, resourceAssignments)}
                  </td>
                ))}
              </tr>
            ))}
            {activities.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="py-4 text-center text-gray-400">No activities to show.</td></tr>
            )}
          </tbody>
        </table>

        {activities.length > 0 && (
          <div style={{ width: '58%' }}>
            <div ref={ganttContainerRef} style={{ width: '100%', overflow: 'hidden', height: ganttDims?.height }}>
              <div ref={ganttInnerRef} style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: 'fit-content' }}>
                <GanttChart activities={activities} relationships={relationships} style={ganttStyle} zoom={ganttZoom} />
              </div>
            </div>
          </div>
        )}
      </div>
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={letterheadTokens} ganttLegend ganttStyle={ganttStyle} />}
    </div>
  )
}
