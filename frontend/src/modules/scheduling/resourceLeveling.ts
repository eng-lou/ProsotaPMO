import { api } from '@/lib/api'
import { toDateOnly, type ResourceSpread } from '@/lib/resourceAssignmentSpread'
import { buildCalendarLookup, resolveHoursPerDay } from './durationDisplay'
import { eachDate, indexSpread, type AssignmentRow } from './useResourcesTabData'
import type { Activity, Calendar, Resource, ResourceAssignment } from './types'

export type LevelingGranularity = 'resource' | 'activity'
export type LevelingMode = 'level' | 'smooth'

interface BucketRange { start: Date; end: Date; label: string }

// Every other constraint_date write in this app sends a naive local-time
// string with no 'Z'/offset (see ActivityForm.tsx's <input
// type="datetime-local"> values, which the backend stores/reads as naive
// datetimes throughout — app/models/activity.py's constraint_date column has
// no timezone). Date.toISOString() instead formats in UTC and appends 'Z',
// producing a timezone-*aware* datetime the moment Pydantic parses it —
// scheduling_cpm.py's constraint comparisons (`max(candidate, a.constraint_date)`)
// then crash with "can't compare offset-naive and offset-aware datetimes" as
// soon as they touch that freshly-set value (2026-08-29, per Maro: "I've not
// been successful at using [leveling] at all" — every Level/Smooth click hit
// this 500, and because it's an unhandled exception raised after
// CORSMiddleware's own response wrapper, the browser saw no CORS header on
// the error and reported it to axios as a bare "Network Error" that
// Scheduling.tsx's handler had no catch for — silent failure end to end).
function toNaiveDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export interface LevelingTarget {
  type: LevelingGranularity
  id: string
  resourceId: string
  label: string
}

function hoursInBucket(hoursByAssignmentDate: Map<string, { hours: number }>, assignmentId: string, bucket: BucketRange): number {
  return eachDate(bucket.start, bucket.end).reduce((sum, d) => sum + (hoursByAssignmentDate.get(`${assignmentId}:${d}`)?.hours ?? 0), 0)
}

function capacityInBucket(capacityByDate: Map<string, number>, bucket: BucketRange): number {
  return eachDate(bucket.start, bucket.end).reduce((sum, d) => sum + (capacityByDate.get(d) ?? 0), 0)
}

// Scans resources in the given order for the next one — or, at 'activity'
// granularity, the next specific contributing activity — with any period
// where demand exceeds capacity, skipping anything already in excludeIds
// (2026-07-09, per Maro: "find the overallocated resource, level it, then
// an option to find next overallocated, then level"). Pure/sync — reads
// whatever's already loaded in Resources tab state, no network calls, so
// it's cheap to call on every click.
export function findNextOverallocatedTarget(
  scopeResources: Resource[],
  granularity: LevelingGranularity,
  assignmentsByResource: Map<string, AssignmentRow[]>,
  buckets: BucketRange[],
  spreadByResource: Map<string, ResourceSpread>,
  excludeIds: Set<string>,
): LevelingTarget | null {
  for (const resource of scopeResources) {
    const spread = spreadByResource.get(resource.id)
    const rows = assignmentsByResource.get(resource.id) ?? []
    if (!spread || rows.length === 0) continue
    const { hoursByAssignmentDate, capacityByDate } = indexSpread(spread)

    const bucket = buckets.find(b => {
      const demand = rows.reduce((sum, row) => sum + hoursInBucket(hoursByAssignmentDate, row.assignment.id, b), 0)
      return demand > capacityInBucket(capacityByDate, b)
    })
    if (!bucket) continue

    if (granularity === 'resource') {
      if (excludeIds.has(resource.id)) continue
      return { type: 'resource', id: resource.id, resourceId: resource.id, label: resource.name }
    }
    const contributor = rows.find(row => !excludeIds.has(row.activity.id) && hoursInBucket(hoursByAssignmentDate, row.assignment.id, bucket) > 0)
    if (!contributor) continue
    return {
      type: 'activity', id: contributor.activity.id, resourceId: resource.id,
      label: `${contributor.activity.code} — ${contributor.activity.task_name} (${resource.name})`,
    }
  }
  return null
}

export interface LevelRunResult {
  movedActivityIds: string[]
  fullyResolved: boolean
  blockedByFloat: boolean
}

async function fetchActivities(projectId: string, schedulePeriodId: string): Promise<Activity[]> {
  const { data } = await api.get<Activity[]>('/api/v1/activities/', { params: { project_id: projectId, schedule_period_id: schedulePeriodId } })
  return data
}

async function fetchAssignments(schedulePeriodId: string): Promise<ResourceAssignment[]> {
  const { data } = await api.get<ResourceAssignment[]>('/api/v1/resource-assignments/', { params: { schedule_period_id: schedulePeriodId } })
  return data
}

