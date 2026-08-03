import axios from 'axios'
import { useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { UDF_DATA_TYPES, type UdfDataType, type UdfEntityType, type UserDefinedFieldDefinition } from './types'

function apiErrorDetail(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
}

const ENTITY_LABEL: Record<UdfEntityType, string> = {
  activity: 'Activities', resource: 'Resources', cost_element: 'Cost',
}

interface Props {
  entityType: UdfEntityType
  onEntityTypeChange: (entityType: UdfEntityType) => void
  // Which entity types this host page can actually offer a column for right
  // now — Scheduling only wires Activities up first (docs/SCHEDULING_GAPS_PLAN.md
  // Phase 9: "build once, verify end-to-end, then repeat"); Resources/Cost's
  // own grids get their own instance of this same widget once wired there.
  availableEntityTypes: UdfEntityType[]
  // Definitions + CRUD handlers come from the host page's own single
  // useUserDefinedFieldDefinitions instance (2026-07-07, per Maro — a
  // field created here wasn't showing up in the Columns menu, because this
  // widget used to call the hook a second time itself, with its own separate
  // state the host page's Columns menu never saw refreshed). Keeping this
  // component purely presentational — one shared source of truth, not two.
  definitions: UserDefinedFieldDefinition[]
  loading: boolean
  onCreate: (name: string, dataType: UdfDataType) => Promise<void>
  onUpdate: (definitionId: string, changes: { name?: string; data_type?: UdfDataType }) => Promise<void>
  onDelete: (definitionId: string) => Promise<void>
  onClose: () => void
}

// P6's own "User Defined Fields" dialog (Maro's reference screenshot,
// 2026-07-07) — define a named, typed custom field once per project/entity
// kind; app/services/user_defined_field.py is the CRUD backing it. Once
// added, the host grid's own Columns menu offers it as "{name} (UDF)",
// inline-editable per its data type (see UdfCell.tsx).
export function UserDefinedFieldsWidget({
  entityType, onEntityTypeChange, availableEntityTypes, definitions, loading, onCreate, onUpdate, onDelete, onClose,
}: Props) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [dataType, setDataType] = useState<UdfDataType>('text')
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDataType, setEditDataType] = useState<UdfDataType>('text')
  const [editError, setEditError] = useState<string | null>(null)

  const resetForm = () => { setCreating(false); setName(''); setDataType('text'); setError(null) }

  const handleCreate = async () => {
    if (!name.trim()) return
    setError(null)
    try {
      await onCreate(name.trim(), dataType)
      resetForm()
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not create that field.')
    }
  }

  const startEdit = (d: UserDefinedFieldDefinition) => {
    setEditingId(d.id)
    setEditName(d.name)
    setEditDataType(d.data_type)
    setEditError(null)
  }
  const cancelEdit = () => { setEditingId(null); setEditError(null) }

  const saveEdit = async (d: UserDefinedFieldDefinition) => {
    if (!editName.trim()) return
    setEditError(null)
    // Changing data type clears every value stored under this field (the
    // old type's column has no meaningful equivalent under a new one) —
    // warn before it happens, not after (2026-07-07, per Maro: "I want to
    // be able to edit the custom field").
    if (editDataType !== d.data_type) {
      if (!(await confirmWithDontAsk(
        'scheduling.udf-change-type',
        `Change "${d.name}" from ${UDF_DATA_TYPES.find(t => t.value === d.data_type)?.label} to ${UDF_DATA_TYPES.find(t => t.value === editDataType)?.label}? This clears every value currently stored under this field, on every ${ENTITY_LABEL[entityType].toLowerCase()} record. This cannot be undone.`
      ))) return
    }
    try {
      await onUpdate(d.id, { name: editName.trim(), data_type: editDataType })
      setEditingId(null)
    } catch (err) {
      setEditError(apiErrorDetail(err) ?? 'Could not save that change.')
    }
  }

  const handleDelete = async (d: UserDefinedFieldDefinition) => {
    if (!(await confirmWithDontAsk(
      'scheduling.udf-delete',
      `Delete the custom field "${d.name}"? This also deletes every value stored under it, on every ${ENTITY_LABEL[entityType].toLowerCase()} record. This cannot be undone.`
    ))) return
    await onDelete(d.id)
  }

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🏷️</span>
        <div className="font-bold text-sm dark:text-prosota-paper">User Defined Fields</div>
        {availableEntityTypes.length > 1 ? (
          <select
            value={entityType}
            onChange={e => onEntityTypeChange(e.target.value as UdfEntityType)}
            className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1"
          >
            {availableEntityTypes.map(t => <option key={t} value={t}>{ENTITY_LABEL[t]}</option>)}
          </select>
        ) : (
          <span className="text-xs text-gray-400 dark:text-prosota-muted">{ENTITY_LABEL[entityType]}</span>
        )}
        <div className="text-xs text-gray-400 dark:text-prosota-muted">Define a custom field, then add it as a column from the grid's own Columns menu</div>
        <button onClick={onClose} className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="bg-gray-50 dark:bg-prosota-panel2 text-left text-gray-500 dark:text-prosota-muted">
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Title</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Data Type</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
          </tr>
        </thead>
        <tbody>
          {definitions.map(d => {
            const isEditing = editingId === d.id
            return (
              <tr key={d.id}>
                {isEditing ? (
                  <>
                    <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        autoFocus
                        className="w-full border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">
                      <select
                        value={editDataType}
                        onChange={e => setEditDataType(e.target.value as UdfDataType)}
                        className="border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
                      >
                        {UDF_DATA_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right whitespace-nowrap">
                      <button onClick={() => saveEdit(d)} className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan mr-2">Save</button>
                      <button onClick={cancelEdit} className="text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line font-medium">{d.name}</td>
                    <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-gray-500 dark:text-prosota-muted">
                      {UDF_DATA_TYPES.find(t => t.value === d.data_type)?.label ?? d.data_type}
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right whitespace-nowrap">
                      <button onClick={() => startEdit(d)} className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan mr-2">Edit</button>
                      <button onClick={() => handleDelete(d)} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">Delete</button>
                    </td>
                  </>
                )}
              </tr>
            )
          })}
          {definitions.length === 0 && !loading && (
            <tr><td colSpan={3} className="px-2 py-3 text-center text-gray-400 dark:text-prosota-muted border border-gray-200 dark:border-prosota-line">No custom fields defined yet for {ENTITY_LABEL[entityType]}</td></tr>
          )}
        </tbody>
      </table>
      {editError && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{editError}</p>}

      {creating ? (
        <div className="border border-gray-200 dark:border-prosota-line rounded p-3 flex items-end gap-2 flex-wrap">
          <label className="text-xs text-gray-600 dark:text-prosota-muted">
            Title
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Deadline"
              autoFocus
              className="block border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1 text-xs mt-0.5 w-48"
            />
          </label>
          <label className="text-xs text-gray-600 dark:text-prosota-muted">
            Data Type
            <select
              value={dataType}
              onChange={e => setDataType(e.target.value as UdfDataType)}
              className="block border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1 text-xs mt-0.5"
            >
              {UDF_DATA_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          {error && <p className="text-xs text-red-600 dark:text-red-400 w-full">{error}</p>}
          <button onClick={handleCreate} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80">Add</button>
          <button onClick={resetForm} className="text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper px-1 py-1.5">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">+ Add Field</button>
      )}
    </div>
  )
}
