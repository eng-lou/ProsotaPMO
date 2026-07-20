import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { GanttStyle } from '@/lib/ganttLayout'
import { ActivityPicker, nearestOtherActivityId } from './ActivityPicker'
import { buildCalendarLookup, resolveHoursPerDay } from './durationDisplay'
import {
  RELATIONSHIP_TYPES, RESOURCE_TYPE_LABELS,
  type Activity, type Calendar, type Resource, type RelationshipType, type ResourceAssignment, type ResourceType,
} from './types'

export type BulkAssignMode = 'predecessor' | 'successor' | 'calendar' | 'resource' | 'unassign-resource' | 'move'

interface Props {
  mode: BulkAssignMode
  selectedActivities: Activity[]
  allActivities: Activity[]
  calendars: Calendar[]
  resources: Resource[]
  // Only needed for 'unassign-resource' — which assignments exist on the
  // selected activities to remove (2026-07-08, per Maro: "an option to clear
  // assigned resources," mirroring the existing bulk-assign flow).
  resourceAssignments: ResourceAssignment[]
  onApplied: () => Promise<void>
  onClose: () => void
  // Same per-type row tint the main activity table / the per-row Add
  // Predecessor/Successor picker use (2026-07-06, per Maro — "what you've
  // done with pred/successor picker should apply to the common picker for
  // both pred/succ" here too).
  ganttStyle: GanttStyle
}

const MODE_LABEL: Record<BulkAssignMode, string> = {
  predecessor: 'Assign a common Predecessor',
  successor: 'Assign a common Successor',
  calendar: 'Assign a Calendar',
  resource: 'Assign a Resource',
  'unassign-resource': 'Unassign a Resource',
  move: 'Move to a new parent',
}

const MODE_ICON: Record<BulkAssignMode, string> = {
  predecessor: '🔗', successor: '🔗', calendar: '🔗', resource: '🔗', 'unassign-resource': '🗑️', move: '📦',
}

function isTimeBased(type: ResourceType): boolean {
  return type === 'labour' || type === 'equipment' || type === 'crew'
}

