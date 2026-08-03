const PROBABILITY_LABELS = ['VL', 'L', 'M', 'H', 'VH'] // row 0 (bottom) -> row 4 (top)
const IMPACT_LABELS = ['N', 'L', 'M', 'H', 'C'] // col 0 (left) -> col 4 (right)

// 0-1 continuous value -> band index 0-4 (matches the prototype's 5-level scales).
function bandOf(value: number): number {
  return Math.min(4, Math.max(0, Math.floor(value * 5)))
}

// Severity 0 (safe, bottom-left) to 8 (severe, top-right) -> a red/amber/green cell colour,
// matching the prototype's heat matrix palette.
function cellColor(severity: number): string {
  if (severity <= 1) return 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
  if (severity <= 3) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400'
  if (severity <= 5) return 'bg-orange-200 text-orange-900 dark:bg-orange-500/25 dark:text-orange-300'
  if (severity <= 6) return 'bg-red-300 text-red-900 dark:bg-red-500/30 dark:text-red-300'
  return 'bg-red-600 text-white dark:bg-red-500'
}

interface HeatMatrixProps {
  probability: number | null
  impact: number | null
  label: string
}

// A real 5x5 probability/impact heat matrix, per the prototype's Qualitative
// Analysis tab. Highlights the cell corresponding to this risk's current position.
export function HeatMatrix({ probability, impact, label }: HeatMatrixProps) {
  const hasPosition = probability !== null && impact !== null
  const probBand = hasPosition ? bandOf(probability!) : null
  const impactBand = hasPosition ? bandOf(impact!) : null

  return (
    <div>
      <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-2">{label}</div>
      <div className="flex gap-1">
        <div className="flex flex-col justify-between text-[9px] font-semibold text-gray-400 dark:text-prosota-muted py-0.5">
          {[...PROBABILITY_LABELS].reverse().map(l => <div key={l} className="h-7 flex items-center">{l}</div>)}
        </div>
        <div className="grid grid-cols-5 gap-0.5">
          {[4, 3, 2, 1, 0].map(row =>
            IMPACT_LABELS.map((_, col) => {
              const isCurrent = probBand === row && impactBand === col
              return (
                <div
                  key={`${row}-${col}`}
                  className={`h-7 w-7 rounded flex items-center justify-center text-[10px] font-bold ${cellColor(row + col)} ${
                    isCurrent ? 'ring-2 ring-offset-1 ring-blue-600' : ''
                  }`}
                >
                  {isCurrent ? '★' : ''}
                </div>
              )
            })
          )}
        </div>
      </div>
      <div className="flex gap-1 mt-1 ml-4">
        {IMPACT_LABELS.map(l => <div key={l} className="h-3 w-7 flex items-center justify-center text-[9px] font-semibold text-gray-400 dark:text-prosota-muted">{l}</div>)}
      </div>
      {hasPosition ? (
        <p className="text-xs text-gray-500 dark:text-prosota-muted mt-1">
          Probability {PROBABILITY_LABELS[probBand!]} x Impact {IMPACT_LABELS[impactBand!]} = rating {(probability! * impact!).toFixed(2)}
        </p>
      ) : (
        <p className="text-xs text-gray-400 dark:text-prosota-muted mt-1">Not assessed yet.</p>
      )}
    </div>
  )
}
