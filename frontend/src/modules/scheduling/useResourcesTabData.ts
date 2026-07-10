import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { toDateOnly, type ResourceSpread } from '@/lib/resourceAssignmentSpread'
import { computePeriodBuckets, type GanttZoom } from './ganttZoom'
import type { Activity, Resource, ResourceAssignment } from './types'

export interface AssignmentRow {
  assignment: ResourceAssignment
  activity: Activity
}

// Shared across Resource Tracking, Resource Usage Profile, and Print/Export
// (2026-07-08, per Maro: "full interactivity" + a unified Page Setup/Print/
// Export spanning all three tables) — one fetch per resource instead of each
// widget independently re-fetching the same spread data, and one shared
// zoom/date-range/selection so all three stay in sync.
export function useResourcesTabData(
  resources: Resource[], resourceAssignments: ResourceAssignment[], activities: Activity[],
  selectedResourceIds: Set<string>, zoom: GanttZoom, rangeStartOverride: Date | null, rangeEndOverride: Date | null,
) {
  const [spreadByResource, setSpreadByResource] = useState<Map<string, ResourceSpread>>(new Map())
  const [loading, setLoading] = useState(true)

  const activitiesById = useMemo(() => new Map(activities.map(a => [a.id, a])), [activities])

  const trackedResources = useMemo(
    () => resources.filter(r =>
      (r.resource_type === 'labour' || r.resource_type === 'equipment' || r.resource_type === 'crew')
      && resourceAssignments.some(a => a.resource_id === r.id)
      && (selectedResourceIds.size === 0 || selectedResourceIds.has(r.id))
    ),
    [resources, resourceAssignments, selectedResourceIds]
  )

  // Base grouping only (no sort/filter) — Resource Tracking applies its own
  // sort on top of this; Profile just sums it as-is.
  const assignmentsByResource = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>()
    for (const assignment of resourceAssignments) {
      const activity = activitiesById.get(assignment.activity_id)
      if (!activity || activity.start == null || activity.finish == null) continue
      const list = map.get(assignment.resource_id) ?? []
      list.push({ assignment, activity })
      map.set(assignment.resource_id, list)
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => (a.activity.start ?? '').localeCompare(b.activity.start ?? ''))
    }
    return map
  }, [resourceAssignments, activitiesById])

  const autoRange = useMemo(() => {
    const dates = [...assignmentsByResource.values()]
      .flat()
      .flatMap(({ activity }) => [activity.start, activity.finish])
      .filter((v): v is string => v != null)
      .map(v => new Date(v))
    const today = new Date()
    if (dates.length === 0) {
      const end = new Date(today)
      end.setDate(end.getDate() + 30)
      return { start: today, end }
    }
    const min = new Date(Math.min(...dates.map(d => d.getTime())))
    const max = new Date(Math.max(...dates.map(d => d.getTime())))
    min.setDate(min.getDate() - 7)
    max.setDate(max.getDate() + 7)
    return { start: min, end: max }
  }, [assignmentsByResource])

  const rangeStart = rangeStartOverride ?? autoRange.start
  const rangeEnd = rangeEndOverride ?? autoRange.end

  const buckets = useMemo(() => computePeriodBuckets(rangeStart, rangeEnd, zoom), [rangeStart, rangeEnd, zoom])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (trackedResources.length === 0) {
        setSpreadByResource(new Map())
        setLoading(false)
        return
      }
      setLoading(true)
      const entries = await Promise.all(trackedResources.map(async r => {
        const { data } = await api.get<ResourceSpread>('/api/v1/resource-assignment-spreads/', {
          params: { resource_id: r.id, start: toDateOnly(rangeStart), end: toDateOnly(rangeEnd) },
        })
        return [r.id, data] as const
      }))
      if (!cancelled) {
        setSpreadByResource(new Map(entries))
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedResources.map(r => r.id).join(','), toDateOnly(rangeStart), toDateOnly(rangeEnd)])

  const refetchResource = async (resourceId: string) => {
    const { data } = await api.get<ResourceSpread>('/api/v1/resource-assignment-spreads/', {
      params: { resource_id: resourceId, start: toDateOnly(rangeStart), end: toDateOnly(rangeEnd) },
    })
    setSpreadByResource(prev => new Map(prev).set(resourceId, data))
  }

  return {
    trackedResources, assignmentsByResource, rangeStart, rangeEnd, buckets,
    spreadByResource, loading, refetchResource,
  }
}

