import { useEffect, useMemo, useRef } from 'react'
import { GanttComponent } from '@syncfusion/ej2-react-gantt'
import type { GanttModel } from '@syncfusion/ej2-gantt'
import { GANTT_ROW_HEIGHT } from './GanttChart'
import type { Activity, ActivityRelationship } from './types'

// The interactive on-screen Gantt only — SchedulingPrintView.tsx keeps using the
// custom SVG GanttChart (./GanttChart.tsx) for print, since that component's
// "shrink to fit the printed page" pass is print-specific and unrelated to this
// swap; Syncfusion's Gantt is a live editable widget, not a print-layout engine.

interface GanttRow {
  ganttId: number
  parentGanttId: number | null
  taskName: string
  startDate: Date | null
  endDate: Date | null
  baselineStartDate: Date | null
  baselineEndDate: Date | null
  progress: number
  isMilestone: boolean
  predecessor: string
  cssClass: string
  // See buildRows: Syncfusion only renders the full taskbar (fill + progress
  // split + our cssClass) when startDate, endDate AND duration are all present
  // (ej2-gantt's chart-rows.js getChildTaskbarNode gates on all three) — without
  // it, rows fall back to a bare, unstyled "unscheduled" bar. Since
  // autoCalculateDateScheduling is off, Syncfusion won't derive this itself.
  duration: number
  durationUnit: 'day'
}

function toGanttDate(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function daysBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0
  return Math.max(0, (end.getTime() - start.getTime()) / 86_400_000)
}

// ProsotaPMO navy/teal applied via per-row cssClass (see .prosota-gantt rules in
// index.css) rather than Syncfusion's queryTaskbarInfo event — declarative and
// keeps the colour decision (is_critical, computed by our own CPM engine) as
// plain row data instead of an imperative per-render callback.
function rowCssClass(a: Activity): string {
  const parts = [a.is_critical ? 'gantt-critical' : 'gantt-normal']
  if (a.activity_type === 'milestone') parts.push('gantt-milestone')
  return parts.join(' ')
}

// Syncfusion's Predecessor string format ("2FS+4h") needs short, stable ids
// matching taskFields.id. Our own UUIDs hit an edge case in Syncfusion's
// GUID-parsing branch (ej2-gantt's dependency.js processElementFormat expects a
// bare 36-char GUID immediately followed by the relationship type, which our
// "uuidFS+4h" tokens don't reliably satisfy) — so activities get a simple
// sequential id scoped to this component instead; the real UUID never leaves it.
function buildRows(activities: Activity[], relationships: ActivityRelationship[]): GanttRow[] {
  const ganttIdByActivityId = new Map<string, number>()
  activities.forEach((a, i) => ganttIdByActivityId.set(a.id, i + 1))

  const predecessorsByActivityId = new Map<string, string[]>()
  relationships.forEach(r => {
    const fromId = ganttIdByActivityId.get(r.predecessor_id)
    if (fromId === undefined || !ganttIdByActivityId.has(r.successor_id)) return
    const lag = r.lag_hours === 0 ? '' : `${r.lag_hours > 0 ? '+' : '-'}${Math.abs(r.lag_hours)}h`
    const list = predecessorsByActivityId.get(r.successor_id) ?? []
    list.push(`${fromId}${r.relationship_type}${lag}`)
    predecessorsByActivityId.set(r.successor_id, list)
  })

  return activities.map(a => {
    const startDate = toGanttDate(a.start)
    const endDate = toGanttDate(a.finish)
    return {
      ganttId: ganttIdByActivityId.get(a.id)!,
      parentGanttId: a.parent_id ? ganttIdByActivityId.get(a.parent_id) ?? null : null,
      taskName: a.task_name,
      startDate,
      endDate,
      baselineStartDate: toGanttDate(a.bl_start),
      baselineEndDate: toGanttDate(a.bl_finish),
      progress: a.pct_complete ? Math.min(Number(a.pct_complete), 100) : 0,
      isMilestone: a.activity_type === 'milestone',
      predecessor: (predecessorsByActivityId.get(a.id) ?? []).join(','),
      cssClass: rowCssClass(a),
      // Calendar-day span between our own already-computed start/finish — not
      // duration_days (net working hours/calendar), since this only needs to
      // agree with the same startDate/endDate pair given above, whatever
      // Syncfusion uses it for internally.
      duration: daysBetween(startDate, endDate),
      durationUnit: 'day' as const,
    }
  })
}

