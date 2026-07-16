import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { RESOURCE_TYPE_LABELS, type Activity, type Resource, type ResourceAssignment, type ResourceType } from './types'

interface Props {
  activity: Activity
  resources: Resource[]
  onChange: () => Promise<void>
}

interface EditValues {
  role: string
  quantity: string
  utilisationPct: string
}

function formatCurrency(value: string) {
  return `£${Number(value).toLocaleString()}`
}

// 'crew' is time-based too (2026-07-08, per Maro: "crew occupies an
// activity's time the same way labour/equipment does") — the backend's own
// copy of this same rule (resource_costing.py, resource_assignment_spread.py's
// _TIME_BASED_TYPES) already includes it; this frontend copy never got
// updated to match, so a crew assignment's "Qty / Utilisation" column fell
// through to the material-style `${quantity} ${unit}` display instead —
// quantity is genuinely null for a crew assignment (only utilisation_pct
// applies), rendering the literal text "null day" (2026-07-13, per Maro's
// own screenshot of exactly that).
function isTimeBased(type: ResourceType): boolean {
  return type === 'labour' || type === 'equipment' || type === 'crew'
}

function singleTimeBasedAssignment(assignments: ResourceAssignment[]): ResourceAssignment | null {
  const timeBased = assignments.filter(a => isTimeBased(a.resource_type))
  return timeBased.length === 1 ? timeBased[0] : null
}

// Converts the stored £ actual (Activity.ac) into whichever unit the toggle
// is currently showing, for display — Cost is a pass-through; Hours/Days
// derive from the one Labour/Equipment assignment's own rate (a day rate)
// and max_hours_per_day (see actualsToCost for the inverse).
function actualsFromCost(ac: string | null, unit: 'cost' | 'hours' | 'days', assignments: ResourceAssignment[]): string {
  if (ac === null || ac.trim() === '') return ''
  if (unit === 'cost') return ac
  const assignment = singleTimeBasedAssignment(assignments)
  const rate = assignment ? Number(assignment.rate) : 0
  if (!assignment || rate <= 0) return ac
  const days = Number(ac) / rate
  const value = unit === 'days' ? days : days * Number(assignment.max_hours_per_day)
  return value.toFixed(2)
}

// The inverse — whatever's typed in the current unit, converted to the £
// total that's actually PATCHed/stored (Activity.ac never changes shape).
function actualsToCost(value: string, unit: 'cost' | 'hours' | 'days', assignments: ResourceAssignment[]): string {
  if (unit === 'cost') return value
  const assignment = singleTimeBasedAssignment(assignments)
  if (!assignment) return value
  const days = unit === 'days' ? Number(value) : Number(value) / Number(assignment.max_hours_per_day)
  return (days * Number(assignment.rate)).toFixed(2)
}

