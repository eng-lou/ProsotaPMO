import axios from 'axios'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { GanttStyle } from '@/lib/ganttLayout'
import { ActivityPicker, nearestOtherActivityId } from './ActivityPicker'
import { buildCalendarLookup, resolveHoursPerDay } from './durationDisplay'
import {
  RELATIONSHIP_TYPES, validRelationshipTypesFor,
  type Activity, type ActivityRelationship, type Calendar, type RelationshipType,
} from './types'

function apiErrorDetail(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
}

interface Props {
  activity: Activity
  activities: Activity[]
  relationships: ActivityRelationship[]
  calendars: Calendar[]
  onChange: () => Promise<void>
  // Jumps the main grid/Gantt to a given activity (2026-07-05, per Maro —
  // clicking a predecessor/successor's name here should select it in the
  // main view and scroll it into view, not just be inert text).
  onFocusActivity: (activityId: string) => void
  // Same per-type row tint the main activity table uses (2026-07-06, per
  // Maro: "adopt the layout coloring we use in the main activity table" for
  // the predecessor/successor picker) — critical/WBS-summary-by-level/
  // milestone/archived, so a WBS summary (which can't actually be linked as
  // either) visually reads as a parent, not just another row in the list.
  ganttStyle: GanttStyle
}

// Lag is collected/shown in days (what planners actually think in, same
// convention as Duration) and converted through the current activity's own
// resolved calendar — never sent to the backend as "days" (2026-07-06, per
// Maro). hoursPerDay is threaded down from ActivityLogic rather than
// re-resolved per row, since every row here is relative to the *same*
// current activity regardless of which end (predecessor/successor) it is.
function formatLagDays(lagHours: number, hoursPerDay: number): string {
  if (lagHours === 0) return '—'
  const days = lagHours / hoursPerDay
  const rounded = Math.round(days * 100) / 100
  return rounded > 0 ? `+${rounded}d` : `${rounded}d`
}