const taskFields: GanttModel['taskFields'] = {
  id: 'ganttId',
  parentID: 'parentGanttId',
  name: 'taskName',
  startDate: 'startDate',
  endDate: 'endDate',
  baselineStartDate: 'baselineStartDate',
  baselineEndDate: 'baselineEndDate',
  duration: 'duration',
  durationUnit: 'durationUnit',
  progress: 'progress',
  milestone: 'isMilestone',
  dependency: 'predecessor',
  cssClass: 'cssClass',
}

const timelineSettings: GanttModel['timelineSettings'] = {
  topTier: { unit: 'Month', format: 'MMM yyyy' },
  bottomTier: { unit: 'Week', format: 'dd MMM' },
}

export function SyncfusionGanttChart({
  activities,
  relationships = [],
  leftPaneRef,
  height,
}: {
  activities: Activity[]
  relationships?: ActivityRelationship[]
  leftPaneRef: React.RefObject<HTMLDivElement>
  height: number
}) {
  const rows = useMemo(() => buildRows(activities, relationships), [activities, relationships])
  // GanttComponent extends the core ej2-gantt Gantt class, so the ref instance
  // carries its internal (undocumented) properties too — see ganttChartModule
  // below. Typed loosely on purpose since those internals aren't in the public
  // .d.ts surface.
  const ganttRef = useRef<GanttComponent | null>(null)

  // The left data grid and the Gantt's own chart pane must stay row-aligned on
  // scroll, same requirement the retired custom GanttChart met via simple sibling
  // divs (Scheduling.tsx's old syncScroll). Syncfusion's Gantt owns its chart
  // pane's scrolling internally with no public scroll event in v33.2.3, so this
  // reaches into ganttChartModule.scrollElement (the real scrollable DOM node)
  // directly rather than wrapping the whole widget in a second scroll container,
  // which would just produce two nested scrollbars.
  useEffect(() => {
    const chartScrollEl = (ganttRef.current as unknown as { ganttChartModule?: { scrollElement?: HTMLElement } } | null)
      ?.ganttChartModule?.scrollElement
    const sourceEl = leftPaneRef.current
    if (!chartScrollEl || !sourceEl) return

    let syncing = false
    const onSourceScroll = () => {
      if (syncing) { syncing = false; return }
      syncing = true
      chartScrollEl.scrollTop = sourceEl.scrollTop
    }
    const onChartScroll = () => {
      if (syncing) { syncing = false; return }
      syncing = true
      sourceEl.scrollTop = chartScrollEl.scrollTop
    }
    sourceEl.addEventListener('scroll', onSourceScroll)
    chartScrollEl.addEventListener('scroll', onChartScroll)
    return () => {
      sourceEl.removeEventListener('scroll', onSourceScroll)
      chartScrollEl.removeEventListener('scroll', onChartScroll)
    }
  }, [leftPaneRef, rows])

  return (
    <div className="prosota-gantt h-full">
      <GanttComponent
        ref={ganttRef}
        dataSource={rows}
        taskFields={taskFields}
        timelineSettings={timelineSettings}
        rowHeight={GANTT_ROW_HEIGHT}
        height={height}
        splitterSettings={{ position: '0%' }}
        gridLines="Both"
        renderBaseline
        readOnly
        allowSelection={false}
        highlightWeekends
        // Our own CPM engine (app/services/scheduling_cpm.py) is the sole source
        // of truth for start/finish/float — Syncfusion must render those dates
        // exactly as given, never recompute or "correct" them against its own
        // working-time/dependency validation. Same "never let two engines
        // disagree" rule this project has already fixed as a bug class in
        // Risk/Cost/Scheduling (computed fields, duplicate % complete, etc.).
        autoCalculateDateScheduling={false}
        enablePredecessorValidation={false}
      />
    </div>
  )
}