async function fetchSpread(resourceId: string, rangeStart: Date, rangeEnd: Date): Promise<ResourceSpread> {
  const { data } = await api.get<ResourceSpread>('/api/v1/resource-assignment-spreads/', {
    params: { resource_id: resourceId, start: toDateOnly(rangeStart), end: toDateOnly(rangeEnd) },
  })
  return data
}

// Resolves one found target's own overallocation as far as it can, moving
// one contributing activity at a time (2026-07-09, per Maro's own
// leveling-vs-smoothing distinction):
//  - 'level' mode: delays a contributing activity — applies a "Start On or
//    After" constraint straight past the overallocated period — regardless
//    of its own float. The project end date and critical path can move as a
//    result, same as real resource leveling.
//  - 'smooth' mode: the same move is only made when the required delay fits
//    inside that activity's own total_float_hours (converted to days via
//    its calendar) — guarantees the project end date/critical path stay
//    put, same as real resource smoothing. If nothing left to move still
//    fits inside its float, stops and reports blockedByFloat so the caller
//    can suggest switching to Leveling for a full fix.
// Activities under a Mandatory Start/Finish constraint are never overridden
// — skipped as immovable, same as P6 treats them.
// Re-fetches activities/assignments/spread fresh from the server on every
// internal step (not the React state already in memory) since each move
// changes downstream dates/float via the backend's own CPM recompute —
// capped at 30 moves as a safety valve, not a tuned constant.
export async function levelTarget(
  target: LevelingTarget,
  mode: LevelingMode,
  projectId: string,
  schedulePeriodId: string,
  calendars: Calendar[],
  rangeStart: Date,
  rangeEnd: Date,
  buckets: BucketRange[],
): Promise<LevelRunResult> {
  const calendarLookup = buildCalendarLookup(calendars)
  const movedActivityIds: string[] = []
  let blockedByFloat = false

  for (let iter = 0; iter < 30; iter++) {
    const [activities, assignments, spread] = await Promise.all([
      fetchActivities(projectId, schedulePeriodId),
      fetchAssignments(schedulePeriodId),
      fetchSpread(target.resourceId, rangeStart, rangeEnd),
    ])
    const activitiesById = new Map(activities.map(a => [a.id, a]))
    const allRows: AssignmentRow[] = []
    for (const assignment of assignments) {
      if (assignment.resource_id !== target.resourceId) continue
      const activity = activitiesById.get(assignment.activity_id)
      if (!activity || activity.start == null || activity.finish == null) continue
      allRows.push({ assignment, activity })
    }
    const moveableRows = target.type === 'activity' ? allRows.filter(row => row.activity.id === target.id) : allRows

    const { hoursByAssignmentDate, capacityByDate } = indexSpread(spread)

    let moved = false
    for (const bucket of buckets) {
      const totalDemand = allRows.reduce((sum, row) => sum + hoursInBucket(hoursByAssignmentDate, row.assignment.id, bucket), 0)
      const capacity = capacityInBucket(capacityByDate, bucket)
      if (totalDemand <= capacity) continue

      // Prefer delaying whichever contributing activity has the most float —
      // the safest one to push, least likely to already be critical.
      const candidate = moveableRows
        .filter(row => hoursInBucket(hoursByAssignmentDate, row.assignment.id, bucket) > 0)
        .filter(row => row.activity.constraint_type !== 'ms' && row.activity.constraint_type !== 'mf')
        .sort((a, b) => Number(b.activity.total_float_hours ?? 0) - Number(a.activity.total_float_hours ?? 0))[0]
      if (!candidate) continue

      const newStart = new Date(bucket.end)
      const oldStart = new Date(candidate.activity.start as string)
      const requiredDelayDays = Math.round((newStart.getTime() - oldStart.getTime()) / 86_400_000)

      if (mode === 'smooth') {
        const hoursPerDay = resolveHoursPerDay(candidate.activity, calendarLookup)
        const floatDays = candidate.activity.total_float_hours != null ? Number(candidate.activity.total_float_hours) / hoursPerDay : 0
        if (requiredDelayDays > floatDays) { blockedByFloat = true; continue }
      }

      await api.patch(`/api/v1/activities/${candidate.activity.id}`, {
        constraint_type: 'snet', constraint_date: toNaiveDatetime(newStart),
      })
      movedActivityIds.push(candidate.activity.id)
      moved = true
      break
    }

    if (!moved) {
      const stillOverallocated = buckets.some(bucket => {
        const totalDemand = allRows.reduce((sum, row) => sum + hoursInBucket(hoursByAssignmentDate, row.assignment.id, bucket), 0)
        return totalDemand > capacityInBucket(capacityByDate, bucket)
      })
      return { movedActivityIds, fullyResolved: !stillOverallocated, blockedByFloat }
    }
  }
  return { movedActivityIds, fullyResolved: false, blockedByFloat }
}
