import { useMemo, useState } from 'react'
import { formatDateTime, toDatetimeLocalValue } from './dateTime'
import { buildCalendarLookup, formatFloatDays, resolveHoursPerDay, type CalendarLookup } from './durationDisplay'
import {
  ACTIVITY_TYPES,
  CONSTRAINT_TYPES,
  isMilestoneType,
  REASSESSMENT_TRIGGER_FIELDS,
  type Activity,
  type ActivityType,
  type Calendar,
  type ConstraintType,
} from './types'

export interface ActivityFormValues {
  task_name: string
  activity_type: ActivityType
  // Collected in days (what planners actually type), converted to duration_hours
  // in toActivityPayload below — the backend's hour-precision CPM engine (Phase
  // 10) is unaffected, this is purely a display/input convenience.
  duration_days: string
  pct_complete: string
  constraint_type: ConstraintType | ''
  constraint_date: string
  calendar_id: string
  // P6's suspend/resume actuals (docs/SCHEDULING_GAPS_PLAN.md Phase 11) —
  // plain user-entered facts, no CPM interaction for this first cut.
  suspend_date: string
  resume_date: string
}

function toFormValues(activity: Activity | null): ActivityFormValues {
  return {
    task_name: activity?.task_name ?? '',
    activity_type: activity?.activity_type ?? 'task',
    duration_days: activity?.duration_days?.toString() ?? '',
    pct_complete: activity?.pct_complete ?? '',
    constraint_type: activity?.constraint_type ?? '',
    constraint_date: toDatetimeLocalValue(activity?.constraint_date),
    calendar_id: activity?.calendar_id ?? '',
    suspend_date: toDatetimeLocalValue(activity?.suspend_date),
    resume_date: toDatetimeLocalValue(activity?.resume_date),
  }
}

// isParent reflects the activity's *actual, structural* wbs_summary status
// (has real children right now) — not values.activity_type, which is just
// whatever the form's Type dropdown currently shows and can't itself demote
// a parent (that only happens by removing its children; see
// app/services/activity.py:_recompute_hierarchy). A WBS/Project summary
// row's duration/% complete/constraint/calendar are rollups from its
// children — the backend rejects these outright for one (2026-07-06, per
// Maro), so they're left out of the payload entirely rather than sent back
// unchanged.
export function toActivityPayload(values: ActivityFormValues, calendarLookup: CalendarLookup, isParent: boolean) {
  const isMilestone = isMilestoneType(values.activity_type)
  const isAsap = !values.constraint_type || values.constraint_type === 'asap'
  // alap needs no date either (2026-07-07, per Maro) — a relative positioning
  // directive, not an exact one — but unlike asap it's still a real,
  // distinct constraint_type to store, not nulled out to "no constraint".
  const needsNoDate = isAsap || values.constraint_type === 'alap'
  const hoursPerDay = resolveHoursPerDay({ calendar_id: values.calendar_id || null }, calendarLookup)
  const payload: Record<string, unknown> = {
    task_name: values.task_name,
    activity_type: values.activity_type,
  }
  if (isParent) return payload
  return {
    ...payload,
    duration_hours: isMilestone ? 0 : values.duration_days ? Number(values.duration_days) * hoursPerDay : null,
    pct_complete: values.pct_complete ? Number(values.pct_complete) : null,
    constraint_type: isAsap ? null : values.constraint_type,
    constraint_date: needsNoDate ? null : values.constraint_date || null,
    calendar_id: values.calendar_id || null,
    suspend_date: values.suspend_date || null,
    resume_date: values.resume_date || null,
  }
}

interface Props {
  activity: Activity | null
  calendars: Calendar[]
  onCancel: () => void
  onSubmit: (values: ActivityFormValues, reassessmentNote: string | null) => Promise<void>
  // True when rendered inside the unified activity-detail panel (Scheduling.tsx),
  // which already provides its own white/border/rounded chrome — the standalone
  // "+ Add Activity" flow (activity === null) still needs its own.
  embedded?: boolean
}

const TYPE_LABELS: Record<ActivityType, string> = {
  task: 'Task',
  start_milestone: 'Start Milestone',
  finish_milestone: 'Finish Milestone',
  wbs_summary: 'WBS Summary',
}

