import axios from 'axios'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { useProject } from '@/lib/ProjectContext'
import { useProjectLetterhead } from '@/lib/letterhead'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { resourceLabelForActivity } from '@/lib/resourceLabel'
import { useUserDefinedFieldDefinitions, useUserDefinedFieldValues } from '@/lib/userDefinedFields'
import { RecordLinks, type LinkCandidate } from '@/components/RecordLinks'
import { BaselineManagerWidget } from '@/components/BaselineManagerWidget'
import { LetterheadEditorWidget } from '@/components/LetterheadEditorWidget'
import { ReassessmentLog } from '@/components/ReassessmentLog'
import { UdfCell } from '@/modules/scheduling/UdfCell'
import { UserDefinedFieldsWidget } from '@/modules/scheduling/UserDefinedFieldsWidget'
import type { Activity, ResourceAssignment } from '@/modules/scheduling/types'
import { Boq } from './Boq'
import { CostCommitments } from './CostCommitments'
import { DEFAULT_COST_LINES } from './costGeneration'
import { CostForm, toCostElementPayload, type CostFormValues } from './CostForm'
import { downloadCostElementsCsv } from './exportCostElements'
import { CostPrintView, type PrintColumn, type PrintRow } from './CostPrintView'
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
  { value: 'resource', label: 'Resource' },
] as const
type GroupByField = (typeof GROUP_OPTIONS)[number]['value']

// Fixed at exactly 2dp (2026-07-27, per Maro's QS review: "£160,690.7 to one
// decimal is a formatting bug") — plain toLocaleString() shows however many
// decimal digits the underlying float happens to carry (0-3, and JS drops a
// trailing zero from a value like 160690.70), so this table and its print
// view mixed £3,213,814 / £257,105.12 / £160,690.7 side by side depending on
// which figure happened to round to a whole number. Currency always has
// exactly two.
function formatCurrency(value: string | null) {
  if (value === null) return '—'
  const n = Number(value)
  const formatted = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `-£${formatted}` : `£${formatted}`
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

// Deterministic, non-cryptographic 128-bit hash (cyrb128) formatted as a
// valid UUID string (2026-07-18, per Maro: "allow me to insert comments per
// line (parents included)") — Construction/Total/each discipline/each other
// grouping's own summary row isn't a real CostElement, so there's no real
// id to hang a UDF value off. UserDefinedFieldValue.record_id is a genuine
// Postgres UUID column (not a free-text field), so a synthetic label like
// "Construction" can't be stored there directly — this instead derives a
// STABLE, always-the-same pseudo-id from the label text itself, reusing the
// exact same UDF value system (and "Comments" column a user already
// created) with zero backend changes. Collision risk is a non-issue here:
// a project only ever has a handful of distinct group labels
// (disciplines + Construction + Total + a few Status/Type values), nowhere
// near the volume where a 128-bit hash's birthday-paradox risk matters.
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

function pseudoRecordId(...parts: string[]): string {
  const [a, b, c, d] = cyrb128(parts.join('::'))
  const hex = (n: number) => n.toString(16).padStart(8, '0')
  const ah = hex(a), bh = hex(b), ch = hex(c), dh = hex(d)
  return `${ah}-${bh.slice(0, 4)}-4${bh.slice(4, 7)}-8${ch.slice(0, 3)}-${ch.slice(3, 8)}${dh.slice(0, 7)}`
}

// Column visibility (2026-07-18, per Maro: "give me column (activation/
// deactivation)") — Checkbox/Description/Budget/Actions stay always-on
// (structural, not really "data" columns); everything else here is
// individually toggleable via the Columns picker, persisted per-browser
// the same way column widths/visibility already work elsewhere in this app.
const TOGGLEABLE_COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'element_group', label: 'Group' },
  { key: 'element_type', label: 'Type' },
  { key: 'cost_owner', label: 'Owner' },
  { key: 'status', label: 'Status' },
  { key: 'variance_band', label: 'Variance Band' },
  { key: 'forecast', label: 'Forecast' },
  { key: 'actuals', label: 'Actuals' },
  { key: 'variance', label: 'Variance' },
  { key: 'pct_complete', label: '% Complete' },
  { key: 'cpi', label: 'CPI' },
] as const
type CostColumnKey = (typeof TOGGLEABLE_COLUMNS)[number]['key']
const COST_PLAN_COLUMNS_KEY = 'prosota_cost_plan_columns'

