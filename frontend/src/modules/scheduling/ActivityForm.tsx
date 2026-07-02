import { useState } from 'react'
import { ACTIVITY_TYPES, CONSTRAINT_TYPES, type Activity, type ActivityType, type Calendar, type ConstraintType } from './types'

export interface ActivityFormValues {
  task_name: string
  activity_type: ActivityType
  duration_days: string
  actual_start: string
  actual_finish: string
  remaining_duration_days: string
  pct_complete: string
  commentary: string
  constraint_type: ConstraintType | ''
  constraint_date: string
  calendar_id: string
}

function toFormValues(activity: Activity | null): ActivityFormValues {
  return {
    task_name: activity?.task_name ?? '',
    activity_type: activity?.activity_type ?? 'task',
    duration_days: activity?.duration_days?.toString() ?? '',
    actual_start: activity?.actual_start ?? '',
    actual_finish: activity?.actual_finish ?? '',
    remaining_duration_days: activity?.remaining_duration_days?.toString() ?? '',
    pct_complete: activity?.pct_complete ?? '',
    commentary: activity?.commentary ?? '',
    constraint_type: activity?.constraint_type ?? '',
    constraint_date: activity?.constraint_date ?? '',
    calendar_id: activity?.calendar_id ?? '',
  }
}

export function toActivityPayload(values: ActivityFormValues) {
  const isMilestone = values.activity_type === 'milestone'
  const isAsap = !values.constraint_type || values.constraint_type === 'asap'
  return {
    task_name: values.task_name,
    activity_type: values.activity_type,
    duration_days: isMilestone ? 0 : values.duration_days ? Number(values.duration_days) : null,
    actual_start: values.actual_start || null,
    actual_finish: values.actual_finish || null,
    remaining_duration_days: values.remaining_duration_days ? Number(values.remaining_duration_days) : null,
    pct_complete: values.pct_complete ? Number(values.pct_complete) : null,
    commentary: values.commentary || null,
    constraint_type: isAsap ? null : values.constraint_type,
    constraint_date: isAsap ? null : values.constraint_date || null,
    calendar_id: values.calendar_id || null,
  }
}

interface Props {
  activity: Activity | null
  calendars: Calendar[]
  onCancel: () => void
  onSubmit: (values: ActivityFormValues) => Promise<void>
}

const TYPE_LABELS: Record<ActivityType, string> = {
  task: 'Task',
  milestone: 'Milestone',
  wbs_summary: 'WBS Summary',
}

export function ActivityForm({ activity, calendars, onCancel, onSubmit }: Props) {
  const [values, setValues] = useState<ActivityFormValues>(toFormValues(activity))
  const [submitting, setSubmitting] = useState(false)

  const set = <K extends keyof ActivityFormValues>(key: K, value: ActivityFormValues[K]) =>
    setValues(v => ({ ...v, [key]: value }))

  const isMilestone = values.activity_type === 'milestone'
  const isAsap = !values.constraint_type || values.constraint_type === 'asap'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit(values)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-5 mb-4 grid grid-cols-2 gap-4">
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
            <div className="font-medium text-gray-700">{activity.start ?? '—'}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">Finish (computed)</div>
            <div className="font-medium text-gray-700">{activity.finish ?? '—'}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">Total Float</div>
            <div className="font-medium text-gray-700">{activity.total_float ?? '—'}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">Critical?</div>
            <div className="font-medium text-gray-700">{activity.is_critical === null ? '—' : activity.is_critical ? 'Yes' : 'No'}</div>
          </div>
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Actual Start</label>
        <input type="date" value={values.actual_start} onChange={e => set('actual_start', e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Actual Finish</label>
        <input type="date" value={values.actual_finish} onChange={e => set('actual_finish', e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Remaining Duration (days)</label>
        <input type="number" min={0} value={values.remaining_duration_days} onChange={e => set('remaining_duration_days', e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
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
        <label className="block text-xs font-semibold text-gray-600 mb-1">Constraint Date</label>
        <input
          type="date"
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
      <div className="col-span-2">
        <label className="block text-xs font-semibold text-gray-600 mb-1">Commentary</label>
        <textarea value={values.commentary} onChange={e => set('commentary', e.target.value)} rows={2} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm resize-y" />
      </div>
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
