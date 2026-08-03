import { useState } from 'react'
import type { UdfValuePayload } from '@/lib/userDefinedFields'
import { formatDateTime, toDatetimeLocalValue } from './dateTime'
import { INDICATOR_OPTIONS, indicatorOption, type IndicatorValue, type UserDefinedFieldDefinition, type UserDefinedFieldValue } from './types'

interface Props {
  definition: UserDefinedFieldDefinition
  value: UserDefinedFieldValue | undefined
  onSave: (payload: UdfValuePayload) => Promise<void>
}

function displayValue(definition: UserDefinedFieldDefinition, value: UserDefinedFieldValue | undefined): React.ReactNode {
  if (definition.data_type === 'indicator') {
    const opt = indicatorOption(value?.value_indicator)
    return <span style={{ color: opt.color }} title={opt.label}>{opt.icon} {opt.label !== 'None' ? opt.label : ''}</span>
  }
  if (definition.data_type === 'start_date' || definition.data_type === 'finish_date') {
    return value?.value_date ? formatDateTime(value.value_date) : '—'
  }
  if (definition.data_type === 'cost') {
    return value?.value_number ? `£${Number(value.value_number).toLocaleString()}` : '—'
  }
  if (definition.data_type === 'number' || definition.data_type === 'integer') {
    return value?.value_number ?? '—'
  }
  return value?.value_text || '—'
}

// Inline-editable (UDF) grid cell (2026-07-07, per Maro — docs/SCHEDULING_GAPS_PLAN.md
// Phase 9), one data-type-aware editor per UserDefinedFieldDefinition.data_type.
// Self-contained edit state (not threaded through the host grid's own
// editingCell tracking) since the set of UDF columns is dynamic per project —
// same double-click-to-edit/blur-or-Enter-to-save/Escape-to-cancel
// interaction as the grid's built-in editable columns.
export function UdfCell({ definition, value, onSave }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEdit = () => {
    if (definition.data_type === 'start_date' || definition.data_type === 'finish_date') {
      setDraft(toDatetimeLocalValue(value?.value_date ?? null))
    } else if (definition.data_type === 'indicator') {
      setDraft(value?.value_indicator ?? 'none')
    } else if (definition.data_type === 'number' || definition.data_type === 'integer' || definition.data_type === 'cost') {
      setDraft(value?.value_number ?? '')
    } else {
      setDraft(value?.value_text ?? '')
    }
    setEditing(true)
  }

  const cancelEdit = () => setEditing(false)

  const commitEdit = async () => {
    setEditing(false)
    if (definition.data_type === 'start_date' || definition.data_type === 'finish_date') {
      await onSave(draft ? { value_date: new Date(draft).toISOString() } : { value_text: null, value_number: null, value_date: null, value_indicator: null })
    } else if (definition.data_type === 'indicator') {
      await onSave({ value_indicator: draft as IndicatorValue })
    } else if (definition.data_type === 'number' || definition.data_type === 'integer' || definition.data_type === 'cost') {
      await onSave(draft !== '' ? { value_number: draft } : { value_text: null, value_number: null, value_date: null, value_indicator: null })
    } else {
      await onSave(draft !== '' ? { value_text: draft } : { value_text: null, value_number: null, value_date: null, value_indicator: null })
    }
  }

  if (!editing) {
    return (
      <td className="px-3 py-1 whitespace-nowrap text-gray-600 dark:text-prosota-paper" onDoubleClick={startEdit} title="Double-click to edit">
        {displayValue(definition, value)}
      </td>
    )
  }

  if (definition.data_type === 'indicator') {
    return (
      <td className="px-3 py-1 whitespace-nowrap">
        <select
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
          className="border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
        >
          {INDICATOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
        </select>
      </td>
    )
  }

  if (definition.data_type === 'start_date' || definition.data_type === 'finish_date') {
    return (
      <td className="px-3 py-1 whitespace-nowrap">
        <input
          autoFocus
          type="datetime-local"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
          className="border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
        />
      </td>
    )
  }

  if (definition.data_type === 'number' || definition.data_type === 'integer' || definition.data_type === 'cost') {
    return (
      <td className="px-3 py-1 whitespace-nowrap">
        <input
          autoFocus
          type="number"
          step={definition.data_type === 'integer' ? 1 : 0.01}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
          className="w-20 border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
        />
      </td>
    )
  }

  return (
    <td className="px-3 py-1 whitespace-nowrap">
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
        className="border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
      />
    </td>
  )
}
