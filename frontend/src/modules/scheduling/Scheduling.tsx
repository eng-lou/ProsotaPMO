import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { ActivityForm, toActivityPayload, type ActivityFormValues } from './ActivityForm'
import { ActivityLogic } from './ActivityLogic'
import { CalendarWidget } from './CalendarWidget'
import { GanttChart, GANTT_ROW_HEIGHT } from './GanttChart'
import type { Activity, ActivityRelationship, Calendar } from './types'

const PANE_MAX_HEIGHT = 600

export function Scheduling() {
  const { selectedProject } = useProject()
  const { period, loading: periodLoading, error: periodError } = useActivePeriod(selectedProject?.id)
  const [activities, setActivities] = useState<Activity[]>([])
  const [relationships, setRelationships] = useState<ActivityRelationship[]>([])
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [calendarWidgetOpen, setCalendarWidgetOpen] = useState(false)

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
        const [activitiesRes, relationshipsRes, calendarsRes] = await Promise.all([
          api.get<Activity[]>('/api/v1/activities/', {
            params: { project_id: selectedProject!.id, period_id: period!.id },
          }),
          api.get<ActivityRelationship[]>('/api/v1/activity-relationships/', {
            params: { period_id: period!.id },
          }),
          api.get<Calendar[]>('/api/v1/calendars/', {
            params: { project_id: selectedProject!.id },
          }),
        ])
        if (!cancelled) {
          setActivities(activitiesRes.data)
          setRelationships(relationshipsRes.data)
          setCalendars(calendarsRes.data)
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

  if (!selectedProject) return null

  const refresh = async () => {
    if (!period) return
    const [activitiesRes, relationshipsRes, calendarsRes] = await Promise.all([
      api.get<Activity[]>('/api/v1/activities/', {
        params: { project_id: selectedProject.id, period_id: period.id },
      }),
      api.get<ActivityRelationship[]>('/api/v1/activity-relationships/', {
        params: { period_id: period.id },
      }),
      api.get<Calendar[]>('/api/v1/calendars/', {
        params: { project_id: selectedProject.id },
      }),
    ])
    setActivities(activitiesRes.data)
    setRelationships(relationshipsRes.data)
    setCalendars(calendarsRes.data)
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
    const index = activities.findIndex(a => a.id === activity.id)
    if (index <= 0) return
    const newParent = activities[index - 1]
    await api.patch(`/api/v1/activities/${activity.id}`, { parent_id: newParent.id })
    await refresh()
  }

  const handleOutdent = async (activity: Activity) => {
    if (!activity.parent_id) return
    const parent = activities.find(a => a.id === activity.parent_id)
    await api.patch(`/api/v1/activities/${activity.id}`, { parent_id: parent?.parent_id ?? null })
    await refresh()
  }

  const depthOf = (a: Activity) => (a.wbs_path ? a.wbs_path.split('.').length - 1 : 0)
  const expandedActivity = activities.find(a => a.id === expandedId) ?? null

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
        Activities for {selectedProject.name}. Start/finish dates, float, and the critical path are computed from
        duration + logic + calendars — set duration and link activities to see them. Baselines are still pending.
        See <span className="font-mono text-xs">docs/SCHEDULING_MODULE_PLAN.md</span> for the staged rollout.
      </p>

      {(error || periodError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error ?? periodError}</div>
      )}

      {calendarWidgetOpen && (
        <CalendarWidget
          projectId={selectedProject.id}
          calendars={calendars}
          onChange={refresh}
          onClose={() => setCalendarWidgetOpen(false)}
        />
      )}

      {formOpen && (
        <ActivityForm activity={null} calendars={calendars} onCancel={() => setFormOpen(false)} onSubmit={handleCreate} />
      )}
      {editingActivity && (
        <ActivityForm activity={editingActivity} calendars={calendars} onCancel={() => setEditingActivity(null)} onSubmit={handleUpdate} />
      )}

      {!formOpen && !editingActivity && (
        <div className="mb-4 flex items-center gap-3">
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
        </div>
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
                <th className="px-3 py-2.5 w-16">WBS</th>
                <th className="px-3 py-2.5 w-56">Activity</th>
                <th className="px-3 py-2.5 w-24">Type</th>
                <th className="px-3 py-2.5 w-16">Dur</th>
                <th className="px-3 py-2.5 w-24">Start</th>
                <th className="px-3 py-2.5 w-24">Finish</th>
                <th className="px-3 py-2.5 w-16">Var (d)</th>
                <th className="px-3 py-2.5 w-16">Float</th>
                <th className="px-3 py-2.5 w-20">% Comp</th>
                <th className="px-3 py-2.5 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a, index) => (
                <tr
                  key={a.id}
                  style={{ height: GANTT_ROW_HEIGHT }}
                  className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${
                    expandedId === a.id ? 'bg-blue-50/50' : a.is_critical ? 'bg-red-50/40' : ''
                  }`}
                >
                  <td className="px-3 py-1 text-gray-500 font-mono text-xs whitespace-nowrap">{a.code}</td>
                  <td className="px-3 py-1 text-gray-400 font-mono text-xs whitespace-nowrap">{a.wbs_path ?? '—'}</td>
                  <td className="px-3 py-1" style={{ paddingLeft: 12 + depthOf(a) * 16 }}>
                    <button onClick={() => setEditingActivity(a)} className="text-left font-medium text-gray-900 hover:text-blue-600 truncate block max-w-[13rem]">
                      {a.activity_type === 'wbs_summary' && '📦 '}
                      {a.task_name}
                    </button>
                  </td>
                  <td className="px-3 py-1 text-gray-600 text-xs capitalize">{a.activity_type.replace('_', ' ')}</td>
                  <td className="px-3 py-1 text-gray-600">{a.duration_days ?? '—'}</td>
                  <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{a.start ?? '—'}</td>
                  <td className="px-3 py-1 text-gray-600 whitespace-nowrap">{a.finish ?? '—'}</td>
                  <td className="px-3 py-1 text-gray-600">{a.variance_days ?? '—'}</td>
                  <td className={`px-3 py-1 ${a.is_critical ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                    {a.total_float ?? '—'}
                  </td>
                  <td className="px-3 py-1 text-gray-600">{a.pct_complete ?? 0}%</td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">
                    <button
                      onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                      title="Logic (predecessors/successors)"
                      className={`text-xs mr-2 ${expandedId === a.id ? 'text-blue-600 font-semibold' : 'text-gray-400 hover:text-blue-600'}`}
                    >
                      🔗
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
              ))}
              {activities.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">
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
          <GanttChart activities={activities} relationships={relationships} />
        </div>
      </div>

      {expandedActivity && (
        <div className="bg-white border border-gray-200 rounded-lg mt-3 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <div className="text-sm font-semibold text-gray-700">
              Logic — {expandedActivity.code}: {expandedActivity.task_name}
            </div>
            <button onClick={() => setExpandedId(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>
          <ActivityLogic activity={expandedActivity} activities={activities} relationships={relationships} onChange={refresh} />
        </div>
      )}
    </div>
  )
}
