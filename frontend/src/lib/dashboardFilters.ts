import type { FilterOperator } from '@/modules/scheduling/types'

// Dashboard widget filtering (2026-09-02) — mirrors lib/schedulingFilters.ts's
// own FilterCondition/evaluateCondition/evaluateFilter almost exactly, per
// Maro: "see how we use the filters/highlights in the schedule.
// functionality is definitely there. build what is needed" — a real,
// already-proven {field, operator, value} condition language (modelled on
// P6's own Filters dialog) already existed; this session's own first-pass
// dashboard filter (a flat equals-only dict) was reinventing a strictly
// weaker version of it, which is exactly what broke on "a particular named
// resource" and would have broken again on any numeric/date comparison or a
// WBS-subtree scope.
//
// Not reusing FilterCondition/evaluateCondition directly — that one's
// `field` is typed as the Activity-only FilterFieldKey union, and its
// switch statement reads straight off a real `Activity` object's own named
// properties. Dashboard widgets iterate several different summary shapes
// (RiskSummary, CostElementSummary, ResourceAssignmentSummary,
// IcdItemSummary, ScheduleActivitySummary, MilestoneTimelineItem) that
// share no common interface, so `field` has to be a plain string and the
// value lookup has to be a generic `record[field]`, not a per-entity
// switch. FilterOperator itself (the actual vocabulary — eq/neq/gt/gte/lt/
// lte/is_true/is_false/contains/starts_with) is reused verbatim, so the
// same mental model and the same operator labels apply everywhere in the
// app, dashboard included.
export interface DashboardFilterCondition {
  field: string
  operator: FilterOperator
  value: string
}

type FieldType = 'number' | 'boolean' | 'date' | 'text'

// Only fields that need a NON-text comparison are listed — everything else
// (code, title, category, status, owner, ids, ...) defaults to 'text' below,
// which already supports eq/neq/contains/starts_with. wbs_path deliberately
// stays 'text': a WBS-subtree scope is a starts_with condition on that same
// dotted-path string (see ScheduleActivitySummary's own schema docstring
// for why a plain equals could never express "everything under this
// node"), not a distinct field type of its own.
const NUMBER_FIELDS = new Set([
  'rating', 'emv_cost', 'emv_schedule_days', 'bac', 'ac', 'pct_complete', 'cpi', 'eac', 'vac', 'budget',
  'variance_days', 'total_float_hours', 'cost_impact', 'schedule_impact_days',
])
const BOOLEAN_FIELDS = new Set(['is_critical'])
const DATE_FIELDS = new Set([
  'date_raised', 'raised_date', 'due_date', 'closed_date', 'required_by',
  'start', 'finish', 'bl_finish', 'suspend_date', 'resume_date',
])

function fieldType(field: string): FieldType {
  if (NUMBER_FIELDS.has(field)) return 'number'
  if (BOOLEAN_FIELDS.has(field)) return 'boolean'
  if (DATE_FIELDS.has(field)) return 'date'
  return 'text'
}

// Null-safe by design, same as evaluateCondition — a condition on a field
// that's null for this record (e.g. bl_finish on an activity with no
// baseline yet) evaluates false rather than throwing or silently coercing
// null to 0/empty-string.
// "udf.<Definition Name>" reads record.udf[name] instead of a same-named
// top-level field (2026-09-02, per Maro: "in the 4d, baseline comparison.
// there's a filter for discipline. also the radial chart?....there's
// precedent" — Radial Chart/Timeline Strip already scope by a real UDF
// value, so this reuses that same UDF data rather than treating it as an
// unreachable gap; see the backend ScheduleActivitySummary.udf/
// CostElementSummary.udf/ResourceAssignmentSummary.udf schema comments
// for where that dict actually comes from). Always text-typed — UDF
// values are already stringified server-side regardless of the
// definition's own data_type, same "generic across data_type" convention
// stringifyUdfValue (scheduleScope.ts) already established.
const UDF_FIELD_PREFIX = 'udf.'

export function evaluateDashboardCondition<T extends object>(record: T, condition: DashboardFilterCondition): boolean {
  const isUdf = condition.field.startsWith(UDF_FIELD_PREFIX)
  const raw = isUdf
    ? ((record as Record<string, unknown>).udf as Record<string, string> | undefined)?.[condition.field.slice(UDF_FIELD_PREFIX.length)]
    : (record as Record<string, unknown>)[condition.field]
  const type = isUdf ? 'text' : fieldType(condition.field)

  if (type === 'boolean') {
    const boolVal = raw === true
    if (condition.operator === 'is_true') return boolVal
    if (condition.operator === 'is_false') return !boolVal
    return false
  }

  if (raw === null || raw === undefined || raw === '') return false

  if (type === 'date') {
    const recordDate = new Date(String(raw))
    const targetDate = new Date(condition.value)
    if (Number.isNaN(recordDate.getTime()) || Number.isNaN(targetDate.getTime())) return false
    switch (condition.operator) {
      case 'eq': return recordDate.toISOString().slice(0, 10) === targetDate.toISOString().slice(0, 10)
      case 'neq': return recordDate.toISOString().slice(0, 10) !== targetDate.toISOString().slice(0, 10)
      case 'gt': return recordDate.getTime() > targetDate.getTime()
      case 'gte': return recordDate.getTime() >= targetDate.getTime()
      case 'lt': return recordDate.getTime() < targetDate.getTime()
      case 'lte': return recordDate.getTime() <= targetDate.getTime()
      default: return false
    }
  }

  if (type === 'number') {
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

  // text (also covers wbs_path's own subtree-scope usage below)
  const a = String(raw).toLowerCase()
  const b = condition.value.toLowerCase()
  // WBS branch match ("everything under 1.2", not just a literal string
  // prefix — 1.2 shouldn't also match a sibling like 1.25) — same fix
  // schedulingFilters.ts's own evaluateCondition already applies for
  // exactly this field.
  if (condition.field === 'wbs_path' && condition.operator === 'starts_with') {
    return a === b || a.startsWith(`${b}.`)
  }
  switch (condition.operator) {
    case 'eq': return a === b
    case 'neq': return a !== b
    case 'contains': return a.includes(b)
    case 'starts_with': return a.startsWith(b)
    default: return false
  }
}

// An empty/undefined condition list matches everything — a widget with no
// filter set shouldn't hide its own data.
export function evaluateDashboardFilter<T extends object>(
  record: T, conditions: DashboardFilterCondition[] | undefined, matchMode: 'all' | 'any' = 'all',
): boolean {
  if (!conditions || conditions.length === 0) return true
  return matchMode === 'all'
    ? conditions.every(c => evaluateDashboardCondition(record, c))
    : conditions.some(c => evaluateDashboardCondition(record, c))
}
