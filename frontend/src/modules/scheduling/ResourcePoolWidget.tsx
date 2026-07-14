import { Fragment, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { FONT_FAMILY_CSS } from '@/lib/ganttLayout'
import { useUserDefinedFieldDefinitions, useUserDefinedFieldValues } from '@/lib/userDefinedFields'
import type { ResourcesLayoutPrefs } from './resourcesLayout'
import { UdfCell } from './UdfCell'
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS, type Calendar, type Resource, type ResourceType } from './types'

interface Props {
  projectId: string
  resources: Resource[]
  calendars: Calendar[]
  onChange: () => Promise<void>
  // Optional (docs/SCHEDULING_GAPS_PLAN.md Phase 7) — undefined when rendered
  // as the full-page Resources tab in Scheduling.tsx, which has nothing to
  // "close" back to; still used when embedded elsewhere as a dismissible panel.
  onClose?: () => void
  // Checking one or more resources here scopes Resource Tracking/Profile
  // below to just those (2026-07-07, per Maro) — owned by Scheduling.tsx,
  // not local state, since two sibling widgets need to read it too.
  selectedIds: Set<string>
  onToggleSelected: (id: string) => void
  layoutPrefs: ResourcesLayoutPrefs
}

interface ResourceFormValues {
  resource_type: ResourceType
  name: string
  // Optional default/primary role (e.g. "Trades", "Foreman") — distinct from
  // a specific assignment's own role override (ResourceAssignments.tsx),
  // see app/models/resource.py.
  role: string
  unit: string
  rate: string
  max_hours_per_day: string
  // '' = no calendar of its own (2026-07-07, per Maro) — optional, storage/
  // display only for now, see app/models/resource.py.
  calendar_id: string
  // Classification fields (2026-07-08, per Maro) — see app/models/resource.py.
  discipline: string
  company: string
  skill_level: string
  category: string
  cost_type: string
  members: string
}

const BLANK: ResourceFormValues = {
  resource_type: 'labour', name: '', role: '', unit: 'day', rate: '', max_hours_per_day: '8', calendar_id: '',
  discipline: '', company: '', skill_level: '', category: '', cost_type: '', members: '',
}

// labour/equipment/crew are always costed as a day rate; subcontractor/cost are
// always a flat lump sum. Only material has a genuinely free-choice unit (e.g.
// "m3", "nr") — see backend app/models/resource.py.
function fixedUnitFor(type: ResourceType): string | null {
  if (type === 'labour' || type === 'equipment' || type === 'crew') return 'day'
  if (type === 'subcontractor' || type === 'cost') return 'lump sum'
  return null
}

function rateLabelFor(type: ResourceType): string {
  if (type === 'subcontractor' || type === 'cost') return 'Rate (£, lump sum)'
  if (type === 'material') return 'Rate (£ / unit)'
  return 'Rate (£ / day)'
}

function isTimeBasedType(type: ResourceType): boolean {
  return type === 'labour' || type === 'equipment' || type === 'crew'
}

