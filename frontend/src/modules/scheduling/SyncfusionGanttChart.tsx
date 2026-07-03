import { useMemo, useRef } from 'react'
import { GanttComponent, Inject, Resize } from '@syncfusion/ej2-react-gantt'
import type { GanttModel } from '@syncfusion/ej2-gantt'
import { formatDateTime } from './dateTime'
import { GANTT_ROW_HEIGHT } from './GanttChart'
import { ACTIVITY_TYPES, type Activity, type ActivityRelationship, type ResourceAssignment } from './types'

// The interactive on-screen Gantt only — SchedulingPrintView.tsx keeps using the
// custom SVG GanttChart (./GanttChart.tsx) for print, since that component's
// "shrink to fit the printed page" pass is print-specific and unrelated to this
// swap; Syncfusion's Gantt is a live editable widget, not a print-layout engine.
//
// This component now owns BOTH panes of the Gantt — its own native grid (no
// longer hidden, per Maro's "use Syncfusion widely, top quality" direction) and
// the chart — as one genuinely unified widget instead of a custom HTML table
// sitting beside a Syncfusion-chart-only pane. Editing stays routed through the
// same inline cell-editing state Scheduling.tsx already owned (readOnly/
// editSettings stay off) rather than Syncfusion's own edit pipeline, so the
// server remains the single source of truth for computed fields exactly as
// before — only the rendering layer changed.

export type ColumnKey =
  | 'code' | 'wbs' | 'type' | 'duration' | 'start' | 'bl_start' | 'finish' | 'bl_finish'
  | 'variance' | 'float' | 'free_float' | 'pct_complete' | 'resources'
  | 'bac' | 'pv' | 'ev' | 'ac' | 'cv' | 'sv' | 'cpi' | 'spi' | 'eac' | 'etc'

export type EditableField = 'task_name' | 'code' | 'duration_hours' | 'pct_complete' | 'activity_type' | 'start' | 'finish'

