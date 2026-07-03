import { useState } from 'react'
import { api } from '@/lib/api'
import {
  RELATIONSHIP_TYPES, RESOURCE_TYPE_LABELS,
  type Activity, type Calendar, type Resource, type RelationshipType, type ResourceType,
} from './types'

export type BulkAssignMode = 'predecessor' | 'successor' | 'calendar' | 'resource'

interface Props {
  mode: BulkAssignMode
  selectedActivities: Activity[]
  allActivities: Activity[]
  calendars: Calendar[]
  resources: Resource[]
  onApplied: () => Promise<void>
  onClose: () => void
}

const MODE_LABEL: Record<BulkAssignMode, string> = {
  predecessor: 'Assign a common Predecessor',
  successor: 'Assign a common Successor',
  calendar: 'Assign a Calendar',
  resource: 'Assign a Resource',
}

function isTimeBased(type: ResourceType): boolean {
  return type === 'labour' || type === 'equipment'
}

// Applies one relationship/calendar/resource choice across every checked activity in
// one go — the "bulk assign successors/predecessors/calendars/resources" Maro asked
// for, sitting next to the row-selection checkboxes. Each target gets its own
// request (no bulk endpoint on the backend), fired with allSettled so one already-
// linked/assigned row doesn't block the rest.
export function BulkAssignWidget({ mode, selectedActivities, allActivities, calendars, resources, onApplied, onClose }: Props) {
  const [targetActivityId, setTargetActivityId] = useState('')
  const [relType, setRelType] = useState<RelationshipType>('FS')
  const [lagHours, setLagHours] = useState('0')
  const [calendarId, setCalendarId] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [role, setRole] = useState('')
  const [quantity, setQuantity] = useState('')
  const [utilisationPct, setUtilisationPct] = useState('100')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedIds = new Set(selectedActivities.map(a => a.id))
  const relationshipCandidates = allActivities.filter(a => !selectedIds.has(a.id))
  const selectedResource = resources.find(r => r.id === resourceId) ?? null

  const canApply =
    mode === 'predecessor' || mode === 'successor' ? targetActivityId !== ''
    : mode === 'calendar' ? true
    : resourceId !== '' && !(selectedResource?.resource_type === 'material' && !quantity)

  const handleApply = async () => {
    setApplying(true)
    setError(null)
    try {
      const results = await Promise.allSettled(selectedActivities.map(async a => {
        if (mode === 'predecessor') {
          await api.post('/api/v1/activity-relationships/', {
            predecessor_id: targetActivityId, successor_id: a.id,
            relationship_type: relType, lag_hours: Number(lagHours) || 0,
          })
        } else if (mode === 'successor') {
          await api.post('/api/v1/activity-relationships/', {
            predecessor_id: a.id, successor_id: targetActivityId,
            relationship_type: relType, lag_hours: Number(lagHours) || 0,
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
        setError(`${failures} of ${selectedActivities.length} failed (likely already linked/assigned) — the rest were applied.`)
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
        <span className="text-lg">🔗</span>
        <div className="font-bold text-sm">{MODE_LABEL[mode]}</div>
        <div className="text-xs text-gray-400">Applies to all {selectedActivities.length} selected activit{selectedActivities.length === 1 ? 'y' : 'ies'}</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        {(mode === 'predecessor' || mode === 'successor') && (
          <>
            <label className="text-xs text-gray-600">
              {mode === 'predecessor' ? 'Predecessor' : 'Successor'}
              <select
                value={targetActivityId} onChange={e => setTargetActivityId(e.target.value)}
                className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 w-64"
              >
                <option value="">Select activity…</option>
                {relationshipCandidates.map(a => <option key={a.id} value={a.id}>{a.code}: {a.task_name}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Type
              <select value={relType} onChange={e => setRelType(e.target.value as RelationshipType)} className="block text-xs border border-gray-300 rounded px-2 py-1 mt-0.5">
                {RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Lag (h)
              <input
                type="number" value={lagHours} onChange={e => setLagHours(e.target.value)}
                title="Positive = lag, negative = lead"
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
            {selectedResource && selectedResource.resource_type === 'subcontractor' && (
              <span className="text-xs text-gray-400 pb-1">Flat lump sum — no quantity needed</span>
            )}
          </>
        )}

        <button
          onClick={handleApply}
          disabled={!canApply || applying}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {applying ? 'Applying…' : `Apply to ${selectedActivities.length}`}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
