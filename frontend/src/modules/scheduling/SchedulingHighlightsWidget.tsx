import axios from 'axios'
import { useRef, useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { downloadJson, readJsonFile } from '@/lib/exportImport'
import {
  FILTER_FIELD_DEFS, FILTER_OPERATOR_LABELS,
  type FilterCondition, type FilterFieldKey, type FilterOperator, type SchedulingHighlight,
} from './types'

interface Props {
  highlights: SchedulingHighlight[]
  onCreate: (name: string, matchMode: 'all' | 'any', conditions: FilterCondition[]) => Promise<void>
  onUpdate: (highlightId: string, name: string, matchMode: 'all' | 'any', conditions: FilterCondition[]) => Promise<void>
  onDelete: (highlightId: string) => Promise<void>
  onClose: () => void

  // Built-in ("Global" tier, same P6-inspired split as Filters) — the one
  // automatic behaviour this whole widget replaces (2026-07-06, per Maro:
  // "you're already doing this by default... I want it normal by default but
  // then i can activate it if i want using the highlight widget").
  highlightCritical: boolean
  onHighlightCriticalChange: (v: boolean) => void

  // Which custom highlights are currently enabled — unlike Filters' per-row
  // Show/Hide mode, a highlight only ever has one direction (tint matching
  // rows), so this is a plain on/off set, not a 3-way mode.
  enabledHighlightIds: Set<string>
  onToggleHighlight: (highlightId: string, enabled: boolean) => void

  onClearAll: () => void
}

function apiErrorDetail(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
}

function defaultCondition(): FilterCondition {
  const def = FILTER_FIELD_DEFS[0]
  return { field: def.key, operator: def.operators[0], value: def.type === 'enum' ? (def.options?.[0]?.value ?? '') : '' }
}

// Same per-condition row as SchedulingFiltersWidget's own — duplicated
// rather than shared, same as each widget file in this module already
// keeps its own small local helpers.
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
        className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line rounded px-1.5 py-1"
      >
        {FILTER_FIELD_DEFS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>
      <select
        value={condition.operator}
        onChange={e => onChange({ ...condition, operator: e.target.value as FilterOperator })}
        className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line rounded px-1.5 py-1"
      >
        {def.operators.map(op => <option key={op} value={op}>{FILTER_OPERATOR_LABELS[op]}</option>)}
      </select>
      {def.type === 'number' && (
        <input
          type="number" value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          className="w-20 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line rounded px-1.5 py-1"
        />
      )}
      {def.type === 'text' && (
        <input
          type="text" value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          placeholder={def.key === 'wbs_path' ? 'e.g. 1.2' : 'Text…'}
          className="w-32 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line rounded px-1.5 py-1"
        />
      )}
      {def.type === 'date' && (
        <input
          type="date" value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line rounded px-1.5 py-1"
        />
      )}
      {def.type === 'enum' && (
        <select
          value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line rounded px-1.5 py-1"
        >
          {def.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {/* boolean fields have no value input — is_true/is_false already says it all */}
      <button onClick={onRemove} className="text-gray-400 dark:text-prosota-muted dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 dark:hover:text-red-400 text-xs">✕</button>
    </div>
  )
}

// The Highlight widget (2026-07-06, per Maro: "create a highlight widget,
// works exactly like the filter") — same Global/User Defined two-tier shape
// and condition-builder as SchedulingFiltersWidget, but tints matching rows
// instead of narrowing the visible list. No global All/Any combinator like
// Filters has: every enabled highlight (built-in Critical + any of these) is
// independently "a reason to flag this row", so activities matching *any*
// enabled one are tinted — there's no real case for only flagging a row that
// matches every enabled highlight simultaneously. All enabled highlights
// share the one project-wide GanttStyle.highlight_color (set in the Layout
// widget), not a colour per rule.
export function SchedulingHighlightsWidget({
  highlights, onCreate, onUpdate, onDelete, onClose,
  highlightCritical, onHighlightCriticalChange, enabledHighlightIds, onToggleHighlight, onClearAll,
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

  const startEditing = (highlight: SchedulingHighlight) => {
    setEditingId(highlight.id)
    setName(highlight.name)
    setConditionMatchMode(highlight.match_mode)
    setConditions(highlight.conditions.length > 0 ? highlight.conditions : [defaultCondition()])
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
      setError(apiErrorDetail(err) ?? `Could not ${editingId ? 'update' : 'save'} the highlight — check your connection and try again.`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (highlight: SchedulingHighlight) => {
    if (!(await confirmWithDontAsk('scheduling.highlight-delete', `Delete the saved highlight "${highlight.name}"? This cannot be undone.`))) return
    setBusyId(highlight.id)
    setError(null)
    try {
      await onDelete(highlight.id)
    } catch {
      setError(`Could not delete "${highlight.name}" — check your connection and try again.`)
    } finally {
      setBusyId(null)
    }
  }

  const handleExport = (highlight: SchedulingHighlight) => {
    downloadJson(`${highlight.name}.highlight.json`, { name: highlight.name, match_mode: highlight.match_mode, conditions: highlight.conditions })
  }

  const handleImportFile = async (file: File) => {
    setError(null)
    try {
      const parsed = await readJsonFile(file) as Partial<SchedulingHighlight>
      if (typeof parsed.name !== 'string' || !Array.isArray(parsed.conditions)) {
        throw new Error(`"${file.name}" isn't a valid exported highlight.`)
      }
      const importedMatchMode: 'all' | 'any' = parsed.match_mode === 'any' ? 'any' : 'all'
      await onCreate(parsed.name, importedMatchMode, parsed.conditions as FilterCondition[])
    } catch (err) {
      setError(apiErrorDetail(err) ?? (err instanceof Error ? err.message : 'Could not import that file.'))
    }
  }

  const anyEnabled = highlightCritical || enabledHighlightIds.size > 0

  return (
    <div className="bg-white dark:bg-prosota-panel dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line dark:border-prosota-line rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🖍</span>
        <div className="font-bold text-sm dark:text-prosota-paper">Highlight</div>
        <div className="text-xs text-gray-400 dark:text-prosota-muted dark:text-prosota-muted">Tints matching rows — doesn't hide anything. Colour is set in Layout.</div>
        {anyEnabled && <button onClick={onClearAll} className="ml-auto text-gray-400 dark:text-prosota-muted dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 dark:hover:text-red-400 text-xs">Clear all</button>}
        <button onClick={onClose} className="text-gray-400 dark:text-prosota-muted dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper dark:hover:text-prosota-paper text-sm">✕</button>
      </div>

      <div className="text-[10px] font-semibold text-gray-400 dark:text-prosota-muted dark:text-prosota-muted uppercase tracking-wide mb-1.5">Built-in</div>
      <div className="flex gap-6 flex-wrap mb-4">
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted dark:text-prosota-muted">
          <input type="checkbox" checked={highlightCritical} onChange={e => onHighlightCriticalChange(e.target.checked)} />
          Critical
        </label>
      </div>

      <div className="text-[10px] font-semibold text-gray-400 dark:text-prosota-muted dark:text-prosota-muted uppercase tracking-wide mb-1.5">User Defined</div>
      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="bg-gray-50 dark:bg-prosota-panel2 dark:bg-prosota-panel2 text-left text-gray-500 dark:text-prosota-muted dark:text-prosota-muted">
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line w-14">On</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line">Name</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line">Conditions</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line"></th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line"></th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line"></th>
          </tr>
        </thead>
        <tbody>
          {highlights.map(h => (
            <tr key={h.id}>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line text-center">
                <input type="checkbox" checked={enabledHighlightIds.has(h.id)} onChange={e => onToggleHighlight(h.id, e.target.checked)} />
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line font-medium">{h.name}</td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line text-gray-500 dark:text-prosota-muted dark:text-prosota-muted">
                {h.conditions.length} condition{h.conditions.length === 1 ? '' : 's'} (match {h.match_mode === 'all' ? 'ALL' : 'ANY'})
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line whitespace-nowrap">
                <button onClick={() => startEditing(h)} disabled={busyId === h.id} className="text-gray-500 dark:text-prosota-muted dark:text-prosota-muted hover:text-blue-600 disabled:opacity-40">Edit</button>
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line whitespace-nowrap">
                <button onClick={() => handleExport(h)} className="text-blue-600 dark:text-prosota-azure dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan dark:hover:text-prosota-cyan">Export</button>
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line dark:border-prosota-line text-right">
                <button onClick={() => handleDelete(h)} disabled={busyId === h.id} className="text-gray-400 dark:text-prosota-muted dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 dark:hover:text-red-400 disabled:opacity-40">Delete</button>
              </td>
            </tr>
          ))}
          {highlights.length === 0 && !creating && (
            <tr><td colSpan={6} className="px-2 py-3 text-center text-gray-400 dark:text-prosota-muted dark:text-prosota-muted border border-gray-200 dark:border-prosota-line dark:border-prosota-line">No custom highlights saved yet</td></tr>
          )}
        </tbody>
      </table>

      {creating ? (
        <div className="border border-gray-200 dark:border-prosota-line dark:border-prosota-line rounded-lg p-3">
          <div className="flex items-center gap-4 mb-3">
            <label className="text-xs text-gray-600 dark:text-prosota-muted dark:text-prosota-muted">
              Name
              <input
                value={name} onChange={e => setName(e.target.value)} placeholder="e.g. High cost variance" autoFocus
                className="block border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line rounded px-2 py-1 text-xs mt-0.5 w-56"
              />
            </label>
            <label className="text-xs text-gray-600 dark:text-prosota-muted dark:text-prosota-muted">
              Match
              <select
                value={conditionMatchMode} onChange={e => setConditionMatchMode(e.target.value as 'all' | 'any')}
                className="block border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper dark:border-prosota-line rounded px-2 py-1 text-xs mt-0.5"
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
            className="text-xs text-blue-600 dark:text-prosota-azure dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan dark:hover:text-prosota-cyan font-medium mb-3"
          >
            + Add condition
          </button>

          {error && <p className="text-xs text-red-600 dark:text-red-400 dark:text-red-400 mb-2">{error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={handleSave} disabled={saving || !name.trim()} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-40">
              {saving ? 'Saving…' : editingId ? 'Update Highlight' : 'Save Highlight'}
            </button>
            <button onClick={closeForm} className="text-xs text-gray-400 dark:text-prosota-muted dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper dark:hover:text-prosota-paper px-1 py-1.5">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={startCreating} className="text-xs text-blue-600 dark:text-prosota-azure dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan dark:hover:text-prosota-cyan font-medium">+ New Highlight</button>
          <button onClick={() => importInputRef.current?.click()} className="text-xs text-blue-600 dark:text-prosota-azure dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan dark:hover:text-prosota-cyan font-medium">
            ⇧ Import Highlight
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

      {!creating && error && <p className="text-xs text-red-600 dark:text-red-400 dark:text-red-400 mt-2">{error}</p>}
    </div>
  )
}
