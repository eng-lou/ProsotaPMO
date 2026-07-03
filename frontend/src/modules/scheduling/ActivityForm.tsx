import { useState } from 'react'
import { formatDateTime, toDatetimeLocalValue } from './dateTime'
import { resolveHoursPerDay } from './durationDisplay'
import {
  ACTIVITY_TYPES,
  CONSTRAINT_TYPES,
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
  actual_start: string
  actual_finish: string
  pct_complete: string
  constraint_type: ConstraintType | ''
  constraint_date: string
  calendar_id: string
}

function toFormValues(activity: Activity | null): ActivityFormValues {
  return {
    task_name: activity?.task_name ?? '',
    activity_type: activity?.activity_type ?? 'task',
    duration_days: activity?.duration_days?.toString() ?? '',
    actual_start: toDatetimeLocalValue(activity?.actual_start),
    actual_finish: toDatetimeLocalValue(activity?.actual_finish),
    pct_complete: activity?.pct_complete ?? '',
    constraint_type: activity?.constraint_type ?? '',
    constraint_date: toDatetimeLocalValue(activity?.constraint_date),
    calendar_id: activity?.calendar_id ?? '',
  }
}

export function toActivityPayload(values: ActivityFormValues, calendars: Calendar[]) {
  const isMilestone = values.activity_type === 'milestone'
  const isAsap = !values.constraint_type || values.constraint_type === 'asap'
  const hoursPerDay = resolveHoursPerDay({ calendar_id: values.calendar_id || null }, calendars)
  return {
    task_name: values.task_name,
    activity_type: values.activity_type,
    duration_hours: isMilestone ? 0 : values.duration_days ? Number(values.duration_days) * hoursPerDay : null,
    actual_start: values.actual_start || null,
    actual_finish: values.actual_finish || null,
    pct_complete: values.pct_complete ? Number(values.pct_complete) : null,
    constraint_type: isAsap ? null : values.constraint_type,
    constraint_date: isAsap ? null : values.constraint_date || null,
    calendar_id: values.calendar_id || null,
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
  milestone: 'Milestone',
  wbs_summary: 'WBS Summary',
}

export function ActivityForm({ activity, calendars, onCancel, onSubmit, embedded = false }: Props) {
  const [initialValues] = useState<ActivityFormValues>(() => toFormValues(activity))
  const [values, setValues] = useState<ActivityFormValues>(initialValues)
  const [submitting, setSubmitting] = useState(false)
  const [reassessmentNote, setReassessmentNote] = useState('')

  const set = <K extends keyof ActivityFormValues>(key: K, value: ActivityFormValues[K]) =>
    setValues(v => ({ ...v, [key]: value }))

  const isMilestone = values.activity_type === 'milestone'
  const isAsap = !values.constraint_type || values.constraint_type === 'asap'

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
      className={embedded ? 'p-4 grid grid-cols-2 gap-4' : 'bg-white border border-gray-200 rounded-lg p-5 mb-4 grid grid-cols-2 gap-4'}
    >
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-gray-600 mb-1">Activity Name</label>
        <input
          value={values.task_name}
          onChange={e => set('task_name', e.target.value)}
          required
          className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Type</label>
        <select
          value={values.activity_type}
          onChange={e => set('activity_type', e.target.value as ActivityType)}
          className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Duration (days)</label>
        <input
          type="number"
          min={0}
          step={0.5}
          value={isMilestone ? 0 : values.duration_days}
          disabled={isMilestone}
          onChange={e => set('duration_days', e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>
      {activity && (
        <div className="col-span-2 grid grid-cols-4 gap-3 bg-gray-50 rounded-md p-2.5 text-xs">
          <div>
            <div className="text-gray-400 mb-0.5">Start (computed)</div>
            <div className="font-medium text-gray-700">{formatDateTime(activity.start)}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">Finish (computed)</div>
            <div className="font-medium text-gray-700">{formatDateTime(activity.finish)}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">Total Float</div>
            <div className="font-medium text-gray-700">
              {activity.total_float_hours ?? '—'}{activity.total_float_hours !== null ? 'h' : ''}
            </div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">Critical?</div>
            <div className="font-medium text-gray-700">{activity.is_critical === null ? '—' : activity.is_critical ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">BL Start</div>
            <div className="font-medium text-gray-700">{formatDateTime(activity.bl_start)}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">BL Finish</div>
            <div className="font-medium text-gray-700">{formatDateTime(activity.bl_finish)}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">Variance (d)</div>
            <div className={`font-medium ${(activity.variance_days ?? 0) > 0 ? 'text-red-600' : 'text-gray-700'}`}>
              {activity.variance_days ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">Duration (hours)</div>
            <div className="font-medium text-gray-700">{activity.duration_hours ?? '—'}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5" title="Computed: Duration x (1 - % Complete) — not directly editable">Remaining Duration (d)</div>
            <div className="font-medium text-gray-700">
              {activity.remaining_duration_hours != null
                ? (Number(activity.remaining_duration_hours) / resolveHoursPerDay(activity, calendars)).toFixed(1)
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5" title="How far along its own current Start/Finish this activity should be by the data date — the input Planned Value (PV) is prorated from. Distinct from % Complete below, which is manually assessed physical progress.">Duration % Complete</div>
            <div className="font-medium text-gray-700">
              {activity.duration_pct_complete != null ? `${Number(activity.duration_pct_complete).toFixed(1)}%` : '—'}
            </div>
          </div>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Actual Start</label>
        <input type="datetime-local" value={values.actual_start} onChange={e => set('actual_start', e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Actual Finish</label>
        <input type="datetime-local" value={values.actual_finish} onChange={e => set('actual_finish', e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">% Complete</label>
        <input type="number" min={0} max={100} value={values.pct_complete} onChange={e => set('pct_complete', e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Constraint Type</label>
        <select
          value={values.constraint_type}
          onChange={e => set('constraint_type', e.target.value as ConstraintType | '')}
          className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          {CONSTRAINT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Constraint Date/Time</label>
        <input
          type="datetime-local"
          value={isAsap ? '' : values.constraint_date}
          disabled={isAsap}
          onChange={e => set('constraint_date', e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Calendar</label>
        <select
          value={values.calendar_id}
          onChange={e => set('calendar_id', e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">(inherit project default)</option>
          {calendars.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.is_project_default ? ' (default)' : ''}</option>
          ))}
        </select>
      </div>
      {hasTriggerChanges && (
        <div className="col-span-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Duration, % complete, or constraint changed — what changed and why? (optional, logged with today's date)
          </label>
          <textarea
            value={reassessmentNote}
            onChange={e => setReassessmentNote(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            rows={2}
            placeholder="e.g. Duration extended from 5 to 8 days following a revised piling sequence."
          />
        </div>
      )}
      <div className="col-span-2 flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-sm px-4 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {activity ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  )
}
