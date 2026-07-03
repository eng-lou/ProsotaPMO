import axios from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { ReassessmentLog } from '@/components/ReassessmentLog'
import { ActivityForm, toActivityPayload, type ActivityFormValues } from './ActivityForm'
import { ActivityLogic } from './ActivityLogic'
import { CalendarWidget } from './CalendarWidget'
import { formatDateTime, toDatetimeLocalValue } from './dateTime'
import { resolveHoursPerDay } from './durationDisplay'
import { downloadActivitiesCsv } from './exportActivities'
import { GANTT_ROW_HEIGHT } from './GanttChart'
import { SyncfusionGanttChart } from './SyncfusionGanttChart'
import { ResourceAssignments } from './ResourceAssignments'
import { ResourcePoolWidget } from './ResourcePoolWidget'
import { RescheduleWidget } from './RescheduleWidget'
import { SchedulingPrintView } from './SchedulingPrintView'
import { SchedulingQualityWidget } from './SchedulingQualityWidget'
import {
  ACTIVITY_TYPES, type Activity, type ActivityRelationship, type Calendar, type Resource, type ResourceAssignment,
} from './types'

const PANE_MAX_HEIGHT = 600

type ColumnKey =
  | 'code' | 'wbs' | 'type' | 'duration' | 'start' | 'bl_start' | 'finish' | 'bl_finish'
  | 'variance' | 'float' | 'free_float' | 'pct_complete' | 'resources'
  | 'bac' | 'pv' | 'ev' | 'ac' | 'cv' | 'sv' | 'cpi' | 'spi' | 'eac' | 'etc'

const ALL_COLUMNS: { key: ColumnKey; label: string; width: string; title?: string }[] = [
  { key: 'code', label: 'Code', width: 'w-24' },
  { key: 'wbs', label: 'WBS', width: 'w-16' },
  { key: 'type', label: 'Type', width: 'w-24' },
  { key: 'duration', label: 'Dur (d)', width: 'w-16' },
  { key: 'start', label: 'Start', width: 'w-24' },
  { key: 'bl_start', label: 'BL Start', width: 'w-24', title: 'Baseline start — captured by "Set Baseline", the plan this activity is measured against' },
  { key: 'finish', label: 'Finish', width: 'w-24' },
  { key: 'bl_finish', label: 'BL Finish', width: 'w-24', title: 'Baseline finish — captured by "Set Baseline", the plan this activity is measured against' },
  { key: 'variance', label: 'Fin. Var (d)', width: 'w-16', title: 'Current Finish vs Baseline Finish, in days. Positive = running later than the baseline plan. Blank until a baseline exists.' },
  { key: 'float', label: 'Total Float', width: 'w-20', title: 'How much this activity could slip without delaying the whole project (hours)' },
  { key: 'free_float', label: 'Free Float', width: 'w-20', title: 'How much this activity could slip without delaying its own successors (hours) — always ≤ Total Float' },
  { key: 'pct_complete', label: '% Comp', width: 'w-20' },
  { key: 'resources', label: 'Resources', width: 'w-24', title: 'Click to assign labour, equipment, material or a subcontractor to this activity' },
  { key: 'bac', label: 'BAC', width: 'w-24', title: 'Budget At Completion — this activity\'s resourced budget (from Cost Plan). Blank until resources are assigned.' },
  { key: 'pv', label: 'PV', width: 'w-24', title: 'Planned Value — how much of BAC should be earned by today, based on how far along this activity\'s own current duration it should be. Not affected by Set Baseline.' },
  { key: 'ev', label: 'EV', width: 'w-24', title: 'Earned Value — BAC × physical % complete, as assessed on the linked Cost Plan line.' },
  { key: 'ac', label: 'AC', width: 'w-24', title: 'Actual Cost — actuals recorded against this activity\'s linked Cost Plan line.' },
  { key: 'cv', label: 'CV', width: 'w-24', title: 'Cost Variance — EV minus AC. Negative = over budget for the work done.' },
  { key: 'sv', label: 'SV', width: 'w-24', title: 'Schedule Variance — EV minus PV. Negative = behind schedule.' },
  { key: 'cpi', label: 'CPI', width: 'w-20', title: 'Cost Performance Index — EV ÷ AC. Below 1.0 = over budget.' },
  { key: 'spi', label: 'SPI', width: 'w-20', title: 'Schedule Performance Index — EV ÷ PV. Below 1.0 = behind schedule.' },
  { key: 'eac', label: 'EAC', width: 'w-24', title: 'Estimate At Completion — BAC ÷ CPI, the forecast final cost at current performance.' },
  { key: 'etc', label: 'ETC', width: 'w-24', title: 'Estimate To Complete — EAC minus AC, the forecast remaining cost.' },
]

const VISIBLE_COLUMNS_STORAGE_KEY = 'prosota_scheduling_visible_columns'

function loadVisibleColumns(): Set<ColumnKey> {
  try {
    const raw = localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw) as ColumnKey[])
  } catch {
    // fall through to default
  }
  return new Set(ALL_COLUMNS.map(c => c.key))
}

// Resizable columns — 'activity' (always visible) and 'actions' (the trailing
// icon column) aren't in ALL_COLUMNS (that's only the toggleable ones) but are
// still user-resizable, so they get entries here too.
type ResizableColumnKey = ColumnKey | 'activity' | 'actions'

const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnKey, number> = {
  code: 96, wbs: 64, activity: 224, type: 96, duration: 64, start: 96, bl_start: 96,
  finish: 96, bl_finish: 96, variance: 80, float: 80, free_float: 80, pct_complete: 80,
  resources: 96, actions: 176,
  bac: 96, pv: 96, ev: 96, ac: 96, cv: 96, sv: 96, cpi: 72, spi: 72, eac: 96, etc: 96,
}

const COLUMN_WIDTHS_STORAGE_KEY = 'prosota_scheduling_column_widths'