function loadVisibleColumns(): Set<CostColumnKey> {
  try {
    const raw = localStorage.getItem(COST_PLAN_COLUMNS_KEY)
    if (!raw) return new Set(TOGGLEABLE_COLUMNS.map(c => c.key))
    const saved: string[] = JSON.parse(raw)
    return new Set(TOGGLEABLE_COLUMNS.map(c => c.key).filter(k => saved.includes(k)))
  } catch {
    return new Set(TOGGLEABLE_COLUMNS.map(c => c.key))
  }
}

const NON_DISCIPLINE_GROUPS = new Set(['On-Costs', 'Risk'])

function uniqueGroups(elements: CostElement[]): string[] {
  // 'BOQ' excluded (2026-07-18) — the dedicated Bill of Quantities element
  // never shows in Cost Plan at all (see visibleElements' own filter), so
  // offering it as a filterable group here would just filter down to
  // nothing every time.
  return [...new Set(elements.map(e => e.element_group).filter((v): v is string => !!v && v !== 'BOQ'))].sort()
}

export function CostPlan() {
  const { selectedProject } = useProject()
  const { period, loading: periodLoading, error: periodError } = useActivePeriod(selectedProject?.id)
  // Scheduling's own schedule-variant/period pair (distinct from `period`
  // above — Risk/Cost/ICD's shared Period) — needed to fetch resource
  // assignments/activities for "Group by Resource" and the Rate Card's
  // child-activity rollup (2026-07-10, per Maro). Same hook Scheduling.tsx
  // itself uses, so it resolves to the exact same live schedule.
  const { period: schedulePeriod } = useActiveScheduleVariant(selectedProject?.id)
  const { letterhead, save: saveLetterhead } = useProjectLetterhead(selectedProject?.id)
  const [letterheadWidgetOpen, setLetterheadWidgetOpen] = useState(false)
  const [baselineWidgetOpen, setBaselineWidgetOpen] = useState(false)
  const [elements, setElements] = useState<CostElement[]>([])
  const [risks, setRisks] = useState<RiskSummary[]>([])
  const [criteria, setCriteria] = useState<CostVarianceCriterion[]>([])
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null)
  const [resourceAssignments, setResourceAssignments] = useState<ResourceAssignment[]>([])
  const [scheduleActivities, setScheduleActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingElement, setEditingElement] = useState<CostElement | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reassessmentRefreshKey, setReassessmentRefreshKey] = useState(0)

  const {
    definitions: udfDefinitions, loading: udfDefinitionsLoading,
    create: createUdfDefinition, update: updateUdfDefinition, remove: removeUdfDefinition,
  } = useUserDefinedFieldDefinitions(selectedProject?.id, 'cost_element')
  // Pseudo-ids for Construction/Total/each discipline's own summary row
  // (2026-07-18, per Maro: "allow me to insert comments per line (parents
  // included)") — see pseudoRecordId's own header. Derived from `elements`
  // directly (not visibleElements/constructionView, to avoid a dependency
  // ordering issue — this only needs the set of discipline names that
  // exist at all, unaffected by the current search/filter).
  const summaryRecordIds = useMemo(() => {
    const disciplines = new Set<string>()
    for (const el of elements) {
      if (el.element_group && !NON_DISCIPLINE_GROUPS.has(el.element_group) && el.element_group !== 'BOQ') {
        disciplines.add(el.element_group)
      }
    }
    return ['Construction', 'Total', ...disciplines].map(label => pseudoRecordId(label))
  }, [elements])
  const { getValue: getUdfValue, setValue: setUdfValue } = useUserDefinedFieldValues(
    udfDefinitions, [...elements.map(e => e.id), ...summaryRecordIds],
  )
  const [udfWidgetOpen, setUdfWidgetOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<Set<CostColumnKey>>(loadVisibleColumns)
  const [columnsPickerOpen, setColumnsPickerOpen] = useState(false)
  const toggleColumn = (key: CostColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      localStorage.setItem(COST_PLAN_COLUMNS_KEY, JSON.stringify([...next]))
      return next
    })
  }

  // Search / Filters / Group — client-side, matching the Risk/ICD toolbar pattern.
  const [searchQuery, setSearchQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set())
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  const [filterGroup, setFilterGroup] = useState('')
  // Defaults to grouped-by-discipline (2026-07-18, per Maro: "the resource
  // loaded task level cost items are too detailed. I want it by discipline
  // so less items on the cost plan... i want disciplines" — not a
  // togglable collapse, just disciplines as the row, full stop).
  // cost_sync.py sets a schedule-sourced element's own element_group to its
  // activity's Discipline UDF value, so grouping by 'element_group' already
  // means "by discipline" for anything IFC-generated, with zero new
  // grouping logic needed here. Every group always renders as one
  // aggregated summary row (see the table body below) — task-level detail
  // lives in the BOQ tab instead, not here.
  const [groupBy, setGroupBy] = useState<GroupByField>('element_group')
  const [generatingCostPlan, setGeneratingCostPlan] = useState(false)
  const [generateMessage, setGenerateMessage] = useState<string | null>(null)
  // Cost Plan / BOQ tabs (2026-07-18, per Maro: "I want a boq form in the
  // cost section BOQ TAB") — a top-level switch, same shape as Scheduling's
  // own Activities/Resources tabs.
  const [costTab, setCostTab] = useState<'plan' | 'boq'>('plan')

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

  // Resource assignments + activities for "Group by Resource" and the Rate
  // Card's child-activity rollup (2026-07-10, per Maro) — loaded separately
  // from the main Cost Plan fetch above since they come from Scheduling's own
  // schedule-variant/period, which resolves independently (and later, since
  // it bootstraps its own variant on first load).
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
      // BOQ lives entirely in its own tab (2026-07-18, per Maro: "BOQ should
      // not be included") — the dedicated "Bill of Quantities" CostElement
      // (Boq.tsx's own BOQ_GROUP) never shows up in Cost Plan at all, not
      // even as an ungrouped/other line.
      if (el.element_group === 'BOQ') return false
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
      const raw = groupBy === 'status' ? (el.status ? COST_ELEMENT_STATUS_LABELS[el.status] : null)
        : groupBy === 'resource' ? resourceLabelForActivity(el.linked_activity_id, resourceAssignments)
        : el[groupBy]
      const key = raw ?? '(none)'
      map.set(key, [...(map.get(key) ?? []), el])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visibleElements, groupBy, resourceAssignments])

  // One aggregated row per group for the rolled-up view (2026-07-18) — sums
  // budget/forecast/actuals/comparison the same way each individual row
  // already resolves them (computed_* for a percentage element, the stored
  // field for a fixed one — renderRow's own isPct logic, mirrored here).
  const groupTotals = (groupElements: CostElement[]) => {
    let budget = 0, forecast = 0, actuals = 0, comparisonCost = 0, hasComparison = false
    for (const el of groupElements) {
      const isPct = el.element_type === 'percentage'
      budget += Number((isPct ? el.computed_budget : el.budget) ?? 0)
      forecast += Number((isPct ? el.computed_forecast : el.forecast) ?? 0)
      actuals += Number((isPct ? el.computed_actuals : el.actuals) ?? 0)
      if (el.comparison_cost !== null) { comparisonCost += Number(el.comparison_cost); hasComparison = true }
    }
    return { budget, forecast, actuals, comparisonCost: hasComparison ? comparisonCost : null }
  }

  // "Construction is the parent of those disciplines, then the discipline
  // and per discipline you can drill down if needed... [Prelims/Design
  // Fees/Overhead/Inflation/Contingency] should be same level as the
  // construction" (2026-07-18) — a real QS cost-plan shape: Construction (a
  // synthetic parent, not a real CostElement — just every schedule-sourced
  // element rolled up by its own discipline) as one section with its own
  // subtotal, then Prelims/Design Fees/Overhead/Inflation/Contingency each
  // as their own top-level line alongside it, not nested under it. Only
  // meaningful when grouped by discipline (groupBy === 'element_group',
  // the default) — other groupings (Status/Type/Resource) still use the
  // plain flat `groups` list below.
  const constructionView = useMemo(() => {
    const disciplineMap = new Map<string, CostElement[]>()
    const topLevel: CostElement[] = []
    for (const el of visibleElements) {
      if (el.element_group && !NON_DISCIPLINE_GROUPS.has(el.element_group)) {
        disciplineMap.set(el.element_group, [...(disciplineMap.get(el.element_group) ?? []), el])
      } else {
        topLevel.push(el)
      }
    }
    const disciplines = [...disciplineMap.entries()].sort(([a], [b]) => a.localeCompare(b))
    return { disciplines, topLevel }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleElements])

  // "Allow me to collapse the construction" (2026-07-18) — hides every
  // discipline row underneath Construction's own subtotal, independent of
  // each discipline's own expand/collapse state (expandedDisciplines is
  // untouched either way, so re-expanding Construction restores whichever
  // disciplines were drilled into before).
  const [constructionCollapsed, setConstructionCollapsed] = useState(false)
  const [expandedDisciplines, setExpandedDisciplines] = useState<Set<string>>(new Set())
  const toggleDiscipline = (discipline: string) => {
    setExpandedDisciplines(prev => {
      const next = new Set(prev)
      if (next.has(discipline)) next.delete(discipline); else next.add(discipline)
      return next
    })
  }

  // Shared aggregated-row renderer — Construction's own subtotal, each
  // discipline under it, the grand Total, and (for every other grouping
  // choice) a plain group header all share the identical column layout, so
  // this is the one place that shape is defined.
  const renderSummaryRow = (
    label: string,
    totals: ReturnType<typeof groupTotals>,
    opts: { bold?: boolean; indent?: boolean; count?: number; expanded?: boolean; onClick?: () => void; className?: string } = {},
  ) => {
    // onClick lives on the arrow/label cells specifically, not the whole
    // <tr> (2026-07-18) — Comments (UDF) needs its own double-click-to-edit
    // on this same row, and a row-wide onClick would otherwise also fire
    // (and toggle expand/collapse) on every click inside that cell too.
    const summaryRecordId = pseudoRecordId(label)
    const boldCls = opts.bold ? 'font-bold' : ''
    return (
      <tr key={label || 'all'} className={opts.className}>
        <td className="px-3 py-2.5"></td>
        <td className="px-2 py-2.5 text-gray-400 text-xs cursor-pointer" onClick={opts.onClick}>
          {opts.onClick ? (opts.expanded ? '▾' : '▸') : ''}
        </td>
        {visibleColumns.has('code') && <td className="px-4 py-2.5"></td>}
        <td
          className={`px-4 py-2.5 ${opts.bold ? 'font-bold' : 'font-medium'} text-gray-900 ${opts.indent ? 'pl-8' : ''} ${opts.onClick ? 'cursor-pointer' : ''}`}
          onClick={opts.onClick}
        >
          {label}{opts.count !== undefined && <span className="font-normal text-gray-400 text-xs"> ({opts.count})</span>}
        </td>
        {visibleColumns.has('element_group') && <td className="px-4 py-2.5"></td>}
        {visibleColumns.has('element_type') && <td className="px-4 py-2.5"></td>}
        {visibleColumns.has('cost_owner') && <td className="px-4 py-2.5"></td>}
        {visibleColumns.has('status') && <td className="px-4 py-2.5"></td>}
        {visibleColumns.has('variance_band') && <td className="px-4 py-2.5"></td>}
        <td className={`px-4 py-2.5 text-gray-900 ${boldCls}`}>{formatCurrency(totals.budget.toString())}</td>
        {visibleColumns.has('forecast') && <td className={`px-4 py-2.5 text-gray-900 ${boldCls}`}>{formatCurrency(totals.forecast.toString())}</td>}
        {visibleColumns.has('actuals') && <td className={`px-4 py-2.5 text-gray-900 ${boldCls}`}>{formatCurrency(totals.actuals.toString())}</td>}
        {visibleColumns.has('variance') && <td className={`px-4 py-2.5 text-gray-900 ${boldCls}`}>{formatCurrency((totals.forecast - totals.budget).toString())}</td>}
        {visibleColumns.has('pct_complete') && <td className="px-4 py-2.5"></td>}
        {visibleColumns.has('cpi') && <td className="px-4 py-2.5"></td>}
        {udfDefinitions.map(d => (
          <UdfCell key={d.id} definition={d} value={getUdfValue(d.id, summaryRecordId)} onSave={payload => setUdfValue(d.id, summaryRecordId, payload)} />
        ))}
        <td className="px-4 py-2.5"></td>
      </tr>
    )
  }

  // Rate Card child-activity rollup (2026-07-10, per Maro: "resource
  // description should be indentable per line... so I can collapse or expand
  // and see the granular detail") — a cost element linked to a WBS Summary
  // can expand into its direct children's own linked cost elements, each
  // recursively drillable the same way. Purely presentational: there's no
  // WBS-tree rollup in the cost data itself (every activity's cost element
  // stays independent, see app/services/resource_assignment.py's own
  // 2026-07-08 note) — this just surfaces the ones that already exist.
  const elementByActivityId = useMemo(() => {
    const map = new Map<string, CostElement>()
    for (const el of elements) {
      if (el.linked_activity_id) map.set(el.linked_activity_id, el)
    }
    return map
  }, [elements])

  const childRowsFor = (activityId: string): { activityId: string; label: string; costElementId: string }[] =>
    scheduleActivities
      .filter(a => a.parent_id === activityId)
      .map(a => {
        const childElement = elementByActivityId.get(a.id)
        return childElement ? { activityId: a.id, label: `${a.code}: ${a.task_name}`, costElementId: childElement.id } : null
      })
      .filter((row): row is { activityId: string; label: string; costElementId: string } => row !== null)

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

  // "Generate Cost Plan" (2026-07-18) — see costGeneration.ts's own header.
  // Resource-loaded fixed elements already exist (cost_sync.py, live) by the
  // time this runs; this only adds the standard on-cost percentage lines,
  // deduped by description so re-running after the schedule changes doesn't
  // spawn duplicates.
  const handleGenerateCostPlan = async () => {
    if (!period) return
    setGeneratingCostPlan(true)
    setGenerateMessage(null)
    try {
      const { data } = await api.post('/api/v1/cost-bulk-generate/', {
        project_id: selectedProject.id, period_id: period.id, elements: DEFAULT_COST_LINES,
      })
      await refreshElements()
      const reused = DEFAULT_COST_LINES.length - data.element_count
      setGenerateMessage(`Cost plan updated — ${data.element_count} new line(s)${reused > 0 ? `, ${reused} already existed` : ''}.`)
    } catch (err) {
      setGenerateMessage(axios.isAxiosError(err)
        ? `Failed to generate cost plan (${err.response?.data?.detail ?? err.message})`
        : 'Failed to generate cost plan')
    } finally {
      setGeneratingCostPlan(false)
    }
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

  // checkbox + arrow + description + budget + actions are always on; the
  // rest depends on visibleColumns (2026-07-18) — colSpan for the expanded-
  // detail and empty-state rows has to track this or the table's borders
  // stop lining up whenever a column's hidden.
  const totalColumnCount = 5 + visibleColumns.size + udfDefinitions.length

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
          <td className="px-2 py-2.5"></td>
          {visibleColumns.has('code') && <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{el.code}</td>}
          <td className="px-4 py-2.5">
            <button
              onClick={() => setExpandedId(expandedId === el.id ? null : el.id)}
              className="text-left font-medium text-gray-900 hover:text-blue-600"
            >
              {el.description}
            </button>
          </td>
          {visibleColumns.has('element_group') && <td className="px-4 py-2.5 text-gray-600">{el.element_group ?? '—'}</td>}
          {visibleColumns.has('element_type') && (
            <td className="px-4 py-2.5">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isPct ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                {isPct ? `${el.rate ? Math.round(Number(el.rate) * 100) : 0}%` : 'fixed'}
              </span>
            </td>
          )}
          {visibleColumns.has('cost_owner') && <td className="px-4 py-2.5 text-gray-600">{el.cost_owner ?? '—'}</td>}
          {visibleColumns.has('status') && <td className="px-4 py-2.5 text-gray-600">{el.status ? COST_ELEMENT_STATUS_LABELS[el.status] : '—'}</td>}
          {visibleColumns.has('variance_band') && (
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
          )}
          <td className="px-4 py-2.5 text-gray-600">{formatCurrency(budget)}</td>
          {visibleColumns.has('forecast') && <td className="px-4 py-2.5 text-gray-600">{formatCurrency(forecast)}</td>}
          {visibleColumns.has('actuals') && <td className="px-4 py-2.5 text-gray-600">{formatCurrency(actuals)}</td>}
          {visibleColumns.has('variance') && (
            <td className="px-4 py-2.5 text-gray-600" title="Forecast vs Budget">
              {(() => {
                const fv = elementForecastVariance(el)
                return fv === null ? '—' : formatCurrency(fv.amount.toString())
              })()}
            </td>
          )}
          {visibleColumns.has('pct_complete') && <td className="px-4 py-2.5 text-gray-600">{el.pct_complete !== null ? `${el.pct_complete}%` : '—'}</td>}
          {visibleColumns.has('cpi') && <td className="px-4 py-2.5 text-gray-600">{formatRatio(el.cpi)}</td>}
          {udfDefinitions.map(d => (
            <UdfCell key={d.id} definition={d} value={getUdfValue(d.id, el.id)} onSave={payload => setUdfValue(d.id, el.id, payload)} />
          ))}
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
            <td colSpan={totalColumnCount} className="p-0">
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
              {el.comparison_cost !== null && (
                <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
                  <div className="text-xs font-semibold text-amber-700 mb-2" title="An independent benchmark figure — another project's equivalent line, a tender return, or a prior cost plan revision. Not the same as Forecast/EAC.">
                    Comparison
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div><div className="text-gray-500">Comparison Cost</div><div className="font-semibold text-gray-800">{formatCurrency(el.comparison_cost)}</div></div>
                    <div><div className="text-gray-500">Budget</div><div className="font-semibold text-gray-800">{formatCurrency(el.element_type === 'percentage' ? el.computed_budget : el.budget)}</div></div>
                    <div title="Budget minus Comparison Cost"><div className="text-gray-500">Variance</div><div className="font-semibold text-gray-800">{formatCurrency(el.comparison_variance)}</div></div>
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
              <CostRateLines
                costElementId={el.id}
                isScheduleLinked={el.source === 'schedule'}
                childRows={el.linked_activity_id ? childRowsFor(el.linked_activity_id) : []}
                childRowsFor={childRowsFor}
              />
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

  const costTabSwitcher = (
    <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
      <button
        onClick={() => setCostTab('plan')}
        className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${costTab === 'plan' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
      >Cost Plan</button>
      <button
        onClick={() => setCostTab('boq')}
        className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${costTab === 'boq' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
      >BOQ</button>
    </div>
  )

  if (costTab === 'boq') {
    return (
      <>
      <div className="p-8 no-print">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-gray-900">Bill of Quantities</h1>
          {period && (
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
              {period.period_label} · {period.freeze_status}
            </span>
          )}
        </div>
        <p className="text-gray-500 text-sm mb-4">
          Measured-works breakdown for {selectedProject.name} — quantity and rate derived from the committed schedule's own duration and resourced cost.
        </p>
        {costTabSwitcher}
      </div>
      {period && <Boq projectId={selectedProject.id} periodId={period.id} projectName={selectedProject.name} />}
      </>
    )
  }

  // "Fix up the print version, to print what's shown in the cost plan
  // (exact fields activated/grouping/collapsible etc)" (2026-07-18) — built
  // from the exact same state driving the on-screen table (constructionView/
  // groups, constructionCollapsed/expandedDisciplines, visibleColumns), so
  // printing can never quietly drift from what's actually shown. Every
  // UDF (Comments included) rides along as its own column too, same as
  // on-screen.
  const formatUdfDisplay = (
    definition: (typeof udfDefinitions)[number],
    value: ReturnType<typeof getUdfValue>,
  ): string => {
    if (!value) return '—'
    if (definition.data_type === 'indicator') return value.value_indicator ?? '—'
    if (definition.data_type === 'start_date' || definition.data_type === 'finish_date') {
      return value.value_date ? new Date(value.value_date).toLocaleDateString() : '—'
    }
    if (definition.data_type === 'cost') return value.value_number ? `£${Number(value.value_number).toLocaleString()}` : '—'
    if (definition.data_type === 'number' || definition.data_type === 'integer') return value.value_number?.toString() ?? '—'
    return value.value_text || '—'
  }

  const printColumns: PrintColumn[] = [
    ...TOGGLEABLE_COLUMNS.filter(c => visibleColumns.has(c.key)).map(c => ({ key: c.key, label: c.label })),
    ...udfDefinitions.map(d => ({ key: `udf:${d.id}`, label: `${d.name} (UDF)` })),
  ]

  const elementCell = (el: CostElement, columnKey: string): string => {
    const isPct = el.element_type === 'percentage'
    if (columnKey.startsWith('udf:')) {
      const definition = udfDefinitions.find(d => d.id === columnKey.slice(4))
      return definition ? formatUdfDisplay(definition, getUdfValue(definition.id, el.id)) : '—'
    }
    switch (columnKey) {
      case 'code': return el.code
      case 'element_group': return el.element_group ?? '—'
      case 'element_type': return isPct ? `${el.rate ? Math.round(Number(el.rate) * 100) : 0}%` : 'fixed'
      case 'cost_owner': return el.cost_owner ?? '—'
      case 'status': return el.status ? COST_ELEMENT_STATUS_LABELS[el.status] : '—'
      case 'variance_band': return varianceBand(el, criteria)?.label ?? '—'
      case 'forecast': return formatCurrency(isPct ? el.computed_forecast : el.forecast)
      case 'actuals': return formatCurrency(isPct ? el.computed_actuals : el.actuals)
      case 'variance': {
        const fv = elementForecastVariance(el)
        return fv === null ? '—' : formatCurrency(fv.amount.toString())
      }
      case 'pct_complete': return el.pct_complete !== null ? `${el.pct_complete}%` : '—'
      case 'cpi': return formatRatio(el.cpi)
      default: return '—'
    }
  }

  const summaryCell = (totals: ReturnType<typeof groupTotals>, label: string, columnKey: string): string => {
    if (columnKey.startsWith('udf:')) {
      const definition = udfDefinitions.find(d => d.id === columnKey.slice(4))
      return definition ? formatUdfDisplay(definition, getUdfValue(definition.id, pseudoRecordId(label))) : '—'
    }
    switch (columnKey) {
      case 'forecast': return formatCurrency(totals.forecast.toString())
      case 'actuals': return formatCurrency(totals.actuals.toString())
      case 'variance': return formatCurrency((totals.forecast - totals.budget).toString())
      default: return '—'
    }
  }

  const elementPrintRow = (el: CostElement): PrintRow => ({
    key: el.id,
    label: el.description,
    budget: formatCurrency(el.element_type === 'percentage' ? el.computed_budget : el.budget),
    cells: Object.fromEntries(printColumns.map(c => [c.key, elementCell(el, c.key)])),
  })

  const summaryPrintRow = (
    label: string, totals: ReturnType<typeof groupTotals>, opts: { count?: number; indent?: boolean; bold?: boolean } = {},
  ): PrintRow => ({
    key: `summary:${label}`,
    label, count: opts.count, indent: opts.indent, bold: opts.bold,
    budget: formatCurrency(totals.budget.toString()),
    cells: Object.fromEntries(printColumns.map(c => [c.key, summaryCell(totals, label, c.key)])),
  })

  const printRows: PrintRow[] = groupBy === 'element_group'
    ? [
        ...(constructionView.disciplines.length > 0
          ? [summaryPrintRow('Construction', groupTotals(constructionView.disciplines.flatMap(([, els]) => els)), { bold: true })]
          : []),
        ...(constructionCollapsed ? [] : constructionView.disciplines.flatMap(([discipline, els]) => [
          summaryPrintRow(discipline, groupTotals(els), { count: els.length, indent: true }),
          ...(expandedDisciplines.has(discipline) ? els.map(elementPrintRow) : []),
        ])),
        ...constructionView.topLevel.map(elementPrintRow),
        ...(constructionView.disciplines.length > 0 || constructionView.topLevel.length > 0
          ? [summaryPrintRow(
              'Total',
              groupTotals([...constructionView.disciplines.flatMap(([, els]) => els), ...constructionView.topLevel]),
              { bold: true },
            )]
          : []),
      ]
    : groupBy === 'none'
      ? visibleElements.map(elementPrintRow)
      : groups.flatMap(([groupKey, groupElements]) => [
          summaryPrintRow(groupKey, groupTotals(groupElements), { count: groupElements.length }),
          ...(expandedDisciplines.has(groupKey) ? groupElements.map(elementPrintRow) : []),
        ])

  const printElementCount = printRows.filter(r => !r.key.startsWith('summary:')).length

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
      {costTabSwitcher}

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
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setFormOpen(true)}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            + New cost element
          </button>
          <button
            onClick={handleGenerateCostPlan}
            disabled={generatingCostPlan}
            title="Adds the standard Prelims/Design Fees/Overhead/Inflation on-cost lines — resource-loaded costs already flow in automatically as resources get assigned in Scheduling"
            className="text-xs px-2.5 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generatingCostPlan ? 'Generating…' : 'Generate Cost Plan'}
          </button>
          {generateMessage && <span className="text-xs text-gray-500">{generateMessage}</span>}
        </div>
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
        <div className="relative">
          <button
            onClick={() => setColumnsPickerOpen(prev => !prev)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              columnsPickerOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            ☰ Columns
          </button>
          {columnsPickerOpen && (
            <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-30 text-xs w-48 space-y-1">
              {TOGGLEABLE_COLUMNS.map(c => (
                <label key={c.key} className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={visibleColumns.has(c.key)} onChange={() => toggleColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
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
          📄 Page Setup
        </button>
        <button
          onClick={() => setUdfWidgetOpen(o => !o)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            udfWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          🏷️ Fields
        </button>
        <button
          onClick={() => setBaselineWidgetOpen(o => !o)}
          title="Capture a named, dated baseline snapshot of the cost plan"
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            baselineWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          🎯 Baseline
        </button>
      </div>

      {baselineWidgetOpen && period && (
        <BaselineManagerWidget
          apiBasePath="/api/v1/cost-baselines"
          periodId={period.id}
          itemNounPlural="Elements"
          moduleLabel="the Cost Plan"
          dismissKeyPrefix="cost"
          onClose={() => setBaselineWidgetOpen(false)}
        />
      )}

      {udfWidgetOpen && (
        <UserDefinedFieldsWidget
          entityType="cost_element"
          availableEntityTypes={['cost_element']}
          onEntityTypeChange={() => {}}
          definitions={udfDefinitions}
          loading={udfDefinitionsLoading}
          onCreate={createUdfDefinition}
          onUpdate={updateUdfDefinition}
          onDelete={removeUdfDefinition}
          onClose={() => setUdfWidgetOpen(false)}
        />
      )}

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
                <th className="px-2 py-2.5 w-6"></th>
                {visibleColumns.has('code') && <th className="px-4 py-2.5">Code</th>}
                <th className="px-4 py-2.5">Description</th>
                {visibleColumns.has('element_group') && <th className="px-4 py-2.5">Group</th>}
                {visibleColumns.has('element_type') && <th className="px-4 py-2.5">Type</th>}
                {visibleColumns.has('cost_owner') && <th className="px-4 py-2.5">Owner</th>}
                {visibleColumns.has('status') && <th className="px-4 py-2.5">Status</th>}
                {visibleColumns.has('variance_band') && <th className="px-4 py-2.5">Variance Band</th>}
                <th className="px-4 py-2.5">Budget</th>
                {visibleColumns.has('forecast') && <th className="px-4 py-2.5">Forecast</th>}
                {visibleColumns.has('actuals') && <th className="px-4 py-2.5">Actuals</th>}
                {visibleColumns.has('variance') && <th className="px-4 py-2.5" title="Forecast vs Budget">Variance</th>}
                {visibleColumns.has('pct_complete') && <th className="px-4 py-2.5">% Complete</th>}
                {visibleColumns.has('cpi') && <th className="px-4 py-2.5">CPI</th>}
                {udfDefinitions.map(d => (
                  <th key={d.id} className="px-4 py-2.5" title={`Custom field (${d.data_type})`}>{d.name} (UDF)</th>
                ))}
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {groupBy === 'element_group' ? (
                <>
                  {constructionView.disciplines.length > 0 && renderSummaryRow(
                    'Construction', groupTotals(constructionView.disciplines.flatMap(([, els]) => els)),
                    {
                      bold: true, expanded: !constructionCollapsed, onClick: () => setConstructionCollapsed(c => !c),
                      className: 'bg-gray-100 border-b border-gray-200',
                    },
                  )}
                  {!constructionCollapsed && constructionView.disciplines.map(([discipline, els]) => {
                    const expanded = expandedDisciplines.has(discipline)
                    return (
                      <Fragment key={discipline}>
                        {renderSummaryRow(discipline, groupTotals(els), {
                          count: els.length, indent: true, expanded,
                          onClick: () => toggleDiscipline(discipline),
                          className: 'border-b border-gray-100 hover:bg-gray-50 cursor-pointer',
                        })}
                        {expanded && els.map(renderRow)}
                      </Fragment>
                    )
                  })}
                  {constructionView.topLevel.map(renderRow)}
                  {(constructionView.disciplines.length > 0 || constructionView.topLevel.length > 0) && renderSummaryRow(
                    'Total',
                    groupTotals([...constructionView.disciplines.flatMap(([, els]) => els), ...constructionView.topLevel]),
                    { bold: true, className: 'bg-gray-50 border-t-2 border-gray-300' },
                  )}
                </>
              ) : (
                groups.map(([groupKey, groupElements]) => {
                  if (groupBy === 'none') return groupElements.map(renderRow)
                  const expanded = expandedDisciplines.has(groupKey)
                  return (
                    <Fragment key={groupKey || 'all'}>
                      {renderSummaryRow(groupKey, groupTotals(groupElements), {
                        count: groupElements.length, expanded, onClick: () => toggleDiscipline(groupKey),
                        className: 'border-b border-gray-100 hover:bg-gray-50 cursor-pointer',
                      })}
                      {expanded && groupElements.map(renderRow)}
                    </Fragment>
                  )
                })
              )}

              {visibleElements.length === 0 && (
                <tr>
                  <td colSpan={totalColumnCount} className="px-4 py-10 text-center text-gray-400 text-sm">
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
      printRows={printMode === 'list' ? printRows : undefined}
      printColumns={printMode === 'list' ? printColumns : undefined}
      printElementCount={printMode === 'list' ? printElementCount : undefined}
      elements={printMode === 'list' ? visibleElements : elements.filter(e => selectedForPrint.has(e.id))}
      projectName={selectedProject.name}
      letterhead={letterhead}
      gfaM2={projectDetails?.gfa_m2 ?? null}
    />
    </>
  )
}