export function ActivityForm({ activity, calendars, onCancel, onSubmit, embedded = false }: Props) {
  const calendarLookup = useMemo(() => buildCalendarLookup(calendars), [calendars])
  const [initialValues] = useState<ActivityFormValues>(() => toFormValues(activity))
  const [values, setValues] = useState<ActivityFormValues>(initialValues)
  const [submitting, setSubmitting] = useState(false)
  const [reassessmentNote, setReassessmentNote] = useState('')

  const set = <K extends keyof ActivityFormValues>(key: K, value: ActivityFormValues[K]) =>
    setValues(v => ({ ...v, [key]: value }))

  const isMilestone = isMilestoneType(values.activity_type)
  const isAsap = !values.constraint_type || values.constraint_type === 'asap'
  // See toActivityPayload's own needsNoDate — alap needs no date either.
  const needsNoDate = isAsap || values.constraint_type === 'alap'
  // The activity's real, structural parent status — see toActivityPayload's
  // own comment above for why this must be the activity prop's actual type,
  // not the (freely, but ineffectively) editable Type dropdown.
  const isParent = activity?.activity_type === 'wbs_summary'

  // Compared against the form's own initial snapshot (not the raw activity object) —
  // constraint_date/actual_* are datetime-local values truncated to the minute, while
  // the activity carries full ISO datetimes with seconds; comparing against the raw
  // activity would flag every untouched datetime field as "changed".
  const hasTriggerChanges = activity !== null && REASSESSMENT_TRIGGER_FIELDS.some(
    field => (initialValues[field] ?? '') !== (values[field] ?? '')
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit(values, hasTriggerChanges && reassessmentNote.trim() ? reassessmentNote.trim() : null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={embedded ? 'p-4 grid grid-cols-2 gap-4' : 'bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 mb-4 grid grid-cols-2 gap-4'}
    >
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">Activity Name</label>
        <input
          value={values.task_name}
          onChange={e => set('task_name', e.target.value)}
          required
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">
          Type{isParent && <span className="font-normal text-gray-400 dark:text-prosota-muted"> — auto-set by having children</span>}
        </label>
        <select
          value={values.activity_type}
          disabled={isParent}
          title={isParent ? 'A WBS/Project summary is set automatically by having children, not manually chosen — remove them to change this' : undefined}
          onChange={e => set('activity_type', e.target.value as ActivityType)}
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        >
          {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">
          Duration (days){isParent && <span className="font-normal text-gray-400 dark:text-prosota-muted"> — computed from children</span>}
        </label>
        <input
          type="number"
          min={0}
          step={0.5}
          value={isMilestone ? 0 : values.duration_days}
          disabled={isMilestone || isParent}
          title={isParent ? 'Rolled up from this WBS/Project summary\'s own children — outdent or remove them to edit this directly' : undefined}
          onChange={e => set('duration_days', e.target.value)}
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>
      {activity && (
        <div className="col-span-2 grid grid-cols-4 gap-3 bg-gray-50 dark:bg-prosota-panel2 rounded-md p-2.5 text-xs">
          <div>
            <div className="text-gray-400 dark:text-prosota-muted mb-0.5">Start (computed)</div>
            <div className="font-medium text-gray-700 dark:text-prosota-muted">
              {/* A Finish Milestone's Start is populated equal to its Finish
                  internally (CPM needs a concrete instant either way), but
                  isn't its own meaningful date — shown as n/a rather than a
                  redundant duplicate of Finish below (2026-07-07, per Maro). */}
              {activity.activity_type === 'finish_milestone' ? 'n/a for a Finish Milestone' : formatDateTime(activity.start)}
            </div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-prosota-muted mb-0.5">Finish (computed)</div>
            <div className="font-medium text-gray-700 dark:text-prosota-muted">
              {activity.activity_type === 'start_milestone' ? 'n/a for a Start Milestone' : formatDateTime(activity.finish)}
            </div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-prosota-muted mb-0.5">Total Float (d)</div>
            <div className="font-medium text-gray-700 dark:text-prosota-muted">{formatFloatDays(activity.total_float_hours, activity, calendarLookup)}</div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-prosota-muted mb-0.5">Critical?</div>
            <div className="font-medium text-gray-700 dark:text-prosota-muted">{activity.is_critical === null ? '—' : activity.is_critical ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-prosota-muted mb-0.5">BL Start</div>
            <div className="font-medium text-gray-700 dark:text-prosota-muted">{formatDateTime(activity.bl_start)}</div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-prosota-muted mb-0.5">BL Finish</div>
            <div className="font-medium text-gray-700 dark:text-prosota-muted">{formatDateTime(activity.bl_finish)}</div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-prosota-muted mb-0.5">Variance (d)</div>
            <div className={`font-medium ${(activity.variance_days ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-prosota-muted'}`}>
              {activity.variance_days ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-prosota-muted mb-0.5" title="Computed: Duration x (1 - % Complete) — not directly editable">Remaining Duration (d)</div>
            <div className="font-medium text-gray-700 dark:text-prosota-muted">
              {activity.remaining_duration_hours != null
                ? (Number(activity.remaining_duration_hours) / resolveHoursPerDay(activity, calendarLookup)).toFixed(1)
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-gray-400 dark:text-prosota-muted mb-0.5" title="How far along its own current Start/Finish this activity should be by the data date — the input Planned Value (PV) is prorated from. Distinct from % Complete below, which is manually assessed physical progress.">Duration % Complete</div>
            <div className="font-medium text-gray-700 dark:text-prosota-muted">
              {activity.duration_pct_complete != null ? `${Number(activity.duration_pct_complete).toFixed(1)}%` : '—'}
            </div>
          </div>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">
          % Complete{isParent && <span className="font-normal text-gray-400 dark:text-prosota-muted"> — weighted average of children</span>}
        </label>
        <input
          type="number" min={0} max={100} value={values.pct_complete}
          disabled={isParent}
          title={isParent ? 'A weighted average of this WBS/Project summary\'s own children\'s % Complete' : undefined}
          onChange={e => set('pct_complete', e.target.value)}
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">
          Constraint Type{isParent && <span className="font-normal text-gray-400 dark:text-prosota-muted"> — n/a for summary rows</span>}
        </label>
        <select
          value={values.constraint_type}
          disabled={isParent}
          title={isParent ? 'Not used for a WBS/Project summary — demote it to a task (remove its children) to set a constraint' : undefined}
          onChange={e => set('constraint_type', e.target.value as ConstraintType | '')}
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        >
          {CONSTRAINT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">Constraint Date/Time</label>
        <input
          type="datetime-local"
          value={needsNoDate ? '' : values.constraint_date}
          disabled={needsNoDate || isParent}
          onChange={e => set('constraint_date', e.target.value)}
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">
          Calendar{isParent && <span className="font-normal text-gray-400 dark:text-prosota-muted"> — n/a for summary rows</span>}
        </label>
        <select
          value={values.calendar_id}
          disabled={isParent}
          title={isParent ? 'Not used for a WBS/Project summary — it isn\'t part of the CPM network itself' : undefined}
          onChange={e => set('calendar_id', e.target.value)}
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">(inherit project default)</option>
          {calendars.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.is_project_default ? ' (default)' : ''}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1" title="Distinct from Actual Start/Finish — an activity can start, get suspended mid-flight, then resume later.">
          Suspend Date/Time
        </label>
        <input
          type="datetime-local"
          value={values.suspend_date}
          onChange={e => set('suspend_date', e.target.value)}
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">Resume Date/Time</label>
        <input
          type="datetime-local"
          value={values.resume_date}
          onChange={e => set('resume_date', e.target.value)}
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm"
        />
      </div>
      {hasTriggerChanges && (
        <div className="col-span-2 p-3 bg-blue-50 border border-blue-200 dark:border-prosota-azure/30 rounded-md">
          <label className="block text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">
            Duration, % complete, or constraint changed — what changed and why? (optional, logged with today's date)
          </label>
          <textarea
            value={reassessmentNote}
            onChange={e => setReassessmentNote(e.target.value)}
            className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm"
            rows={2}
            placeholder="e.g. Duration extended from 5 to 8 days following a revised piling sequence."
          />
        </div>
      )}
      <div className="col-span-2 flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-sm px-4 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-50">
          {activity ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  )
}
