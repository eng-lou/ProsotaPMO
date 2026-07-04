import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { useProject } from '@/lib/ProjectContext'
import { useProjectLetterhead } from '@/lib/letterhead'
import { useActivePeriod } from '@/lib/usePeriod'
import { RecordLinks, type LinkCandidate } from '@/components/RecordLinks'
import { LetterheadEditorWidget } from '@/components/LetterheadEditorWidget'
import { ReassessmentLog } from '@/components/ReassessmentLog'
import { downloadIcdItemsCsv } from './exportIcdItems'
import { IcdActionItems } from './IcdActionItems'
import { IcdComments } from './IcdComments'
import { IcdCriteriaThresholds } from './IcdCriteriaThresholds'
import { IcdKpiStrip } from './IcdKpiStrip'
import { IcdForm, toIcdPayload, type IcdFormValues } from './IcdForm'
import { IcdPrintView } from './IcdPrintView'
import { ITEM_TYPE_LABELS, ITEM_TYPES, PRIORITIES, PRIORITY_LABELS, STATUS_LABELS, type IcdItem, type ItemType } from './types'

interface RiskSummary { id: string; code: string; title: string }
interface CostElementSummary { id: string; code: string; description: string }

const TYPE_STYLES: Record<ItemType, string> = {
  issue: 'bg-red-100 text-red-700',
  change: 'bg-amber-100 text-amber-700',
  decision: 'bg-blue-100 text-blue-700',
}

const GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'item_type', label: 'Type' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'owner', label: 'Owner' },
] as const
type GroupByField = (typeof GROUP_OPTIONS)[number]['value']

function formatCurrency(value: string | null) {
  if (value === null) return '—'
  return `£${Number(value).toLocaleString()}`
}

function uniqueValues(items: IcdItem[], field: 'owner' | 'status'): string[] {
  return [...new Set(items.map(i => i[field]).filter((v): v is string => !!v))].sort()
}

