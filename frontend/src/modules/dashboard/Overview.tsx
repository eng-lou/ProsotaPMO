import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ModuleLoadError } from '@/components/ModuleLoadError'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { useWbsOptions } from '@/lib/useWbsOptions'
import { WbsScopePicker } from './WbsScopePicker'
import { fetchRelatedRecords, toggleCrossFilterKey, type CrossFilterEntityKind, type CrossFilterScope } from '@/lib/dashboardCrossFilter'
import { DashboardGrid } from './DashboardGrid'
import type { DashboardOverviewResponse } from './types'

// EMV is signed (threats negative, opportunities positive) — same convention
// as RiskRegister.tsx's own formatCurrency.
export function formatCurrency(value: string | number) {
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `£${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function formatDate(value: string | null) {
  if (value === null) return '—'
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function Overview() {
  const { selectedProject } = useProject()
  return <ProjectOverview key={selectedProject?.id} />
}

function ProjectOverview() {
  const navigate = useNavigate()
  const { selectedProject } = useProject()
  const { period, loading: periodLoading, error: periodError, refetch: refetchPeriod } = useActivePeriod(selectedProject?.id)
  const { period: schedulePeriod, loading: scheduleLoading, error: scheduleError, refetch: refetchSchedule } = useActiveScheduleVariant(selectedProject?.id)

  // WBS slicer (2026-08-28, per Maro: "allow slicers for wbs which affects
  // all the cards") — replaces the old registered-sub-project picker with
  // any real WBS node, fetched once here purely to populate the picker
  // (get_overview itself does its own scoped query server-side; this list
  // is never used to compute anything client-side).
  const wbsLookup = useWbsOptions(selectedProject?.id, schedulePeriod?.id)
  const { options: wbsNodes, selectedId: wbsNodeId, select: setWbsNodeId } = wbsLookup
  const [data, setData] = useState<DashboardOverviewResponse | null>(null)
  const requestedScope = `${period?.id}:${schedulePeriod?.id}:${wbsNodeId}`
  const [loadedScope, setLoadedScope] = useState('')
  const scopeMatches = loadedScope === requestedScope
  const [loading, setLoading] = useState(true)
  // error (2026-09-16, per Maro: this screen — the default landing page
  // after sign-in — got stuck on "Loading…" forever on a work laptop where
  // this request never got a response at all) — the render guard below used
  // to check `!data` alone, which is indistinguishable from "still loading"
  // once a request fails: `data` stays null either way, so a failed request
  // looked identical to a slow one, forever, with no way out. Tracked
  // separately from `loading` (which api.ts's own new request timeout now
  // guarantees resolves within 25s either way) so a genuine failure shows a
  // real message with a retry instead of silently staying on "Loading…".
  const [error, setError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!selectedProject || !period || !schedulePeriod) return
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    api.get<DashboardOverviewResponse>('/api/v1/dashboard/overview', {
      signal: controller.signal,
      params: {
        project_id: selectedProject.id,
        period_id: period.id,
        schedule_period_id: schedulePeriod.id,
        wbs_node_activity_id: wbsNodeId || undefined,
      },
    })
      .then(({ data }) => {
        if (controller.signal.aborted) return
        setData(data)
        setLoadedScope(requestedScope)
      })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [selectedProject?.id, period?.id, schedulePeriod?.id, wbsNodeId, requestedScope, retryCount])

  // Cross-widget "click to filter" (2026-09-06, per Maro — see
  // lib/dashboardCrossFilter.ts's own header for the full design).
  // crossFilterSeed holds only WHAT was clicked (key + kind + the ids it
  // resolves to); the actual related-records resolution is a real server
  // round trip (RecordLink causal edges aren't something the client
  // already has), fetched below whenever the seed changes. Widened
  // 2026-09-07 from activity-only to any of the four kinds.
  const [crossFilterSeed, setCrossFilterSeed] = useState<{ key: string; seedType: CrossFilterEntityKind; seedIds: string[] } | null>(null)
  const [crossFilter, setCrossFilter] = useState<CrossFilterScope | null>(null)
  const [crossFilterLoading, setCrossFilterLoading] = useState(false)
  const [crossFilterError, setCrossFilterError] = useState(false)
  const [crossFilterAttempt, setCrossFilterAttempt] = useState(0)
  useEffect(() => { setCrossFilterSeed(null) }, [period?.id, schedulePeriod?.id])
  useEffect(() => {
    setCrossFilter(null)
    setCrossFilterError(false)
    if (!selectedProject || !crossFilterSeed) {
      setCrossFilterLoading(false)
      return
    }
    const controller = new AbortController()
    setCrossFilterLoading(true)
    fetchRelatedRecords(selectedProject.id, crossFilterSeed.seedType, crossFilterSeed.seedIds, controller.signal).then(related => {
      if (controller.signal.aborted) return
      setCrossFilter({
        key: crossFilterSeed.key,
        activityIds: new Set(related.activity_ids),
        costElementIds: new Set(related.cost_element_ids),
        riskIds: new Set(related.risk_ids),
        icdItemIds: new Set(related.icd_item_ids),
      })
    }).catch(() => {
      if (!controller.signal.aborted) setCrossFilterError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setCrossFilterLoading(false)
    })
    return () => controller.abort()
  }, [selectedProject?.id, crossFilterSeed, crossFilterAttempt])
  const handleCrossFilterClick = (key: string, seedType: CrossFilterEntityKind, seedIds: string[]) => {
    const nextKey = toggleCrossFilterKey(crossFilterSeed, key)
    setCrossFilterSeed(nextKey ? { key: nextKey, seedType, seedIds } : null)
  }

  if ((!period && periodError) || (!schedulePeriod && scheduleError)) {
    return (
      <ModuleLoadError
        message={(!period && periodError) || scheduleError || ''}
        onRetry={() => { if (!period) refetchPeriod(); if (!schedulePeriod) refetchSchedule() }}
      />
    )
  }

  if (error && !data) {
    return (
      <div className="p-8 text-sm">
        <p className="text-gray-500 dark:text-prosota-muted mb-3">Couldn't load the dashboard. Check your connection and try again.</p>
        <button
          onClick={() => setRetryCount(c => c + 1)}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80"
        >
          Retry
        </button>
      </div>
    )
  }

  if (periodLoading || scheduleLoading || !data) {
    return <div className="p-8 text-gray-400 dark:text-prosota-muted text-sm">Loading…</div>
  }

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="text-sm text-amber-700 dark:text-prosota-amber">
        {scopeMatches ? 'Couldn’t refresh the dashboard. Showing the previous results.' : 'Couldn’t load the requested view. Previous figures are hidden until it loads.'}{' '}
        <button className="underline" onClick={() => setRetryCount(c => c + 1)}>Retry</button>
      </div>}
      {crossFilterError && <div role="alert" className="text-sm text-amber-700 dark:text-prosota-amber">
        Related-record filter couldn’t load. No related-record filter is applied.{' '}
        <button className="underline" onClick={() => setCrossFilterAttempt(n => n + 1)}>Retry filter</button>
      </div>}
      {crossFilterLoading && <p role="status" className="text-xs text-gray-500 dark:text-prosota-muted">Applying related-record filter…</p>}
      <div style={{ display: scopeMatches ? undefined : 'none' }} className="rounded-lg border border-gray-200 dark:border-prosota-line bg-white dark:bg-prosota-panel p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-prosota-paper">Project controls snapshot</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-prosota-muted">
            Data date: {formatDate(data.project_info.data_date)} · {data.project_info.total_activities} activities · {data.project_info.has_baseline ? 'Baseline assigned' : 'No baseline assigned'}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-prosota-muted">{wbsNodeId ? wbsNodes.find(a => a.id === wbsNodeId)?.task_name || 'Selected WBS' : 'Whole schedule'}{crossFilter ? ' · Related-record filter active on supported widgets' : ''}</p>
        </div>
        <button disabled={loading} onClick={() => setRetryCount(c => c + 1)} className="no-print text-xs px-3 py-2 rounded border border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh figures'}</button>
      </div>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-gray-500 dark:text-prosota-muted">Drag widget headers to arrange · Expand a widget to print or export</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {/* 2026-09-02, per Maro: "using the general wbs filter at the top
              right just messed up the whole dashboard... the filter edits on
              the critical activities one was just wiped" — this used to gate
              on `loading` too, which is true on every WBS/period refetch, not
              just the very first load. That unmounted DashboardGrid on every
              WBS pick, discarding its own local widgets state (drag/resize/
              add/remove/filter edits, all local-only until "Save current
              as…") and re-seeding fresh from the server on remount, silently
              reverting any unsaved edit. Now gated on `data` alone (set once
              and never reset to null on refetch) so DashboardGrid stays
              mounted across a WBS change — only its widgetProps.data prop
              updates in place — and a lightweight "Refreshing…" label covers
              the "still fetching" case instead of unmounting the whole grid. */}
          {loading && <span className="text-xs text-gray-400 dark:text-prosota-muted">Refreshing…</span>}
          <WbsScopePicker lookup={wbsLookup} />
          {wbsNodeId && (
            <button
              onClick={() => setWbsNodeId('')}
              title="Clear the WBS scope and show the whole schedule again"
              className="text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-700 dark:hover:text-prosota-paper"
            >
              ✕ Whole schedule
            </button>
          )}
          {crossFilterSeed && (
            <button
              onClick={() => setCrossFilterSeed(null)}
              title="Clear the cross-filter and show everything again"
              className="text-xs px-2 py-1 rounded-md bg-prosota-amber/20 text-prosota-ink dark:text-prosota-paper border border-prosota-amber/40 hover:bg-prosota-amber/30"
            >
              {crossFilter ? '✕ Cross-filter active' : '✕ Clear filter request'}
            </button>
          )}
        </div>
      </div>

      <div hidden={!scopeMatches} aria-busy={loading || crossFilterLoading} className={loading || crossFilterLoading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
        <DashboardGrid
          projectId={selectedProject?.id}
          widgetProps={{
            data, onNavigateToRisks: () => navigate('/risks'), projectId: selectedProject?.id,
            crossFilter, onCrossFilterClick: handleCrossFilterClick,
          }}
        />
      </div>
    </div>
  )
}