function loadColumnWidths(): Record<ResizableColumnKey, number> {
  try {
    const raw = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY)
    if (raw) return { ...DEFAULT_COLUMN_WIDTHS, ...(JSON.parse(raw) as Partial<Record<ResizableColumnKey, number>>) }
  } catch {
    // fall through to default
  }
  return DEFAULT_COLUMN_WIDTHS
}

// A <th> with a drag handle on its right edge. Requires the parent <table> to use
// table-layout:fixed (Tailwind's table-fixed) — otherwise the browser can ignore
// an explicit header width once cell content forces the column wider.
function ResizableTh({
  width, onResizeStart, children, className = '', title,
}: {
  width: number
  onResizeStart: (e: React.MouseEvent) => void
  children?: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <th className={`relative px-3 py-2.5 ${className}`} style={{ width }} title={title}>
      <div className="truncate pr-2">{children}</div>
      <span
        onMouseDown={onResizeStart}
        onClick={e => e.stopPropagation()}
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-300 active:bg-blue-400"
      />
    </th>
  )
}

// Same formatting convention as Cost Plan (frontend/src/modules/costs/CostPlan.tsx)
// so a figure reads identically whether seen here or on its linked Cost Plan line.
function formatMoney(value: string | null) {
  if (value === null) return '—'
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString()}` : `£${n.toLocaleString()}`
}

function formatRatio(value: string | null) {
  if (value === null) return '—'
  return Number(value).toFixed(3)
}

// Inline-editable fields (double-click a cell) — the value types PATCH accepts.
// start/finish aren't plain passthrough fields: editing Start applies a soft "Start
// On or After" constraint (P6/MS Project convention — the activity's normal logic
// can still push it later, it just can't start earlier); editing Finish is
// translated server-side into the duration that produces it, Start unchanged — see
// commitEdit below and backend app/services/scheduling_cpm.py:compute_duration_for_finish.
type EditableField = 'task_name' | 'code' | 'duration_hours' | 'pct_complete' | 'activity_type' | 'start' | 'finish'

// Fields copyable row-to-row via the clipboard buttons — everything a planner would
// want to templatize across similar activities (task_name and computed fields
// deliberately excluded — copying a name or a CPM-derived date makes no sense).
const ROW_CLIPBOARD_FIELDS: (keyof Activity)[] = [
  'activity_type', 'duration_hours', 'pct_complete', 'constraint_type', 'constraint_date', 'calendar_id', 'commentary',
]

export function Scheduling() {
  const { selectedProject } = useProject()
  const { period, loading: periodLoading, error: periodError, refetch: refetchPeriod } = useActivePeriod(selectedProject?.id)
  const [activities, setActivities] = useState<Activity[]>([])
  const [relationships, setRelationships] = useState<ActivityRelationship[]>([])
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [resourceAssignments, setResourceAssignments] = useState<ResourceAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  // expandedId now drives one unified activity-detail panel (fields + Logic +
  // Resources + Reassessment) — single click on an activity's name opens it;
  // there's no separate floating edit form anymore (only "+ Add Activity" still
  // uses a standalone ActivityForm, since there's no existing row to expand into).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [calendarWidgetOpen, setCalendarWidgetOpen] = useState(false)
  const [resourcePoolWidgetOpen, setResourcePoolWidgetOpen] = useState(false)
  const [qualityWidgetOpen, setQualityWidgetOpen] = useState(false)
  const [rescheduleWidgetOpen, setRescheduleWidgetOpen] = useState(false)
  const [reassessmentRefreshKey, setReassessmentRefreshKey] = useState(0)

  // Search / Filters — client-side, matching the prototype's toolbar row. No separate
  // Group-by control: unlike Risk/ICD/Cost (flat lists needing an artificial grouping
  // mechanism), activities are already organised by the WBS outline hierarchy
  // (Phase 2) — a second grouping layer would duplicate it, and would also break the
  // Gantt's fixed per-row index alignment the same way an inline-expanding row did
  // (see the Logic panel's history in this file).
  const [searchQuery, setSearchQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterCritical, setFilterCritical] = useState(false)
  const [filterDelayed, setFilterDelayed] = useState(false)
  const [filterAtRisk, setFilterAtRisk] = useState(false)

  // Show/Hide Columns — persisted per-browser so a planner's chosen layout survives
  // a reload. Activity name + actions columns are always shown (not toggleable).
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(loadVisibleColumns)
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false)
  const isColumnVisible = (key: ColumnKey) => visibleColumns.has(key)
  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }

  // Resizable columns + the pane divider — both drag-to-resize with the same
  // "attach document listeners on mousedown, detach on mouseup, persist on
  // release" pattern, since neither is a fixed set of DOM nodes React can bind
  // cleanup to. Text selection is suppressed for the drag's duration — without
  // it, a fast drag also selects the table's text, which visually fights the
  // resize and can make it look like dragging isn't doing anything.
  const beginDrag = (onMove: (deltaX: number) => void, onEnd: () => void) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const onMouseMove = (moveEvent: MouseEvent) => onMove(moveEvent.clientX - startX)
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = previousUserSelect
      onEnd()
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const [columnWidths, setColumnWidths] = useState<Record<ResizableColumnKey, number>>(loadColumnWidths)
  const startColumnResize = (key: ResizableColumnKey) => {
    const startWidth = columnWidths[key]
    return beginDrag(
      deltaX => setColumnWidths(w => ({ ...w, [key]: Math.max(40, startWidth + deltaX) })),
      () => setColumnWidths(w => {
        localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(w))
        return w
      }),
    )
  }

  const [leftPaneWidth, setLeftPaneWidth] = useState<number | null>(() => {
    const saved = localStorage.getItem('prosota_scheduling_left_pane_width')
    return saved ? Number(saved) : null
  })
  const startPaneResize = (e: React.MouseEvent) => {
    const startWidth = leftPaneRef.current?.getBoundingClientRect().width ?? 700
    beginDrag(
      deltaX => setLeftPaneWidth(Math.max(320, startWidth + deltaX)),
      () => setLeftPaneWidth(w => {
        if (w !== null) localStorage.setItem('prosota_scheduling_left_pane_width', String(w))
        return w
      }),
    )(e)
  }

  // Inline editing — double-click a cell to edit it in place instead of opening the
  // modal form. Only a handful of fields are safe to edit this way (everything else
  // is either computed by the CPM engine or benefits from the modal's fuller context).
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null)
  const [editingValue, setEditingValue] = useState('')

  // The task_name cell needs both a single-click (open the unified activity-detail
  // panel below the grid) and a double-click (inline rename) behaviour on the same
  // element. The DOM fires two ordinary `click` events before `dblclick` — so
  // naively wiring onClick straight to "expand" means every double-click expands
  // (twice, toggling back off) before inline-editing a moment later. Delaying the
  // single-click action lets a following dblclick cancel it — the standard fix for
  // this browser quirk.
  const nameClickTimer = useRef<number | null>(null)
  const handleNameClick = (a: Activity) => {
    if (nameClickTimer.current !== null) return
    nameClickTimer.current = window.setTimeout(() => {
      nameClickTimer.current = null
      setExpandedId(id => id === a.id ? null : a.id)
    }, 220)
  }
  const handleNameDoubleClick = (a: Activity) => {
    if (nameClickTimer.current !== null) {
      window.clearTimeout(nameClickTimer.current)
      nameClickTimer.current = null
    }
    startEdit(a, 'task_name')
  }

  // Row clipboard — "copy" snapshots one activity's editable settings; "paste" applies
  // them to another. True cell-value copy/paste is handled for free by the native
  // browser clipboard once a cell becomes a text <input> (see editingCell above); this
  // covers the "seed several similar activities from one configured row" workflow.
  const [rowClipboard, setRowClipboard] = useState<Partial<Activity> | null>(null)

  // Left (data grid) and right (Gantt) panes scroll independently in the DOM but must
  // stay row-aligned — see "Gantt Chart — Rendering Plan" in docs/SCHEDULING_MODULE_PLAN.md.
  // SyncfusionGanttChart wires the actual left/right scroll sync itself (it reaches
  // into the Gantt's own internal chart-scroll element), so this ref is just the
  // handle it needs into the left pane — no local sync logic lives here anymore.
  const leftPaneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedProject || !period) return
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const [activitiesRes, relationshipsRes, calendarsRes, resourcesRes, assignmentsRes] = await Promise.all([
          api.get<Activity[]>('/api/v1/activities/', {
            params: { project_id: selectedProject!.id, period_id: period!.id },
          }),
          api.get<ActivityRelationship[]>('/api/v1/activity-relationships/', {
            params: { period_id: period!.id },
          }),
          api.get<Calendar[]>('/api/v1/calendars/', {
            params: { project_id: selectedProject!.id },
          }),
          api.get<Resource[]>('/api/v1/resources/', {
            params: { project_id: selectedProject!.id },
          }),
          api.get<ResourceAssignment[]>('/api/v1/resource-assignments/', {
            params: { period_id: period!.id },
          }),
        ])
        if (!cancelled) {
          setActivities(activitiesRes.data)
          setRelationships(relationshipsRes.data)
          setCalendars(calendarsRes.data)
          setResources(resourcesRes.data)
          setResourceAssignments(assignmentsRes.data)
        }
      } catch {
        if (!cancelled) setError('Failed to load schedule')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedProject, period])

  // Delayed/At Risk are computed badges, not stored fields — consistent with how
  // Cost Plan's variance-band fix went (never expose a derivable value as manual
  // input). Delayed = finished later than baseline; At Risk = has float, but not much.
  const visibleActivities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return activities.filter(a => {
      if (q) {
        const haystack = [a.code, a.task_name, a.commentary].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (filterCritical && a.is_critical !== true) return false
      if (filterDelayed && !(a.variance_days !== null && a.variance_days > 0)) return false
      // ~1-5 working days of float at a nominal 8h/day — an approximation, same as
      // the backend quality module's DCMA thresholds (app/services/scheduling_quality.py).
      if (filterAtRisk && !(a.total_float_hours !== null && a.total_float_hours > 0 && a.total_float_hours <= 40)) return false
      return true
    })
  }, [activities, searchQuery, filterCritical, filterDelayed, filterAtRisk])

  if (!selectedProject) return null

  const refresh = async () => {
    if (!period) return
    const [activitiesRes, relationshipsRes, calendarsRes, resourcesRes, assignmentsRes] = await Promise.all([
      api.get<Activity[]>('/api/v1/activities/', {
        params: { project_id: selectedProject.id, period_id: period.id },
      }),
      api.get<ActivityRelationship[]>('/api/v1/activity-relationships/', {
        params: { period_id: period.id },
      }),
      api.get<Calendar[]>('/api/v1/calendars/', {
        params: { project_id: selectedProject.id },
      }),
      api.get<Resource[]>('/api/v1/resources/', {
        params: { project_id: selectedProject.id },
      }),
      api.get<ResourceAssignment[]>('/api/v1/resource-assignments/', {
        params: { period_id: period.id },
      }),
    ])
    setActivities(activitiesRes.data)
    setRelationships(relationshipsRes.data)
    setCalendars(calendarsRes.data)
    setResources(resourcesRes.data)
    setResourceAssignments(assignmentsRes.data)
  }

  const handleCreate = async (values: ActivityFormValues) => {
    if (!period) return
    await api.post('/api/v1/activities/', {
      ...toActivityPayload(values, calendars),
      project_id: selectedProject.id,
      period_id: period.id,
    })
    setFormOpen(false)
    await refresh()
  }

  const handleUpdate = async (activity: Activity, values: ActivityFormValues, reassessmentNote: string | null) => {
    await api.patch(`/api/v1/activities/${activity.id}`, toActivityPayload(values, calendars))
    if (reassessmentNote) {
      await api.post('/api/v1/reassessments/', {
        record_type: 'activity', record_id: activity.id, note: reassessmentNote,
      })
      setReassessmentRefreshKey(k => k + 1)
    }
    await refresh()
  }

  const handleDelete = async (activity: Activity) => {
    const childCount = activities.filter(a => a.parent_id === activity.id).length
    let cascade = true

    if (childCount > 0) {
      const label = `${childCount} sub-activit${childCount === 1 ? 'y' : 'ies'}`
      cascade = window.confirm(
        `"${activity.task_name}" has ${label}. Delete them too?\n\n` +
        `OK = delete "${activity.task_name}" and all ${label}.\n` +
        `Cancel = delete only "${activity.task_name}" — its ${label} move up to its level instead.`
      )
    } else if (!window.confirm(`Delete activity "${activity.task_name}"? This cannot be undone.`)) {
      return
    }

    await api.delete(`/api/v1/activities/${activity.id}`, { params: { cascade } })
    await refresh()
  }

  // Indent = become a child of the row immediately above it in outline order (which the
  // API already returns pre-sorted — see app/services/activity.py:list_activities).
  // Outdent = move up one level, to the current parent's parent. Both are just a
  // parent_id PATCH; the server re-derives wbs_path/activity_type/rollups. MS Project
  // style, per docs/SCHEDULING_MODULE_PLAN.md Phase 2.
  const handleIndent = async (activity: Activity) => {
    const index = visibleActivities.findIndex(a => a.id === activity.id)
    if (index <= 0) return
    const newParent = visibleActivities[index - 1]
    await api.patch(`/api/v1/activities/${activity.id}`, { parent_id: newParent.id })
    await refresh()
  }

  const handleOutdent = async (activity: Activity) => {
    if (!activity.parent_id) return
    const parent = activities.find(a => a.id === activity.parent_id)
    await api.patch(`/api/v1/activities/${activity.id}`, { parent_id: parent?.parent_id ?? null })
    await refresh()
  }

  // Move up/down = reorder among current siblings (display order/WBS numbering
  // only — a separate lever from indent/outdent's hierarchy level). Added per
  // Maro: indenting only lets an activity become a child of whatever row is
  // immediately above it, so repositioning it under a different summary first
  // meant deleting and recreating activities in the right order.
  const handleMoveUp = async (activity: Activity) => {
    await api.post(`/api/v1/activities/${activity.id}/move`, { direction: 'up' })
    await refresh()
  }

  const handleMoveDown = async (activity: Activity) => {
    await api.post(`/api/v1/activities/${activity.id}/move`, { direction: 'down' })
    await refresh()
  }

  const handleSetBaseline = async () => {
    if (!period) return
    const already = activities.some(a => a.bl_start !== null)
    const message = already
      ? 'Re-set the baseline? This overwrites the current baseline dates with today\'s planned dates for every activity in this period.'
      : 'Set the baseline? This captures today\'s planned dates as the reference point variance is measured against.'
    if (!window.confirm(message)) return
    await api.post('/api/v1/activities/set-baseline', null, { params: { period_id: period.id } })
    await refresh()
  }

  const startEdit = (a: Activity, field: EditableField) => {
    setEditingCell({ id: a.id, field })
    setEditingValue(
      field === 'task_name' ? a.task_name
      : field === 'code' ? a.code
      // Edited in days (what planners actually type), converted to duration_hours
      // on commit below — the backend's hour-precision CPM engine is unaffected,
      // this is purely a display/input convenience.
      : field === 'duration_hours' ? String(a.duration_days ?? '')
      : field === 'pct_complete' ? String(a.pct_complete ?? '')
      : field === 'start' ? toDatetimeLocalValue(a.start)
      : field === 'finish' ? toDatetimeLocalValue(a.finish)
      : a.activity_type
    )
  }

  const cancelEdit = () => setEditingCell(null)

  const commitEdit = async () => {
    if (!editingCell) return
    const { id, field } = editingCell

    let payload: Record<string, unknown>
    if (field === 'duration_hours') {
      const days = editingValue.trim() === '' ? null : Number(editingValue)
      if (days !== null && Number.isNaN(days)) { setEditingCell(null); return }
      const activity = activities.find(a => a.id === id)
      const hoursPerDay = activity ? resolveHoursPerDay(activity, calendars) : 8
      payload = { duration_hours: days !== null ? days * hoursPerDay : null }
    } else if (field === 'pct_complete') {
      const num = editingValue.trim() === '' ? null : Number(editingValue)
      if (num !== null && Number.isNaN(num)) { setEditingCell(null); return }
      payload = { pct_complete: num }
    } else if (field === 'start') {
      if (!editingValue) { setEditingCell(null); return }
      // Soft constraint (P6/MS Project "Start On or After") — the activity's normal
      // logic can still push it later than this; it just can't start earlier.
      if (!window.confirm(
        'Setting a start date applies a "Start On or After" constraint — this activity ' +
        'will never start earlier than it, though its normal logic/dependencies can still push it later. Continue?'
      )) { setEditingCell(null); return }
      payload = { constraint_type: 'snet', constraint_date: editingValue }
    } else if (field === 'finish') {
      if (!editingValue) { setEditingCell(null); return }
      // Backend translates this into a new duration_hours (Start stays put) — see
      // app/services/scheduling_cpm.py:compute_duration_for_finish.
      payload = { finish: editingValue }
    } else {
      payload = { [field]: editingValue }
    }

    try {
      await api.patch(`/api/v1/activities/${id}`, payload)
      setEditingCell(null)
      await refresh()
    } catch (err) {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
      window.alert(message ?? 'Could not save that change.')
    }
  }

  const handleCopyRow = (a: Activity) => {
    const snapshot: Partial<Activity> = {}
    for (const field of ROW_CLIPBOARD_FIELDS) (snapshot as Record<string, unknown>)[field] = a[field]
    setRowClipboard(snapshot)
  }

  const handlePasteRow = async (a: Activity) => {
    if (!rowClipboard) return
    if (!window.confirm(
      `Paste the copied settings (type, duration, % complete, constraint, calendar, commentary) onto "${a.task_name}"?\n\nThis overwrites its current values.`
    )) return
    await api.patch(`/api/v1/activities/${a.id}`, rowClipboard)
    await refresh()
  }

  const depthOf = (a: Activity) => (a.wbs_path ? a.wbs_path.split('.').length - 1 : 0)
  const expandedActivity = activities.find(a => a.id === expandedId) ?? null

  // True siblings (same parent_id), not the filtered/searched visibleActivities —
  // move up/down talks to the backend's real sibling group regardless of what a
  // search/filter is currently hiding, so the button's disabled state must match.
  const sortedSiblingsOf = (a: Activity) =>
    activities
      .filter(x => x.parent_id === a.parent_id)
      .sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
  const isFirstSibling = (a: Activity) => sortedSiblingsOf(a)[0]?.id === a.id
  const isLastSibling = (a: Activity) => {
    const siblings = sortedSiblingsOf(a)
    return siblings[siblings.length - 1]?.id === a.id
  }

  if (loading || periodLoading) {
    return <div className="p-8 text-sm text-gray-400">Loading schedule…</div>
  }

  return (
    <>
    <div className="p-8 no-print">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Scheduling</h1>
        {period && (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
            {period.period_label} · {period.freeze_status}
          </span>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-6">
        Activities for {selectedProject.name}. Start/finish dates, float, and the critical path are computed from
        duration + logic + calendars — set duration and link activities to see them.
        See <span className="font-mono text-xs">docs/SCHEDULING_MODULE_PLAN.md</span> for the staged rollout.
      </p>

      {(error || periodError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error ?? periodError}</div>
      )}

      {calendarWidgetOpen && (
        <div className="no-print">
          <CalendarWidget
            projectId={selectedProject.id}
            calendars={calendars}
            onChange={refresh}
            onClose={() => setCalendarWidgetOpen(false)}
          />
        </div>
      )}

      {resourcePoolWidgetOpen && (
        <div className="no-print">
          <ResourcePoolWidget
            projectId={selectedProject.id}
            resources={resources}
            onChange={refresh}
            onClose={() => setResourcePoolWidgetOpen(false)}
          />
        </div>
      )}

      {qualityWidgetOpen && period && (
        <div className="no-print">
          <SchedulingQualityWidget periodId={period.id} onClose={() => setQualityWidgetOpen(false)} />
        </div>
      )}

      {rescheduleWidgetOpen && period && (
        <div className="no-print">
          <RescheduleWidget
            period={period}
            onApplied={async () => { await Promise.all([refresh(), refetchPeriod()]) }}
            onClose={() => setRescheduleWidgetOpen(false)}
          />
        </div>
      )}

      {formOpen && (
        <div className="no-print">
          <ActivityForm
            activity={null} calendars={calendars}
            onCancel={() => setFormOpen(false)} onSubmit={handleCreate}
          />
        </div>
      )}

      {!formOpen && (
        <div className="mb-4 flex items-center gap-3 no-print">
          <button onClick={() => setFormOpen(true)} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            + Add Activity
          </button>
          <button
            onClick={() => setCalendarWidgetOpen(o => !o)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              calendarWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            📆 Calendar
          </button>
          <button
            onClick={() => setResourcePoolWidgetOpen(o => !o)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              resourcePoolWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            👷 Resources
          </button>
          <button
            onClick={handleSetBaseline}
            disabled={activities.length === 0}
            title="Capture today's planned dates as the reference point variance is measured against"
            className="text-xs px-3 py-1.5 rounded-md font-medium border bg-white text-gray-600 border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🎯 Set Baseline
          </button>
          <button
            onClick={() => setQualityWidgetOpen(o => !o)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              qualityWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            🔬 Quality Check
          </button>
          <button
            onClick={() => setRescheduleWidgetOpen(o => !o)}
            disabled={activities.length === 0}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${
              rescheduleWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            🔄 Reschedule
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap no-print">
        <div className="relative max-w-xs w-full">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search activities…"
            className="w-full border border-gray-300 rounded-md pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setFiltersOpen(o => !o)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            filtersOpen || filterCritical || filterDelayed || filterAtRisk
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          ⚙ Filters{[filterCritical, filterDelayed, filterAtRisk].filter(Boolean).length > 0
            ? ` (${[filterCritical, filterDelayed, filterAtRisk].filter(Boolean).length})` : ''}
        </button>
        <div className="relative">
          <button
            onClick={() => setColumnsMenuOpen(o => !o)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              columnsMenuOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            ☰ Columns
          </button>
          {columnsMenuOpen && (
            <div className="absolute z-10 top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-52">
              {ALL_COLUMNS.map(col => (
                <label key={col.key} className="flex items-center gap-1.5 text-xs text-gray-600 py-1" title={col.title}>
                  <input type="checkbox" checked={isColumnVisible(col.key)} onChange={() => toggleColumn(col.key)} />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => downloadActivitiesCsv(visibleActivities, selectedProject.name)}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          title="Exports the activities currently shown (respecting search/filters) as a CSV file, opens directly in Excel."
        >
          ⇩ Export ({visibleActivities.length})
        </button>
        <button
          onClick={() => window.print()}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          title="Print the activity list exactly as currently shown (respecting search/filters)."
        >
          🖨️ Print
        </button>
      </div>

      {filtersOpen && (
        <div className="no-print bg-white border border-gray-200 rounded-lg p-4 mb-4 flex gap-6 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={filterCritical} onChange={e => setFilterCritical(e.target.checked)} />
            Critical only
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={filterDelayed} onChange={e => setFilterDelayed(e.target.checked)} />
            Delayed (finish later than baseline)
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={filterAtRisk} onChange={e => setFilterAtRisk(e.target.checked)} />
            At risk (float ≤ 40h, ~1–5 working days)
          </label>
          {(filterCritical || filterDelayed || filterAtRisk) && (
            <button
              onClick={() => { setFilterCritical(false); setFilterDelayed(false); setFilterAtRisk(false) }}
              className="text-xs text-gray-400 hover:text-red-600"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex">
        <div
          ref={leftPaneRef}
          className="overflow-y-auto overflow-x-hidden shrink-0"
          style={{ maxHeight: PANE_MAX_HEIGHT, width: leftPaneWidth ?? undefined }}
        >
          <table className="text-sm border-collapse table-fixed">
            <colgroup>
              {isColumnVisible('code') && <col style={{ width: columnWidths.code }} />}
              {isColumnVisible('wbs') && <col style={{ width: columnWidths.wbs }} />}
              <col style={{ width: columnWidths.activity }} />
              {isColumnVisible('type') && <col style={{ width: columnWidths.type }} />}
              {isColumnVisible('duration') && <col style={{ width: columnWidths.duration }} />}
              {isColumnVisible('start') && <col style={{ width: columnWidths.start }} />}
              {isColumnVisible('bl_start') && <col style={{ width: columnWidths.bl_start }} />}
              {isColumnVisible('finish') && <col style={{ width: columnWidths.finish }} />}
              {isColumnVisible('bl_finish') && <col style={{ width: columnWidths.bl_finish }} />}
              {isColumnVisible('variance') && <col style={{ width: columnWidths.variance }} />}
              {isColumnVisible('float') && <col style={{ width: columnWidths.float }} />}
              {isColumnVisible('free_float') && <col style={{ width: columnWidths.free_float }} />}
              {isColumnVisible('pct_complete') && <col style={{ width: columnWidths.pct_complete }} />}
              {isColumnVisible('resources') && <col style={{ width: columnWidths.resources }} />}
              {isColumnVisible('bac') && <col style={{ width: columnWidths.bac }} />}
              {isColumnVisible('pv') && <col style={{ width: columnWidths.pv }} />}
              {isColumnVisible('ev') && <col style={{ width: columnWidths.ev }} />}
              {isColumnVisible('ac') && <col style={{ width: columnWidths.ac }} />}
              {isColumnVisible('cv') && <col style={{ width: columnWidths.cv }} />}
              {isColumnVisible('sv') && <col style={{ width: columnWidths.sv }} />}
              {isColumnVisible('cpi') && <col style={{ width: columnWidths.cpi }} />}
              {isColumnVisible('spi') && <col style={{ width: columnWidths.spi }} />}
              {isColumnVisible('eac') && <col style={{ width: columnWidths.eac }} />}
              {isColumnVisible('etc') && <col style={{ width: columnWidths.etc }} />}
              <col style={{ width: columnWidths.actions }} />
            </colgroup>
            <thead>
              <tr
                style={{ height: 36 }}
                className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-500 font-medium uppercase tracking-wide sticky top-0"
              >
                {isColumnVisible('code') && <ResizableTh width={columnWidths.code} onResizeStart={startColumnResize('code')}>Code</ResizableTh>}
                {isColumnVisible('wbs') && <ResizableTh width={columnWidths.wbs} onResizeStart={startColumnResize('wbs')}>WBS</ResizableTh>}
                <ResizableTh width={columnWidths.activity} onResizeStart={startColumnResize('activity')}>Activity</ResizableTh>
                {isColumnVisible('type') && <ResizableTh width={columnWidths.type} onResizeStart={startColumnResize('type')}>Type</ResizableTh>}
                {isColumnVisible('duration') && <ResizableTh width={columnWidths.duration} onResizeStart={startColumnResize('duration')}>Dur (d)</ResizableTh>}
                {isColumnVisible('start') && <ResizableTh width={columnWidths.start} onResizeStart={startColumnResize('start')}>Start</ResizableTh>}
                {isColumnVisible('bl_start') && <ResizableTh width={columnWidths.bl_start} onResizeStart={startColumnResize('bl_start')} title="Baseline start — captured by Set Baseline">BL Start</ResizableTh>}
                {isColumnVisible('finish') && <ResizableTh width={columnWidths.finish} onResizeStart={startColumnResize('finish')}>Finish</ResizableTh>}
                {isColumnVisible('bl_finish') && <ResizableTh width={columnWidths.bl_finish} onResizeStart={startColumnResize('bl_finish')} title="Baseline finish — captured by Set Baseline">BL Finish</ResizableTh>}
                {isColumnVisible('variance') && (
                  <ResizableTh
                    width={columnWidths.variance} onResizeStart={startColumnResize('variance')}
                    title="Current Finish vs Baseline Finish, in days. Positive = later than the baseline plan."
                  >
                    Fin. Var (d)
                  </ResizableTh>
                )}
                {isColumnVisible('float') && <ResizableTh width={columnWidths.float} onResizeStart={startColumnResize('float')} title="Slip this activity can absorb without delaying the whole project (hours)">Total Float</ResizableTh>}
                {isColumnVisible('free_float') && <ResizableTh width={columnWidths.free_float} onResizeStart={startColumnResize('free_float')} title="Slip this activity can absorb without delaying its own successors (hours)">Free Float</ResizableTh>}
                {isColumnVisible('pct_complete') && <ResizableTh width={columnWidths.pct_complete} onResizeStart={startColumnResize('pct_complete')}>% Comp</ResizableTh>}
                {isColumnVisible('resources') && <ResizableTh width={columnWidths.resources} onResizeStart={startColumnResize('resources')}>Resources</ResizableTh>}
                {isColumnVisible('bac') && <ResizableTh width={columnWidths.bac} onResizeStart={startColumnResize('bac')} title="Budget At Completion — this activity's resourced budget (from Cost Plan)">BAC</ResizableTh>}
                {isColumnVisible('pv') && <ResizableTh width={columnWidths.pv} onResizeStart={startColumnResize('pv')} title="Planned Value — how much of BAC should be earned by today, based on this activity's own current duration">PV</ResizableTh>}
                {isColumnVisible('ev') && <ResizableTh width={columnWidths.ev} onResizeStart={startColumnResize('ev')} title="Earned Value — BAC × physical % complete, as assessed on the linked Cost Plan line">EV</ResizableTh>}
                {isColumnVisible('ac') && <ResizableTh width={columnWidths.ac} onResizeStart={startColumnResize('ac')} title="Actual Cost — actuals recorded against this activity's linked Cost Plan line">AC</ResizableTh>}
                {isColumnVisible('cv') && <ResizableTh width={columnWidths.cv} onResizeStart={startColumnResize('cv')} title="Cost Variance — EV minus AC">CV</ResizableTh>}
                {isColumnVisible('sv') && <ResizableTh width={columnWidths.sv} onResizeStart={startColumnResize('sv')} title="Schedule Variance — EV minus PV">SV</ResizableTh>}
                {isColumnVisible('cpi') && <ResizableTh width={columnWidths.cpi} onResizeStart={startColumnResize('cpi')} title="Cost Performance Index — EV ÷ AC">CPI</ResizableTh>}
                {isColumnVisible('spi') && <ResizableTh width={columnWidths.spi} onResizeStart={startColumnResize('spi')} title="Schedule Performance Index — EV ÷ PV">SPI</ResizableTh>}
                {isColumnVisible('eac') && <ResizableTh width={columnWidths.eac} onResizeStart={startColumnResize('eac')} title="Estimate At Completion — BAC ÷ CPI">EAC</ResizableTh>}
                {isColumnVisible('etc') && <ResizableTh width={columnWidths.etc} onResizeStart={startColumnResize('etc')} title="Estimate To Complete — EAC minus AC">ETC</ResizableTh>}
                <ResizableTh width={columnWidths.actions} onResizeStart={startColumnResize('actions')} className="no-print" />
              </tr>
            </thead>
            <tbody>
              {visibleActivities.map((a, index) => {
                const editingField = editingCell?.id === a.id ? editingCell.field : null
                return (
                <tr
                  key={a.id}
                  style={{ height: GANTT_ROW_HEIGHT }}
                  className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${
                    expandedId === a.id ? 'bg-blue-50/50' : a.is_critical ? 'bg-red-50/40' : ''
                  }`}
                >
                  {isColumnVisible('code') && (
                    <td className="px-3 py-1 text-gray-500 font-mono text-xs whitespace-nowrap" onDoubleClick={() => startEdit(a, 'code')}>
                      {editingField === 'code' ? (
                        <input
                          autoFocus
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="w-20 border border-blue-400 rounded px-1 py-0.5 text-xs font-mono"
                        />
                      ) : a.code}
                    </td>
                  )}
                  {isColumnVisible('wbs') && <td className="px-3 py-1 text-gray-400 font-mono text-xs whitespace-nowrap">{a.wbs_path ?? '—'}</td>}
                  <td className="px-3 py-1" style={{ paddingLeft: 12 + depthOf(a) * 16 }}>
                    {editingField === 'task_name' ? (
                      <input
                        autoFocus
                        value={editingValue}
                        onChange={e => setEditingValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                        className="w-full max-w-[13rem] border border-blue-400 rounded px-1 py-0.5 text-sm"
                      />
                    ) : (
                      <button
                        onClick={() => handleNameClick(a)}
                        onDoubleClick={() => handleNameDoubleClick(a)}
                        className="text-left font-medium text-gray-900 hover:text-blue-600 truncate block max-w-[13rem]"
                        title="Click to open, double-click to rename in place"
                      >
                        {a.activity_type === 'wbs_summary' && '📦 '}
                        {a.task_name}
                      </button>
                    )}
                  </td>
                  {isColumnVisible('type') && (
                    <td className="px-3 py-1 text-gray-600 text-xs capitalize" onDoubleClick={() => startEdit(a, 'activity_type')}>
                      {editingField === 'activity_type' ? (
                        <select
                          autoFocus
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
                          className="border border-blue-400 rounded px-1 py-0.5 text-xs"
                        >
                          {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                        </select>
                      ) : a.activity_type.replace('_', ' ')}
                    </td>
                  )}
                  {isColumnVisible('duration') && (
                    <td className="px-3 py-1 text-gray-600" onDoubleClick={() => startEdit(a, 'duration_hours')} title={a.duration_hours !== null ? `${a.duration_hours}h` : undefined}>
                      {editingField === 'duration_hours' ? (
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          step={0.5}
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="w-16 border border-blue-400 rounded px-1 py-0.5 text-sm"
                        />
                      ) : (a.duration_days ?? '—')}
                    </td>
                  )}
                  {isColumnVisible('start') && (
                    <td
                      className="px-3 py-1 text-gray-600 whitespace-nowrap"
                      onDoubleClick={() => startEdit(a, 'start')}
                      title={a.constraint_type === 'snet' ? 'Start On or After constraint applied' : 'Double-click to set a Start On or After constraint'}
                    >
                      {editingField === 'start' ? (
                        <input
                          autoFocus
                          type="datetime-local"
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="border border-blue-400 rounded px-1 py-0.5 text-xs"
                        />
                      ) : formatDateTime(a.start)}
                    </td>
                  )}
                  {isColumnVisible('bl_start') && <td className="px-3 py-1 text-gray-400 whitespace-nowrap">{formatDateTime(a.bl_start)}</td>}
                  {isColumnVisible('finish') && (
                    <td
                      className="px-3 py-1 text-gray-600 whitespace-nowrap"
                      onDoubleClick={() => startEdit(a, 'finish')}
                      title="Double-click to change duration by setting a new finish"
                    >
                      {editingField === 'finish' ? (
                        <input
                          autoFocus
                          type="datetime-local"
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="border border-blue-400 rounded px-1 py-0.5 text-xs"
                        />
                      ) : formatDateTime(a.finish)}
                    </td>
                  )}
                  {isColumnVisible('bl_finish') && <td className="px-3 py-1 text-gray-400 whitespace-nowrap">{formatDateTime(a.bl_finish)}</td>}
                  {isColumnVisible('variance') && (
                    <td className={`px-3 py-1 ${(a.variance_days ?? 0) > 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                      {a.variance_days ?? '—'}
                    </td>
                  )}
                  {isColumnVisible('float') && (
                    <td className={`px-3 py-1 ${a.is_critical ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                      {a.total_float_hours ?? '—'}{a.total_float_hours !== null ? 'h' : ''}
                    </td>
                  )}
                  {isColumnVisible('free_float') && (
                    <td className="px-3 py-1 text-gray-600">
                      {a.free_float_hours ?? '—'}{a.free_float_hours !== null ? 'h' : ''}
                    </td>
                  )}
                  {isColumnVisible('pct_complete') && (
                    <td className="px-3 py-1 text-gray-600" onDoubleClick={() => startEdit(a, 'pct_complete')}>
                      {editingField === 'pct_complete' ? (
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          max={100}
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="w-16 border border-blue-400 rounded px-1 py-0.5 text-sm"
                        />
                      ) : `${a.pct_complete ?? 0}%`}
                    </td>
                  )}
                  {isColumnVisible('resources') && (() => {
                    const assigned = resourceAssignments.filter(ra => ra.activity_id === a.id)
                    const names = assigned.map(ra => ra.resource_name).join(', ')
                    return (
                      <td
                        className="px-3 py-1 text-gray-600 cursor-pointer"
                        onClick={() => setExpandedId(id => id === a.id ? null : a.id)}
                        title={assigned.length > 0 ? `${names} — click to view/edit` : 'Click to assign resources'}
                      >
                        {assigned.length === 0 ? <span className="text-gray-300">—</span> : (
                          <span className="truncate block max-w-[8rem]">{names}</span>
                        )}
                      </td>
                    )
                  })()}
                  {isColumnVisible('bac') && <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{formatMoney(a.bac)}</td>}
                  {isColumnVisible('pv') && <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{formatMoney(a.pv)}</td>}
                  {isColumnVisible('ev') && <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{formatMoney(a.ev)}</td>}
                  {isColumnVisible('ac') && <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{formatMoney(a.ac)}</td>}
                  {isColumnVisible('cv') && <td className={`px-3 py-1 whitespace-nowrap ${a.cv !== null && Number(a.cv) < 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{formatMoney(a.cv)}</td>}
                  {isColumnVisible('sv') && <td className={`px-3 py-1 whitespace-nowrap ${a.sv !== null && Number(a.sv) < 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{formatMoney(a.sv)}</td>}
                  {isColumnVisible('cpi') && <td className={`px-3 py-1 ${a.cpi !== null && Number(a.cpi) < 1 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{formatRatio(a.cpi)}</td>}
                  {isColumnVisible('spi') && <td className={`px-3 py-1 ${a.spi !== null && Number(a.spi) < 1 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{formatRatio(a.spi)}</td>}
                  {isColumnVisible('eac') && <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{formatMoney(a.eac)}</td>}
                  {isColumnVisible('etc') && <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{formatMoney(a.etc)}</td>}
                  <td className="px-3 py-1 text-right whitespace-nowrap no-print">
                    <button
                      onClick={() => handleCopyRow(a)}
                      title="Copy row settings (type, duration, % complete, constraint, calendar, commentary)"
                      className="text-xs text-gray-400 hover:text-blue-600 mr-1.5"
                    >
                      ⧉
                    </button>
                    <button
                      onClick={() => handlePasteRow(a)}
                      disabled={!rowClipboard}
                      title="Paste copied row settings onto this activity"
                      className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 mr-2.5"
                    >
                      📋
                    </button>
                    <button
                      onClick={() => handleMoveUp(a)}
                      disabled={isFirstSibling(a)}
                      title="Move up (reorder among siblings — doesn't change hierarchy level)"
                      className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 mr-1.5"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleMoveDown(a)}
                      disabled={isLastSibling(a)}
                      title="Move down (reorder among siblings — doesn't change hierarchy level)"
                      className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 mr-2.5"
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => handleOutdent(a)}
                      disabled={!a.parent_id}
                      title="Outdent"
                      className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 mr-1.5"
                    >
                      ⇤
                    </button>
                    <button
                      onClick={() => handleIndent(a)}
                      disabled={index === 0}
                      title="Indent"
                      className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 mr-2.5"
                    >
                      ⇥
                    </button>
                    <button onClick={() => handleDelete(a)} className="text-xs text-gray-400 hover:text-red-600">
                      Delete
                    </button>
                  </td>
                </tr>
                )
              })}
              {visibleActivities.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.size + 2} className="px-4 py-10 text-center text-gray-400 text-sm">
                    {activities.length === 0
                      ? 'No activities yet for this period. Add the first one above.'
                      : 'No activities match your search/filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div
          onMouseDown={startPaneResize}
          title="Drag to resize"
          className="w-1.5 shrink-0 cursor-col-resize bg-gray-100 hover:bg-blue-300 active:bg-blue-400 no-print"
        />
        <div className="flex-1 overflow-hidden no-print" style={{ maxHeight: PANE_MAX_HEIGHT }}>
          <SyncfusionGanttChart
            activities={visibleActivities}
            relationships={relationships}
            leftPaneRef={leftPaneRef}
            height={PANE_MAX_HEIGHT}
          />
        </div>
      </div>

      {expandedActivity && (
        <div className="bg-white border border-gray-200 rounded-lg mt-3 overflow-hidden no-print">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <div className="text-sm font-semibold text-gray-700">
              {expandedActivity.code}: {expandedActivity.task_name}
            </div>
            <button onClick={() => setExpandedId(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>
          <div className="grid grid-cols-5 divide-x divide-gray-100">
            <div className="col-span-3">
              <ActivityForm
                activity={expandedActivity} calendars={calendars} embedded
                onCancel={() => setExpandedId(null)}
                onSubmit={(values, note) => handleUpdate(expandedActivity, values, note)}
              />
            </div>
            <div className="col-span-2 divide-y divide-gray-100 overflow-y-auto" style={{ maxHeight: 420 }}>
              <ActivityLogic activity={expandedActivity} activities={activities} relationships={relationships} onChange={refresh} />
              <ResourceAssignments activity={expandedActivity} resources={resources} onChange={refresh} />
              <ReassessmentLog
                recordType="activity"
                recordId={expandedActivity.id}
                refreshKey={reassessmentRefreshKey}
                onLogged={() => refresh()}
              />
            </div>
          </div>
        </div>
      )}
    </div>
    <SchedulingPrintView activities={visibleActivities} relationships={relationships} projectName={selectedProject.name} />
    </>
  )
}