function formatMoney(value: string | null) {
  if (value === null) return '—'
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString()}` : `£${n.toLocaleString()}`
}

function formatRatio(value: string | null) {
  if (value === null) return '—'
  return Number(value).toFixed(3)
}

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
  // Grid-side fields — the back-reference lets every column template reach the
  // full Activity (and the handlers/edit-state passed into this component)
  // without a second id-based lookup per cell.
  activity: Activity
  isFirstSibling: boolean
  isLastSibling: boolean
  resourcesLabel: string
  // Dedicated placeholder field for the trailing actions column — its content is
  // entirely template-driven, but Syncfusion columns need a real field name to
  // key off (resize events, etc.), and reusing 'ganttId' (the actual id/tree
  // field) for that would be a confusing, fragile double-purpose.
  actionsPlaceholder: ''
}

// Grid column `template` functions don't receive our flat dataSource row
// directly — ej2-gantt wraps every row into its own internal IGanttData record
// (taskData holds "the original data provided in the data source", per
// interface.d.ts; ganttProperties carries its own CPM-computed fields
// alongside) for its dual use as both the grid row and the chart's taskbar
// data. Confirmed via a live crash (Cannot read properties of undefined
// (reading 'id')) — every template needs to unwrap through .taskData first.
// TS still types templates as receiving GanttRow directly for readability;
// this defensively unwraps regardless of which shape actually arrives.
function unwrap(row: GanttRow | { taskData: GanttRow }): GanttRow {
  return 'taskData' in row ? row.taskData : row
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

// ej2-gantt's getChildTaskbarNode only builds the full styled taskbar when
// `duration` is truthy — and in JS, 0 is falsy, so a genuinely zero-duration
// row (start === finish: a task collapsed to a point, e.g. a 100%-complete
// activity whose remaining duration hit 0 — see Activity.duration_pct_complete
// in types.ts) silently falls back to the same bare "unscheduled" template the
// missing-duration bug produced earlier, and disappears. Milestones render via
// a separate code path keyed off isMilestone, not this gate, so they're
// unaffected and genuinely should stay at 0. For everything else, floor to a
// visually-negligible but truthy sliver so the real bar (and our cssClass
// coloring) always renders — this never changes what's shown in our own left-
// hand data grid, only how Syncfusion draws the bar.
const MIN_VISUAL_DURATION_DAYS = 0.25

function visualDuration(days: number, isMilestone: boolean): number {
  return isMilestone ? days : Math.max(days, MIN_VISUAL_DURATION_DAYS)
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

function buildRows(
  activities: Activity[],
  allActivities: Activity[],
  relationships: ActivityRelationship[],
  resourceAssignments: ResourceAssignment[],
): GanttRow[] {
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

  // True siblings from the full (unfiltered) activity list — move up/down and
  // indent talk to the backend's real sibling/outline group regardless of what
  // a search/filter is currently hiding, so a disabled button always matches
  // what the backend will actually do.
  const sortedSiblingsOf = (a: Activity) =>
    allActivities.filter(x => x.parent_id === a.parent_id).sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))

  return activities.map(a => {
    const startDate = toGanttDate(a.start)
    const endDate = toGanttDate(a.finish)
    const isMilestone = a.activity_type === 'milestone'
    const siblings = sortedSiblingsOf(a)
    const assignedNames = resourceAssignments.filter(ra => ra.activity_id === a.id).map(ra => ra.resource_name)
    return {
      ganttId: ganttIdByActivityId.get(a.id)!,
      parentGanttId: a.parent_id ? ganttIdByActivityId.get(a.parent_id) ?? null : null,
      taskName: a.task_name,
      startDate,
      endDate,
      baselineStartDate: toGanttDate(a.bl_start),
      baselineEndDate: toGanttDate(a.bl_finish),
      progress: a.pct_complete ? Math.min(Number(a.pct_complete), 100) : 0,
      isMilestone,
      predecessor: (predecessorsByActivityId.get(a.id) ?? []).join(','),
      cssClass: rowCssClass(a),
      // Calendar-day span between our own already-computed start/finish — not
      // duration_days (net working hours/calendar), since this only needs to
      // agree with the same startDate/endDate pair given above, whatever
      // Syncfusion uses it for internally. Floored via visualDuration so a
      // collapsed (start === finish) task still renders as a real bar.
      duration: visualDuration(daysBetween(startDate, endDate), isMilestone),
      durationUnit: 'day' as const,
      activity: a,
      isFirstSibling: siblings[0]?.id === a.id,
      isLastSibling: siblings[siblings.length - 1]?.id === a.id,
      resourcesLabel: assignedNames.join(', '),
      actionsPlaceholder: '' as const,
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

// timelineViewMode is a flat/simple property (unlike topTier/bottomTier, which
// are nested Complex-in-Complex objects that didn't reliably reach the
// underlying instance as a plain object literal — confirmed by Maro's
// screenshot showing an auto-picked Week/Day header instead of the requested
// Month/Week). ej2-gantt's own auto-derivation (Timeline.processTimelineUnit)
// expands a single mode into a sensible top/bottom tier pair, so this gets
// Month/Week without needing the nested object to survive the prop boundary.
const timelineSettings: GanttModel['timelineSettings'] = {
  timelineViewMode: 'Month',
}

interface EditingCell {
  id: string
  field: EditableField
}

export function SyncfusionGanttChart({
  activities,
  allActivities,
  relationships = [],
  resourceAssignments,
  height,
  visibleColumns,
  columnWidths,
  onColumnResize,
  rowClipboard,
  editingCell,
  editingValue,
  onEditingValueChange,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onActivityClick,
  onActivityDoubleClick,
  onCopyRow,
  onPasteRow,
  onMoveUp,
  onMoveDown,
  onIndent,
  onOutdent,
  onDelete,
}: {
  activities: Activity[]
  allActivities: Activity[]
  relationships?: ActivityRelationship[]
  resourceAssignments: ResourceAssignment[]
  height: number
  visibleColumns: Set<ColumnKey>
  columnWidths: Record<string, number>
  onColumnResize: (key: string, width: number) => void
  rowClipboard: Partial<Activity> | null
  editingCell: EditingCell | null
  editingValue: string
  onEditingValueChange: (value: string) => void
  onStartEdit: (a: Activity, field: EditableField) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onActivityClick: (a: Activity) => void
  onActivityDoubleClick: (a: Activity) => void
  onCopyRow: (a: Activity) => void
  onPasteRow: (a: Activity) => void
  onMoveUp: (a: Activity) => void
  onMoveDown: (a: Activity) => void
  onIndent: (a: Activity) => void
  onOutdent: (a: Activity) => void
  onDelete: (a: Activity) => void
}) {
  const rows = useMemo(
    () => buildRows(activities, allActivities, relationships, resourceAssignments),
    [activities, allActivities, relationships, resourceAssignments],
  )
  // GanttComponent extends the core ej2-gantt Gantt class, so the ref instance
  // carries its internal (undocumented) properties too — see ganttChartModule
  // below. Typed loosely on purpose since those internals aren't in the public
  // .d.ts surface.
  const ganttRef = useRef<GanttComponent | null>(null)

  // Fires once the timeline/rows have actually painted (unlike `created`, which
  // can fire before layout is final).
  const handleDataBound = () => {}

  const inputProps = (className: string) => ({
    autoFocus: true,
    value: editingValue,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onEditingValueChange(e.target.value),
    onBlur: onCommitEdit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') onCommitEdit()
      if (e.key === 'Escape') onCancelEdit()
    },
    className,
  })

  const columns: NonNullable<GanttModel['columns']> = useMemo(() => {
    const isEditing = (row: GanttRow, field: EditableField) => editingCell?.id === unwrap(row).activity.id && editingCell.field === field

    const cols: NonNullable<GanttModel['columns']> = [
      {
        field: 'code', headerText: 'Code', width: columnWidths.code, visible: visibleColumns.has('code'),
        template: (row: GanttRow) => isEditing(row, 'code') ? (
          <input {...inputProps('w-20 border border-blue-400 rounded px-1 py-0.5 text-xs font-mono')} />
        ) : (
          <span
            className="font-mono text-xs text-gray-500 cursor-text"
            onDoubleClick={() => onStartEdit(unwrap(row).activity, 'code')}
          >
            {unwrap(row).activity.code}
          </span>
        ),
      },
      {
        field: 'wbsPath', headerText: 'WBS', width: columnWidths.wbs, visible: visibleColumns.has('wbs'),
        template: (row: GanttRow) => <span className="font-mono text-xs text-gray-400">{unwrap(row).activity.wbs_path ?? '—'}</span>,
      },
      {
        field: 'taskName', headerText: 'Activity', width: columnWidths.activity,
        template: (row: GanttRow) => isEditing(row, 'task_name') ? (
          <input {...inputProps('w-full border border-blue-400 rounded px-1 py-0.5 text-sm')} />
        ) : (
          <button
            onClick={() => onActivityClick(unwrap(row).activity)}
            onDoubleClick={() => onActivityDoubleClick(unwrap(row).activity)}
            className="text-left font-medium text-gray-900 hover:text-blue-600 truncate block w-full"
            title="Click to open, double-click to rename in place"
          >
            {unwrap(row).activity.activity_type === 'wbs_summary' && '📦 '}
            {unwrap(row).activity.task_name}
          </button>
        ),
      },
      {
        field: 'typeLabel', headerText: 'Type', width: columnWidths.type, visible: visibleColumns.has('type'),
        template: (row: GanttRow) => isEditing(row, 'activity_type') ? (
          <select
            autoFocus
            value={editingValue}
            onChange={e => onEditingValueChange(e.target.value)}
            onBlur={onCommitEdit}
            onKeyDown={e => { if (e.key === 'Escape') onCancelEdit() }}
            className="border border-blue-400 rounded px-1 py-0.5 text-xs"
          >
            {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        ) : (
          <span className="text-xs text-gray-600 capitalize" onDoubleClick={() => onStartEdit(unwrap(row).activity, 'activity_type')}>
            {unwrap(row).activity.activity_type.replace('_', ' ')}
          </span>
        ),
      },
      {
        field: 'durationDays', headerText: 'Dur (d)', width: columnWidths.duration, visible: visibleColumns.has('duration'),
        template: (row: GanttRow) => isEditing(row, 'duration_hours') ? (
          <input type="number" min={0} step={0.5} {...inputProps('w-16 border border-blue-400 rounded px-1 py-0.5 text-sm')} />
        ) : (
          <span
            className="text-gray-600 cursor-text"
            title={unwrap(row).activity.duration_hours !== null ? `${unwrap(row).activity.duration_hours}h` : undefined}
            onDoubleClick={() => onStartEdit(unwrap(row).activity, 'duration_hours')}
          >
            {unwrap(row).activity.duration_days ?? '—'}
          </span>
        ),
      },
      {
        field: 'startDate', headerText: 'Start', width: columnWidths.start, visible: visibleColumns.has('start'),
        template: (row: GanttRow) => isEditing(row, 'start') ? (
          <input type="datetime-local" {...inputProps('border border-blue-400 rounded px-1 py-0.5 text-xs')} />
        ) : (
          <span
            className="text-gray-600 whitespace-nowrap cursor-text"
            title={unwrap(row).activity.constraint_type === 'snet' ? 'Start On or After constraint applied' : 'Double-click to set a Start On or After constraint'}
            onDoubleClick={() => onStartEdit(unwrap(row).activity, 'start')}
          >
            {formatDateTime(unwrap(row).activity.start)}
          </span>
        ),
      },
      {
        field: 'baselineStartDate', headerText: 'BL Start', width: columnWidths.bl_start, visible: visibleColumns.has('bl_start'),
        template: (row: GanttRow) => <span className="text-gray-400 whitespace-nowrap">{formatDateTime(unwrap(row).activity.bl_start)}</span>,
      },
      {
        field: 'endDate', headerText: 'Finish', width: columnWidths.finish, visible: visibleColumns.has('finish'),
        template: (row: GanttRow) => isEditing(row, 'finish') ? (
          <input type="datetime-local" {...inputProps('border border-blue-400 rounded px-1 py-0.5 text-xs')} />
        ) : (
          <span
            className="text-gray-600 whitespace-nowrap cursor-text"
            title="Double-click to change duration by setting a new finish"
            onDoubleClick={() => onStartEdit(unwrap(row).activity, 'finish')}
          >
            {formatDateTime(unwrap(row).activity.finish)}
          </span>
        ),
      },
      {
        field: 'baselineEndDate', headerText: 'BL Finish', width: columnWidths.bl_finish, visible: visibleColumns.has('bl_finish'),
        template: (row: GanttRow) => <span className="text-gray-400 whitespace-nowrap">{formatDateTime(unwrap(row).activity.bl_finish)}</span>,
      },
      {
        field: 'varianceDays', headerText: 'Fin. Var (d)', width: columnWidths.variance, visible: visibleColumns.has('variance'),
        template: (row: GanttRow) => (
          <span className={(unwrap(row).activity.variance_days ?? 0) > 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}>
            {unwrap(row).activity.variance_days ?? '—'}
          </span>
        ),
      },
      {
        field: 'totalFloatHours', headerText: 'Total Float', width: columnWidths.float, visible: visibleColumns.has('float'),
        template: (row: GanttRow) => (
          <span className={unwrap(row).activity.is_critical ? 'text-red-600 font-semibold' : 'text-gray-600'}>
            {unwrap(row).activity.total_float_hours ?? '—'}{unwrap(row).activity.total_float_hours !== null ? 'h' : ''}
          </span>
        ),
      },
      {
        field: 'freeFloatHours', headerText: 'Free Float', width: columnWidths.free_float, visible: visibleColumns.has('free_float'),
        template: (row: GanttRow) => (
          <span className="text-gray-600">
            {unwrap(row).activity.free_float_hours ?? '—'}{unwrap(row).activity.free_float_hours !== null ? 'h' : ''}
          </span>
        ),
      },
      {
        field: 'progress', headerText: '% Comp', width: columnWidths.pct_complete, visible: visibleColumns.has('pct_complete'),
        template: (row: GanttRow) => isEditing(row, 'pct_complete') ? (
          <input type="number" min={0} max={100} {...inputProps('w-16 border border-blue-400 rounded px-1 py-0.5 text-sm')} />
        ) : (
          <span className="text-gray-600 cursor-text" onDoubleClick={() => onStartEdit(unwrap(row).activity, 'pct_complete')}>
            {unwrap(row).activity.pct_complete ?? 0}%
          </span>
        ),
      },
      {
        field: 'resourcesLabel', headerText: 'Resources', width: columnWidths.resources, visible: visibleColumns.has('resources'),
        template: (row: GanttRow) => (
          <span
            className="text-gray-600 cursor-pointer truncate block"
            onClick={() => onActivityClick(unwrap(row).activity)}
            title={unwrap(row).resourcesLabel ? `${unwrap(row).resourcesLabel} — click to view/edit` : 'Click to assign resources'}
          >
            {unwrap(row).resourcesLabel || <span className="text-gray-300">—</span>}
          </span>
        ),
      },
      {
        field: 'bac', headerText: 'BAC', width: columnWidths.bac, visible: visibleColumns.has('bac'),
        template: (row: GanttRow) => <span className="text-gray-600 whitespace-nowrap">{formatMoney(unwrap(row).activity.bac)}</span>,
      },
      {
        field: 'pv', headerText: 'PV', width: columnWidths.pv, visible: visibleColumns.has('pv'),
        template: (row: GanttRow) => <span className="text-gray-600 whitespace-nowrap">{formatMoney(unwrap(row).activity.pv)}</span>,
      },
      {
        field: 'ev', headerText: 'EV', width: columnWidths.ev, visible: visibleColumns.has('ev'),
        template: (row: GanttRow) => <span className="text-gray-600 whitespace-nowrap">{formatMoney(unwrap(row).activity.ev)}</span>,
      },
      {
        field: 'ac', headerText: 'AC', width: columnWidths.ac, visible: visibleColumns.has('ac'),
        template: (row: GanttRow) => <span className="text-gray-600 whitespace-nowrap">{formatMoney(unwrap(row).activity.ac)}</span>,
      },
      {
        field: 'cv', headerText: 'CV', width: columnWidths.cv, visible: visibleColumns.has('cv'),
        template: (row: GanttRow) => (
          <span className={`whitespace-nowrap ${unwrap(row).activity.cv !== null && Number(unwrap(row).activity.cv) < 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
            {formatMoney(unwrap(row).activity.cv)}
          </span>
        ),
      },
      {
        field: 'sv', headerText: 'SV', width: columnWidths.sv, visible: visibleColumns.has('sv'),
        template: (row: GanttRow) => (
          <span className={`whitespace-nowrap ${unwrap(row).activity.sv !== null && Number(unwrap(row).activity.sv) < 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
            {formatMoney(unwrap(row).activity.sv)}
          </span>
        ),
      },
      {
        field: 'cpi', headerText: 'CPI', width: columnWidths.cpi, visible: visibleColumns.has('cpi'),
        template: (row: GanttRow) => (
          <span className={unwrap(row).activity.cpi !== null && Number(unwrap(row).activity.cpi) < 1 ? 'text-red-600 font-semibold' : 'text-gray-600'}>
            {formatRatio(unwrap(row).activity.cpi)}
          </span>
        ),
      },
      {
        field: 'spi', headerText: 'SPI', width: columnWidths.spi, visible: visibleColumns.has('spi'),
        template: (row: GanttRow) => (
          <span className={unwrap(row).activity.spi !== null && Number(unwrap(row).activity.spi) < 1 ? 'text-red-600 font-semibold' : 'text-gray-600'}>
            {formatRatio(unwrap(row).activity.spi)}
          </span>
        ),
      },
      {
        field: 'eac', headerText: 'EAC', width: columnWidths.eac, visible: visibleColumns.has('eac'),
        template: (row: GanttRow) => <span className="text-gray-600 whitespace-nowrap">{formatMoney(unwrap(row).activity.eac)}</span>,
      },
      {
        field: 'etc', headerText: 'ETC', width: columnWidths.etc, visible: visibleColumns.has('etc'),
        template: (row: GanttRow) => <span className="text-gray-600 whitespace-nowrap">{formatMoney(unwrap(row).activity.etc)}</span>,
      },
      {
        field: 'actionsPlaceholder', headerText: '', width: columnWidths.actions, allowResizing: true, textAlign: 'Right' as const,
        template: (row: GanttRow) => (
          <div className="text-right whitespace-nowrap no-print">
            <button onClick={() => onCopyRow(unwrap(row).activity)} title="Copy row settings" className="text-xs text-gray-400 hover:text-blue-600 mr-1.5">⧉</button>
            <button
              onClick={() => onPasteRow(unwrap(row).activity)}
              disabled={!rowClipboard}
              title="Paste copied row settings onto this activity"
              className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 mr-2.5"
            >📋</button>
            <button
              onClick={() => onMoveUp(unwrap(row).activity)}
              disabled={unwrap(row).isFirstSibling}
              title="Move up (reorder among siblings)"
              className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 mr-1.5"
            >▲</button>
            <button
              onClick={() => onMoveDown(unwrap(row).activity)}
              disabled={unwrap(row).isLastSibling}
              title="Move down (reorder among siblings)"
              className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 mr-2.5"
            >▼</button>
            <button
              onClick={() => onOutdent(unwrap(row).activity)}
              disabled={!unwrap(row).activity.parent_id}
              title="Outdent"
              className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 mr-1.5"
            >⇤</button>
            <button
              onClick={() => onIndent(unwrap(row).activity)}
              title="Indent"
              className="text-xs text-gray-400 hover:text-blue-600 mr-2.5"
            >⇥</button>
            <button onClick={() => onDelete(unwrap(row).activity)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
          </div>
        ),
      },
    ]
    return cols
  }, [visibleColumns, columnWidths, editingCell, editingValue, rowClipboard])

  // The left data grid and the Gantt's own chart pane must stay row-aligned on
  // scroll — now genuinely free, since both panes are owned by the same
  // Syncfusion widget instead of a custom table synced against a second one.

  const handleResizeStop = (args: unknown) => {
    const a = args as { column?: { field?: string; width?: string | number } }
    const field = a.column?.field
    const width = a.column?.width
    if (!field || width === undefined) return
    const key = field === 'wbsPath' ? 'wbs' : field === 'taskName' ? 'activity' : field === 'durationDays' ? 'duration'
      : field === 'startDate' ? 'start' : field === 'baselineStartDate' ? 'bl_start' : field === 'endDate' ? 'finish'
      : field === 'baselineEndDate' ? 'bl_finish' : field === 'varianceDays' ? 'variance' : field === 'totalFloatHours' ? 'float'
      : field === 'freeFloatHours' ? 'free_float' : field === 'progress' ? 'pct_complete' : field === 'resourcesLabel' ? 'resources'
      : field === 'actionsPlaceholder' ? 'actions' : field
    onColumnResize(key, typeof width === 'string' ? parseFloat(width) : width)
  }

  return (
    <div className="prosota-gantt h-full">
      <GanttComponent
        ref={ganttRef}
        dataSource={rows}
        taskFields={taskFields}
        columns={columns}
        treeColumnIndex={2}
        timelineSettings={timelineSettings}
        rowHeight={GANTT_ROW_HEIGHT}
        height={height}
        // Grid pane no longer hidden (Scheduling now uses Syncfusion's own grid,
        // not a separate custom table) — give it the lion's share of the width
        // by default since it carries 20+ EVM/WBS columns; still user-draggable.
        splitterSettings={{ position: '58%' }}
        gridLines="Both"
        renderBaseline
        readOnly
        allowResizing
        allowSelection={false}
        highlightWeekends
        dataBound={handleDataBound}
        resizeStop={handleResizeStop}
        // Our own CPM engine (app/services/scheduling_cpm.py) is the sole source
        // of truth for start/finish/float — Syncfusion must render those dates
        // exactly as given, never recompute or "correct" them against its own
        // working-time/dependency validation. Same "never let two engines
        // disagree" rule this project has already fixed as a bug class in
        // Risk/Cost/Scheduling (computed fields, duplicate % complete, etc.).
        autoCalculateDateScheduling={false}
        enablePredecessorValidation={false}
      >
        <Inject services={[Resize]} />
      </GanttComponent>
    </div>
  )
}
