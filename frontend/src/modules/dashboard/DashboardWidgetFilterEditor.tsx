import { useState } from 'react'
import { FILTER_OPERATOR_LABELS, type FilterOperator } from '@/modules/scheduling/types'
import type { DashboardFilterCondition } from '@/lib/dashboardFilters'
import type { DashboardWidgetConfig } from '@/lib/dashboardLayouts'
import { dashboardFieldOptions, operatorsForType, type DashboardFieldDef } from '@/lib/dashboardFilterFields'
import type { DashboardOverviewResponse } from './types'

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
// Field is a dropdown, not free text (2026-09-02, per Maro: "you need to
// make this a drop down" — the plain-text version this replaced was
// unclickable on top of being fiddly; see lib/dashboardFilterFields.ts's
// own header for the per-widget-type field registry this now drives from,
// including UDF options discovered live from this widget's own already-
// fetched data rather than a fixed list).
//
// Local-only, same as every other widget edit in this grid (drag/resize/
// add/remove/rename) — DashboardGrid.tsx's own "Local-only... doesn't
// touch the saved layout until you explicitly 'Save current as…'" applies
// here unchanged; this component only ever calls the same setWidgets
// updater the rest of the grid already uses.

function emptyCondition(fields: DashboardFieldDef[]): DashboardFilterCondition {
  return { field: fields[0]?.key ?? '', operator: 'eq', value: '' }
}

export function DashboardWidgetFilterEditor({ widget, data, onChange, onClose }: {
  widget: DashboardWidgetConfig
  data: DashboardOverviewResponse | undefined
  onChange: (next: Pick<DashboardWidgetConfig, 'filter' | 'filter_match_mode'>) => void
  onClose: () => void
}) {
  const [conditions, setConditions] = useState<DashboardFilterCondition[]>(widget.filter ?? [])
  const [matchMode, setMatchMode] = useState<'all' | 'any'>(widget.filter_match_mode ?? 'all')

  const fields = dashboardFieldOptions(widget.widget_type, data)

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
    commit([...conditions, emptyCondition(fields)], matchMode)
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
        {conditions.map((c, i) => {
          // A condition's field can be stale (a UDF value that no longer
          // exists in real data, or a name Poe typed that never matched
          // anything) — always keep it selectable rather than silently
          // reverting to the first option, so a human can see and fix
          // exactly what's wrong.
          const known = fields.find(f => f.key === c.field)
          const options = known ? fields : [{ key: c.field, label: c.field ? `${c.field} (not a real field)` : '— choose a field —', type: 'text' as const }, ...fields]
          const fieldType = known?.type ?? 'text'
          return (
            <div key={i} className="space-y-1 border border-gray-100 dark:border-prosota-line rounded p-1.5">
              <div className="flex items-center gap-1">
                <select
                  value={c.field}
                  onChange={e => {
                    const nextField = fields.find(f => f.key === e.target.value)
                    const nextOperators = operatorsForType(nextField?.type ?? 'text')
                    updateCondition(i, {
                      field: e.target.value,
                      operator: nextOperators.includes(c.operator) ? c.operator : nextOperators[0],
                    })
                  }}
                  className="flex-1 w-0 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
                >
                  {options.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
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
                  {operatorsForType(fieldType).map(op => <option key={op} value={op}>{FILTER_OPERATOR_LABELS[op]}</option>)}
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
          )
        })}
        <button
          onClick={addCondition}
          className="w-full text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
        >
          + Add condition
        </button>
        <p className="text-[10px] text-gray-400 dark:text-prosota-muted">
          Fields match this widget's own underlying record, including any of this project's own User Defined Fields found in the live data.
        </p>
      </div>
    </>
  )
}
