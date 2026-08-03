import axios from 'axios'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { useProject } from '@/lib/ProjectContext'
import { useProjectLetterhead } from '@/lib/letterhead'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import type { Activity, ResourceAssignment } from '@/modules/scheduling/types'
import { RecordLinks, type LinkCandidate } from '@/components/RecordLinks'
import { BaselineManagerWidget } from '@/components/BaselineManagerWidget'
import { HeatMatrix } from '@/components/HeatMatrix'
import { LetterheadEditorWidget } from '@/components/LetterheadEditorWidget'
import { ReassessmentLog } from '@/components/ReassessmentLog'
import { RiskForm, toRiskPayload, type RiskFormValues } from './RiskForm'
import { MitigationActions } from './MitigationActions'
import { CriteriaThresholds } from './CriteriaThresholds'
import { downloadRisksCsv } from './exportRisks'
import { RiskPrintView } from './RiskPrintView'
import { buildRiskDraft } from './riskGeneration'
import { RISK_STATUSES, type Risk } from './types'

interface CostElementSummary {
  id: string
  code: string
  description: string
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  mitigated: 'bg-blue-100 text-blue-700 dark:bg-prosota-azure/15 dark:text-prosota-azure',
  closed: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
}

const RISK_TYPE_STYLES: Record<string, string> = {
  threat: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  opportunity: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
}

const GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'category', label: 'Theme' },
  { value: 'area', label: 'Area' },
  { value: 'status', label: 'Status' },
  { value: 'risk_type', label: 'Risk type' },
] as const
type GroupByField = (typeof GROUP_OPTIONS)[number]['value']

function formatPercent(value: string | null) {
  if (value === null) return '—'
  return `${Math.round(Number(value) * 100)}%`
}

