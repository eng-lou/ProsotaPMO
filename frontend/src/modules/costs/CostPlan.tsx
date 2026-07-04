import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { useProject } from '@/lib/ProjectContext'
import { useProjectLetterhead } from '@/lib/letterhead'
import { useActivePeriod } from '@/lib/usePeriod'
import { RecordLinks, type LinkCandidate } from '@/components/RecordLinks'
import { LetterheadEditorWidget } from '@/components/LetterheadEditorWidget'
import { ReassessmentLog } from '@/components/ReassessmentLog'
import { CostCommitments } from './CostCommitments'
import { CostForm, toCostElementPayload, type CostFormValues } from './CostForm'
import { downloadCostElementsCsv } from './exportCostElements'
import { CostPrintView } from './CostPrintView'
import { CostRateLines } from './CostRateLines'
import { CostSummaryPanel } from './CostSummaryPanel'
import { CostVarianceThresholds } from './CostVarianceThresholds'
import type { CostVarianceCriterion } from './criteriaTypes'
import { COST_ELEMENT_STATUSES, COST_ELEMENT_STATUS_LABELS, ELEMENT_TYPES, type CostElement } from './types'

interface RiskSummary {
  id: string
  code: string
  title: string
}

interface ProjectDetails {
  gfa_m2: string | null
  space_count: number | null
}

const GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'element_group', label: 'Group' },
  { value: 'status', label: 'Status' },
  { value: 'element_type', label: 'Type' },
] as const
type GroupByField = (typeof GROUP_OPTIONS)[number]['value']

