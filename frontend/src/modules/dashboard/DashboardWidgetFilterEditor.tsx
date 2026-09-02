import { useState } from 'react'
import { FILTER_OPERATOR_LABELS, type FilterOperator } from '@/modules/scheduling/types'
import type { DashboardFilterCondition } from '@/lib/dashboardFilters'
import type { DashboardWidgetConfig } from '@/lib/dashboardLayouts'

// Direct filter editing for dashboard widgets (2026-09-02, per Maro: "you
// cant do anything but delete them because you havent exposed the filter
// so i cant change the variable MEP to HVAC... you need to be able to
// expose the parameters driving the dashboards so users may edit" — a real
// gap: propose_create_dashboard_layout could WRITE a widget's filter
// (backend/app/ai/tools.py), but nothing in this grid could ever READ or
// change one afterward, Poe-authored or not. A wrong/stale condition
// (Poe guessing "MEP" when the real value was "HVAC," or a UDF value that
// changes later) had no fix except deleting the whole widget and asking
// Poe to redraft it from scratch.
//
// Deliberately plain field/value TEXT inputs, not a per-widget-type guided
// dropdown of real field names (the way FILTER_FIELD_DEFS drives
// Scheduling's own ConditionRow, schedulingFilters.ts) — that registry is
// hard-typed to Activity's own fields alone; dashboard widgets span five
// unrelated record shapes (Risk/CostElement/ResourceAssignment/IcdItem/
// ScheduleActivity) plus per-project-dynamic UDF names (udf.<name>), so a
// single shared dropdown can't cover all of them without either a second,
// larger per-widget-type field registry (a real, separately-scoped follow-
// up if this plain version turns out too fiddly in practice) or silently
// getting it wrong for some widget types. A free-text field name is
// exactly what propose_create_dashboard_layout's own tool description
// already documents per widget_type — Maro can read the same field list
// Poe was given (this file's own header points there) rather than this UI
// needing to duplicate it as a dropdown.
//
// Local-only, same as every other widget edit in this grid (drag/resize/
// add/remove/rename) — DashboardGrid.tsx's own "Local-only... doesn't
// touch the saved layout until you explicitly 'Save current as…'" applies
// here unchanged; this component only ever calls the same setWidgets
// updater the rest of the grid already uses.

const OPERATORS: FilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_true', 'is_false', 'contains', 'starts_with']

function emptyCondition(): DashboardFilterCondition {
  return { field: '', operator: 'eq', value: '' }
}

export function DashboardWidgetFilterEditor({ widget, onChange, onClose }: {
  widget: DashboardWidgetConfig
  onChange: (next: Pick<DashboardWidgetConfig, 'filter' | 'filter_match_mode'>) => void
  onClose: () => void
}) {
  const [conditions, setConditions] = useState<DashboardFilterCondition[]>(widget.filter ?? [])
  const [matchMode, setMatchMode] = useState<'all' | 'any'>(widget.filter_match_mode ?? 'all')

  const commit = (nextConditions: DashboardFilterCondition[], nextMatchMode: 'all' | 'any') => {
    setConditions(nextConditions)
    setMatchMode(nextMatchMode)
    onChange({ filter: nextConditions.length > 0 ? nextConditions : undefined, filter_match_mode: nextMatchMode })
  }

  const updateCondition = (index: number, patch: Partial<DashboardFilterCondition>) => {
    commit(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)), matchMode)
  }
  const removeCondition = (index: number) => {
    commit(conditions.filter((_, i) => i !== index), matchMode)
  }
  const addCondition = () => {
    commit([...conditions, emptyCondition()], matchMode)
  }

  return (
    <>
      <button className="fixed inset-0 z-30 cursor-default" onMouseDown={e => e.stopPropagation()} onClick={onClose} tabIndex={-1} aria-label="Close filter editor" />
      <div
        className="absolute top-full right-0 mt-1 z-40 w-80 bg-white dark:bg-prosota-panel border border-gray-300 dark:border-prosota-line rounded-md shadow-lg p-2.5 space-y-2"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Widget header's own onMouseDown starts a drag (with preventDefault,
            which blocks input focus) on every descendant — this popover is
            rendered inside that header, so every row here must stop the
            mousedown from bubbling up to it. */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide">Filter</span>
          {conditions.length > 1 && (
            <div className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-prosota-muted">
              <button
                onClick={() => commit(conditions, 'all')}
                className={`px-1.5 py-0.5 rounded ${matchMode === 'all' ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-prosota-line'}`}
                title="Every condition must match"
              >All</button>
              <button
                onClick={() => commit(conditions, 'any')}
                className={`px-1.5 py-0.5 rounded ${matchMode === 'any' ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-prosota-line'}`}
                title="Any one condition matching is enough"
              >Any</button>
            </div>
          )}
        </div>
        {conditions.length === 0 && (
          <p className="text-[11px] text-gray-400 dark:text-prosota-muted">No filter — showing everything this widget normally shows.</p>
        )}
        {conditions.map((c, i) => (
          <div key={i} className="space-y-1 border border-gray-100 dark:border-prosota-line rounded p-1.5">
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={c.field}
                onChange={e => updateCondition(i, { field: e.target.value })}
                placeholder="field, e.g. category or udf.Discipline"
                className="flex-1 w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
              />
              <button
                onClick={() => removeCondition(i)}
                title="Remove condition"
                className="shrink-0 text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400"
              >✕</button>
            </div>
            <div className="flex items-center gap-1">
              <select
                value={c.operator}
                onChange={e => updateCondition(i, { operator: e.target.value as FilterOperator })}
                className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
              >
                {OPERATORS.map(op => <option key={op} value={op}>{FILTER_OPERATOR_LABELS[op]}</option>)}
              </select>
              {c.operator !== 'is_true' && c.operator !== 'is_false' && (
                <input
                  type="text"
                  value={c.value}
                  onChange={e => updateCondition(i, { value: e.target.value })}
                  placeholder="value"
                  className="flex-1 w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
                />
              )}
            </div>
          </div>
        ))}
        <button
          onClick={addCondition}
          className="w-full text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
        >
          + Add condition
        </button>
        <p className="text-[10px] text-gray-400 dark:text-prosota-muted">
          Field names match this widget's own underlying record — the same list Poe uses when it drafts a filtered layout. A wrong/misspelled field silently matches nothing rather than erroring.
        </p>
      </div>
    </>
  )
}
