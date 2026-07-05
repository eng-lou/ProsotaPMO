import axios from 'axios'
import { useRef, useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { downloadJson, readJsonFile } from '@/lib/exportImport'
import {
  FILTER_FIELD_DEFS, FILTER_OPERATOR_LABELS,
  type FilterCondition, type FilterFieldKey, type FilterOperator, type SchedulingFilter,
} from './types'

interface Props {
  filters: SchedulingFilter[]
  onCreate: (name: string, matchMode: 'all' | 'any', conditions: FilterCondition[]) => Promise<void>
  onUpdate: (filterId: string, name: string, matchMode: 'all' | 'any', conditions: FilterCondition[]) => Promise<void>
  onDelete: (filterId: string) => Promise<void>
  onClose: () => void

  // Built-in ("Global" tier, P6 terms) filters — plain checkboxes, unchanged
  // individually, just rendered in this same single panel now instead of a
  // separate one (2026-07-05, per Maro: "I want only one filter widget").
  filterCritical: boolean
  onFilterCriticalChange: (v: boolean) => void
  filterDelayed: boolean
  onFilterDelayedChange: (v: boolean) => void
  filterAtRisk: boolean
  onFilterAtRiskChange: (v: boolean) => void

  // Show/Hide/Off per custom filter — kept separate from the saved filter's
  // own conditions (2026-07-05, per Maro: ticking a filter he'd built hid
  // the very activity that matched it, since "ticked" implicitly meant
  // "show only matches"; this replaces that implicit assumption with an
  // explicit choice, and the same saved filter can be used either way).
  customFilterModes: Record<string, 'show' | 'hide'>
  onCustomFilterModeChange: (filterId: string, mode: 'off' | 'show' | 'hide') => void

  // Global "match All selected filters / Any selected filter" mode —
  // combines whichever built-in + custom filters are currently enabled.
  matchMode: 'all' | 'any'
  onMatchModeChange: (mode: 'all' | 'any') => void

  onClearAll: () => void
}

function apiErrorDetail(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
}

function defaultCondition(): FilterCondition {
  const def = FILTER_FIELD_DEFS[0]
  return { field: def.key, operator: def.operators[0], value: def.type === 'enum' ? (def.options?.[0]?.value ?? '') : '' }
}

// One condition row's value input is driven entirely by the selected
// field's type (2026-07-05, per Maro: "more utility, not just preset
// options" — a free-text box for WBS/code/name, a real date picker for any
// date field, not just fixed dropdowns) rather than the field itself
// dictating a hardcoded widget.
function ConditionRow({ condition, onChange, onRemove }: {
  condition: FilterCondition
  onChange: (c: FilterCondition) => void
  onRemove: () => void
}) {
  const def = FILTER_FIELD_DEFS.find(d => d.key === condition.field) ?? FILTER_FIELD_DEFS[0]
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={condition.field}
        onChange={e => {
          const nextDef = FILTER_FIELD_DEFS.find(d => d.key === e.target.value as FilterFieldKey)!
          onChange({ field: nextDef.key, operator: nextDef.operators[0], value: nextDef.type === 'enum' ? (nextDef.options?.[0]?.value ?? '') : '' })
        }}
        className="text-xs border border-gray-300 rounded px-1.5 py-1"
      >
        {FILTER_FIELD_DEFS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>
      <select
        value={condition.operator}
        onChange={e => onChange({ ...condition, operator: e.target.value as FilterOperator })}
        className="text-xs border border-gray-300 rounded px-1.5 py-1"
      >
        {def.operators.map(op => <option key={op} value={op}>{FILTER_OPERATOR_LABELS[op]}</option>)}
      </select>
      {def.type === 'number' && (
        <input
          type="number" value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          className="w-20 text-xs border border-gray-300 rounded px-1.5 py-1"
        />
      )}
      {def.type === 'text' && (
        <input
          type="text" value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          placeholder={def.key === 'wbs_path' ? 'e.g. 1.2' : 'Text…'}
          className="w-32 text-xs border border-gray-300 rounded px-1.5 py-1"
        />
      )}
      {def.type === 'date' && (
        <input
          type="date" value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          className="text-xs border border-gray-300 rounded px-1.5 py-1"
        />
      )}
      {def.type === 'enum' && (
        <select
          value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          className="text-xs border border-gray-300 rounded px-1.5 py-1"
        >
          {def.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {/* boolean fields have no value input — is_true/is_false already says it all */}
      <button onClick={onRemove} className="text-gray-400 hover:text-red-600 text-xs">✕</button>
    </div>
  )
}

// The single Filters panel (2026-07-05, per Maro — previously split across a
// plain checkbox panel and a separate "Manage Filters" widget, merged into
// one here) — modelled on P6's own Filters dialog: a "Global" tier (the 3
// built-in checkboxes, hardcoded) and a "User Defined" tier (these, named,
// saved, backend-persisted, each with its own condition list + match mode),
// combined by one global All/Any radio. Import/Export use the same shared
// client-side helpers as Layout/Calendar/Letterhead.
export function SchedulingFiltersWidget({
  filters, onCreate, onUpdate, onDelete, onClose,
  filterCritical, onFilterCriticalChange, filterDelayed, onFilterDelayedChange, filterAtRisk, onFilterAtRiskChange,
  customFilterModes, onCustomFilterModeChange, matchMode, onMatchModeChange, onClearAll,
}: Props) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [conditionMatchMode, setConditionMatchMode] = useState<'all' | 'any'>('all')
  const [conditions, setConditions] = useState<FilterCondition[]>([defaultCondition()])
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const startCreating = () => {
    setEditingId(null)
    setName('')
    setConditionMatchMode('all')
    setConditions([defaultCondition()])
    setError(null)
    setCreating(true)
  }

  const startEditing = (filter: SchedulingFilter) => {
    setEditingId(filter.id)
    setName(filter.name)
    setConditionMatchMode(filter.match_mode)
    setConditions(filter.conditions.length > 0 ? filter.conditions : [defaultCondition()])
    setError(null)
    setCreating(true)
  }

  const closeForm = () => {
    setCreating(false)
    setEditingId(null)
    setName('')
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (editingId) await onUpdate(editingId, name.trim(), conditionMatchMode, conditions)
      else await onCreate(name.trim(), conditionMatchMode, conditions)
      closeForm()
    } catch (err) {
      setError(apiErrorDetail(err) ?? `Could not ${editingId ? 'update' : 'save'} the filter — check your connection and try again.`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (filter: SchedulingFilter) => {
    if (!(await confirmWithDontAsk('scheduling.filter-delete', `Delete the saved filter "${filter.name}"? This cannot be undone.`))) return
    setBusyId(filter.id)
    setError(null)
    try {
      await onDelete(filter.id)
    } catch {
      setError(`Could not delete "${filter.name}" — check your connection and try again.`)
    } finally {
      setBusyId(null)
    }
  }

  const handleExport = (filter: SchedulingFilter) => {
    downloadJson(`${filter.name}.filter.json`, { name: filter.name, match_mode: filter.match_mode, conditions: filter.conditions })
  }

  const handleImportFile = async (file: File) => {
    setError(null)
    try {
      const parsed = await readJsonFile(file) as Partial<SchedulingFilter>
      if (typeof parsed.name !== 'string' || !Array.isArray(parsed.conditions)) {
        throw new Error(`"${file.name}" isn't a valid exported filter.`)
      }
      const importedMatchMode: 'all' | 'any' = parsed.match_mode === 'any' ? 'any' : 'all'
      await onCreate(parsed.name, importedMatchMode, parsed.conditions as FilterCondition[])
    } catch (err) {
      setError(apiErrorDetail(err) ?? (err instanceof Error ? err.message : 'Could not import that file.'))
    }
  }

  const anyEnabled = filterCritical || filterDelayed || filterAtRisk || Object.keys(customFilterModes).length > 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">⚙</span>
        <div className="font-bold text-sm">Filters</div>
        <div className="text-xs text-gray-400">Built-in presets, plus your own saved filters</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-600 mb-3">
        Show activities that match
        <label className="flex items-center gap-1">
          <input type="radio" checked={matchMode === 'all'} onChange={() => onMatchModeChange('all')} />
          All selected filters
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={matchMode === 'any'} onChange={() => onMatchModeChange('any')} />
          Any selected filter
        </label>
        {anyEnabled && <button onClick={onClearAll} className="ml-auto text-gray-400 hover:text-red-600">Clear all</button>}
      </div>

      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Built-in</div>
      <div className="flex gap-6 flex-wrap mb-4">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={filterCritical} onChange={e => onFilterCriticalChange(e.target.checked)} />
          Critical only
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={filterDelayed} onChange={e => onFilterDelayedChange(e.target.checked)} />
          Delayed (finish later than baseline)
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={filterAtRisk} onChange={e => onFilterAtRiskChange(e.target.checked)} />
          At risk (float ≤ 40h, ~1–5 working days)
        </label>
      </div>

      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">User Defined</div>
      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-2 py-1.5 border border-gray-200 w-24">Mode</th>
            <th className="px-2 py-1.5 border border-gray-200">Name</th>
            <th className="px-2 py-1.5 border border-gray-200">Conditions</th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
          </tr>
        </thead>
        <tbody>
          {filters.map(f => (
            <tr key={f.id}>
              <td className="px-2 py-1.5 border border-gray-200">
                <select
                  value={customFilterModes[f.id] ?? 'off'}
                  onChange={e => onCustomFilterModeChange(f.id, e.target.value as 'off' | 'show' | 'hide')}
                  className="text-xs border border-gray-300 rounded px-1 py-0.5 w-full"
                >
                  <option value="off">Off</option>
                  <option value="show">Show matches</option>
                  <option value="hide">Hide matches</option>
                </select>
              </td>
              <td className="px-2 py-1.5 border border-gray-200 font-medium">{f.name}</td>
              <td className="px-2 py-1.5 border border-gray-200 text-gray-500">
                {f.conditions.length} condition{f.conditions.length === 1 ? '' : 's'} (match {f.match_mode === 'all' ? 'ALL' : 'ANY'})
              </td>
              <td className="px-2 py-1.5 border border-gray-200 whitespace-nowrap">
                <button onClick={() => startEditing(f)} disabled={busyId === f.id} className="text-gray-500 hover:text-blue-600 disabled:opacity-40">Edit</button>
              </td>
              <td className="px-2 py-1.5 border border-gray-200 whitespace-nowrap">
                <button onClick={() => handleExport(f)} className="text-blue-600 hover:text-blue-700">Export</button>
              </td>
              <td className="px-2 py-1.5 border border-gray-200 text-right">
                <button onClick={() => handleDelete(f)} disabled={busyId === f.id} className="text-gray-400 hover:text-red-600 disabled:opacity-40">Delete</button>
              </td>
            </tr>
          ))}
          {filters.length === 0 && !creating && (
            <tr><td colSpan={6} className="px-2 py-3 text-center text-gray-400 border border-gray-200">No custom filters saved yet</td></tr>
          )}
        </tbody>
      </table>

      {creating ? (
        <div className="border border-gray-200 rounded-lg p-3">
          <div className="flex items-center gap-4 mb-3">
            <label className="text-xs text-gray-600">
              Name
              <input
                value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Phase 3 milestones" autoFocus
                className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-56"
              />
            </label>
            <label className="text-xs text-gray-600">
              Match
              <select
                value={conditionMatchMode} onChange={e => setConditionMatchMode(e.target.value as 'all' | 'any')}
                className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5"
              >
                <option value="all">ALL of these conditions</option>
                <option value="any">ANY of these conditions</option>
              </select>
            </label>
          </div>

          <div className="space-y-1.5 mb-2">
            {conditions.map((c, i) => (
              <ConditionRow
                key={i} condition={c}
                onChange={next => setConditions(cs => cs.map((x, j) => j === i ? next : x))}
                onRemove={() => setConditions(cs => cs.filter((_, j) => j !== i))}
              />
            ))}
          </div>
          <button
            onClick={() => setConditions(cs => [...cs, defaultCondition()])}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium mb-3"
          >
            + Add condition
          </button>

          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={handleSave} disabled={saving || !name.trim()} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
              {saving ? 'Saving…' : editingId ? 'Update Filter' : 'Save Filter'}
            </button>
            <button onClick={closeForm} className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1.5">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={startCreating} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ New Filter</button>
          <button onClick={() => importInputRef.current?.click()} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            ⇧ Import Filter
          </button>
          <input
            ref={importInputRef} type="file" accept="application/json,.json" className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleImportFile(file)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {!creating && error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
