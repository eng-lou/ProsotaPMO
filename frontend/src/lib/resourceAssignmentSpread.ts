import { useEffect, useState } from 'react'
import type { ResourceAssignment } from '@/modules/scheduling/types'
import { api } from './api'

export interface SpreadCell {
  assignment_id: string
  date: string
  hours: string
  is_override: boolean
}

export interface SpreadCapacityDay {
  date: string
  capacity: string
}

export interface ResourceSpread {
  days: SpreadCapacityDay[]
  cells: SpreadCell[]
}

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Day-by-day hours (override-or-default) for every Labour/Equipment
// assignment under one resource, plus that resource's own per-day capacity —
// backend deals purely in days (app/services/resource_assignment_spread.py);
// bucketing into whatever zoom the Resource Tracking spreadsheet is showing
// happens client-side, same as GanttChart's own zoom.
export function useResourceSpread(resourceId: string | undefined, start: Date, end: Date) {
  const [data, setData] = useState<ResourceSpread | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!resourceId) return
    setLoading(true)
    try {
      const { data: spread } = await api.get<ResourceSpread>('/api/v1/resource-assignment-spreads/', {
        params: { resource_id: resourceId, start: toDateOnly(start), end: toDateOnly(end) },
      })
      setData(spread)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, toDateOnly(start), toDateOnly(end)])

  return { data, loading, refetch: load }
}

// Editing a cell at any zoom — a single day, or a whole week/month/quarter/
// year — arrives here as one requested total for a date range; the backend
// evenly distributes it across the working days in that range, clipped to
// the assignment's own activity's *current* Start/Finish (2026-07-07, per
// Maro: cells are only editable where the resource is actively assigned).
export async function saveSpreadRange(
  resourceAssignmentId: string, periodStart: Date, periodEnd: Date, totalHours: number
): Promise<void> {
  await api.patch('/api/v1/resource-assignment-spreads/', {
    resource_assignment_id: resourceAssignmentId,
    period_start: toDateOnly(periodStart),
    period_end: toDateOnly(periodEnd),
    total_hours: totalHours,
  })
}

// Reconciles a (possibly hand-leveled) spread back into the existing
// utilisation_pct-driven cost formula and re-syncs the linked Cost Element's
// EVM figures — see app/services/resource_assignment_spread.py:recalculate_costs.
export async function recalculateCosts(resourceAssignmentId: string): Promise<ResourceAssignment> {
  const { data } = await api.post<ResourceAssignment>(`/api/v1/resource-assignment-spreads/${resourceAssignmentId}/recalculate-costs`)
  return data
}
