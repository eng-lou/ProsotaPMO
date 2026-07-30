import axios from 'axios'
import { Fragment, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { useProjectLetterhead } from '@/lib/letterhead'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import type { Activity, ResourceAssignment } from '@/modules/scheduling/types'
import { BoqPrintView } from './BoqPrintView'
import { buildBoqDraft, buildBoqTree } from './boqGeneration'
import type { CostElement, CostRateLine } from './types'

// Bill of Quantities tab (2026-07-18, per Maro: "I want a boq form in the
// cost section BOQ TAB. empty then the button to generate as well.
// populated from our schedule, ifc quantities and relevant project data").
// No new backend model — a BOQ is exactly what a CostElement's own
// CostRateLine breakdown already is (Sr.No/Item/Qty/Unit/Rate/Amount, total
// = qty x rate, computed at query time), so this tab just manages one
// dedicated "Bill of Quantities" CostElement's rate lines directly, reusing
// the existing cost-elements/cost-rate-lines CRUD entirely as-is. Starts
// empty (no such element exists yet for this project/period) with only a
// Generate button and a manual "+ Add line" — Generate creates the
// container element the first time it's needed, then populates it from
// boqGeneration.ts's own derivation off the committed schedule + resourced
// costs.
const BOQ_DESCRIPTION = 'Bill of Quantities'
const BOQ_GROUP = 'BOQ'

interface Props {
  projectId: string
  periodId: string
  projectName: string
}

function formatCurrency(value: number) {
  return value < 0 ? `-£${Math.abs(value).toLocaleString()}` : `£${value.toLocaleString()}`
}

export function Boq({ projectId, periodId, projectName }: Props) {
  const { period: schedulePeriod } = useActiveScheduleVariant(projectId)
  const { letterhead } = useProjectLetterhead(projectId)
  const [boqElement, setBoqElement] = useState<CostElement | null | undefined>(undefined) // undefined = loading
  const [lines, setLines] = useState<CostRateLine[]>([])
  const [scheduleActivities, setScheduleActivities] = useState<Activity[]>([])
  const [resourceAssignments, setResourceAssignments] = useState<ResourceAssignment[]>([])
  const [generating, setGenerating] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [addForm, setAddForm] = useState<{ description: string; qty: string; unit: string; rate: string } | null>(null)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<{ description: string; qty: string; unit: string; rate: string } | null>(null)
  const [printTrigger, setPrintTrigger] = useState(0)

  // Fires window.print() only after BoqPrintView has committed to the DOM
  // (same two-step trigger CostPlan.tsx's own print buttons already use).
  useEffect(() => {
    if (printTrigger > 0) window.print()
  }, [printTrigger])

  const load = async () => {
    const { data } = await api.get<CostElement[]>('/api/v1/cost-elements/', { params: { project_id: projectId, period_id: periodId } })
    const existing = data.find(e => e.description === BOQ_DESCRIPTION && e.element_group === BOQ_GROUP) ?? null
    setBoqElement(existing)
    if (existing) {
      const linesRes = await api.get<CostRateLine[]>('/api/v1/cost-rate-lines/', { params: { cost_element_id: existing.id } })
      setLines(linesRes.data)
    } else {
      setLines([])
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, periodId])

  useEffect(() => {
    if (!schedulePeriod) return
    let cancelled = false
    async function loadScheduleData() {
      const [assignmentsRes, activitiesRes] = await Promise.all([
        api.get<ResourceAssignment[]>('/api/v1/resource-assignments/', { params: { schedule_period_id: schedulePeriod!.id } }),
        api.get<Activity[]>('/api/v1/activities/', { params: { project_id: projectId, schedule_period_id: schedulePeriod!.id } }),
      ])
      if (cancelled) return
      setResourceAssignments(assignmentsRes.data)
      setScheduleActivities(activitiesRes.data)
    }
    loadScheduleData()
    return () => { cancelled = true }
  }, [projectId, schedulePeriod])

  const handleGenerate = async () => {
    const drafts = buildBoqDraft(scheduleActivities, resourceAssignments)
    if (drafts.length === 0) {
      setMessage('No committed schedule found to draft a BOQ from yet.')
      return
    }
    setGenerating(true)
    setMessage(null)
    try {
      let element = boqElement
      if (!element) {
        const { data } = await api.post<CostElement>('/api/v1/cost-elements/', {
          project_id: projectId, period_id: periodId, element_type: 'fixed',
          element_group: BOQ_GROUP, description: BOQ_DESCRIPTION,
        })
        element = data
        setBoqElement(element)
      }
      // Deduped by cost_code, not description (2026-07-27) — a real,
      // stable, per-activity identifier now that one exists, more robust
      // than text matching (falls back to description for older lines
      // generated before cost_code existed). No bulk-create endpoint
      // exists for rate lines, this list is small enough that sequential
      // single-creates are fine.
      const existingKeys = new Set(lines.map(l => l.cost_code ?? l.description))
      const toCreate = drafts.filter(d => !existingKeys.has(d.cost_code))
      for (const d of toCreate) {
        await api.post('/api/v1/cost-rate-lines/', {
          cost_element_id: element.id, description: d.description, qty: d.qty, unit: d.unit, rate: d.rate,
          cost_code: d.cost_code,
        })
      }
      await load()
      const reused = drafts.length - toCreate.length
      setMessage(`BOQ updated — ${toCreate.length} new line(s)${reused > 0 ? `, ${reused} already existed` : ''}.`)
    } catch (err) {
      setMessage(axios.isAxiosError(err) ? `Failed to generate BOQ (${err.response?.data?.detail ?? err.message})` : 'Failed to generate BOQ')
    } finally {
      setGenerating(false)
    }
  }

  const handleAddLine = async () => {
    if (!addForm || !addForm.description.trim()) return
    let element = boqElement
    if (!element) {
      const { data } = await api.post<CostElement>('/api/v1/cost-elements/', {
        project_id: projectId, period_id: periodId, element_type: 'fixed',
        element_group: BOQ_GROUP, description: BOQ_DESCRIPTION,
      })
      element = data
      setBoqElement(element)
    }
    await api.post('/api/v1/cost-rate-lines/', {
      cost_element_id: element.id, description: addForm.description,
      qty: addForm.qty || '0', unit: addForm.unit || null, rate: addForm.rate || '0',
    })
    setAddForm(null)
    await load()
  }

  const handleSaveEdit = async (lineId: string) => {
    if (!editValues) return
    await api.patch(`/api/v1/cost-rate-lines/${lineId}`, {
      description: editValues.description, qty: editValues.qty, unit: editValues.unit || null, rate: editValues.rate,
    })
    setEditingLineId(null)
    setEditValues(null)
    await load()
  }

  const handleDeleteLine = async (line: CostRateLine) => {
    if (!(await confirmWithDontAsk('cost.boq-line-delete', `Delete BOQ line "${line.description}"? This cannot be undone.`))) return
    await api.delete(`/api/v1/cost-rate-lines/${line.id}`)
    await load()
  }

  // No bulk-delete endpoint exists for rate lines (none of this app's other
  // per-row CRUD tables have one either — Path/Annotation/etc. all delete
  // one row per request), so this loops the same single-delete call
  // handleDeleteLine already uses; a BOQ is small enough (dozens, not
  // thousands, of lines) that sequential requests are fine.
  const handleDeleteAll = async () => {
    if (lines.length === 0) return
    if (!(await confirmWithDontAsk('cost.boq-delete-all', `Delete all ${lines.length} BOQ line(s)? This cannot be undone.`))) return
    setDeletingAll(true)
    try {
      for (const line of lines) await api.delete(`/api/v1/cost-rate-lines/${line.id}`)
      await load()
    } finally {
      setDeletingAll(false)
    }
  }

  const handlePrint = () => setPrintTrigger(t => t + 1)

  const total = lines.reduce((sum, l) => sum + Number(l.total), 0)

  if (boqElement === undefined) {
    return <div className="text-sm text-gray-400">Loading BOQ…</div>
  }

  return (
    <>
    <div className="no-print">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={handleGenerate}
          disabled={generating}
          title="Derives BOQ lines from the committed schedule — quantity from each activity's own duration, rate from its already-resourced cost. Review and tune before relying on it."
          className="text-xs px-2.5 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? 'Generating…' : 'Generate BOQ'}
        </button>
        {!addForm && (
          <button
            onClick={() => setAddForm({ description: '', qty: '', unit: '', rate: '' })}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            + Add line
          </button>
        )}
        <button
          onClick={handleDeleteAll}
          disabled={lines.length === 0 || deletingAll}
          title="Delete every BOQ line — the container element stays, so Generate BOQ can repopulate it afterward."
          className="text-xs px-2.5 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {deletingAll ? 'Deleting…' : 'Delete All'}
        </button>
        <button
          onClick={handlePrint}
          disabled={lines.length === 0}
          title="Print the BOQ exactly as currently shown."
          className="text-xs px-2.5 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          🖨️ Print
        </button>
        {message && <span className="text-xs text-gray-500">{message}</span>}
      </div>

      {addForm && (
        <div className="mb-4 p-3 border border-gray-200 rounded-md bg-gray-50 flex items-end gap-2 flex-wrap">
          <label className="text-xs text-gray-500">Item
            <input value={addForm.description} onChange={e => setAddForm({ ...addForm, description: e.target.value })}
              className="block border border-gray-300 rounded px-2 py-1 text-sm w-64" autoFocus />
          </label>
          <label className="text-xs text-gray-500">Qty
            <input value={addForm.qty} onChange={e => setAddForm({ ...addForm, qty: e.target.value })}
              className="block border border-gray-300 rounded px-2 py-1 text-sm w-24" />
          </label>
          <label className="text-xs text-gray-500">Unit
            <input value={addForm.unit} onChange={e => setAddForm({ ...addForm, unit: e.target.value })}
              className="block border border-gray-300 rounded px-2 py-1 text-sm w-20" />
          </label>
          <label className="text-xs text-gray-500">Rate
            <input value={addForm.rate} onChange={e => setAddForm({ ...addForm, rate: e.target.value })}
              className="block border border-gray-300 rounded px-2 py-1 text-sm w-24" />
          </label>
          <button onClick={handleAddLine} className="text-xs px-2.5 py-1.5 rounded-md bg-gray-900 text-white">Save</button>
          <button onClick={() => setAddForm(null)} className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 text-gray-600">Cancel</button>
        </div>
      )}

      {lines.length === 0 && !addForm ? (
        <div className="text-sm text-gray-400 py-8 text-center border border-dashed border-gray-200 rounded-md">
          No BOQ lines yet — click Generate BOQ to draft one from the committed schedule, or + Add line to start manually.
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-200">
              <th className="py-2 pr-2 w-12">Sr.</th>
              <th className="py-2 pr-2">Name of Item</th>
              <th className="py-2 pr-2 w-32">Cost Code</th>
              <th className="py-2 pr-2 text-right w-24">Quantity</th>
              <th className="py-2 pr-2 w-16">Unit</th>
              <th className="py-2 pr-2 text-right w-24">Rate</th>
              <th className="py-2 pr-2 text-right w-28">Amount</th>
              <th className="py-2 pr-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const tree = buildBoqTree(lines, scheduleActivities)
              let sr = 0
              const renderLine = (line: CostRateLine, label: string, indent: number, showSr: boolean) => {
                if (showSr) sr++
                const isEditing = editingLineId === line.id && editValues
                return (
                  <tr key={line.id} className="border-b border-gray-100 hover:bg-gray-50">
                    {isEditing ? (
                      <>
                        <td className="py-1.5 pr-2 text-gray-400">{showSr ? sr : '—'}</td>
                        <td className="py-1.5 pr-2" style={{ paddingLeft: 8 + indent * 16 }}>
                          <input value={editValues!.description} onChange={e => setEditValues({ ...editValues!, description: e.target.value })}
                            className="border border-gray-300 rounded px-1.5 py-0.5 text-sm w-full" />
                        </td>
                        <td className="py-1.5 pr-2 text-gray-400 font-mono text-[10px]">{line.cost_code ?? '—'}</td>
                        <td className="py-1.5 pr-2">
                          <input value={editValues!.qty} onChange={e => setEditValues({ ...editValues!, qty: e.target.value })}
                            className="border border-gray-300 rounded px-1.5 py-0.5 text-sm w-full text-right" />
                        </td>
                        <td className="py-1.5 pr-2">
                          <input value={editValues!.unit} onChange={e => setEditValues({ ...editValues!, unit: e.target.value })}
                            className="border border-gray-300 rounded px-1.5 py-0.5 text-sm w-full" />
                        </td>
                        <td className="py-1.5 pr-2">
                          <input value={editValues!.rate} onChange={e => setEditValues({ ...editValues!, rate: e.target.value })}
                            className="border border-gray-300 rounded px-1.5 py-0.5 text-sm w-full text-right" />
                        </td>
                        <td className="py-1.5 pr-2 text-right text-gray-400">—</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          <button onClick={() => handleSaveEdit(line.id)} className="text-xs text-blue-600 hover:text-blue-700 mr-2">Save</button>
                          <button onClick={() => { setEditingLineId(null); setEditValues(null) }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-1.5 pr-2 text-gray-400">{showSr ? sr : '—'}</td>
                        <td className="py-1.5 pr-2" style={{ paddingLeft: 8 + indent * 16 }}>{label}</td>
                        <td className="py-1.5 pr-2 text-gray-400 font-mono text-[10px]">{line.cost_code ?? '—'}</td>
                        <td className="py-1.5 pr-2 text-right">{Number(line.qty).toLocaleString()}</td>
                        <td className="py-1.5 pr-2 text-gray-500">{line.unit ?? '—'}</td>
                        <td className="py-1.5 pr-2 text-right">{formatCurrency(Number(line.rate))}</td>
                        <td className="py-1.5 pr-2 text-right font-medium">{formatCurrency(Number(line.total))}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          <button
                            onClick={() => { setEditingLineId(line.id); setEditValues({ description: line.description, qty: line.qty, unit: line.unit ?? '', rate: line.rate }) }}
                            className="text-xs text-gray-400 hover:text-gray-600 mr-2"
                          >Edit</button>
                          <button onClick={() => handleDeleteLine(line)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              }
              return (
                <>
                  {tree.sections.map(section => (
                    <Fragment key={section.key}>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <td className="py-1.5 pr-2"></td>
                        <td className="py-1.5 pr-2 font-bold">{section.label}</td>
                        <td className="py-1.5 pr-2 text-gray-400 font-mono text-[10px]">{section.key}</td>
                        <td colSpan={3}></td>
                        <td className="py-1.5 pr-2 text-right font-bold">{formatCurrency(section.subtotal)}</td>
                        <td></td>
                      </tr>
                      {section.elements.map(element => (
                        <Fragment key={element.key}>
                          <tr className="border-b border-gray-100">
                            <td className="py-1.5 pr-2"></td>
                            <td className="py-1.5 pr-2 font-semibold text-gray-600" style={{ paddingLeft: 8 + 16 }}>{element.label}</td>
                            <td className="py-1.5 pr-2 text-gray-400 font-mono text-[10px]">{element.key}</td>
                            <td colSpan={3}></td>
                            <td className="py-1.5 pr-2 text-right font-semibold text-gray-600">{formatCurrency(element.subtotal)}</td>
                            <td></td>
                          </tr>
                          {element.activities.map(activity => (
                            <Fragment key={activity.line.id}>
                              {renderLine(activity.line, activity.label, 2, true)}
                              {activity.resources.map(resource => renderLine(resource.line, resource.label, 3, false))}
                            </Fragment>
                          ))}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                  {tree.ungrouped.map(line => renderLine(line, line.description, 0, true))}
                </>
              )
            })()}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-bold">
              <td colSpan={6} className="py-2 pr-2 text-right">Total Cost</td>
              <td className="py-2 pr-2 text-right">{formatCurrency(total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
    <BoqPrintView lines={lines} total={total} projectName={projectName} letterhead={letterhead} activities={scheduleActivities} />
    </>
  )
}
