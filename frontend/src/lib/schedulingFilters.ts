import { useEffect, useState } from 'react'
import type { Activity, FilterCondition, FilterFieldKey, SchedulingFilter } from '@/modules/scheduling/types'
import { FILTER_FIELD_DEFS } from '@/modules/scheduling/types'
import { api } from './api'

function getFieldValue(activity: Activity, field: FilterFieldKey): unknown {
  switch (field) {
    case 'code': return activity.code
    case 'wbs_path': return activity.wbs_path
    case 'task_name': return activity.task_name
    case 'activity_type': return activity.activity_type
    case 'constraint_type': return activity.constraint_type
    case 'is_critical': return activity.is_critical
    case 'is_archived': return activity.is_archived
    case 'start': return activity.start
    case 'finish': return activity.finish
    case 'actual_start': return activity.actual_start
    case 'actual_finish': return activity.actual_finish
    case 'bl_start': return activity.bl_start
    case 'bl_finish': return activity.bl_finish
    case 'constraint_date': return activity.constraint_date
    case 'duration_hours': return activity.duration_hours
    case 'duration_days': return activity.duration_days
    case 'remaining_duration_hours': return activity.remaining_duration_hours
    case 'bl_duration_hours': return activity.bl_duration_hours
    case 'variance_days': return activity.variance_days
    case 'total_float_hours': return activity.total_float_hours
    case 'free_float_hours': return activity.free_float_hours
    case 'sub_total_float_hours': return activity.sub_total_float_hours
    case 'sub_is_critical': return activity.sub_is_critical
    case 'pct_complete': return activity.pct_complete
    case 'duration_pct_complete': return activity.duration_pct_complete
    case 'bac': return activity.bac
    case 'ac': return activity.ac
    case 'pv': return activity.pv
    case 'ev': return activity.ev
    case 'cv': return activity.cv
    case 'sv': return activity.sv
    case 'cpi': return activity.cpi
    case 'spi': return activity.spi
    case 'eac': return activity.eac
    case 'etc': return activity.etc
  }
}

// Null-safe by design — a condition on a field that's null for this activity
// (e.g. total_float_hours on a wbs_summary row, outside the CPM network)
// evaluates false rather than throwing or silently coercing null to 0.
export function evaluateCondition(activity: Activity, condition: FilterCondition): boolean {
  const def = FILTER_FIELD_DEFS.find(d => d.key === condition.field)
  if (!def) return false
  const raw = getFieldValue(activity, condition.field)

  if (def.type === 'boolean') {
    const boolVal = raw === true
    if (condition.operator === 'is_true') return boolVal
    if (condition.operator === 'is_false') return !boolVal
    return false
  }

  if (raw === null || raw === undefined || raw === '') return false

  if (def.type === 'enum') {
    const strVal = String(raw)
    if (condition.operator === 'eq') return strVal === condition.value
    if (condition.operator === 'neq') return strVal !== condition.value
    return false
  }

  if (def.type === 'text') {
    const strVal = String(raw)
    // WBS branch match ("everything under 1.2", not just a literal string
    // prefix — 1.2 shouldn't also match a sibling like 1.25) — 2026-07-05,
    // per Maro's own example: "where wbs is (then editable)".
    if (condition.field === 'wbs_path' && condition.operator === 'starts_with') {
      return strVal === condition.value || strVal.startsWith(`${condition.value}.`)
    }
    const a = strVal.toLowerCase()
    const b = condition.value.toLowerCase()
    switch (condition.operator) {
      case 'eq': return a === b
      case 'neq': return a !== b
      case 'contains': return a.includes(b)
      case 'starts_with': return a.startsWith(b)
      default: return false
    }
  }

  if (def.type === 'date') {
    const activityDate = new Date(String(raw))
    const targetDate = new Date(condition.value)
    if (Number.isNaN(activityDate.getTime()) || Number.isNaN(targetDate.getTime())) return false
    switch (condition.operator) {
      // Same calendar day, not exact-to-the-millisecond — activity dates
      // carry a time-of-day (Phase 10), a condition's date input doesn't.
      case 'eq': return activityDate.toISOString().slice(0, 10) === targetDate.toISOString().slice(0, 10)
      case 'neq': return activityDate.toISOString().slice(0, 10) !== targetDate.toISOString().slice(0, 10)
      case 'gt': return activityDate.getTime() > targetDate.getTime()
      case 'gte': return activityDate.getTime() >= targetDate.getTime()
      case 'lt': return activityDate.getTime() < targetDate.getTime()
      case 'lte': return activityDate.getTime() <= targetDate.getTime()
      default: return false
    }
  }

  // number
  const numVal = Number(raw)
  const target = Number(condition.value)
  if (Number.isNaN(numVal) || Number.isNaN(target)) return false
  switch (condition.operator) {
    case 'eq': return numVal === target
    case 'neq': return numVal !== target
    case 'gt': return numVal > target
    case 'gte': return numVal >= target
    case 'lt': return numVal < target
    case 'lte': return numVal <= target
    default: return false
  }
}

// An empty condition list matches everything — a filter with nothing added
// to it yet shouldn't hide the whole project.
export function evaluateFilter(activity: Activity, filter: SchedulingFilter): boolean {
  if (filter.conditions.length === 0) return true
  return filter.match_mode === 'all'
    ? filter.conditions.every(c => evaluateCondition(activity, c))
    : filter.conditions.some(c => evaluateCondition(activity, c))
}

// Named, saved, per-project custom filters (2026-07-05, per Maro, modelled on
// P6's own Filters dialog) — same create/list/update/delete shape as
// useGanttLayouts, minus the apply/reset concept (multiple filters can be
// enabled simultaneously in the Scheduling toolbar, so there's no single
// "active" one to track server-side).
export function useSchedulingFilters(projectId: string | undefined) {
  const [filters, setFilters] = useState<SchedulingFilter[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<SchedulingFilter[]>('/api/v1/scheduling-filters/', { params: { project_id: projectId } })
      setFilters(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const create = async (name: string, matchMode: 'all' | 'any', conditions: FilterCondition[]) => {
    await api.post('/api/v1/scheduling-filters/', { project_id: projectId, name, match_mode: matchMode, conditions })
    await load()
  }

  const update = async (filterId: string, name: string, matchMode: 'all' | 'any', conditions: FilterCondition[]) => {
    await api.patch(`/api/v1/scheduling-filters/${filterId}`, { name, match_mode: matchMode, conditions })
    await load()
  }

  const remove = async (filterId: string) => {
    await api.delete(`/api/v1/scheduling-filters/${filterId}`)
    await load()
  }

  return { filters, loading, create, update, remove, refetch: load }
}
