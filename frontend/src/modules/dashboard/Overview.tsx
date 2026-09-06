import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { ActivityPicker } from '@/modules/scheduling/ActivityPicker'
import type { Activity } from '@/modules/scheduling/types'
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
  const navigate = useNavigate()
  const { selectedProject } = useProject()
  const { period, loading: periodLoading } = useActivePeriod(selectedProject?.id)
  const { period: schedulePeriod, loading: scheduleLoading } = useActiveScheduleVariant(selectedProject?.id)

  // WBS slicer (2026-08-28, per Maro: "allow slicers for wbs which affects
  // all the cards") — replaces the old registered-sub-project picker with
  // any real WBS node, fetched once here purely to populate the picker
  // (get_overview itself does its own scoped query server-side; this list
  // is never used to compute anything client-side).
  const [wbsNodes, setWbsNodes] = useState<Activity[]>([])
  useEffect(() => {
    if (!selectedProject || !schedulePeriod) return
    api.get<Activity[]>('/api/v1/activities/', {
      params: { project_id: selectedProject.id, schedule_period_id: schedulePeriod.id },
    }).then(({ data }) => setWbsNodes(data.filter(a => a.activity_type === 'wbs_summary')))
  }, [selectedProject?.id, schedulePeriod?.id])

  const [wbsNodeId, setWbsNodeId] = useState<string>('')
  const [data, setData] = useState<DashboardOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!selectedProject || !period || !schedulePeriod) return
    setLoading(true)
    api.get<DashboardOverviewResponse>('/api/v1/dashboard/overview', {
      params: {
        project_id: selectedProject.id,
        period_id: period.id,
        schedule_period_id: schedulePeriod.id,
        wbs_node_activity_id: wbsNodeId || undefined,
      },
    })
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [selectedProject?.id, period?.id, schedulePeriod?.id, wbsNodeId])

  // Cross-widget "click to filter" (2026-09-06, per Maro — see
  // lib/dashboardCrossFilter.ts's own header for the full design).
  // crossFilterSeed holds only WHAT was clicked (key + kind + the ids it
  // resolves to); the actual related-records resolution is a real server
  // round trip (RecordLink causal edges aren't something the client
  // already has), fetched below whenever the seed changes. Widened
  // 2026-09-07 from activity-only to any of the four kinds.
  const [crossFilterSeed, setCrossFilterSeed] = useState<{ key: string; seedType: CrossFilterEntityKind; seedIds: string[] } | null>(null)
  const [crossFilter, setCrossFilter] = useState<CrossFilterScope | null>(null)
  useEffect(() => {
    if (!selectedProject || !crossFilterSeed) {
      setCrossFilter(null)
      return
    }
    let cancelled = false
    fetchRelatedRecords(selectedProject.id, crossFilterSeed.seedType, crossFilterSeed.seedIds).then(related => {
      if (cancelled) return
      setCrossFilter({
        key: crossFilterSeed.key,
        activityIds: new Set(related.activity_ids),
        costElementIds: new Set(related.cost_element_ids),
        riskIds: new Set(related.risk_ids),
        icdItemIds: new Set(related.icd_item_ids),
      })
    })
    return () => { cancelled = true }
  }, [selectedProject?.id, crossFilterSeed])
  const handleCrossFilterClick = (key: string, seedType: CrossFilterEntityKind, seedIds: string[]) => {
    const nextKey = toggleCrossFilterKey(crossFilter, key)
    setCrossFilterSeed(nextKey ? { key: nextKey, seedType, seedIds } : null)
  }

  if (periodLoading || scheduleLoading || !data) {
    return <div className="p-8 text-gray-400 dark:text-prosota-muted text-sm">Loading…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-3 text-sm">
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
          <div className="w-56">
            <ActivityPicker
              activities={wbsNodes}
              value={wbsNodeId}
              onChange={setWbsNodeId}
              placeholder="Whole schedule"
            />
          </div>
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
              ✕ Cross-filter active
            </button>
          )}
        </div>
      </div>

      <div className={loading ? 'opacity-60 pointer-events-none transition-opacity' : 'transition-opacity'}>
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
