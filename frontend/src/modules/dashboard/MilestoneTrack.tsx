import type { MilestoneTimelineItem } from './types'

function formatDate(value: string | null) {
  if (value === null) return '—'
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatTick(t: number) {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

// Delayed (variance_days > 0) beats critical, same bucket precedence
// Dashboard.tsx/dashboard.py already use for Schedule Performance — a
// milestone that's both late and on the critical path reads as "late," not
// "at risk of becoming late."
function statusColor(m: MilestoneTimelineItem): string {
  if (m.variance_days !== null && m.variance_days > 0) return '#dc2626'
  if (m.is_critical) return '#d97706'
  return '#16a34a'
}

interface MilestoneTrackProps {
  milestones: MilestoneTimelineItem[]
}

const TICK_COUNT = 6

// A real interval timeline — a dated axis with regular tick marks running
// underneath (per Maro: "single line is stupid, timeline intervalled with
// points is better"), not just a bare line connecting two dots. Milestones
// sit above the axis, positioned by real date; calendar ticks sit below it,
// so the two never collide regardless of how few milestones there are.
export function MilestoneTrack({ milestones }: MilestoneTrackProps) {
  const dated = milestones.filter(m => m.finish !== null)

  if (dated.length === 0) {
    return <div className="text-xs text-gray-400 dark:text-prosota-muted py-8 text-center">No milestones yet.</div>
  }

  const times = dated.map(m => new Date(m.finish!).getTime())
  const rawMin = Math.min(...times)
  const rawMax = Math.max(...times)
  const rawSpan = rawMax - rawMin || 1000 * 60 * 60 * 24 * 30 // a single milestone gets a fake 30-day span to sit inside

  // Pad 8% either side so a milestone never sits exactly on the axis's own edge.
  const pad = rawSpan * 0.08
  const minTime = rawMin - pad
  const maxTime = rawMax + pad
  const span = maxTime - minTime

  const positionOf = (t: number) => ((t - minTime) / span) * 100

  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => minTime + (span * i) / (TICK_COUNT - 1))

  return (
    <div className="relative pt-16 pb-12" style={{ minHeight: 190 }}>
      <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-200" />

      {/* Calendar interval ticks — below the axis, purely a scale reference.
          Anchored at the axis's own vertical centre (top-1/2, zero-height
          wrapper) rather than translated onto it, same "position by anchor,
          not by straddling the line" fix as the milestones below. */}
      {ticks.map((t, i) => (
        <div key={i} className="absolute top-1/2" style={{ left: `${positionOf(t)}%` }}>
          <span className="absolute top-2 left-1/2 -translate-x-1/2 block w-px h-3 bg-gray-300" />
          <div className="absolute top-7 left-1/2 -translate-x-1/2 text-[10px] text-gray-400 dark:text-prosota-muted whitespace-nowrap">
            {formatTick(t)}
          </div>
        </div>
      ))}

      {/* Milestones — above the axis, positioned by real date. The dot sits
          a clear 12px above the line (not straddling it) and the label a
          further clear gap above the dot — per Maro: "milestone points and
          texts are close to the line". Anchored at the axis's own vertical
          centre (a zero-height wrapper, same trick as the ticks above) with
          bottom-offset children stacking upward from there, rather than
          translating the dot onto the line and eyeballing the label's own
          offset from it. */}
      {dated.map(m => {
        const left = positionOf(new Date(m.finish!).getTime())
        return (
          <div key={m.id} className="absolute top-1/2" style={{ left: `${left}%`, transform: 'translateX(-50%)' }}>
            <span
              className="absolute bottom-3 left-1/2 -translate-x-1/2 block w-3 h-3 rounded-full ring-2 ring-white"
              style={{ backgroundColor: statusColor(m) }}
              title={m.task_name}
            />
            <div className="absolute bottom-9 w-max max-w-[140px] text-center left-1/2 -translate-x-1/2 text-xs">
              <div className="text-gray-700 dark:text-prosota-muted font-medium leading-tight">{m.task_name}</div>
              <div className="text-gray-400 dark:text-prosota-muted mt-0.5">{formatDate(m.finish)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