export function indexSpread(spread: ResourceSpread | undefined) {
  const hoursByAssignmentDate = new Map<string, { hours: number; isOverride: boolean }>()
  const capacityByDate = new Map<string, number>()
  if (!spread) return { hoursByAssignmentDate, capacityByDate }
  for (const cell of spread.cells) {
    hoursByAssignmentDate.set(`${cell.assignment_id}:${cell.date}`, { hours: Number(cell.hours), isOverride: cell.is_override })
  }
  for (const day of spread.days) {
    capacityByDate.set(day.date, Number(day.capacity))
  }
  return { hoursByAssignmentDate, capacityByDate }
}

export function eachDate(start: Date, end: Date): string[] {
  const dates: string[] = []
  const cur = new Date(start)
  while (cur < end) {
    dates.push(toDateOnly(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// Same conversion basis as ResourceTrackingWidget's own toDisplay (2026-07-10,
// per Maro: "show as costs... assuming cost per resources are populated") —
// each resource's own max_hours_per_day/rate, not a calendar, so Hours/Days/
// Cost stay arithmetically consistent with each other and with the spread's
// own demand basis. Applied per-resource *before* summing into a shared bar,
// since Profile aggregates across resources that can have different rates.
export function usageUnitFactor(resource: Resource, unit: 'hours' | 'days' | 'cost'): number {
  const maxHoursPerDay = Number(resource.max_hours_per_day) || 8
  if (unit === 'days') return 1 / maxHoursPerDay
  if (unit === 'cost') return Number(resource.rate) / maxHoursPerDay
  return 1
}

// Resource Usage Profile's bar/limit data — shared by the screen widget and
// its print view so the "has actuals -> green, overallocated -> red"
// colouring logic can't drift between the two (2026-07-08, per Maro).
export function computeUsageProfileBars(
  trackedResources: Resource[], assignmentsByResource: Map<string, AssignmentRow[]>,
  buckets: { start: Date; end: Date; label: string }[], spreadByResource: Map<string, ResourceSpread>,
  selectedActivityIds: Set<string>, unit: 'hours' | 'days' | 'cost' = 'hours',
): { barValues: number[]; hasActuals: boolean[]; limitValue: number } {
  const scopedRows = trackedResources.flatMap(r => assignmentsByResource.get(r.id) ?? [])
    .filter(row => selectedActivityIds.size === 0 || selectedActivityIds.has(row.activity.id))

  const bars = buckets.map(() => 0)
  const actualFlags = buckets.map(() => false)
  for (const resource of trackedResources) {
    const spread = spreadByResource.get(resource.id)
    if (!spread) continue
    const factor = usageUnitFactor(resource, unit)
    const { hoursByAssignmentDate } = indexSpread(spread)
    const rows = (assignmentsByResource.get(resource.id) ?? []).filter(row => scopedRows.includes(row))
    buckets.forEach((bucket, i) => {
      for (const d of eachDate(bucket.start, bucket.end)) {
        for (const row of rows) {
          const hours = hoursByAssignmentDate.get(`${row.assignment.id}:${d}`)?.hours ?? 0
          if (hours > 0) {
            bars[i] += hours * factor
            if (row.activity.ac !== null) actualFlags[i] = true
          }
        }
      }
    })
  }
  let maxCapacity = 0
  for (const bucket of buckets) {
    let capacity = 0
    for (const resource of trackedResources) {
      const spread = spreadByResource.get(resource.id)
      if (!spread) continue
      const factor = usageUnitFactor(resource, unit)
      const capacityByDate = new Map(spread.days.map(d => [d.date, Number(d.capacity)]))
      for (const d of eachDate(bucket.start, bucket.end)) {
        capacity += (capacityByDate.get(d) ?? 0) * factor
      }
    }
    maxCapacity = Math.max(maxCapacity, capacity)
  }
  return { barValues: bars, hasActuals: actualFlags, limitValue: maxCapacity }
}