// Classification fields (2026-07-08, per Maro) — discipline/company apply to
// every type; the rest are type-conditional. Shared between the create panel
// and each row's inline edit sub-row so the two forms can't drift apart.
function ClassificationFields({ values, setter }: { values: ResourceFormValues; setter: (fn: (v: ResourceFormValues) => ResourceFormValues) => void }) {
  return (
    <>
      <label className="text-xs text-gray-600">
        Discipline
        <input value={values.discipline} onChange={e => setter(v => ({ ...v, discipline: e.target.value }))} placeholder="e.g. Structural Engineering" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-40" />
      </label>
      <label className="text-xs text-gray-600">
        Company
        <input value={values.company} onChange={e => setter(v => ({ ...v, company: e.target.value }))} placeholder="e.g. ABC Civil Engineering Ltd" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-40" />
      </label>
      {values.resource_type === 'labour' && (
        <label className="text-xs text-gray-600">
          Skill level
          <input value={values.skill_level} onChange={e => setter(v => ({ ...v, skill_level: e.target.value }))} placeholder="e.g. Skilled" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-28" />
        </label>
      )}
      {(values.resource_type === 'material' || values.resource_type === 'equipment') && (
        <label className="text-xs text-gray-600">
          Category
          <input value={values.category} onChange={e => setter(v => ({ ...v, category: e.target.value }))} placeholder="e.g. Concrete" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-28" />
        </label>
      )}
      {values.resource_type === 'cost' && (
        <label className="text-xs text-gray-600">
          Cost type
          <select value={values.cost_type} onChange={e => setter(v => ({ ...v, cost_type: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5">
            <option value="">—</option>
            <option value="fixed">Fixed</option>
            <option value="recurring">Recurring</option>
          </select>
        </label>
      )}
      {values.resource_type === 'crew' && (
        <label className="text-xs text-gray-600">
          Members
          <input value={values.members} onChange={e => setter(v => ({ ...v, members: e.target.value }))} placeholder="e.g. 1x Excavator, 2x Labourers" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-64" />
        </label>
      )}
    </>
  )
}

const COLLAPSED_STORAGE_KEY = 'prosota_resource_pool_collapsed'

export function ResourcePoolWidget({ projectId, resources, calendars, onChange, onClose, selectedIds, onToggleSelected, layoutPrefs }: Props) {
  // Collapsible (2026-07-14, per Maro: "make the resource pool collapsible")
  // — this table alone can run to 25+ rows once a schedule's been generated,
  // pushing Resource Tracking/Profile below it well down the page. Persisted
  // like every other collapse-state in this app (e.g. Resource Tracking's
  // own visible-columns Set) so it stays collapsed across reloads instead of
  // needing to be re-collapsed on every visit.
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true')
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next))
      return next
    })
  }
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<ResourceFormValues>(BLANK)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<ResourceFormValues>(BLANK)

  const { definitions: udfDefinitions } = useUserDefinedFieldDefinitions(projectId, 'resource')
  const { getValue: getUdfValue, setValue: setUdfValue } = useUserDefinedFieldValues(udfDefinitions, resources.map(r => r.id))

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
      role: form.role || null,
      unit: form.unit,
      rate: form.rate,
      max_hours_per_day: form.max_hours_per_day || undefined,
      calendar_id: form.calendar_id || null,
      discipline: form.discipline || null,
      company: form.company || null,
      skill_level: form.skill_level || null,
      category: form.category || null,
      cost_type: form.cost_type || null,
      members: form.members || null,
    })
    setCreating(false)
    setForm(BLANK)
    await onChange()
  }

  const startEdit = (r: Resource) => {
    setEditingId(r.id)
    setEditForm({
      resource_type: r.resource_type, name: r.name, role: r.role ?? '', unit: r.unit, rate: r.rate,
      max_hours_per_day: r.max_hours_per_day, calendar_id: r.calendar_id ?? '',
      discipline: r.discipline ?? '', company: r.company ?? '', skill_level: r.skill_level ?? '',
      category: r.category ?? '', cost_type: r.cost_type ?? '', members: r.members ?? '',
    })
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    await api.patch(`/api/v1/resources/${editingId}`, {
      ...editForm, role: editForm.role || null, calendar_id: editForm.calendar_id || null,
      discipline: editForm.discipline || null, company: editForm.company || null,
      skill_level: editForm.skill_level || null, category: editForm.category || null,
      cost_type: editForm.cost_type || null, members: editForm.members || null,
    })
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
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="text-gray-400 hover:text-gray-600 text-xs w-4 flex-shrink-0"
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <div className="font-bold text-sm">Resource Pool</div>
        <div className="text-xs text-gray-400">Labour, equipment, material, subcontractors, cost &amp; crew — define here, assign to activities via Logic</div>
        {onClose && <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>}
      </div>

      {!collapsed && (
      <>
      <table className="w-full border-collapse mb-2" style={{ fontFamily: FONT_FAMILY_CSS[layoutPrefs.fontFamily], fontSize: layoutPrefs.fontSize }}>
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-2 py-1.5 border border-gray-200">
              <input
                type="checkbox"
                title="Select all — scopes Resource Tracking/Profile below to just the checked resources"
                checked={resources.length > 0 && resources.every(r => selectedIds.has(r.id))}
                onChange={() => {
                  const allSelected = resources.every(r => selectedIds.has(r.id))
                  for (const r of resources) {
                    if (allSelected === selectedIds.has(r.id)) onToggleSelected(r.id)
                  }
                }}
              />
            </th>
            <th className="px-2 py-1.5 border border-gray-200">Type</th>
            <th className="px-2 py-1.5 border border-gray-200">Name</th>
            <th className="px-2 py-1.5 border border-gray-200">Role</th>
            <th className="px-2 py-1.5 border border-gray-200">Unit</th>
            <th className="px-2 py-1.5 border border-gray-200 text-right">Rate (£)</th>
            <th className="px-2 py-1.5 border border-gray-200 text-right">Max h/day</th>
            <th className="px-2 py-1.5 border border-gray-200" title="Optional own calendar — storage/display only for now, doesn't yet affect scheduling">Calendar</th>
            {udfDefinitions.map(d => (
              <th key={d.id} className="px-2 py-1.5 border border-gray-200" title={`Custom field (${d.data_type})`}>{d.name} (UDF)</th>
            ))}
            <th className="px-2 py-1.5 border border-gray-200"></th>
          </tr>
        </thead>
        <tbody>
          {resources.map(r => {
            const isTimeBased = isTimeBasedType(r.resource_type)
            const editFixedUnit = editingId === r.id ? fixedUnitFor(editForm.resource_type) : null
            return (
            <Fragment key={r.id}>
            <tr>
              <td className="px-2 py-1.5 border border-gray-200">
                <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => onToggleSelected(r.id)} />
              </td>
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
                    <input value={editForm.role} onChange={e => setEditForm(v => ({ ...v, role: e.target.value }))} placeholder="e.g. Trades" className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />
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
                    {isTimeBasedType(editForm.resource_type) ? (
                      <input type="number" min={0} max={24} step={0.5} value={editForm.max_hours_per_day} onChange={e => setEditForm(v => ({ ...v, max_hours_per_day: e.target.value }))} className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs text-right" />
                    ) : <span className="text-gray-300 block text-right">—</span>}
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200">
                    <select
                      value={editForm.calendar_id}
                      onChange={e => setEditForm(v => ({ ...v, calendar_id: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
                    >
                      <option value="">None</option>
                      {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  {udfDefinitions.map(d => (
                    <UdfCell key={d.id} definition={d} value={getUdfValue(d.id, r.id)} onSave={payload => setUdfValue(d.id, r.id, payload)} />
                  ))}
                  <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap">
                    <button onClick={handleSaveEdit} className="text-blue-600 hover:text-blue-700 mr-2">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{RESOURCE_TYPE_LABELS[r.resource_type]}</td>
                  <td className="px-2 py-1.5 border border-gray-200 font-medium">{r.name}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{r.role ?? '—'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{r.unit}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right">{Number(r.rate).toLocaleString()}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right text-gray-500">{isTimeBased ? r.max_hours_per_day : '—'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">
                    {r.calendar_id ? (calendars.find(c => c.id === r.calendar_id)?.name ?? '—') : '—'}
                  </td>
                  {udfDefinitions.map(d => (
                    <UdfCell key={d.id} definition={d} value={getUdfValue(d.id, r.id)} onSave={payload => setUdfValue(d.id, r.id, payload)} />
                  ))}
                  <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(r)} className="text-blue-600 hover:text-blue-700 mr-2">Edit</button>
                    <button onClick={() => handleDelete(r)} className="text-gray-400 hover:text-red-600">Delete</button>
                  </td>
                </>
              )}
            </tr>
            {editingId === r.id && (
              <tr>
                <td colSpan={9 + udfDefinitions.length} className="px-2 py-2 border border-gray-200 bg-gray-50">
                  <div className="flex items-end gap-2 flex-wrap">
                    <ClassificationFields values={editForm} setter={setEditForm} />
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
            )
          })}
          {resources.length === 0 && !creating && (
            <tr><td colSpan={9 + udfDefinitions.length} className="px-2 py-3 text-center text-gray-400 border border-gray-200">No resources yet</td></tr>
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
          <label className="text-xs text-gray-600" title="Optional default/primary role — a specific assignment can still override this">
            Role
            <input value={form.role} onChange={e => setForm(v => ({ ...v, role: e.target.value }))} placeholder="e.g. Trades" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-24" />
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
          {isTimeBasedType(form.resource_type) && (
            <label className="text-xs text-gray-600">
              Max hours/day
              <input type="number" min={0} max={24} step={0.5} value={form.max_hours_per_day} onChange={e => setForm(v => ({ ...v, max_hours_per_day: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-20" />
            </label>
          )}
          <label className="text-xs text-gray-600" title="Optional — storage/display only for now, doesn't yet affect scheduling">
            Calendar
            <select
              value={form.calendar_id}
              onChange={e => setForm(v => ({ ...v, calendar_id: e.target.value }))}
              className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5"
            >
              <option value="">None</option>
              {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <ClassificationFields values={form} setter={setForm} />
          <button onClick={handleCreate} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">Add</button>
          <button onClick={() => { setCreating(false); setForm(BLANK) }} className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1.5">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Resource</button>
      )}
      </>
      )}
    </div>
  )
}
