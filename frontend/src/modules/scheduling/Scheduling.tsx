import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { ActivityForm, toActivityPayload, type ActivityFormValues } from './ActivityForm'
import { GanttChart, GANTT_ROW_HEIGHT } from './GanttChart'
import type { Activity } from './types'

const PANE_MAX_HEIGHT = 600

export function Scheduling() {
  const { selectedProject } = useProject()
  const { period, loading: periodLoading, error: periodError } = useActivePeriod(selectedProject?.id)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)

  // Left (data grid) and right (Gantt) panes scroll independently in the DOM but must
  // stay row-aligned — see "Gantt Chart — Rendering Plan" in docs/SCHEDULING_MODULE_PLAN.md.
  const leftPaneRef = useRef<HTMLDivElement>(null)
  const rightPaneRef = useRef<HTMLDivElement>(null)
  const syncingScroll = useRef(false)

  const syncScroll = (source: 'left' | 'right') => {
    if (syncingScroll.current) {
      syncingScroll.current = false
      return
    }
    const from = source === 'left' ? leftPaneRef.current : rightPaneRef.current
    const to = source === 'left' ? rightPaneRef.current : leftPaneRef.current
    if (!from || !to) return
    syncingScroll.current = true
    to.scrollTop = from.scrollTop
  }

  useEffect(() => {
    if (!selectedProject || !period) return
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const { data } = await api.get<Activity[]>('/api/v1/activities/', {
          params: { project_id: selectedProject!.id, period_id: period!.id },
        })
        if (!cancelled) setActivities(data)
      } catch {
        if (!cancelled) setError('Failed to load schedule')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedProject, period])

  if (!selectedProject) return null

  const refresh = async () => {
    if (!period) return
    const { data } = await api.get<Activity[]>('/api/v1/activities/', {
      params: { project_id: selectedProject.id, period_id: period.id },
    })
    setActivities(data)
  }

  const handleCreate = async (values: ActivityFormValues) => {
    if (!period) return
    await api.post('/api/v1/activities/', {
      ...toActivityPayload(values),
      project_id: selectedProject.id,
      period_id: period.id,
    })
    setFormOpen(false)
    await refresh()
  }

  const handleUpdate = async (values: ActivityFormValues) => {
    if (!editingActivity) return
    await api.patch(`/api/v1/activities/${editingActivity.id}`, toActivityPayload(values))
    setEditingActivity(null)
    await refresh()
  }

  const handleDelete = async (activity: Activity) => {
    if (!window.confirm(`Delete activity "${activity.task_name}"? This cannot be undone.`)) return
    await api.delete(`/api/v1/activities/${activity.id}`)
    await refresh()
  }

  if (loading || periodLoading) {
    return <div className="p-8 text-sm text-gray-400">Loading schedule…</div>
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Scheduling</h1>
        {period && (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
            {period.period_label} · {period.freeze_status}
          </span>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-6">
        Activities for {selectedProject.name}. Logic, calendars, the critical path and baselines aren't computed
        yet — see <span className="font-mono text-xs">docs/SCHEDULING_MODULE_PLAN.md</span> for the staged rollout.
      </p>

      {(error || periodError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error ?? periodError}</div>
      )}

      {formOpen && <ActivityForm activity={null} onCancel={() => setFormOpen(false)} onSubmit={handleCreate} />}
      {editingActivity && (
        <ActivityForm activity={editingActivity} onCancel={() => setEditingActivity(null)} onSubmit={handleUpdate} />
      )}

      {!formOpen && !editingActivity && (
        <button onClick={() => setFormOpen(true)} className="mb-4 text-sm text-blue-600 hover:text-blue-700 font-medium">
          + Add Activity
        </button>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex">
        <div
          ref={leftPaneRef}
          onScroll={() => syncScroll('left')}
          className="overflow-y-auto overflow-x-hidden shrink-0"
          style={{ maxHeight: PANE_MAX_HEIGHT }}
        >
          <table className="text-sm border-collapse">
            <thead>
              <tr
                style={{ height: 36 }}
                className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-500 font-medium uppercase tracking-wide sticky top-0"
              >
                <th className="px-3 py-2.5 w-24">Code</th>
                <th className="px-3 py-2.5 w-56">Activity</th>
                <th className="px-3 py-2.5 w-24">Type</th>
                <th className="px-3 py-2.5 w-16">Dur</th>
                <th className="px-3 py-2.5 w-24">Start</th>
                <th className="px-3 py-2.5 w-24">Finish</th>
                <th className="px-3 py-2.5 w-16">Var (d)</th>
                <th className="px-3 py-2.5 w-20">% Comp</th>
                <th className="px-3 py-2.5 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {activities.map(a => (
                <tr key={a.id} style={{ height: GANTT_ROW_HEIGHT }} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-1 text-gray-500 font-mono text-xs whitespace-nowrap">{a.code}</td>
                  <td className="px-3 py-1">
                    <button onClick={() => setEditingActivity(a)} className="text-left font-medium text-gray-900 hover:text-blue-600 truncate block max-w-[13rem]">
                      {a.task_name}
                    </button>
                  </td>
                  <td className="px-3 py-1 text-gray-600 text-xs capitalize">{a.activity_type.replace('_', ' ')}</td>
                  <td className="px-3 py-1 text-gray-600">{a.duration_days ?? '—'}</td>
                  <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{a.start ?? '—'}</td>
                  <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{a.finish ?? '—'}</td>
                  <td className="px-3 py-1 text-gray-600">{a.variance_days ?? '—'}</td>
                  <td className="px-3 py-1 text-gray-600">{a.pct_complete ?? 0}%</td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">
                    <button onClick={() => handleDelete(a)} className="text-xs text-gray-400 hover:text-red-600">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {activities.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">
                    No activities yet for this period. Add the first one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div
          ref={rightPaneRef}
          onScroll={() => syncScroll('right')}
          className="flex-1 overflow-auto border-l border-gray-200"
          style={{ maxHeight: PANE_MAX_HEIGHT }}
        >
          <GanttChart activities={activities} />
        </div>
      </div>
    </div>
  )
}