// Applies one relationship/calendar/resource choice across every checked activity in
// one go — the "bulk assign successors/predecessors/calendars/resources" Maro asked
// for, sitting next to the row-selection checkboxes. Each target gets its own
// request (no bulk endpoint on the backend), fired with allSettled so one already-
// linked/assigned row doesn't block the rest.
export function BulkAssignWidget({ mode, selectedActivities, allActivities, calendars, resources, resourceAssignments, onApplied, onClose, ganttStyle }: Props) {
  const [targetActivityId, setTargetActivityId] = useState('')
  const [relType, setRelType] = useState<RelationshipType>('FS')
  const [lagDays, setLagDays] = useState('0')
  const [calendarId, setCalendarId] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [role, setRole] = useState('')
  const [quantity, setQuantity] = useState('')
  const [utilisationPct, setUtilisationPct] = useState('100')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedIds = new Set(selectedActivities.map(a => a.id))
  const relationshipCandidates = allActivities.filter(a => !selectedIds.has(a.id))
  // Move target can't be a selected activity itself, nor a descendant of one
  // (2026-07-07, per Maro: "move parented activities into another activity
  // to become a parent") — either would ask the backend to make a subtree
  // its own descendant's child, a cycle. The backend's own _validate_no_cycle
  // (app/services/activity.py) rejects this too, so this is a UX nicety (not
  // offering an invalid pick at all) rather than the only guard.
  const isDescendantOfSelected = (a: Activity): boolean => {
    let current = a
    while (current.parent_id) {
      const parent = allActivities.find(x => x.id === current.parent_id)
      if (!parent) return false
      if (selectedIds.has(parent.id)) return true
      current = parent
    }
    return false
  }
  const moveCandidates = allActivities.filter(a => !selectedIds.has(a.id) && !isDescendantOfSelected(a))
  const selectedResource = resources.find(r => r.id === resourceId) ?? null
  // Anchors the picker near the last (bottom-most, in outline order) checked
  // activity rather than the current selection value or the top of the list
  // — every checked activity is excluded from `relationshipCandidates`, not
  // just this one, so the nearest *pickable* neighbour may be more than one
  // row away (2026-07-06, per Maro).
  const lastChecked = selectedActivities[selectedActivities.length - 1]
  const scrollToId = nearestOtherActivityId(allActivities, lastChecked?.id, selectedIds)
  // Lag is collected in days (same convention as Duration, 2026-07-06 per
  // Maro), converted through the common predecessor/successor's own
  // resolved calendar — the one shared reference point across every
  // relationship this bulk-applies.
  const targetActivity = allActivities.find(a => a.id === targetActivityId)
  const calendarLookup = useMemo(() => buildCalendarLookup(calendars), [calendars])
  const hoursPerDay = targetActivity ? resolveHoursPerDay(targetActivity, calendarLookup) : 8

  // Empty resourceId = "All assigned resources" for this mode (2026-07-08, per
  // Maro) — unlike 'resource' mode, where empty means "not picked yet."
  const matchingAssignments = mode === 'unassign-resource'
    ? resourceAssignments.filter(ra => selectedIds.has(ra.activity_id) && (!resourceId || ra.resource_id === resourceId))
    : []

  const canApply =
    mode === 'predecessor' || mode === 'successor' || mode === 'move' ? targetActivityId !== ''
    : mode === 'calendar' ? true
    : mode === 'unassign-resource' ? matchingAssignments.length > 0
    : resourceId !== '' && !(selectedResource?.resource_type === 'material' && !quantity)

  const handleApply = async () => {
    if (mode === 'unassign-resource') {
      const resourceLabel = selectedResource ? selectedResource.name : 'all assigned resources'
      if (!(await confirmWithDontAsk(
        'scheduling.bulk-unassign-resource',
        `Remove ${matchingAssignments.length} resource assignment${matchingAssignments.length === 1 ? '' : 's'} `
        + `(${resourceLabel}) across ${selectedActivities.length} selected activit${selectedActivities.length === 1 ? 'y' : 'ies'}? `
        + `This can't be undone.`
      ))) return
      setApplying(true)
      setError(null)
      try {
        const results = await Promise.allSettled(matchingAssignments.map(ra => api.delete(`/api/v1/resource-assignments/${ra.id}`)))
        const failures = results.filter(r => r.status === 'rejected').length
        await onApplied()
        if (failures > 0) {
          setError(`${failures} of ${matchingAssignments.length} failed to remove — the rest were applied.`)
        } else {
          onClose()
        }
      } finally {
        setApplying(false)
      }
      return
    }

    setApplying(true)
    setError(null)
    try {
      const lagHours = (Number(lagDays) || 0) * hoursPerDay
      // For 'move' only, re-parent just the top-level checked activities — a
      // checked child of another checked activity already comes along with
      // its own (unmoved) parent; re-parenting it too would instead detach
      // it straight onto the target, breaking the subtree apart rather than
      // moving it as a whole (same "top-level only" precedent as
      // Scheduling.tsx's handleBulkDelete/handleBulkArchive).
      const targets = mode === 'move' ? selectedActivities.filter(a => !isDescendantOfSelected(a)) : selectedActivities
      const results = await Promise.allSettled(targets.map(async a => {
        if (mode === 'move') {
          await api.patch(`/api/v1/activities/${a.id}`, { parent_id: targetActivityId })
        } else if (mode === 'predecessor') {
          await api.post('/api/v1/activity-relationships/', {
            predecessor_id: targetActivityId, successor_id: a.id,
            relationship_type: relType, lag_hours: lagHours,
          })
        } else if (mode === 'successor') {
          await api.post('/api/v1/activity-relationships/', {
            predecessor_id: a.id, successor_id: targetActivityId,
            relationship_type: relType, lag_hours: lagHours,
          })
        } else if (mode === 'calendar') {
          await api.patch(`/api/v1/activities/${a.id}`, { calendar_id: calendarId || null })
        } else if (mode === 'resource' && selectedResource) {
          await api.post('/api/v1/resource-assignments/', {
            activity_id: a.id,
            resource_id: resourceId,
            role: role.trim() || null,
            quantity: selectedResource.resource_type === 'material' ? quantity : null,
            utilisation_pct: isTimeBased(selectedResource.resource_type) ? utilisationPct : null,
          })
        }
      }))
      const failures = results.filter(r => r.status === 'rejected').length
      await onApplied()
      if (failures > 0) {
        setError(
          mode === 'move'
            ? `${failures} of ${targets.length} failed (would create a cycle in the WBS) — the rest were applied.`
            : `${failures} of ${targets.length} failed (likely already linked/assigned) — the rest were applied.`
        )
      } else {
        onClose()
      }
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">{MODE_ICON[mode]}</span>
        <div className="font-bold text-sm">{MODE_LABEL[mode]}</div>
        <div className="text-xs text-gray-400">Applies to all {selectedActivities.length} selected activit{selectedActivities.length === 1 ? 'y' : 'ies'}</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <form
        onSubmit={e => { e.preventDefault(); handleApply() }}
        className="flex items-end gap-2 flex-wrap"
      >
        {mode === 'move' && (
          <label className="text-xs text-gray-600">
            New parent
            <ActivityPicker
              activities={moveCandidates} value={targetActivityId} onChange={setTargetActivityId}
              scrollToId={scrollToId} showDates ganttStyle={ganttStyle}
              className="mt-0.5 w-64"
            />
          </label>
        )}

        {(mode === 'predecessor' || mode === 'successor') && (
          <>
            <label className="text-xs text-gray-600">
              {mode === 'predecessor' ? 'Predecessor' : 'Successor'}
              <ActivityPicker
                activities={relationshipCandidates} value={targetActivityId} onChange={setTargetActivityId}
                scrollToId={scrollToId} showDates ganttStyle={ganttStyle}
                className="mt-0.5 w-64"
              />
            </label>
            <label className="text-xs text-gray-600">
              Type
              <select value={relType} onChange={e => setRelType(e.target.value as RelationshipType)} className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5">
                {RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Lag (d)
              <input
                type="number" step={0.5} value={lagDays} onChange={e => setLagDays(e.target.value)}
                title="Lag (days) — positive = lag, negative = lead"
                className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 w-16"
              />
            </label>
          </>
        )}

        {mode === 'calendar' && (
          <label className="text-xs text-gray-600">
            Calendar
            <select value={calendarId} onChange={e => setCalendarId(e.target.value)} className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 w-64">
              <option value="">Project default</option>
              {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}

        {mode === 'resource' && (
          <>
            <label className="text-xs text-gray-600">
              Resource
              <select value={resourceId} onChange={e => setResourceId(e.target.value)} className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 w-64">
                <option value="">Select resource…</option>
                {resources.map(r => <option key={r.id} value={r.id}>{r.name} ({RESOURCE_TYPE_LABELS[r.resource_type]}, £{r.rate}/{r.unit})</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Role
              <input value={role} onChange={e => setRole(e.target.value)} placeholder="Optional" className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 w-32" />
            </label>
            {selectedResource && isTimeBased(selectedResource.resource_type) && (
              <label className="text-xs text-gray-600">
                Utilisation
                <input
                  type="number" min={1} max={100} step={1}
                  value={utilisationPct} onChange={e => setUtilisationPct(e.target.value)}
                  className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 w-16"
                />%
              </label>
            )}
            {selectedResource && selectedResource.resource_type === 'material' && (
              <label className="text-xs text-gray-600">
                Qty ({selectedResource.unit})
                <input
                  type="number" min={0} step={0.01}
                  value={quantity} onChange={e => setQuantity(e.target.value)}
                  className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 w-24"
                />
              </label>
            )}
            {selectedResource && (selectedResource.resource_type === 'subcontractor' || selectedResource.resource_type === 'cost') && (
              <span className="text-xs text-gray-400 pb-1">Flat lump sum — no quantity needed</span>
            )}
          </>
        )}

        {mode === 'unassign-resource' && (
          <>
            <label className="text-xs text-gray-600">
              Resource to remove
              <select value={resourceId} onChange={e => setResourceId(e.target.value)} className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 w-64">
                <option value="">All assigned resources</option>
                {resources.map(r => <option key={r.id} value={r.id}>{r.name} ({RESOURCE_TYPE_LABELS[r.resource_type]})</option>)}
              </select>
            </label>
            <span className="text-xs text-gray-400 pb-1">
              {matchingAssignments.length} assignment{matchingAssignments.length === 1 ? '' : 's'} will be removed
            </span>
          </>
        )}

        <button
          type="submit"
          disabled={!canApply || applying}
          className={`text-xs px-3 py-1.5 rounded text-white disabled:opacity-40 disabled:cursor-not-allowed ${
            mode === 'unassign-resource' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {mode === 'unassign-resource'
            ? (applying ? 'Removing…' : `Remove ${matchingAssignments.length}`)
            : (applying ? 'Applying…' : `Apply to ${selectedActivities.length}`)}
        </button>
      </form>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
