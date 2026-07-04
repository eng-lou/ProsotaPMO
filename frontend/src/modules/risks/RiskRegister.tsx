import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { useProject } from '@/lib/ProjectContext'
import { useProjectLetterhead } from '@/lib/letterhead'
import { useActivePeriod } from '@/lib/usePeriod'
import { RecordLinks, type LinkCandidate } from '@/components/RecordLinks'
import { HeatMatrix } from '@/components/HeatMatrix'
import { LetterheadEditorWidget } from '@/components/LetterheadEditorWidget'
import { ReassessmentLog } from '@/components/ReassessmentLog'
import { RiskForm, toRiskPayload, type RiskFormValues } from './RiskForm'
import { MitigationActions } from './MitigationActions'
import { CriteriaThresholds } from './CriteriaThresholds'
import { downloadRisksCsv } from './exportRisks'
import { RiskPrintView } from './RiskPrintView'
import { RISK_STATUSES, type Risk } from './types'

interface CostElementSummary {
  id: string
  code: string
  description: string
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700',
  mitigated: 'bg-blue-100 text-blue-700',
  closed: 'bg-green-100 text-green-700',
}

const RISK_TYPE_STYLES: Record<string, string> = {
  threat: 'bg-red-100 text-red-700',
  opportunity: 'bg-green-100 text-green-700',
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
  const { letterhead, save: saveLetterhead } = useProjectLetterhead(selectedProject?.id)
  const [letterheadWidgetOpen, setLetterheadWidgetOpen] = useState(false)
  const [risks, setRisks] = useState<Risk[]>([])
  const [costElements, setCostElements] = useState<CostElementSummary[]>([])
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
      <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
        <td className="px-3 py-2.5">
          <input
            type="checkbox"
            checked={selectedForPrint.has(risk.id)}
            onChange={() => toggleInSet(selectedForPrint, setSelectedForPrint, risk.id)}
          />
        </td>
        <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{risk.code}</td>
        <td className="px-4 py-2.5">
          <button
            onClick={() => setExpandedId(expandedId === risk.id ? null : risk.id)}
            className="text-left font-medium text-gray-900 hover:text-blue-600"
          >
            {risk.title}
          </button>
        </td>
        <td className="px-4 py-2.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RISK_TYPE_STYLES[risk.risk_type]}`}>
            {risk.risk_type}
          </span>
        </td>
        <td className="px-4 py-2.5 text-gray-600">{risk.category ?? '—'}</td>
        <td className="px-4 py-2.5 text-gray-600">{risk.area ?? '—'}</td>
        <td className="px-4 py-2.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[risk.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {risk.status}
          </span>
        </td>
        <td className="px-4 py-2.5 text-gray-600">{formatPercent(risk.probability)}</td>
        <td className="px-4 py-2.5 text-gray-600">{formatPercent(risk.impact)}</td>
        <td className="px-4 py-2.5 text-gray-600">{risk.rating ?? '—'}</td>
        <td className="px-4 py-2.5 text-gray-600">{formatCurrency(risk.emv_cost)}</td>
        <td className="px-4 py-2.5 text-gray-600">{formatDays(risk.emv_schedule_days)}</td>
        <td className="px-4 py-2.5 text-right whitespace-nowrap">
          <button onClick={() => setEditingRisk(risk)} className="text-xs text-blue-600 hover:text-blue-700 mr-3">
            Edit
          </button>
          <button onClick={() => handleDelete(risk)} className="text-xs text-gray-400 hover:text-red-600">
            Delete
          </button>
        </td>
      </tr>
      {expandedId === risk.id && (
        <tr>
          <td colSpan={13} className="p-0">
            {(risk.date_raised || risk.expected_impact_date || risk.last_reviewed_date || risk.date_closed) && (
              <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex gap-6 flex-wrap text-xs text-gray-500">
                {risk.date_raised && <span>Raised: <span className="text-gray-700">{risk.date_raised}</span></span>}
                {risk.expected_impact_date && <span>Expected impact: <span className="text-gray-700">{risk.expected_impact_date}</span></span>}
                {risk.last_reviewed_date && <span>Last reviewed: <span className="text-gray-700">{risk.last_reviewed_date}</span></span>}
                {risk.date_closed && <span>Closed: <span className="text-gray-700">{risk.date_closed}</span></span>}
              </div>
            )}
            <div className="px-4 py-4 bg-gray-50 border-t border-gray-100 flex gap-10 flex-wrap">
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
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-600">
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
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-2 text-xs">
                {risk.contingency_plan && (
                  <div>
                    <span className="font-semibold text-gray-600">Contingency plan: </span>
                    <span className="text-gray-600">{risk.contingency_plan}</span>
                  </div>
                )}
                {risk.fallback_plan && (
                  <div>
                    <span className="font-semibold text-gray-600">Fallback plan: </span>
                    <span className="text-gray-600">{risk.fallback_plan}</span>
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
    return <div className="p-8 text-sm text-gray-400">Loading risk register…</div>
  }

  return (
    <>
    <div className="p-8 no-print">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Risk Register</h1>
        {period && (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
            {period.period_label} · {period.freeze_status}
          </span>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-6">
        Risks for {selectedProject.name}. Frozen periods will become read-only once Period Manager is built.
      </p>

      {(error || periodError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error ?? periodError}</div>
      )}

      <CriteriaThresholds projectId={selectedProject.id} />

      {formOpen && (
        <RiskForm risk={null} onCancel={() => setFormOpen(false)} onSubmit={handleCreate} />
      )}
      {editingRisk && (
        <RiskForm risk={editingRisk} onCancel={() => setEditingRisk(null)} onSubmit={handleUpdate} />
      )}

      {!formOpen && !editingRisk && (
        <button
          onClick={() => setFormOpen(true)}
          className="mb-4 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          + New risk
        </button>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative max-w-xs w-full">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search risks…"
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
          onClick={() => downloadRisksCsv(visibleRisks, selectedProject.name)}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          title="Exports the risks currently shown (respecting search/filters) as a CSV file, opens directly in Excel."
        >
          ⇩ Export ({visibleRisks.length})
        </button>
        <button
          onClick={handlePrintList}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          title="Print the register exactly as currently shown (respecting search/filters/grouping)."
        >
          🖨️ Print as shown
        </button>
        <button
          onClick={handlePrintSelectedDetail}
          disabled={selectedForPrint.size === 0}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Print a full-detail report for the risks checked in the table below."
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
            project: selectedProject.name, module: 'Risk Register',
            count: `${visibleRisks.length} risk${visibleRisks.length === 1 ? '' : 's'}`,
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
              {RISK_STATUSES.map(s => (
                <label key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
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
            <div className="text-xs font-semibold text-gray-600 mb-1.5">Risk type</div>
            <div className="flex flex-col gap-1">
              {['threat', 'opportunity'].map(t => (
                <label key={t} className="flex items-center gap-1.5 text-xs text-gray-600">
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
            <div className="text-xs font-semibold text-gray-600 mb-1.5">Theme</div>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="text-xs border border-gray-300 rounded-md px-2 py-1">
              <option value="">All</option>
              {uniqueValues(risks, 'category').map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1.5">Area</div>
            <select value={filterArea} onChange={e => setFilterArea(e.target.value)} className="text-xs border border-gray-300 rounded-md px-2 py-1">
              <option value="">All</option>
              {uniqueValues(risks, 'area').map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilterStatuses(new Set()); setFilterRiskTypes(new Set()); setFilterCategory(''); setFilterArea('') }}
              className="text-xs text-gray-400 hover:text-red-600 self-end"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-500 font-medium uppercase tracking-wide">
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
                    <td colSpan={13} className="px-4 py-1.5 bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {groupKey} <span className="font-normal normal-case text-gray-400">({groupRisks.length})</span>
                    </td>
                  </tr>
                )}
                {groupRisks.map(renderRow)}
              </Fragment>
            ))}

            {visibleRisks.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-gray-400 text-sm">
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