// EMV is signed (threats negative, opportunities positive — see RISK_MODULE_PLAN.md).
function formatCurrency(value: string | null) {
  if (value === null) return '—'
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString()}` : `£${n.toLocaleString()}`
}

function formatDays(value: string | null) {
  if (value === null) return '—'
  return Number(value).toFixed(1)
}

function uniqueValues(risks: Risk[], field: 'category' | 'area'): string[] {
  return [...new Set(risks.map(r => r[field]).filter((v): v is string => !!v))].sort()
}

export function RiskRegister() {
  const { selectedProject } = useProject()
  const { period, loading: periodLoading, error: periodError } = useActivePeriod(selectedProject?.id)
  const { period: schedulePeriod } = useActiveScheduleVariant(selectedProject?.id)
  const { letterhead, save: saveLetterhead } = useProjectLetterhead(selectedProject?.id)
  const [letterheadWidgetOpen, setLetterheadWidgetOpen] = useState(false)
  const [baselineWidgetOpen, setBaselineWidgetOpen] = useState(false)
  const [risks, setRisks] = useState<Risk[]>([])
  const [costElements, setCostElements] = useState<CostElementSummary[]>([])
  // Schedule + resource data for "Generate Risk Register" (2026-07-18) — see
  // riskGeneration.ts's own header on why these are needed (per-discipline
  // resourced cost, overall programme duration).
  const [scheduleActivities, setScheduleActivities] = useState<Activity[]>([])
  const [resourceAssignments, setResourceAssignments] = useState<ResourceAssignment[]>([])
  const [generatingRisks, setGeneratingRisks] = useState(false)
  const [generateRiskMessage, setGenerateRiskMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingRisk, setEditingRisk] = useState<Risk | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reassessmentRefreshKey, setReassessmentRefreshKey] = useState(0)

  // Search / Filters / Group — client-side, matching the prototype's toolbar row.
  const [searchQuery, setSearchQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set())
  const [filterRiskTypes, setFilterRiskTypes] = useState<Set<string>>(new Set())
  const [filterCategory, setFilterCategory] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [groupBy, setGroupBy] = useState<GroupByField>('none')

  // Print / Preview — the .print-only view (RiskPrintView) is always in the DOM
  // (hidden via CSS except during @media print); these control what it renders.
  const [selectedForPrint, setSelectedForPrint] = useState<Set<string>>(new Set())
  const [printMode, setPrintMode] = useState<'list' | 'detail'>('list')
  const [printTrigger, setPrintTrigger] = useState(0)

  useEffect(() => {
    if (!selectedProject || !period) return
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const [riskRes, costRes] = await Promise.all([
          api.get<Risk[]>('/api/v1/risks/', { params: { project_id: selectedProject!.id, period_id: period!.id } }),
          api.get<CostElementSummary[]>('/api/v1/cost-elements/', { params: { project_id: selectedProject!.id, period_id: period!.id } }),
        ])
        if (cancelled) return
        setRisks(riskRes.data)
        setCostElements(costRes.data)
      } catch {
        if (!cancelled) setError('Failed to load risk register')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedProject, period])

  // Schedule + resource data for "Generate Risk Register" (2026-07-18) —
  // loaded separately from the main Risk Register fetch above since it
  // comes from Scheduling's own schedule-variant/period, same split
  // CostPlan.tsx already uses for the identical reason.
  useEffect(() => {
    if (!selectedProject || !schedulePeriod) return
    let cancelled = false
    async function loadScheduleData() {
      const [assignmentsRes, activitiesRes] = await Promise.all([
        api.get<ResourceAssignment[]>('/api/v1/resource-assignments/', { params: { schedule_period_id: schedulePeriod!.id } }),
        api.get<Activity[]>('/api/v1/activities/', { params: { project_id: selectedProject!.id, schedule_period_id: schedulePeriod!.id } }),
      ])
      if (cancelled) return
      setResourceAssignments(assignmentsRes.data)
      setScheduleActivities(activitiesRes.data)
    }
    loadScheduleData()
    return () => { cancelled = true }
  }, [selectedProject, schedulePeriod])

  // Fires window.print() only after printMode has committed to the DOM (state
  // updates are batched/async, so calling print() directly after setPrintMode
  // in the same handler could still print the previous mode's content).
  useEffect(() => {
    if (printTrigger > 0) window.print()
  }, [printTrigger])

  const toggleInSet = (set: Set<string>, setSet: (s: Set<string>) => void, value: string) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setSet(next)
  }

  const activeFilterCount = filterStatuses.size + filterRiskTypes.size + (filterCategory ? 1 : 0) + (filterArea ? 1 : 0)

  const visibleRisks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return risks.filter(r => {
      if (q) {
        const haystack = [r.title, r.code, r.category, r.area, r.risk_owner].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (filterStatuses.size > 0 && !filterStatuses.has(r.status)) return false
      if (filterRiskTypes.size > 0 && !filterRiskTypes.has(r.risk_type)) return false
      if (filterCategory && r.category !== filterCategory) return false
      if (filterArea && r.area !== filterArea) return false
      return true
    })
  }, [risks, searchQuery, filterStatuses, filterRiskTypes, filterCategory, filterArea])

  const groups = useMemo((): [string, Risk[]][] => {
    if (groupBy === 'none') return [['', visibleRisks]]
    const map = new Map<string, Risk[]>()
    for (const r of visibleRisks) {
      const key = (r[groupBy] as string | null) ?? '(none)'
      map.set(key, [...(map.get(key) ?? []), r])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visibleRisks, groupBy])

  if (!selectedProject) return null

  const refreshRisks = async () => {
    if (!period) return
    const { data } = await api.get<Risk[]>('/api/v1/risks/', {
      params: { project_id: selectedProject.id, period_id: period.id },
    })
    setRisks(data)
  }

  // "Generate Risk Register" (2026-07-18) — see riskGeneration.ts's own
  // header. Also refreshes costElements, not just risks: a threat with a
  // real cost EMV rolls into a Contingency line on the Cost Plan
  // (risk_bulk_generate.py, backend) in this same call, and that line lives
  // in costElements here too (used for whatever cost-linked display this
  // register already shows).
  const handleGenerateRisks = async () => {
    if (!period) return
    const drafts = buildRiskDraft(scheduleActivities, resourceAssignments)
    if (drafts.length === 0) {
      setGenerateRiskMessage('No committed schedule found to draft risks from yet.')
      return
    }
    setGeneratingRisks(true)
    setGenerateRiskMessage(null)
    try {
      const { data } = await api.post('/api/v1/risk-bulk-generate/', {
        project_id: selectedProject.id, period_id: period.id, risks: drafts,
      })
      await refreshRisks()
      const costRes = await api.get<CostElementSummary[]>('/api/v1/cost-elements/', {
        params: { project_id: selectedProject.id, period_id: period.id },
      })
      setCostElements(costRes.data)
      const reused = drafts.length - data.risk_count
      const contingencyNote = data.contingency_cost_element_id
        ? ` Contingency updated to ${(Number(data.contingency_rate) * 100).toFixed(1)}% of fixed costs.`
        : ''
      setGenerateRiskMessage(
        `Risk register updated — ${data.risk_count} new risk(s)${reused > 0 ? `, ${reused} already existed` : ''}.${contingencyNote}`
      )
    } catch (err) {
      setGenerateRiskMessage(axios.isAxiosError(err)
        ? `Failed to generate risk register (${err.response?.data?.detail ?? err.message})`
        : 'Failed to generate risk register')
    } finally {
      setGeneratingRisks(false)
    }
  }

  const handleCreate = async (values: RiskFormValues) => {
    if (!period) return
    await api.post('/api/v1/risks/', {
      ...toRiskPayload(values),
      project_id: selectedProject.id,
      period_id: period.id,
    })
    setFormOpen(false)
    await refreshRisks()
  }

  const handleUpdate = async (values: RiskFormValues, reassessmentNote: string | null) => {
    if (!editingRisk) return
    await api.patch(`/api/v1/risks/${editingRisk.id}`, toRiskPayload(values))
    if (reassessmentNote) {
      await api.post('/api/v1/reassessments/', { record_type: 'risk', record_id: editingRisk.id, note: reassessmentNote })
      setReassessmentRefreshKey(k => k + 1)
    }
    setEditingRisk(null)
    await refreshRisks()
  }

  const handleDelete = async (risk: Risk) => {
    if (!(await confirmWithDontAsk('risk.delete', `Delete risk "${risk.title}"? This cannot be undone.`))) return
    await api.delete(`/api/v1/risks/${risk.id}`)
    await refreshRisks()
  }

  const handlePrintList = () => {
    setPrintMode('list')
    setPrintTrigger(t => t + 1)
  }

  const handlePrintSelectedDetail = () => {
    if (selectedForPrint.size === 0) return
    setPrintMode('detail')
    setPrintTrigger(t => t + 1)
  }

  const candidatesFor = (risk: Risk): LinkCandidate[] => [
    ...risks.filter(r => r.id !== risk.id).map(r => ({ id: r.id, type: 'risk' as const, label: `${r.code}: ${r.title}` })),
    ...costElements.map(c => ({ id: c.id, type: 'cost_element' as const, label: `${c.code}: ${c.description}` })),
  ]

  const renderRow = (risk: Risk) => (
    <Fragment key={risk.id}>
      <tr className="border-b border-gray-100 dark:border-prosota-line last:border-0 hover:bg-gray-50 dark:hover:bg-prosota-panel2">
        <td className="px-3 py-2.5">
          <input
            type="checkbox"
            checked={selectedForPrint.has(risk.id)}
            onChange={() => toggleInSet(selectedForPrint, setSelectedForPrint, risk.id)}
          />
        </td>
        <td className="px-4 py-2.5 text-gray-500 dark:text-prosota-muted font-mono text-xs">{risk.code}</td>
        <td className="px-4 py-2.5">
          <button
            onClick={() => setExpandedId(expandedId === risk.id ? null : risk.id)}
            className="text-left font-medium text-gray-900 dark:text-prosota-paper hover:text-blue-600"
          >
            {risk.title}
          </button>
        </td>
        <td className="px-4 py-2.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RISK_TYPE_STYLES[risk.risk_type]}`}>
            {risk.risk_type}
          </span>
        </td>
        <td className="px-4 py-2.5 text-gray-600 dark:text-prosota-muted">{risk.category ?? '—'}</td>
        <td className="px-4 py-2.5 text-gray-600 dark:text-prosota-muted">{risk.area ?? '—'}</td>
        <td className="px-4 py-2.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[risk.status] ?? 'bg-gray-100 dark:bg-prosota-panel2 text-gray-600 dark:text-prosota-muted'}`}>
            {risk.status}
          </span>
        </td>
        <td className="px-4 py-2.5 text-gray-600 dark:text-prosota-muted">{formatPercent(risk.probability)}</td>
        <td className="px-4 py-2.5 text-gray-600 dark:text-prosota-muted">{formatPercent(risk.impact)}</td>
        <td className="px-4 py-2.5 text-gray-600 dark:text-prosota-muted">{risk.rating ?? '—'}</td>
        <td className="px-4 py-2.5 text-gray-600 dark:text-prosota-muted">{formatCurrency(risk.emv_cost)}</td>
        <td className="px-4 py-2.5 text-gray-600 dark:text-prosota-muted">{formatDays(risk.emv_schedule_days)}</td>
        <td className="px-4 py-2.5 text-right whitespace-nowrap">
          <button onClick={() => setEditingRisk(risk)} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan mr-3">
            Edit
          </button>
          <button onClick={() => handleDelete(risk)} className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">
            Delete
          </button>
        </td>
      </tr>
      {expandedId === risk.id && (
        <tr>
          <td colSpan={13} className="p-0">
            {(risk.date_raised || risk.expected_impact_date || risk.last_reviewed_date || risk.date_closed) && (
              <div className="px-4 py-2.5 bg-gray-50 dark:bg-prosota-panel2 border-t border-gray-100 dark:border-prosota-line flex gap-6 flex-wrap text-xs text-gray-500 dark:text-prosota-muted">
                {risk.date_raised && <span>Raised: <span className="text-gray-700 dark:text-prosota-muted">{risk.date_raised}</span></span>}
                {risk.expected_impact_date && <span>Expected impact: <span className="text-gray-700 dark:text-prosota-muted">{risk.expected_impact_date}</span></span>}
                {risk.last_reviewed_date && <span>Last reviewed: <span className="text-gray-700 dark:text-prosota-muted">{risk.last_reviewed_date}</span></span>}
                {risk.date_closed && <span>Closed: <span className="text-gray-700 dark:text-prosota-muted">{risk.date_closed}</span></span>}
              </div>
            )}
            <div className="px-4 py-4 bg-gray-50 dark:bg-prosota-panel2 border-t border-gray-100 dark:border-prosota-line flex gap-10 flex-wrap">
              <HeatMatrix
                label="Inherent (pre-mitigation)"
                probability={risk.probability !== null ? Number(risk.probability) : null}
                impact={risk.impact !== null ? Number(risk.impact) : null}
              />
              <HeatMatrix
                label="Residual (post-mitigation target)"
                probability={risk.probability_residual !== null ? Number(risk.probability_residual) : null}
                impact={risk.impact_residual !== null ? Number(risk.impact_residual) : null}
              />
            </div>
            {risk.rating_narrative && (
              <div className="px-4 py-3 bg-gray-50 dark:bg-prosota-panel2 border-t border-gray-100 dark:border-prosota-line text-xs text-gray-600 dark:text-prosota-muted">
                {risk.rating_narrative}
              </div>
            )}
            <MitigationActions riskId={risk.id} />
            <ReassessmentLog
              recordType="risk"
              recordId={risk.id}
              refreshKey={reassessmentRefreshKey}
              onLogged={() => refreshRisks()}
            />
            {(risk.contingency_plan || risk.fallback_plan) && (
              <div className="px-4 py-3 bg-gray-50 dark:bg-prosota-panel2 border-t border-gray-100 dark:border-prosota-line space-y-2 text-xs">
                {risk.contingency_plan && (
                  <div>
                    <span className="font-semibold text-gray-600 dark:text-prosota-muted">Contingency plan: </span>
                    <span className="text-gray-600 dark:text-prosota-muted">{risk.contingency_plan}</span>
                  </div>
                )}
                {risk.fallback_plan && (
                  <div>
                    <span className="font-semibold text-gray-600 dark:text-prosota-muted">Fallback plan: </span>
                    <span className="text-gray-600 dark:text-prosota-muted">{risk.fallback_plan}</span>
                  </div>
                )}
              </div>
            )}
            <RecordLinks recordType="risk" recordId={risk.id} candidates={candidatesFor(risk)} />
          </td>
        </tr>
      )}
    </Fragment>
  )

  if (loading || periodLoading) {
    return <div className="p-8 text-sm text-gray-400 dark:text-prosota-muted">Loading risk register…</div>
  }

  return (
    <>
    <div className="p-8 no-print">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-prosota-paper">Risk Register</h1>
        {period && (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-prosota-panel2 text-gray-600 dark:text-prosota-muted font-medium">
            {period.period_label} · {period.freeze_status}
          </span>
        )}
      </div>
      <p className="text-gray-500 dark:text-prosota-muted text-sm mb-6">
        Risks for {selectedProject.name}. Frozen periods will become read-only once Period Manager is built.
      </p>

      {(error || periodError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/30 rounded-md text-red-700 dark:text-red-400 text-sm">{error ?? periodError}</div>
      )}

      <CriteriaThresholds projectId={selectedProject.id} />

      {formOpen && (
        <RiskForm risk={null} onCancel={() => setFormOpen(false)} onSubmit={handleCreate} />
      )}
      {editingRisk && (
        <RiskForm risk={editingRisk} onCancel={() => setEditingRisk(null)} onSubmit={handleUpdate} />
      )}

      {!formOpen && !editingRisk && (
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setFormOpen(true)}
            className="text-sm text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium"
          >
            + New risk
          </button>
          <button
            onClick={handleGenerateRisks}
            disabled={generatingRisks}
            title="Drafts a first-pass risk register from the committed schedule and resourced costs — general construction risks plus one per discipline actually present. Review and tune before relying on it."
            className="text-xs px-2.5 py-1 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generatingRisks ? 'Generating…' : 'Generate Risk Register'}
          </button>
          {generateRiskMessage && <span className="text-xs text-gray-500 dark:text-prosota-muted">{generateRiskMessage}</span>}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative max-w-xs w-full">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-prosota-muted text-xs">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search risks…"
            className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setFiltersOpen(prev => !prev)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            filtersOpen || activeFilterCount > 0 ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          ⚙ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        <select
          value={groupBy}
          onChange={e => setGroupBy(e.target.value as GroupByField)}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted"
        >
          {GROUP_OPTIONS.map(o => <option key={o.value} value={o.value}>↕ Group: {o.label}</option>)}
        </select>
        <button
          onClick={() => downloadRisksCsv(visibleRisks, selectedProject.name)}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
          title="Exports the risks currently shown (respecting search/filters) as a CSV file, opens directly in Excel."
        >
          ⇩ Export ({visibleRisks.length})
        </button>
        <button
          onClick={handlePrintList}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
          title="Print the register exactly as currently shown (respecting search/filters/grouping)."
        >
          🖨️ Print as shown
        </button>
        <button
          onClick={handlePrintSelectedDetail}
          disabled={selectedForPrint.size === 0}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Print a full-detail report for the risks checked in the table below."
        >
          🖨️ Print selected, full detail ({selectedForPrint.size})
        </button>
        <button
          onClick={() => setLetterheadWidgetOpen(o => !o)}
          title="Edit the shared logo/header/footer used on every module's printed reports for this project"
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            letterheadWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          📄 Page Setup
        </button>
        <button
          onClick={() => setBaselineWidgetOpen(o => !o)}
          title="Capture a named, dated baseline snapshot of the risk register"
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            baselineWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          🎯 Baseline
        </button>
      </div>

      {baselineWidgetOpen && period && (
        <BaselineManagerWidget
          apiBasePath="/api/v1/risk-baselines"
          periodId={period.id}
          itemNounPlural="Risks"
          moduleLabel="the Risk Register"
          dismissKeyPrefix="risk"
          onClose={() => setBaselineWidgetOpen(false)}
        />
      )}

      {letterheadWidgetOpen && letterhead && (
        <LetterheadEditorWidget
          letterhead={letterhead}
          previewTokens={{
            project: selectedProject.name, module: 'Risk Register',
            count: `${visibleRisks.length} risk${visibleRisks.length === 1 ? '' : 's'}`,
            printed_at: new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
          }}
          onSave={saveLetterhead}
          onClose={() => setLetterheadWidgetOpen(false)}
        />
      )}

      {filtersOpen && (
        <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-4 mb-4 flex gap-8 flex-wrap">
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1.5">Status</div>
            <div className="flex flex-col gap-1">
              {RISK_STATUSES.map(s => (
                <label key={s} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted">
                  <input
                    type="checkbox"
                    checked={filterStatuses.has(s)}
                    onChange={() => toggleInSet(filterStatuses, setFilterStatuses, s)}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1.5">Risk type</div>
            <div className="flex flex-col gap-1">
              {['threat', 'opportunity'].map(t => (
                <label key={t} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted">
                  <input
                    type="checkbox"
                    checked={filterRiskTypes.has(t)}
                    onChange={() => toggleInSet(filterRiskTypes, setFilterRiskTypes, t)}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1.5">Theme</div>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1">
              <option value="">All</option>
              {uniqueValues(risks, 'category').map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1.5">Area</div>
            <select value={filterArea} onChange={e => setFilterArea(e.target.value)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1">
              <option value="">All</option>
              {uniqueValues(risks, 'area').map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilterStatuses(new Set()); setFilterRiskTypes(new Set()); setFilterCategory(''); setFilterArea('') }}
              className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 self-end"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-prosota-panel2 border-b border-gray-200 dark:border-prosota-line text-left text-xs text-gray-500 dark:text-prosota-muted font-medium uppercase tracking-wide">
              <th className="px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={visibleRisks.length > 0 && visibleRisks.every(r => selectedForPrint.has(r.id))}
                  onChange={e => setSelectedForPrint(e.target.checked ? new Set(visibleRisks.map(r => r.id)) : new Set())}
                  title="Select all (for print)"
                />
              </th>
              <th className="px-4 py-2.5">Code</th>
              <th className="px-4 py-2.5">Title</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Theme</th>
              <th className="px-4 py-2.5">Area</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Prob.</th>
              <th className="px-4 py-2.5">Impact</th>
              <th className="px-4 py-2.5">Rating</th>
              <th className="px-4 py-2.5">EMV Cost</th>
              <th className="px-4 py-2.5">EMV Days</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([groupKey, groupRisks]) => (
              <Fragment key={groupKey || 'all'}>
                {groupBy !== 'none' && (
                  <tr>
                    <td colSpan={13} className="px-4 py-1.5 bg-gray-100 dark:bg-prosota-panel2 text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide">
                      {groupKey} <span className="font-normal normal-case text-gray-400 dark:text-prosota-muted">({groupRisks.length})</span>
                    </td>
                  </tr>
                )}
                {groupRisks.map(renderRow)}
              </Fragment>
            ))}

            {visibleRisks.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-gray-400 dark:text-prosota-muted text-sm">
                  {risks.length === 0 ? 'No risks yet for this period. Add the first one above.' : 'No risks match your search/filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    <RiskPrintView
      mode={printMode}
      risks={printMode === 'list' ? visibleRisks : risks.filter(r => selectedForPrint.has(r.id))}
      projectName={selectedProject.name}
      letterhead={letterhead}
    />
    </>
  )
}
