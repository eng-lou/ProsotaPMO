import { useEffect, useRef, useState } from 'react'
import { formatDateTime } from './dateTime'
import { GanttChart } from './GanttChart'
import type { Activity, ActivityRelationship } from './types'

interface Props {
  activities: Activity[]
  relationships: ActivityRelationship[]
  projectName: string
}

// Column widths as percentages of the (narrowed, side-by-side) print table —
// table-fixed + colgroup so columns actually respect these instead of the
// browser auto-sizing them to fit each cell's longest content, which is what
// was pushing the table wide enough to crowd out the Gantt on the same page.
const PRINT_COL_WIDTHS: Record<string, number> = {
  code: 11, activity: 27, dur: 7, start: 15, finish: 15, float: 9, pct: 8,
}

// The Gantt's natural pixel width (14px/day) routinely exceeds the space
// available beside the table, and browsers don't auto-shrink overflowing print
// content — it just gets clipped at the page edge. Measuring and applying a
// scale-to-fit transform avoids that. The .print-only ancestor is display:none
// outside of printing, so layout dimensions aren't available until the browser
// is about to print — 'beforeprint' fires synchronously just before that
// happens, which is when the real measurement needs to happen.
function ScaledGantt({ activities, relationships }: { activities: Activity[]; relationships: ActivityRelationship[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<{ scale: number; height: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const container = containerRef.current
      const inner = innerRef.current
      if (!container || !inner) return
      const naturalWidth = inner.scrollWidth
      const naturalHeight = inner.scrollHeight
      const availableWidth = container.clientWidth
      if (!naturalWidth || !availableWidth) return
      const scale = naturalWidth > availableWidth ? availableWidth / naturalWidth : 1
      setDims({ scale, height: naturalHeight * scale })
    }
    measure()
    window.addEventListener('beforeprint', measure)
    return () => window.removeEventListener('beforeprint', measure)
  }, [activities, relationships])

  return (
    <div ref={containerRef} style={{ width: '100%', overflow: 'hidden', height: dims?.height }}>
      <div ref={innerRef} style={{ transform: `scale(${dims?.scale ?? 1})`, transformOrigin: 'top left', width: 'fit-content' }}>
        <GanttChart activities={activities} relationships={relationships} />
      </div>
    </div>
  )
}

// A dedicated printable rendering, shown only via @media print (see index.css
// .print-only) — same pattern as Risk/ICD/Cost Plan's own PrintView components.
// The on-screen table lives in a fixed-height scrollable pane (so the split view
// with the Gantt works), which browsers don't paginate for print — anything past
// the visible scroll position was silently cut off. This renders in normal
// document flow instead, so the browser can paginate it properly across pages.
// Table and Gantt sit side by side (mirroring the on-screen split view) so both
// land on the same printed page instead of the Gantt spilling onto a second one.
export function SchedulingPrintView({ activities, relationships, projectName }: Props) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="print-only p-8">
      <div className="mb-4 flex items-baseline justify-between border-b border-gray-300 pb-3">
        <div>
          <h1 className="text-xl font-bold">{projectName} — Schedule</h1>
          <p className="text-sm text-gray-500">{activities.length} activit{activities.length === 1 ? 'y' : 'ies'} (as shown, respecting search/filters)</p>
        </div>
        <p className="text-xs text-gray-400">Printed {printedAt}</p>
      </div>

      <div className="flex gap-3 items-start">
        <table className="text-[9px] border-collapse" style={{ tableLayout: 'fixed', width: '42%' }}>
          <colgroup>
            <col style={{ width: `${PRINT_COL_WIDTHS.code}%` }} />
            <col style={{ width: `${PRINT_COL_WIDTHS.activity}%` }} />
            <col style={{ width: `${PRINT_COL_WIDTHS.dur}%` }} />
            <col style={{ width: `${PRINT_COL_WIDTHS.start}%` }} />
            <col style={{ width: `${PRINT_COL_WIDTHS.finish}%` }} />
            <col style={{ width: `${PRINT_COL_WIDTHS.float}%` }} />
            <col style={{ width: `${PRINT_COL_WIDTHS.pct}%` }} />
          </colgroup>
          <thead>
            <tr className="text-left border-b-2 border-gray-400">
              <th className="py-1 pr-1">Code</th>
              <th className="py-1 pr-1">Activity</th>
              <th className="py-1 pr-1 text-right">Dur</th>
              <th className="py-1 pr-1">Start</th>
              <th className="py-1 pr-1">Finish</th>
              <th className="py-1 pr-1 text-right">Float</th>
              <th className="py-1 pr-1 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {activities.map(a => (
              <tr key={a.id} className="border-b border-gray-200" style={{ pageBreakInside: 'avoid' }}>
                <td className="py-0.5 pr-1 font-mono overflow-hidden text-ellipsis whitespace-nowrap">{a.code}</td>
                <td
                  className="py-0.5 pr-1 overflow-hidden text-ellipsis whitespace-nowrap"
                  style={{ paddingLeft: (a.wbs_path ? a.wbs_path.split('.').length - 1 : 0) * 6 }}
                  title={a.task_name}
                >
                  {a.activity_type === 'wbs_summary' && '📦 '}{a.task_name}
                </td>
                <td className="py-0.5 pr-1 text-right">{a.duration_days ?? '—'}</td>
                <td className="py-0.5 pr-1 whitespace-nowrap overflow-hidden text-ellipsis">{formatDateTime(a.start)}</td>
                <td className="py-0.5 pr-1 whitespace-nowrap overflow-hidden text-ellipsis">{formatDateTime(a.finish)}</td>
                <td className="py-0.5 pr-1 text-right">{a.total_float_hours ?? '—'}</td>
                <td className="py-0.5 pr-1 text-right">{a.pct_complete ?? 0}</td>
              </tr>
            ))}
            {activities.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center text-gray-400">No activities to show.</td></tr>
            )}
          </tbody>
        </table>

        {activities.length > 0 && (
          <div style={{ width: '58%' }}>
            <ScaledGantt activities={activities} relationships={relationships} />
          </div>
        )}
      </div>
    </div>
  )
}