export function IcdTracker() {
  const { selectedProject } = useProject()
  const { period, loading: periodLoading, error: periodError } = useActivePeriod(selectedProject?.id)
  const { letterhead, save: saveLetterhead } = useProjectLetterhead(selectedProject?.id)
  const [letterheadWidgetOpen, setLetterheadWidgetOpen] = useState(false)
  const [items, setItems] = useState<IcdItem[]>([])
  const [risks, setRisks] = useState<RiskSummary[]>([])
  const [costElements, setCostElements] = useState<CostElementSummary[]>([])
  const [typeFilter, setTypeFilter] = useState<ItemType | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<IcdItem | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reassessmentRefreshKey, setReassessmentRefreshKey] = useState(0)

  // Search / Filters / Group — client-side, matching the Risk Register's toolbar.
  const [searchQuery, setSearchQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set())
  const [filterPriorities, setFilterPriorities] = useState<Set<string>>(new Set())
  const [filterOwner, setFilterOwner] = useState('')
  const [groupBy, setGroupBy] = useState<GroupByField>('none')

  // Print / Preview — the .print-only view (IcdPrintView) is always in the DOM
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
        const [itemRes, riskRes, costRes] = await Promise.all([
          api.get<IcdItem[]>('/api/v1/icd-items/', { params: { project_id: selectedProject!.id, period_id: period!.id } }),
          api.get<RiskSummary[]>('/api/v1/risks/', { params: { project_id: selectedProject!.id, period_id: period!.id } }),
          api.get<CostElementSummary[]>('/api/v1/cost-elements/', { params: { project_id: selectedProject!.id, period_id: period!.id } }),
        ])
        if (cancelled) return
        setItems(itemRes.data)
        setRisks(riskRes.data)
        setCostElements(costRes.data)
      } catch {
        if (!cancelled) setError('Failed to load ICD tracker')
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

  const activeFilterCount = filterStatuses.size + filterPriorities.size + (filterOwner ? 1 : 0)

  const searchedAndFilteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return items.filter(i => {
      if (typeFilter !== 'all' && i.item_type !== typeFilter) return false
      if (q) {
        const haystack = [i.title, i.code, i.owner, i.raised_by].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (filterStatuses.size > 0 && !filterStatuses.has(i.status)) return false
      if (filterPriorities.size > 0 && !filterPriorities.has(i.priority ?? '')) return false
      if (filterOwner && i.owner !== filterOwner) return false
      return true
    })
  }, [items, typeFilter, searchQuery, filterStatuses, filterPriorities, filterOwner])

  const groups = useMemo((): [string, IcdItem[]][] => {
    if (groupBy === 'none') return [['', searchedAndFilteredItems]]
    const map = new Map<string, IcdItem[]>()
    for (const i of searchedAndFilteredItems) {
      const raw = groupBy === 'item_type' ? ITEM_TYPE_LABELS[i.item_type]
        : groupBy === 'status' ? (STATUS_LABELS[i.status] ?? i.status)
        : groupBy === 'priority' ? (i.priority ? (PRIORITY_LABELS[i.priority as keyof typeof PRIORITY_LABELS] ?? i.priority) : null)
        : i.owner
      const key = raw ?? '(none)'
      map.set(key, [...(map.get(key) ?? []), i])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [searchedAndFilteredItems, groupBy])

  if (!selectedProject) return null

  const refreshItems = async () => {
    if (!period) return
    const { data } = await api.get<IcdItem[]>('/api/v1/icd-items/', {
      params: { project_id: selectedProject.id, period_id: period.id },
    })
    setItems(data)
  }

  const handleCreate = async (values: IcdFormValues, _reassessmentNote: string | null) => {
    if (!period) return
    await api.post('/api/v1/icd-items/', {
      ...toIcdPayload(values),
      item_type: values.item_type,
      project_id: selectedProject.id,
      period_id: period.id,
    })
    setFormOpen(false)
    await refreshItems()
  }

  const handleUpdate = async (values: IcdFormValues, reassessmentNote: string | null) => {
    if (!editingItem) return
    await api.patch(`/api/v1/icd-items/${editingItem.id}`, toIcdPayload(values))
    if (reassessmentNote) {
      await api.post('/api/v1/reassessments/', { record_type: 'icd_item', record_id: editingItem.id, note: reassessmentNote })
      setReassessmentRefreshKey(k => k + 1)
    }
    setEditingItem(null)
    await refreshItems()
  }

  const handleDelete = async (item: IcdItem) => {
    if (!(await confirmWithDontAsk('icd.delete-item', `Delete "${item.title}"? This cannot be undone.`))) return
    await api.delete(`/api/v1/icd-items/${item.id}`)
    await refreshItems()
  }

  const candidatesFor = (item: IcdItem): LinkCandidate[] => [
    ...items.filter(i => i.id !== item.id).map(i => ({ id: i.id, type: i.item_type, label: `${i.code}: ${i.title}` })),
    ...risks.map(r => ({ id: r.id, type: 'risk' as const, label: `${r.code}: ${r.title}` })),
    ...costElements.map(c => ({ id: c.id, type: 'cost_element' as const, label: `${c.code}: ${c.description}` })),
  ]

  const handlePrintList = () => {
    setPrintMode('list')
    setPrintTrigger(t => t + 1)
  }

  const handlePrintSelectedDetail = () => {
    if (selectedForPrint.size === 0) return
    setPrintMode('detail')
    setPrintTrigger(t => t + 1)
  }

  const visibleItems = searchedAndFilteredItems

  const renderRow = (item: IcdItem) => (
    <Fragment key={item.id}>
      <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
        <td className="px-3 py-2.5">
          <input
            type="checkbox"
            checked={selectedForPrint.has(item.id)}
            onChange={() => toggleInSet(selectedForPrint, setSelectedForPrint, item.id)}
          />
        </td>
        <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{item.code}</td>
        <td className="px-4 py-2.5">
          <button
            onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
            className="text-left font-medium text-gray-900 hover:text-blue-600"
          >
            {item.title}
          </button>
        </td>
        <td className="px-4 py-2.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_STYLES[item.item_type]}`}>
            {ITEM_TYPE_LABELS[item.item_type]}
          </span>
        </td>
        <td className="px-4 py-2.5 text-gray-600">
          {STATUS_LABELS[item.status] ?? item.status}
          {item.item_type === 'change' && item.ccb_decision && (
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-medium ${
              item.ccb_decision === 'approved' ? 'bg-green-100 text-green-700'
                : item.ccb_decision === 'rejected' ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              CCB: {item.ccb_decision}
            </span>
          )}
        </td>
        <td className="px-4 py-2.5 text-gray-600 capitalize">{item.priority ?? '—'}</td>
        <td className="px-4 py-2.5 text-gray-600">{item.owner ?? '—'}</td>
        <td className="px-4 py-2.5 text-gray-600">
          {item.item_type === 'decision' ? (item.required_by ?? '—') : (item.due_date ?? '—')}
        </td>
        <td className="px-4 py-2.5 text-gray-600">
          {item.item_type === 'change' && (
            <>{formatCurrency(item.cost_impact)}{item.schedule_impact_days ? ` · +${item.schedule_impact_days}d` : ''}</>
          )}
          {item.item_type === 'issue' && (item.severity ?? '—')}
          {item.item_type === 'decision' && (item.decision_maker ?? '—')}
        </td>
        <td className="px-4 py-2.5 text-right whitespace-nowrap">
          <button onClick={() => setEditingItem(item)} className="text-xs text-blue-600 hover:text-blue-700 mr-3">
            Edit
          </button>
          <button onClick={() => handleDelete(item)} className="text-xs text-gray-400 hover:text-red-600">
            Delete
          </button>
        </td>
      </tr>
      {expandedId === item.id && (
        <tr>
          <td colSpan={10} className="p-0">
            {(item.raised_date || item.due_date || item.last_reviewed_date || item.closed_date) && (
              <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex gap-6 flex-wrap text-xs text-gray-500">
                {item.raised_date && <span>Raised: <span className="text-gray-700">{item.raised_date}</span></span>}
                {item.due_date && <span>Due: <span className="text-gray-700">{item.due_date}</span></span>}
                {item.last_reviewed_date && <span>Last reviewed: <span className="text-gray-700">{item.last_reviewed_date}</span></span>}
                {item.closed_date && <span>Closed: <span className="text-gray-700">{item.closed_date}</span></span>}
              </div>
            )}
            {(item.description || item.raised_by || item.resolution || item.contract_reference || item.change_type || item.cost_claim || item.eot_claim_days || item.quality_impact || item.rejection_reason || item.if_late_consequence) && (
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-1.5 text-xs">
                {item.raised_by && (
                  <div><span className="font-semibold text-gray-600">Raised by: </span><span className="text-gray-600">{item.raised_by}</span></div>
                )}
                {item.description && (
                  <div><span className="font-semibold text-gray-600">Description: </span><span className="text-gray-600">{item.description}</span></div>
                )}
                {item.change_type && (
                  <div><span className="font-semibold text-gray-600">Change type: </span><span className="text-gray-600">{item.change_type}</span></div>
                )}
                {item.contract_reference && (
                  <div><span className="font-semibold text-gray-600">Contract reference: </span><span className="text-gray-600">{item.contract_reference}</span></div>
                )}
                {(item.cost_claim || item.eot_claim_days) && (
                  <div>
                    <span className="font-semibold text-gray-600">Claim: </span>
                    <span className="text-gray-600">{formatCurrency(item.cost_claim)}{item.eot_claim_days ? ` · ${item.eot_claim_days}d EOT` : ''}</span>
                  </div>
                )}
                {item.quality_impact && (
                  <div><span className="font-semibold text-gray-600">Quality impact: </span><span className="text-gray-600">{item.quality_impact}</span></div>
                )}
                {item.rejection_reason && (
                  <div><span className="font-semibold text-gray-600">Rejection reason: </span><span className="text-gray-600">{item.rejection_reason}</span></div>
                )}
                {item.if_late_consequence && (
                  <div><span className="font-semibold text-gray-600">Consequence if late: </span><span className="text-gray-600">{item.if_late_consequence}</span></div>
                )}
                {item.resolution && (
                  <div><span className="font-semibold text-gray-600">Resolution: </span><span className="text-gray-600">{item.resolution}</span></div>
                )}
              </div>
            )}
            <IcdActionItems icdItemId={item.id} />
            <ReassessmentLog
              recordType="icd_item"
              recordId={item.id}
              refreshKey={reassessmentRefreshKey}
              onLogged={() => refreshItems()}
            />
            <IcdComments icdItemId={item.id} />
            <RecordLinks recordType={item.item_type} recordId={item.id} candidates={candidatesFor(item)} />
          </td>
        </tr>
      )}
    </Fragment>
  )

  if (loading || periodLoading) {
    return <div className="p-8 text-sm text-gray-400">Loading ICD tracker…</div>
  }

  return (
    <>
    <div className="p-8 no-print">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">ICD Tracker</h1>
        {period && (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
            {period.period_label} · {period.freeze_status}
          </span>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-6">Issues, changes, and decisions for {selectedProject.name}.</p>

      {(error || periodError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">{error ?? periodError}</div>
      )}

      <IcdKpiStrip items={items} />

      <IcdCriteriaThresholds projectId={selectedProject.id} />

      <div className="flex gap-2 mb-4">
        {(['all', ...ITEM_TYPES] as const).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium ${
              typeFilter === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'all' ? 'All' : ITEM_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {formOpen && (
        <IcdForm item={null} onCancel={() => setFormOpen(false)} onSubmit={handleCreate} />
      )}
      {editingItem && (
        <IcdForm item={editingItem} onCancel={() => setEditingItem(null)} onSubmit={handleUpdate} />
      )}

      {!formOpen && !editingItem && (
        <button
          onClick={() => setFormOpen(true)}
          className="mb-4 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          + New issue / change / decision
        </button>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative max-w-xs w-full">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search issues, changes, decisions…"
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
          onClick={() => downloadIcdItemsCsv(visibleItems, selectedProject.name)}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          title="Exports the items currently shown (respecting search/filters) as a CSV file, opens directly in Excel."
        >
          ⇩ Export ({visibleItems.length})
        </button>
        <button
          onClick={handlePrintList}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          title="Print the tracker exactly as currently shown (respecting search/filters/grouping)."
        >
          🖨️ Print as shown
        </button>
        <button
          onClick={handlePrintSelectedDetail}
          disabled={selectedForPrint.size === 0}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Print a full-detail report for the items checked in the table below."
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
            project: selectedProject.name, module: 'ICD Tracker',
            count: `${visibleItems.length} item${visibleItems.length === 1 ? '' : 's'}`,
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
              {uniqueValues(items, 'status').map(s => (
                <label key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={filterStatuses.has(s)}
                    onChange={() => toggleInSet(filterStatuses, setFilterStatuses, s)}
                  />
                  {STATUS_LABELS[s] ?? s}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1.5">Priority</div>
            <div className="flex flex-col gap-1">
              {PRIORITIES.map(p => (
                <label key={p} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={filterPriorities.has(p)}
                    onChange={() => toggleInSet(filterPriorities, setFilterPriorities, p)}
                  />
                  {PRIORITY_LABELS[p]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1.5">Owner</div>
            <select value={filterOwner} onChange={e => setFilterOwner(e.target.value)} className="text-xs border border-gray-300 rounded-md px-2 py-1">
              <option value="">All</option>
              {uniqueValues(items, 'owner').map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilterStatuses(new Set()); setFilterPriorities(new Set()); setFilterOwner('') }}
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
                  checked={visibleItems.length > 0 && visibleItems.every(i => selectedForPrint.has(i.id))}
                  onChange={e => setSelectedForPrint(e.target.checked ? new Set(visibleItems.map(i => i.id)) : new Set())}
                  title="Select all (for print)"
                />
              </th>
              <th className="px-4 py-2.5">Code</th>
              <th className="px-4 py-2.5">Title</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Priority</th>
              <th className="px-4 py-2.5">Owner</th>
              <th className="px-4 py-2.5">Due</th>
              <th className="px-4 py-2.5">Impact</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([groupKey, groupItems]) => (
              <Fragment key={groupKey || 'all'}>
                {groupBy !== 'none' && (
                  <tr>
                    <td colSpan={10} className="px-4 py-1.5 bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {groupKey} <span className="font-normal normal-case text-gray-400">({groupItems.length})</span>
                    </td>
                  </tr>
                )}
                {groupItems.map(renderRow)}
              </Fragment>
            ))}

            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-400 text-sm">
                  {items.length === 0 ? 'No items yet for this period. Add the first one above.' : 'No items match your search/filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    <IcdPrintView
      mode={printMode}
      items={printMode === 'list' ? visibleItems : items.filter(i => selectedForPrint.has(i.id))}
      projectName={selectedProject.name}
      letterhead={letterhead}
    />
    </>
  )
}