function formatCurrency(value: string | null) {
  if (value === null) return '—'
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString()}` : `£${n.toLocaleString()}`
}

function formatRatio(value: string | null) {
  if (value === null) return '—'
  return Number(value).toFixed(3)
}

const VARIANCE_BAND_STYLES: Record<string, string> = {
  Saving: 'bg-green-100 text-green-700',
  'On Budget': 'bg-gray-100 text-gray-600',
  Monitor: 'bg-amber-100 text-amber-700',
  'Over Budget': 'bg-red-100 text-red-700',
}

// forecast (EAC) vs budget — not vs the frozen Rev A baseline, which only
// moves on a deliberate re-baseline and would otherwise contradict the Cost
// Summary panel's Budget vs Forecast comparison (a baseline-based badge could
// say "On Budget" while the summary reports a real forecast overrun).
function elementForecastVariance(el: CostElement): { amount: number; pct: number } | null {
  const isPct = el.element_type === 'percentage'
  const budget = isPct ? el.computed_budget : el.budget
  const forecast = isPct ? el.computed_forecast : el.forecast
  if (budget === null || forecast === null) return null
  const budgetNum = Number(budget)
  if (budgetNum === 0) return null
  const amount = Number(forecast) - budgetNum
  return { amount, pct: (amount / budgetNum) * 100 }
}

function varianceBand(el: CostElement, criteria: CostVarianceCriterion[]): CostVarianceCriterion | null {
  const fv = elementForecastVariance(el)
  if (fv === null) return null
  return criteria.find(c => {
    const min = c.min_pct !== null ? Number(c.min_pct) : -Infinity
    const max = c.max_pct !== null ? Number(c.max_pct) : Infinity
    return fv.pct >= min && fv.pct < max
  }) ?? null
}

function uniqueGroups(elements: CostElement[]): string[] {
  return [...new Set(elements.map(e => e.element_group).filter((v): v is string => !!v))].sort()
}

export function CostPlan() {
  const { selectedProject } = useProject()
  const { period, loading: periodLoading, error: periodError } = useActivePeriod(selectedProject?.id)
  const { letterhead, save: saveLetterhead } = useProjectLetterhead(selectedProject?.id)
  const [letterheadWidgetOpen, setLetterheadWidgetOpen] = useState(false)
  const [elements, setElements] = useState<CostElement[]>([])
  const [risks, setRisks] = useState<RiskSummary[]>([])
  const [criteria, setCriteria] = useState<CostVarianceCriterion[]>([])
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingElement, setEditingElement] = useState<CostElement | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reassessmentRefreshKey, setReassessmentRefreshKey] = useState(0)

  // Search / Filters / Group — client-side, matching the Risk/ICD toolbar pattern.
  const [searchQuery, setSearchQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set())
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  const [filterGroup, setFilterGroup] = useState('')
  const [groupBy, setGroupBy] = useState<GroupByField>('none')

  // Print / Preview
  const [selectedForPrint, setSelectedForPrint] = useState<Set<string>>(new Set())
  const [printMode, setPrintMode] = useState<'list' | 'detail'>('list')
  const [printTrigger, setPrintTrigger] = useState(0)

  useEffect(() => {
    if (!selectedProject || !period) return
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const [costRes, riskRes, criteriaRes, projectRes] = await Promise.all([
          api.get<CostElement[]>('/api/v1/cost-elements/', { params: { project_id: selectedProject!.id, period_id: period!.id } }),
          api.get<RiskSummary[]>('/api/v1/risks/', { params: { project_id: selectedProject!.id, period_id: period!.id } }),
          api.get<CostVarianceCriterion[]>('/api/v1/cost-variance-criteria/', { params: { project_id: selectedProject!.id } }),
          api.get<ProjectDetails>(`/api/v1/projects/${selectedProject!.id}`),
        ])
        if (cancelled) return
        setElements(costRes.data)
        setRisks(riskRes.data)
        setCriteria(criteriaRes.data.sort((a, b) => a.level - b.level))
        setProjectDetails(projectRes.data)
      } catch {
        if (!cancelled) setError('Failed to load cost plan')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedProject, period])

  // Fires window.print() only after printMode has committed to the DOM.
  useEffect(() => {
    if (printTrigger > 0) window.print()
  }, [printTrigger])

  const toggleInSet = (set: Set<string>, setSet: (s: Set<string>) => void, value: string) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setSet(next)
  }

  const activeFilterCount = filterStatuses.size + filterTypes.size + (filterGroup ? 1 : 0)

  const visibleElements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return elements.filter(el => {
      if (q) {
        const haystack = [el.description, el.code, el.cost_owner, el.element_group].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (filterStatuses.size > 0 && !filterStatuses.has(el.status ?? '')) return false
      if (filterTypes.size > 0 && !filterTypes.has(el.element_type)) return false
      if (filterGroup && el.element_group !== filterGroup) return false
      return true
    })
  }, [elements, searchQuery, filterStatuses, filterTypes, filterGroup])

  const groups = useMemo((): [string, CostElement[]][] => {
    if (groupBy === 'none') return [['', visibleElements]]
    const map = new Map<string, CostElement[]>()
    for (const el of visibleElements) {
      const raw = groupBy === 'status' ? (el.status ? COST_ELEMENT_STATUS_LABELS[el.status] : null) : el[groupBy]
      const key = raw ?? '(none)'
      map.set(key, [...(map.get(key) ?? []), el])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visibleElements, groupBy])

  if (!selectedProject) return null

  const refreshElements = async () => {
    if (!period) return
    const { data } = await api.get<CostElement[]>('/api/v1/cost-elements/', {
      params: { project_id: selectedProject.id, period_id: period.id },
    })
    setElements(data)
  }

  const handleCreate = async (values: CostFormValues, _reassessmentNote: string | null) => {
    if (!period) return
    await api.post('/api/v1/cost-elements/', {
      ...toCostElementPayload(values),
      project_id: selectedProject.id,
      period_id: period.id,
    })
    setFormOpen(false)
    await refreshElements()
  }

  const handleUpdate = async (values: CostFormValues, reassessmentNote: string | null) => {
    if (!editingElement) return
    await api.patch(`/api/v1/cost-elements/${editingElement.id}`, toCostElementPayload(values))
    if (reassessmentNote) {
      await api.post('/api/v1/reassessments/', { record_type: 'cost_element', record_id: editingElement.id, note: reassessmentNote })
      setReassessmentRefreshKey(k => k + 1)
    }
    setEditingElement(null)
    await refreshElements()
  }

  const handleDelete = async (el: CostElement) => {
    if (!(await confirmWithDontAsk('cost.element-delete', `Delete cost element "${el.description}"? This cannot be undone.`))) return
    await api.delete(`/api/v1/cost-elements/${el.id}`)
    await refreshElements()
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

  const candidatesFor = (el: CostElement): LinkCandidate[] => [
    ...elements.filter(e => e.id !== el.id).map(e => ({ id: e.id, type: 'cost_element' as const, label: `${e.code}: ${e.description}` })),
    ...risks.map(r => ({ id: r.id, type: 'risk' as const, label: `${r.code}: ${r.title}` })),
  ]

  const renderRow = (el: CostElement) => {
    const isPct = el.element_type === 'percentage'
    const budget = isPct ? el.computed_budget : el.budget
    const forecast = isPct ? el.computed_forecast : el.forecast
    const actuals = isPct ? el.computed_actuals : el.actuals
    return (
      <Fragment key={el.id}>
        <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
          <td className="px-3 py-2.5">
            <input
              type="checkbox"
              checked={selectedForPrint.has(el.id)}
              onChange={() => toggleInSet(selectedForPrint, setSelectedForPrint, el.id)}
            />
          </td>
          <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{el.code}</td>
          <td className="px-4 py-2.5">
            <button
              onClick={() => setExpandedId(expandedId === el.id ? null : el.id)}
              className="text-left font-medium text-gray-900 hover:text-blue-600"
            >
              {el.description}
            </button>
          </td>
          <td className="px-4 py-2.5 text-gray-600">{el.element_group ?? '—'}</td>
          <td className="px-4 py-2.5">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isPct ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
              {isPct ? `${el.rate ? Math.round(Number(el.rate) * 100) : 0}%` : 'fixed'}
            </span>
          </td>
          <td className="px-4 py-2.5 text-gray-600">{el.cost_owner ?? '—'}</td>
          <td className="px-4 py-2.5 text-gray-600">{el.status ? COST_ELEMENT_STATUS_LABELS[el.status] : '—'}</td>
          <td className="px-4 py-2.5">
            {(() => {
              const band = varianceBand(el, criteria)
              return band ? (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${VARIANCE_BAND_STYLES[band.label] ?? 'bg-gray-100 text-gray-600'}`}>
                  {band.label}
                </span>
              ) : <span className="text-gray-400">—</span>
            })()}
          </td>
          <td className="px-4 py-2.5 text-gray-600">{formatCurrency(budget)}</td>
          <td className="px-4 py-2.5 text-gray-600">{formatCurrency(forecast)}</td>
          <td className="px-4 py-2.5 text-gray-600">{formatCurrency(actuals)}</td>
          <td className="px-4 py-2.5 text-gray-600" title="Forecast vs Budget">
            {(() => {
              const fv = elementForecastVariance(el)
              return fv === null ? '—' : formatCurrency(fv.amount.toString())
            })()}
          </td>
          <td className="px-4 py-2.5 text-gray-600">{el.pct_complete !== null ? `${el.pct_complete}%` : '—'}</td>
          <td className="px-4 py-2.5 text-gray-600">{formatRatio(el.cpi)}</td>
          <td className="px-4 py-2.5 text-right whitespace-nowrap">
            <button onClick={() => setEditingElement(el)} className="text-xs text-blue-600 hover:text-blue-700 mr-3">
              Edit
            </button>
            <button onClick={() => handleDelete(el)} className="text-xs text-gray-400 hover:text-red-600">
              Delete
            </button>
          </td>
        </tr>
        {expandedId === el.id && (
          <tr>
            <td colSpan={15} className="p-0">
              {el.last_reviewed_date && (
                <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex gap-6 flex-wrap text-xs text-gray-500">
                  <span>Last reviewed: <span className="text-gray-700">{el.last_reviewed_date}</span></span>
                </div>
              )}
              {(el.pct_complete !== null || el.pv !== null) && (
                <div className="px-4 py-3 bg-blue-50 border-t border-blue-100">
                  <div className="text-xs font-semibold text-blue-700 mb-2">Earned Value</div>
                  {el.pv !== null && (
                    <div className="grid grid-cols-4 gap-3 text-xs mb-3 pb-3 border-b border-blue-100">
                      <div title="Planned Value — how much of BAC should be earned by today, per this line's linked activity's own schedule position. Set in Scheduling, not here.">
                        <div className="text-gray-500">PV</div><div className="font-semibold text-gray-800">{formatCurrency(el.pv)}</div>
                      </div>
                      <div><div className="text-gray-500">EV</div><div className="font-semibold text-gray-800">{formatCurrency(el.ev)}</div></div>
                      <div title="Schedule Variance — EV minus PV"><div className="text-gray-500">SV</div><div className="font-semibold text-gray-800">{formatCurrency(el.sv)}</div></div>
                      <div title="Schedule Performance Index — EV ÷ PV"><div className="text-gray-500">SPI</div><div className="font-semibold text-gray-800">{formatRatio(el.spi)}</div></div>
                    </div>
                  )}
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <div><div className="text-gray-500">CV</div><div className="font-semibold text-gray-800">{formatCurrency(el.cv)}</div></div>
                    <div><div className="text-gray-500">EAC</div><div className="font-semibold text-gray-800">{formatCurrency(el.eac)}</div></div>
                    <div><div className="text-gray-500">ETC</div><div className="font-semibold text-gray-800">{formatCurrency(el.etc)}</div></div>
                    <div><div className="text-gray-500">VAC</div><div className="font-semibold text-gray-800">{formatCurrency(el.vac)}</div></div>
                    <div><div className="text-gray-500">TCPI</div><div className="font-semibold text-gray-800">{formatRatio(el.tcpi)}</div></div>
                    {el.cost_per_m2 && (
                      <div><div className="text-gray-500">£/m²</div><div className="font-semibold text-gray-800">{formatCurrency(el.cost_per_m2)}</div></div>
                    )}
                  </div>
                </div>
              )}
              {(el.scope_note || el.variance_commentary || el.qs_signoff_name) && (
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-1.5 text-xs">
                  {el.scope_note && (
                    <div><span className="font-semibold text-gray-600">Scope note: </span><span className="text-gray-600">{el.scope_note}</span></div>
                  )}
                  {el.variance_commentary && (
                    <div><span className="font-semibold text-gray-600">Variance commentary: </span><span className="text-gray-600">{el.variance_commentary}</span></div>
                  )}
                  {el.qs_signoff_name && (
                    <div><span className="font-semibold text-gray-600">QS sign-off: </span><span className="text-gray-600">{el.qs_signoff_name}{el.qs_signoff_date ? ` · ${el.qs_signoff_date}` : ''}</span></div>
                  )}
                </div>
              )}
              <CostRateLines costElementId={el.id} isScheduleLinked={el.source === 'schedule'} />
              <CostCommitments costElementId={el.id} />
              <ReassessmentLog
                recordType="cost_element"
                recordId={el.id}
                refreshKey={reassessmentRefreshKey}
                onLogged={() => refreshElements()}
              />
              <RecordLinks recordType="cost_element" recordId={el.id} candidates={candidatesFor(el)} />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  if (loading || periodLoading) {
    return <div className="p-8 text-sm text-gray-400">Loading cost plan…</div>
  }

  return (
    <>
    <div className="p-8 no-print">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Cost Plan</h1>
        {period && (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
            {period.period_label} · {period.freeze_status}
          </span>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-6">
        Cost elements for {selectedProject.name}. Percentage elements (Prelims, Contingency, etc.) compute automatically from the fixed subtotal.
      </p>

      {(error || periodError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error ?? periodError}</div>
      )}

      <CostVarianceThresholds
        criteria={criteria}
        onUpdated={updated => setCriteria(prev => prev.map(c => c.id === updated.id ? updated : c))}
      />

      {formOpen && (
        <CostForm costElement={null} onCancel={() => setFormOpen(false)} onSubmit={handleCreate} />
      )}
      {editingElement && (
        <CostForm costElement={editingElement} onCancel={() => setEditingElement(null)} onSubmit={handleUpdate} />
      )}

      {!formOpen && !editingElement && (
        <button
          onClick={() => setFormOpen(true)}
          className="mb-4 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          + New cost element
        </button>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative max-w-xs w-full">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search cost elements…"
            className="w-full border border-gray-300 rounded-md pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setFiltersOpen(prev => !prev)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            filtersOpen || activeFilterCount > 0 ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          ⚙ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        <select
          value={groupBy}
          onChange={e => setGroupBy(e.target.value as GroupByField)}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600"
        >
          {GROUP_OPTIONS.map(o => <option key={o.value} value={o.value}>↕ Group: {o.label}</option>)}
        </select>
        <button
          onClick={() => downloadCostElementsCsv(visibleElements, selectedProject.name)}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          title="Exports the cost elements currently shown (respecting search/filters) as a CSV file, opens directly in Excel."
        >
          ⇩ Export ({visibleElements.length})
        </button>
        <button
          onClick={handlePrintList}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          title="Print the cost plan exactly as currently shown (respecting search/filters/grouping)."
        >
          🖨️ Print as shown
        </button>
        <button
          onClick={handlePrintSelectedDetail}
          disabled={selectedForPrint.size === 0}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Print a full-detail report for the elements checked in the table below."
        >
          🖨️ Print selected, full detail ({selectedForPrint.size})
        </button>
        <button
          onClick={() => setLetterheadWidgetOpen(o => !o)}
          title="Edit the shared logo/header/footer used on every module's printed reports for this project"
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            letterheadWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          🎨 Letterhead
        </button>
      </div>

      {letterheadWidgetOpen && letterhead && (
        <LetterheadEditorWidget
          letterhead={letterhead}
          previewTokens={{
            project: selectedProject.name, module: 'Cost Plan',
            count: `${visibleElements.length} element${visibleElements.length === 1 ? '' : 's'}`,
            printed_at: new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
          }}
          onSave={saveLetterhead}
          onClose={() => setLetterheadWidgetOpen(false)}
        />
      )}

      {filtersOpen && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 flex gap-8 flex-wrap">
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1.5">Status</div>
            <div className="flex flex-col gap-1">
              {COST_ELEMENT_STATUSES.map(s => (
                <label key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={filterStatuses.has(s)}
                    onChange={() => toggleInSet(filterStatuses, setFilterStatuses, s)}
                  />
                  {COST_ELEMENT_STATUS_LABELS[s]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1.5">Type</div>
            <div className="flex flex-col gap-1">
              {ELEMENT_TYPES.map(t => (
                <label key={t} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={filterTypes.has(t)}
                    onChange={() => toggleInSet(filterTypes, setFilterTypes, t)}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1.5">Group</div>
            <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} className="text-xs border border-gray-300 rounded-md px-2 py-1">
              <option value="">All</option>
              {uniqueGroups(elements).map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilterStatuses(new Set()); setFilterTypes(new Set()); setFilterGroup('') }}
              className="text-xs text-gray-400 hover:text-red-600 self-end"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '16px', alignItems: 'start' }}>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-500 font-medium uppercase tracking-wide">
                <th className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={visibleElements.length > 0 && visibleElements.every(e => selectedForPrint.has(e.id))}
                    onChange={e => setSelectedForPrint(e.target.checked ? new Set(visibleElements.map(e => e.id)) : new Set())}
                    title="Select all (for print)"
                  />
                </th>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Description</th>
                <th className="px-4 py-2.5">Group</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Owner</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Variance Band</th>
                <th className="px-4 py-2.5">Budget</th>
                <th className="px-4 py-2.5">Forecast</th>
                <th className="px-4 py-2.5">Actuals</th>
                <th className="px-4 py-2.5" title="Forecast vs Budget">Variance</th>
                <th className="px-4 py-2.5">% Complete</th>
                <th className="px-4 py-2.5">CPI</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([groupKey, groupElements]) => (
                <Fragment key={groupKey || 'all'}>
                  {groupBy !== 'none' && (
                    <tr>
                      <td colSpan={15} className="px-4 py-1.5 bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {groupKey} <span className="font-normal normal-case text-gray-400">({groupElements.length})</span>
                      </td>
                    </tr>
                  )}
                  {groupElements.map(renderRow)}
                </Fragment>
              ))}

              {visibleElements.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-gray-400 text-sm">
                    {elements.length === 0 ? 'No cost elements yet for this period. Add the first one above.' : 'No cost elements match your search/filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <CostSummaryPanel
          elements={visibleElements}
          gfaM2={projectDetails?.gfa_m2 ?? null}
          spaceCount={projectDetails?.space_count ?? null}
        />
      </div>
    </div>
    <CostPrintView
      mode={printMode}
      elements={printMode === 'list' ? visibleElements : elements.filter(e => selectedForPrint.has(e.id))}
      projectName={selectedProject.name}
      letterhead={letterhead}
    />
    </>
  )
}
