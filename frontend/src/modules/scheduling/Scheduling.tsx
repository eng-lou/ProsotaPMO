import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { ReassessmentLog } from '@/components/ReassessmentLog'
import { ActivityForm, toActivityPayload, type ActivityFormValues } from './ActivityForm'
import { ActivityLogic } from './ActivityLogic'
import { CalendarWidget } from './CalendarWidget'
import { downloadActivitiesCsv } from './exportActivities'
import { GanttChart, GANTT_ROW_HEIGHT } from './GanttChart'
import { SchedulingQualityWidget } from './SchedulingQualityWidget'
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
  const [qualityWidgetOpen, setQualityWidgetOpen] = useState(false)
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
      if (filterAtRisk && !(a.total_float !== null && a.total_float > 0 && a.total_float <= 5)) return false
      return true
    })
  }, [activities, searchQuery, filterCritical, filterDelayed, filterAtRisk])

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

  const handleUpdate = async (values: ActivityFormValues, reassessmentNote: string | null) => {
    if (!editingActivity) return
    await api.patch(`/api/v1/activities/${editingActivity.id}`, toActivityPayload(values))
    if (reassessmentNote) {
      await api.post('/api/v1/reassessments/', {
        record_type: 'activity', record_id: editingActivity.id, note: reassessmentNote,
      })
      setReassessmentRefreshKey(k => k + 1)
    }
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

      {qualityWidgetOpen && period && (
        <div className="no-print">
          <SchedulingQualityWidget periodId={period.id} onClose={() => setQualityWidgetOpen(false)} />
        </div>
      )}

      {formOpen && (
        <div className="no-print">
          <ActivityForm activity={null} calendars={calendars} onCancel={() => setFormOpen(false)} onSubmit={handleCreate} />
        </div>
      )}
      {editingActivity && (
        <div className="no-print">
          <ActivityForm activity={editingActivity} calendars={calendars} onCancel={() => setEditingActivity(null)} onSubmit={handleUpdate} />
        </div>
      )}

      {!formOpen && !editingActivity && (
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
            At risk (float 1–5 days)
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
                <th className="px-3 py-2.5 w-28 no-print"></th>
              </tr>
            </thead>
            <tbody>
              {visibleActivities.map((a, index) => (
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
                  <td className="px-3 py-1 text-right whitespace-nowrap no-print">
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
              {visibleActivities.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">
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
          ref={rightPaneRef}
          onScroll={() => syncScroll('right')}
          className="flex-1 overflow-auto border-l border-gray-200 no-print"
          style={{ maxHeight: PANE_MAX_HEIGHT }}
        >
          <GanttChart activities={visibleActivities} relationships={relationships} />
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
          <ActivityLogic activity={expandedActivity} activities={activities} relationships={relationships} onChange={refresh} />
          <ReassessmentLog
            recordType="activity"
            recordId={expandedActivity.id}
            refreshKey={reassessmentRefreshKey}
            onLogged={() => refresh()}
          />
        </div>
      )}
    </div>
  )
}