function LinkTable({
  title,
  rows,
  otherIdField,
  activitiesById,
  hoursPerDay,
  getSuccessorType,
  onUpdate,
  onDelete,
  onFocusActivity,
}: {
  title: string
  rows: ActivityRelationship[]
  otherIdField: 'predecessor_id' | 'successor_id'
  activitiesById: Map<string, Activity>
  hoursPerDay: number
  // The activity whose milestone-ness (if any) restricts which relationship
  // types make sense for this row — see validRelationshipTypesFor. Varies
  // per row for the Successors table (each row's own successor differs);
  // fixed to the current activity for the Predecessors table.
  getSuccessorType: (r: ActivityRelationship) => Activity['activity_type'] | undefined
  onUpdate: (id: string, relationshipType: RelationshipType, lagHours: number) => Promise<void>
  onDelete: (id: string) => void
  onFocusActivity: (activityId: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editType, setEditType] = useState<RelationshipType>('FS')
  const [editLagDays, setEditLagDays] = useState('0')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = (r: ActivityRelationship) => {
    setEditingId(r.id)
    setEditType(r.relationship_type)
    setEditLagDays(String(Math.round((r.lag_hours / hoursPerDay) * 100) / 100))
    setError(null)
  }

  const cancelEdit = () => { setEditingId(null); setError(null) }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    setError(null)
    try {
      await onUpdate(editingId, editType, (Number(editLagDays) || 0) * hoursPerDay)
      setEditingId(null)
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not save that change.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide mb-1.5">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-gray-400 dark:text-prosota-muted mb-2">None</div>
      ) : (
        <table className="w-full text-xs border-collapse mb-2">
          <tbody>
            {rows.map(r => {
              const other = activitiesById.get(r[otherIdField])
              const isEditing = editingId === r.id
              const validTypes = validRelationshipTypesFor(getSuccessorType(r))
              const restricted = validTypes.length < RELATIONSHIP_TYPES.length
              return (
                <tr key={r.id} className="border-b border-gray-100 dark:border-prosota-line last:border-0">
                  <td className="py-1 pr-2 font-mono text-gray-500 dark:text-prosota-muted whitespace-nowrap">{other?.code ?? '—'}</td>
                  <td className="py-1 pr-2 text-gray-700 dark:text-prosota-muted truncate max-w-[10rem]">
                    {other ? (
                      <button
                        onClick={() => onFocusActivity(other.id)}
                        title="Select and scroll to this activity"
                        className="text-left text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan hover:underline truncate"
                      >
                        {other.task_name}
                      </button>
                    ) : 'Unknown'}
                  </td>
                  {isEditing ? (
                    <>
                      <td className="py-1 pr-2">
                        <select
                          value={editType}
                          onChange={e => setEditType(e.target.value as RelationshipType)}
                          autoFocus
                          title={restricted ? `Only ${validTypes.join('/')} can drive this milestone's own meaningful date` : undefined}
                          className="text-xs border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
                        >
                          {RELATIONSHIP_TYPES.map(t => (
                            <option key={t} value={t} disabled={!validTypes.includes(t)}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          step={0.5}
                          value={editLagDays}
                          onChange={e => setEditLagDays(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                          title="Lag (days) — positive = lag, negative = lead"
                          className="w-14 text-xs border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="py-1 text-right whitespace-nowrap">
                        <button onClick={saveEdit} disabled={saving} className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan disabled:opacity-40 mr-2">✓</button>
                        <button onClick={cancelEdit} className="text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">✕</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-1 pr-2">
                        <button
                          onClick={() => startEdit(r)}
                          title="Click to edit the relationship type and lag"
                          className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:text-prosota-azure font-medium hover:bg-blue-100"
                        >
                          {r.relationship_type}
                        </button>
                      </td>
                      <td className="py-1 pr-2 text-gray-500 dark:text-prosota-muted whitespace-nowrap">
                        <button onClick={() => startEdit(r)} title="Click to edit the relationship type and lag" className="hover:text-gray-700 dark:hover:text-prosota-paper">
                          {formatLagDays(r.lag_hours, hoursPerDay)}
                        </button>
                      </td>
                      <td className="py-1 text-right">
                        <button onClick={() => onDelete(r.id)} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">✕</button>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {error && <div className="text-[11px] text-red-600 dark:text-red-400 mb-2">{error}</div>}
    </div>
  )
}

export function ActivityLogic({ activity, activities, relationships, calendars, onChange, onFocusActivity, ganttStyle }: Props) {
  const [addingPred, setAddingPred] = useState(false)
  const [addingSucc, setAddingSucc] = useState(false)
  const [candidateId, setCandidateId] = useState('')
  const [relType, setRelType] = useState<RelationshipType>('FS')
  const [lagDays, setLagDays] = useState('0')
  const [addError, setAddError] = useState<string | null>(null)

  const calendarLookup = useMemo(() => buildCalendarLookup(calendars), [calendars])
  const hoursPerDay = resolveHoursPerDay(activity, calendarLookup)
  const activitiesById = new Map(activities.map(a => [a.id, a]))
  const predecessors = relationships.filter(r => r.successor_id === activity.id)
  const successors = relationships.filter(r => r.predecessor_id === activity.id)
  const candidates = activities.filter(a => a.id !== activity.id)
  // Scrolls the picker to roughly the current activity's own position
  // rather than starting at the very top of a 100+ row project (2026-07-06,
  // per Maro: a predecessor/successor is usually nearby in the WBS, not at
  // the top).
  const scrollToId = nearestOtherActivityId(activities, activity.id, new Set([activity.id]))
  // A WBS/Project summary row's sequencing is a rollup from its own children
  // — the backend rejects linking one in as a predecessor/successor outright
  // (2026-07-06, per Maro), so there's no point offering the add controls.
  const isParent = activity.activity_type === 'wbs_summary'

  const resetAddForm = () => {
    setAddingPred(false)
    setAddingSucc(false)
    setCandidateId('')
    setRelType('FS')
    setLagDays('0')
    setAddError(null)
  }

  const handleAdd = async (mode: 'predecessor' | 'successor') => {
    if (!candidateId) return
    setAddError(null)
    const lagHours = (Number(lagDays) || 0) * hoursPerDay
    const payload = mode === 'predecessor'
      ? { predecessor_id: candidateId, successor_id: activity.id, relationship_type: relType, lag_hours: lagHours }
      : { predecessor_id: activity.id, successor_id: candidateId, relationship_type: relType, lag_hours: lagHours }
    try {
      await api.post('/api/v1/activity-relationships/', payload)
    } catch (err) {
      setAddError(apiErrorDetail(err) ?? 'Could not create that relationship.')
      return
    }
    resetAddForm()
    await onChange()
  }

  const handleUpdate = async (id: string, relationshipType: RelationshipType, lagHours: number) => {
    await api.patch(`/api/v1/activity-relationships/${id}`, { relationship_type: relationshipType, lag_hours: lagHours })
    await onChange()
  }

  const handleDelete = async (id: string) => {
    await api.delete(`/api/v1/activity-relationships/${id}`)
    await onChange()
  }

  const AddForm = ({ mode, onCancel }: { mode: 'predecessor' | 'successor'; onCancel: () => void }) => {
    // The successor for this link is always `activity` itself when adding a
    // predecessor (its milestone-ness, if any, is fixed); when adding a
    // successor instead, it's whichever candidate is currently picked, which
    // can change as the user browses the picker (2026-07-07, per Maro:
    // disable the relationship types that "depend on a finish date" — or a
    // start one — that a Start/Finish Milestone successor can't use, instead
    // of letting the request silently fail).
    const successorType = mode === 'predecessor' ? activity.activity_type : activitiesById.get(candidateId)?.activity_type
    const validTypes = validRelationshipTypesFor(successorType)
    const restricted = validTypes.length < RELATIONSHIP_TYPES.length
    return (
    // A real <form>, not a <div> (2026-07-06, per Maro — Enter didn't apply
    // the change, only clicking Add did) — native Enter-submits-the-form
    // behaviour then just works from any field (the picker's own text input,
    // the lag number input) without wiring onKeyDown to each one individually.
    <form
      onSubmit={e => { e.preventDefault(); handleAdd(mode) }}
      className="flex items-center gap-2 mb-2 flex-wrap"
    >
      <ActivityPicker
        activities={candidates} value={candidateId} onChange={setCandidateId} scrollToId={scrollToId}
        showDates ganttStyle={ganttStyle} className="w-56"
      />
      <select
        value={relType}
        onChange={e => setRelType(e.target.value as RelationshipType)}
        title={restricted ? `Only ${validTypes.join('/')} can drive this milestone's own meaningful date` : undefined}
        className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1"
      >
        {RELATIONSHIP_TYPES.map(t => (
          <option key={t} value={t} disabled={!validTypes.includes(t)}>{t}</option>
        ))}
      </select>
      <input
        type="number"
        step={0.5}
        value={lagDays}
        onChange={e => setLagDays(e.target.value)}
        title="Lag (days) — positive = lag, negative = lead"
        className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1 w-16"
      />
      <button type="submit" className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80">Add</button>
      <button type="button" onClick={onCancel} className="text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">Cancel</button>
      {addError && <div className="text-[11px] text-red-600 dark:text-red-400 w-full">{addError}</div>}
    </form>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-6 px-4 py-4 bg-gray-50 dark:bg-prosota-panel2 border-t border-gray-100 dark:border-prosota-line text-xs">
      <div>
        <LinkTable
          title="Predecessors"
          rows={predecessors}
          otherIdField="predecessor_id"
          activitiesById={activitiesById}
          hoursPerDay={hoursPerDay}
          getSuccessorType={() => activity.activity_type}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onFocusActivity={onFocusActivity}
        />
        {isParent ? (
          <div className="text-[11px] text-gray-400 dark:text-prosota-muted">Not applicable to a WBS/Project summary — link its individual tasks/milestones instead.</div>
        ) : addingPred ? (
          <AddForm mode="predecessor" onCancel={resetAddForm} />
        ) : (
          <button onClick={() => setAddingPred(true)} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">
            + Add Predecessor
          </button>
        )}
      </div>
      <div>
        <LinkTable
          title="Successors"
          rows={successors}
          otherIdField="successor_id"
          activitiesById={activitiesById}
          hoursPerDay={hoursPerDay}
          getSuccessorType={r => activitiesById.get(r.successor_id)?.activity_type}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onFocusActivity={onFocusActivity}
        />
        {isParent ? (
          <div className="text-[11px] text-gray-400 dark:text-prosota-muted">Not applicable to a WBS/Project summary — link its individual tasks/milestones instead.</div>
        ) : addingSucc ? (
          <AddForm mode="successor" onCancel={resetAddForm} />
        ) : (
          <button onClick={() => setAddingSucc(true)} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">
            + Add Successor
          </button>
        )}
      </div>
    </div>
  )
}
