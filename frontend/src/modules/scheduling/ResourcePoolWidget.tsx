import { useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS, type Resource, type ResourceType } from './types'

interface Props {
  projectId: string
  resources: Resource[]
  onChange: () => Promise<void>
  onClose: () => void
}

interface ResourceFormValues {
  resource_type: ResourceType
  name: string
  unit: string
  rate: string
  max_hours_per_day: string
}

const BLANK: ResourceFormValues = { resource_type: 'labour', name: '', unit: 'day', rate: '', max_hours_per_day: '8' }

// labour/equipment are always costed as a day rate; subcontractor is always a flat
// lump sum. Only material has a genuinely free-choice unit (e.g. "m3", "nr") — see
// backend app/models/resource.py.
function fixedUnitFor(type: ResourceType): string | null {
  if (type === 'labour' || type === 'equipment') return 'day'
  if (type === 'subcontractor') return 'lump sum'
  return null
}

function rateLabelFor(type: ResourceType): string {
  if (type === 'subcontractor') return 'Rate (£, lump sum)'
  if (type === 'material') return 'Rate (£ / unit)'
  return 'Rate (£ / day)'
}

export function ResourcePoolWidget({ projectId, resources, onChange, onClose }: Props) {
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<ResourceFormValues>(BLANK)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<ResourceFormValues>(BLANK)

  const setType = (setter: typeof setForm, type: ResourceType) => {
    const fixedUnit = fixedUnitFor(type)
    setter(v => ({ ...v, resource_type: type, unit: fixedUnit ?? (v.unit === 'day' || v.unit === 'lump sum' ? '' : v.unit) }))
  }

  const handleCreate = async () => {
    if (!form.name.trim() || !form.unit.trim() || form.rate === '') return
    await api.post('/api/v1/resources/', {
      project_id: projectId,
      resource_type: form.resource_type,
      name: form.name,
      unit: form.unit,
      rate: form.rate,
      max_hours_per_day: form.max_hours_per_day || undefined,
    })
    setCreating(false)
    setForm(BLANK)
    await onChange()
  }

  const startEdit = (r: Resource) => {
    setEditingId(r.id)
    setEditForm({ resource_type: r.resource_type, name: r.name, unit: r.unit, rate: r.rate, max_hours_per_day: r.max_hours_per_day })
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    await api.patch(`/api/v1/resources/${editingId}`, editForm)
    setEditingId(null)
    await onChange()
  }

  const handleDelete = async (r: Resource) => {
    if (!(await confirmWithDontAsk('scheduling.resource-delete', `Delete resource "${r.name}"? This is only possible if it isn't assigned to any activity.`))) return
    try {
      await api.delete(`/api/v1/resources/${r.id}`)
      await onChange()
    } catch (err) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : undefined
      window.alert(message ?? 'Could not delete this resource.')
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">👷</span>
        <div className="font-bold text-sm">Resource Pool</div>
        <div className="text-xs text-gray-400">Labour, equipment, material &amp; subcontractors — define here, assign to activities via 🔗 Logic</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-2">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-2 py-1.5 border border-gray-200">Type</th>
            <th className="px-2 py-1.5 border border-gray-200">Name</th>
            <th className="px-2 py-1.5 border border-gray-200">Unit</th>
            <th className="px-2 py-1.5 border border-gray-200 text-right">Rate (£)</th>
            <th className="px-2 py-1.5 border border-gray-200 text-right">Max h/day</th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
          </tr>
        </thead>
        <tbody>
          {resources.map(r => {
            const isTimeBased = r.resource_type === 'labour' || r.resource_type === 'equipment'
            const editFixedUnit = editingId === r.id ? fixedUnitFor(editForm.resource_type) : null
            return (
            <tr key={r.id}>
              {editingId === r.id ? (
                <>
                  <td className="px-2 py-1.5 border border-gray-200">
                    <select
                      value={editForm.resource_type}
                      onChange={e => setType(setEditForm, e.target.value as ResourceType)}
                      className="border border-gray-300 rounded px-1 py-0.5 text-xs"
                    >
                      {RESOURCE_TYPES.map(t => <option key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200">
                    <input value={editForm.name} onChange={e => setEditForm(v => ({ ...v, name: e.target.value }))} className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200">
                    {editFixedUnit ? (
                      <span className="text-gray-400">{editFixedUnit}</span>
                    ) : (
                      <input value={editForm.unit} onChange={e => setEditForm(v => ({ ...v, unit: e.target.value }))} placeholder="m3 / nr / each" className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />
                    )}
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200">
                    <input type="number" min={0} step={0.01} value={editForm.rate} onChange={e => setEditForm(v => ({ ...v, rate: e.target.value }))} className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs text-right" />
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200">
                    {editForm.resource_type === 'labour' || editForm.resource_type === 'equipment' ? (
                      <input type="number" min={0} max={24} step={0.5} value={editForm.max_hours_per_day} onChange={e => setEditForm(v => ({ ...v, max_hours_per_day: e.target.value }))} className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs text-right" />
                    ) : <span className="text-gray-300 block text-right">—</span>}
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap">
                    <button onClick={handleSaveEdit} className="text-blue-600 hover:text-blue-700 mr-2">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{RESOURCE_TYPE_LABELS[r.resource_type]}</td>
                  <td className="px-2 py-1.5 border border-gray-200 font-medium">{r.name}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{r.unit}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right">{Number(r.rate).toLocaleString()}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right text-gray-500">{isTimeBased ? r.max_hours_per_day : '—'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(r)} className="text-blue-600 hover:text-blue-700 mr-2">Edit</button>
                    <button onClick={() => handleDelete(r)} className="text-gray-400 hover:text-red-600">Delete</button>
                  </td>
                </>
              )}
            </tr>
            )
          })}
          {resources.length === 0 && !creating && (
            <tr><td colSpan={6} className="px-2 py-3 text-center text-gray-400 border border-gray-200">No resources yet</td></tr>
          )}
        </tbody>
      </table>

      {creating ? (
        <div className="border border-gray-200 rounded p-3 flex items-end gap-2 flex-wrap">
          <label className="text-xs text-gray-600">
            Type
            <select value={form.resource_type} onChange={e => setType(setForm, e.target.value as ResourceType)} className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5">
              {RESOURCE_TYPES.map(t => <option key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            Name
            <input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} placeholder="e.g. J. Davies" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5" />
          </label>
          {fixedUnitFor(form.resource_type) ? (
            <div className="text-xs text-gray-500">
              Unit
              <div className="mt-1.5">{fixedUnitFor(form.resource_type)}</div>
            </div>
          ) : (
            <label className="text-xs text-gray-600">
              Unit
              <input value={form.unit} onChange={e => setForm(v => ({ ...v, unit: e.target.value }))} placeholder="m3 / nr / each" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-24" />
            </label>
          )}
          <label className="text-xs text-gray-600">
            {rateLabelFor(form.resource_type)}
            <input type="number" min={0} step={0.01} value={form.rate} onChange={e => setForm(v => ({ ...v, rate: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-28" />
          </label>
          {(form.resource_type === 'labour' || form.resource_type === 'equipment') && (
            <label className="text-xs text-gray-600">
              Max hours/day
              <input type="number" min={0} max={24} step={0.5} value={form.max_hours_per_day} onChange={e => setForm(v => ({ ...v, max_hours_per_day: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-20" />
            </label>
          )}
          <button onClick={handleCreate} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">Add</button>
          <button onClick={() => { setCreating(false); setForm(BLANK) }} className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1.5">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Resource</button>
      )}
    </div>
  )
}
