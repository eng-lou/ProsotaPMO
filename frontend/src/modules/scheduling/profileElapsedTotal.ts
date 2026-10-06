// Reconstruct period amounts when only a cumulative activity total is available.
// This is elapsed-calendar-time phasing, not a record of transactions or timesheets.
export function profileElapsedTotal(
  total: number, start: Date, finish: Date, dataDate: Date,
  buckets: { start: Date; end: Date }[],
): (number | null)[] {
  const from = start.getTime()
  const to = Math.min(finish.getTime(), dataDate.getTime())
  if (![total, from, to].every(Number.isFinite) || to < from) return buckets.map(() => null)
  return buckets.map(bucket => {
    const left = bucket.start.getTime(), right = bucket.end.getTime()
    if (to === from) return left <= from && from < right ? total : null
    const overlap = Math.max(0, Math.min(right, to) - Math.max(left, from))
    return overlap > 0 ? total * overlap / (to - from) : null
  })
}
