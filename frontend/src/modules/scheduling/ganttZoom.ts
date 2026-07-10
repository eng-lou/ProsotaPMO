// Gantt timescale zoom (2026-07-03, per Maro) — a view/navigation preference
// (like column widths), not a saved "theme" setting, so it lives in
// localStorage rather than the backend GanttLayout entity: switching zoom
// while looking at the chart shouldn't require saving/applying a layout.
export type GanttZoom = 'day' | 'week' | 'month' | 'quarter' | 'year'

export const ZOOM_OPTIONS: { value: GanttZoom; label: string }[] = [
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'quarter', label: 'Quarters' },
  { value: 'year', label: 'Years' },
]

// Pixels per calendar day at each zoom — shrinks as the timescale zooms out
// so a multi-year schedule doesn't render an unusably wide chart.
export const DAY_WIDTH_BY_ZOOM: Record<GanttZoom, number> = {
  day: 28,
  week: 14,
  month: 5,
  quarter: 2,
  year: 0.6,
}

const STORAGE_KEY = 'prosota_scheduling_gantt_zoom'

export function loadGanttZoom(): GanttZoom {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw && ZOOM_OPTIONS.some(o => o.value === raw) ? (raw as GanttZoom) : 'week'
}

export function saveGanttZoom(zoom: GanttZoom) {
  localStorage.setItem(STORAGE_KEY, zoom)
}

function mondayOnOrBefore(d: Date): Date {
  const result = new Date(d)
  const day = result.getDay()
  const diff = day === 0 ? 6 : day - 1
  result.setDate(result.getDate() - diff)
  return result
}

function quarterStart(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3) * 3
  return new Date(d.getFullYear(), q, 1)
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000
}

// Header tick marks for the current zoom — day: every day; week: every
// Monday (the original behaviour); month: the 1st of each month; quarter:
// each quarter start; year: 1 Jan.
export function computeTimeMarks(rangeStart: Date, totalDays: number, zoom: GanttZoom): { offset: number; label: string }[] {
  const marks: { offset: number; label: string }[] = []

  if (zoom === 'day') {
    for (let i = 0; i <= totalDays; i++) {
      const d = new Date(rangeStart)
      d.setDate(d.getDate() + i)
      marks.push({ offset: i, label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) })
    }
    return marks
  }

  if (zoom === 'week') {
    const cursor = mondayOnOrBefore(rangeStart)
    while (daysBetween(rangeStart, cursor) < totalDays) {
      marks.push({ offset: daysBetween(rangeStart, cursor), label: cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) })
      cursor.setDate(cursor.getDate() + 7)
    }
    return marks
  }

  if (zoom === 'month') {
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
    while (daysBetween(rangeStart, cursor) < totalDays) {
      marks.push({ offset: daysBetween(rangeStart, cursor), label: cursor.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return marks
  }

  if (zoom === 'quarter') {
    const cursor = quarterStart(rangeStart)
    while (daysBetween(rangeStart, cursor) < totalDays) {
      const q = Math.floor(cursor.getMonth() / 3) + 1
      marks.push({ offset: daysBetween(rangeStart, cursor), label: `Q${q} ${cursor.getFullYear()}` })
      cursor.setMonth(cursor.getMonth() + 3)
    }
    return marks
  }

  // year
  const cursor = new Date(rangeStart.getFullYear(), 0, 1)
  while (daysBetween(rangeStart, cursor) < totalDays) {
    marks.push({ offset: daysBetween(rangeStart, cursor), label: String(cursor.getFullYear()) })
    cursor.setFullYear(cursor.getFullYear() + 1)
  }
  return marks
}

// Discrete period start/end pairs between two dates at a given zoom — the
// Resource Tracking spreadsheet's own column boundaries (a literal <table>,
// unlike GanttChart's pixel-positioned bars) — same per-zoom cursor-advance
// rules as computeTimeMarks above (day/+1day, week/Monday+7, month/+1month,
// quarter/+3months, year/+1year), just returning [start, end) pairs instead
// of single tick offsets.
export function computePeriodBuckets(rangeStart: Date, rangeEnd: Date, zoom: GanttZoom): { start: Date; end: Date; label: string }[] {
  const buckets: { start: Date; end: Date; label: string }[] = []

  if (zoom === 'day') {
    const cursor = new Date(rangeStart)
    while (cursor < rangeEnd) {
      const end = new Date(cursor)
      end.setDate(end.getDate() + 1)
      buckets.push({ start: new Date(cursor), end, label: cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) })
      cursor.setDate(cursor.getDate() + 1)
    }
    return buckets
  }

  if (zoom === 'week') {
    const cursor = mondayOnOrBefore(rangeStart)
    while (cursor < rangeEnd) {
      const end = new Date(cursor)
      end.setDate(end.getDate() + 7)
      buckets.push({ start: new Date(cursor), end, label: cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) })
      cursor.setDate(cursor.getDate() + 7)
    }
    return buckets
  }

  if (zoom === 'month') {
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
    while (cursor < rangeEnd) {
      const end = new Date(cursor)
      end.setMonth(end.getMonth() + 1)
      buckets.push({ start: new Date(cursor), end, label: cursor.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return buckets
  }

  if (zoom === 'quarter') {
    const cursor = quarterStart(rangeStart)
    while (cursor < rangeEnd) {
      const end = new Date(cursor)
      end.setMonth(end.getMonth() + 3)
      const q = Math.floor(cursor.getMonth() / 3) + 1
      buckets.push({ start: new Date(cursor), end, label: `Q${q} ${cursor.getFullYear()}` })
      cursor.setMonth(cursor.getMonth() + 3)
    }
    return buckets
  }

  // year
  const cursor = new Date(rangeStart.getFullYear(), 0, 1)
  while (cursor < rangeEnd) {
    const end = new Date(cursor)
    end.setFullYear(end.getFullYear() + 1)
    buckets.push({ start: new Date(cursor), end, label: String(cursor.getFullYear()) })
    cursor.setFullYear(cursor.getFullYear() + 1)
  }
  return buckets
}