export function ResourceAssignments({ activity, resources, onChange }: Props) {
  const [assignments, setAssignments] = useState<ResourceAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [resourceId, setResourceId] = useState('')
  const [role, setRole] = useState('')
  const [quantity, setQuantity] = useState('')
  const [utilisationPct, setUtilisationPct] = useState('100')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<EditValues>({ role: '', quantity: '', utilisationPct: '100' })
  const [actualsInput, setActualsInput] = useState(activity.ac ?? '')
  const [savingActuals, setSavingActuals] = useState(false)
  // Cost/Hours/Days entry (2026-07-07, per Maro) — Actual Cost is still the
  // only thing actually stored (Activity.ac, a flat £ total, unchanged);
  // Hours/Days just convert through the activity's one Labour/Equipment
  // resource assignment's own rate (a day rate) and max_hours_per_day, same
  // formula app/services/resource_costing.py uses for budget. Only offered
  // when there's exactly one such assignment — with two or more, whose
  // rate/day-length to convert against is ambiguous, so it falls back to
  // Cost-only entry, unchanged from before this existed.
  const [actualsUnit, setActualsUnit] = useState<'cost' | 'hours' | 'days'>('cost')

  useEffect(() => { setActualsInput(actualsFromCost(activity.ac, actualsUnit, assignments)) }, [activity.ac, actualsUnit, assignments])

  const handleSaveActuals = async () => {
    setSavingActuals(true)
    try {
      const actuals = actualsInput.trim() === '' ? null : actualsToCost(actualsInput, actualsUnit, assignments)
      await api.patch(`/api/v1/activities/${activity.id}/actuals`, { actuals })
      await onChange()
    } finally {
      setSavingActuals(false)
    }
  }

  const load = () => {
    setLoading(true)
    api.get<ResourceAssignment[]>('/api/v1/resource-assignments/', { params: { activity_id: activity.id } })
      .then(res => setAssignments(res.data))
      .finally(() => setLoading(false))
  }

  useEffect(load, [activity.id])

  const selectedResource = resources.find(r => r.id === resourceId) ?? null

  const resetForm = () => {
    setAdding(false)
    setResourceId('')
    setRole('')
    setQuantity('')
    setUtilisationPct('100')
  }

  const handleAdd = async () => {
    if (!resourceId || !selectedResource) return
    if (selectedResource.resource_type === 'material' && !quantity) return
    await api.post('/api/v1/resource-assignments/', {
      activity_id: activity.id,
      resource_id: resourceId,
      role: role.trim() || null,
      quantity: selectedResource.resource_type === 'material' ? quantity : null,
      utilisation_pct: isTimeBased(selectedResource.resource_type) ? utilisationPct : null,
    })
    resetForm()
    load()
    await onChange()
  }

  const startEdit = (a: ResourceAssignment) => {
    setAdding(false)
    setEditingId(a.id)
    setEditValues({
      role: a.role ?? '',
      quantity: a.quantity ?? '',
      utilisationPct: a.utilisation_pct ?? '100',
    })
  }

  const handleSaveEdit = async (a: ResourceAssignment) => {
    if (a.resource_type === 'material' && !editValues.quantity) return
    await api.patch(`/api/v1/resource-assignments/${a.id}`, {
      role: editValues.role.trim() || null,
      quantity: a.resource_type === 'material' ? editValues.quantity : undefined,
      utilisation_pct: isTimeBased(a.resource_type) ? editValues.utilisationPct : undefined,
    })
    setEditingId(null)
    load()
    await onChange()
  }

  const handleDelete = async (assignment: ResourceAssignment) => {
    await api.delete(`/api/v1/resource-assignments/${assignment.id}`)
    load()
    await onChange()
  }

  if (loading) return <p className="text-xs text-gray-400 px-4 py-3">Loading resources…</p>

  const totalBudget = assignments.reduce((sum, a) => sum + Number(a.budget), 0)
  // A WBS/Project summary row isn't real work — the backend rejects assigning
  // a resource to one outright (2026-07-06, per Maro), so only the "add" path
  // is blocked here. Any assignments left over from before this row gained
  // children (and got promoted to a summary) still display and can still be
  // edited/removed, same as anywhere else — nothing retroactively hidden.
  const isParent = activity.activity_type === 'wbs_summary'

  return (
    <div className="px-4 py-4 bg-gray-50 border-t border-gray-100 text-xs">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Assigned Resources</div>
      {assignments.length === 0 ? (
        <div className="text-xs text-gray-400 mb-2">None</div>
      ) : (
        <table className="w-full text-xs border-collapse mb-2">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="pb-1">Resource</th>
              <th className="pb-1">Role</th>
              <th className="pb-1 text-right">Qty / Utilisation</th>
              <th className="pb-1 text-right">Budget</th>
              <th className="pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {assignments.map(a => (
              <tr key={a.id} className="border-t border-gray-100 bg-white">
                <td className="py-1 px-1">
                  {a.resource_name}
                  <span className="text-gray-400"> ({RESOURCE_TYPE_LABELS[a.resource_type]})</span>
                </td>
                {editingId === a.id ? (
                  <>
                    <td className="py-1 px-1">
                      <input
                        autoFocus
                        value={editValues.role}
                        onChange={e => setEditValues(v => ({ ...v, role: e.target.value }))}
                        placeholder="Role (optional)"
                        className="w-full border border-blue-400 rounded px-1 py-0.5 text-xs"
                      />
                    </td>
                    <td className="py-1 px-1 text-right">
                      {isTimeBased(a.resource_type) ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number" min={1} max={100} step={1}
                            value={editValues.utilisationPct}
                            onChange={e => setEditValues(v => ({ ...v, utilisationPct: e.target.value }))}
                            className="w-14 border border-blue-400 rounded px-1 py-0.5 text-xs text-right"
                          />%
                        </span>
                      ) : a.resource_type === 'subcontractor' ? (
                        <span className="text-gray-400">lump sum</span>
                      ) : (
                        <input
                          type="number" min={0} step={0.01}
                          value={editValues.quantity}
                          onChange={e => setEditValues(v => ({ ...v, quantity: e.target.value }))}
                          className="w-20 border border-blue-400 rounded px-1 py-0.5 text-xs text-right"
                        />
                      )}
                    </td>
                    <td className="py-1 px-1 text-right font-medium text-gray-400">—</td>
                    <td className="py-1 px-1 text-right whitespace-nowrap">
                      <button onClick={() => handleSaveEdit(a)} className="text-blue-600 hover:text-blue-700 mr-1.5">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-1 px-1 text-gray-500">{a.role ?? '—'}</td>
                    <td className="py-1 px-1 text-right">
                      {isTimeBased(a.resource_type) ? `${a.utilisation_pct ?? 100}% × ${activity.duration_days ?? '—'}d`
                        : a.resource_type === 'subcontractor' ? 'lump sum'
                        : `${a.quantity} ${a.unit}`}
                    </td>
                    <td className="py-1 px-1 text-right font-medium">{formatCurrency(a.budget)}</td>
                    <td className="py-1 px-1 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(a)} className="text-blue-600 hover:text-blue-700 mr-1.5">Edit</button>
                      <button onClick={() => handleDelete(a)} className="text-gray-400 hover:text-red-600">✕</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-semibold bg-white">
              <td className="py-1 px-1" colSpan={3}>Total (Planned / Budget)</td>
              <td className="py-1 px-1 text-right">{formatCurrency(totalBudget.toString())}</td>
              <td></td>
            </tr>
            <tr className="bg-white">
              <td className="py-1 px-1 text-gray-500" colSpan={3}>
                Actual {actualsUnit === 'cost' ? 'Cost' : actualsUnit === 'hours' ? 'Hours' : 'Days'}
                <span className="text-gray-400"> — synced to the linked Cost Plan line</span>
              </td>
              <td className="py-1 px-1 text-right" colSpan={2}>
                <span className="inline-flex items-center gap-1.5 justify-end w-full">
                  {singleTimeBasedAssignment(assignments) && (
                    <span className="inline-flex items-center border border-gray-300 rounded overflow-hidden">
                      {(['cost', 'hours', 'days'] as const).map(u => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => setActualsUnit(u)}
                          title={u === 'cost' ? 'Enter the actual cost directly' : `Enter actual ${u} worked — converted to cost via this activity's one time-based resource's rate`}
                          className={`px-1.5 py-0.5 text-[10px] ${actualsUnit === u ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                        >
                          {u === 'cost' ? '£' : u === 'hours' ? 'h' : 'd'}
                        </button>
                      ))}
                    </span>
                  )}
                  {actualsUnit === 'cost' && '£'}
                  <input
                    type="number" min={0} step={0.01}
                    value={actualsInput}
                    onChange={e => setActualsInput(e.target.value)}
                    onBlur={handleSaveActuals}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    disabled={savingActuals}
                    placeholder="0.00"
                    className="w-20 border border-gray-300 rounded px-1 py-0.5 text-xs text-right disabled:opacity-50"
                  />
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {isParent ? (
        <div className="text-[11px] text-gray-400">Not applicable to a WBS/Project summary — assign resources to its individual tasks/milestones instead.</div>
      ) : adding ? (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <select value={resourceId} onChange={e => setResourceId(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1">
            <option value="">Select resource…</option>
            {resources.map(r => <option key={r.id} value={r.id}>{r.name} ({RESOURCE_TYPE_LABELS[r.resource_type]}, £{r.rate}/{r.unit})</option>)}
          </select>
          <input
            value={role}
            onChange={e => setRole(e.target.value)}
            placeholder="Role (optional)"
            className="text-xs border border-gray-300 rounded px-2 py-1 w-32"
          />
          {selectedResource && isTimeBased(selectedResource.resource_type) && (
            <label className="text-xs text-gray-600 flex items-center gap-1">
              Utilisation
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={utilisationPct}
                onChange={e => setUtilisationPct(e.target.value)}
                title={`% of ${selectedResource.name}'s day spent on this activity, each day of its ${activity.duration_days ?? '—'}-day duration`}
                className="text-xs border border-gray-300 rounded px-2 py-1 w-16"
              />%
            </label>
          )}
          {selectedResource && selectedResource.resource_type === 'material' && (
            <input
              type="number"
              min={0}
              step={0.01}
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder={`Qty (${selectedResource.unit})`}
              className="text-xs border border-gray-300 rounded px-2 py-1 w-24"
            />
          )}
          {selectedResource && selectedResource.resource_type === 'subcontractor' && (
            <span className="text-xs text-gray-400">Flat lump sum — no quantity needed</span>
          )}
          <button
            onClick={handleAdd}
            disabled={!resourceId || (selectedResource?.resource_type === 'material' && !quantity)}
            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
          <button onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={resources.length === 0}
          title={resources.length === 0 ? 'Add resources to the Resource Pool first (👷 Resources button)' : undefined}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-300 disabled:cursor-not-allowed"
        >
          + Assign Resource
        </button>
      )}
    </div>
  )
}
