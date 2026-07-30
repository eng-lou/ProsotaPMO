import { useState } from 'react'

interface Props {
  errors: string[]
  onDismissOne: (index: number) => void
  onDismissAll: () => void
}

// Collapsed by default (2026-07-28, per Maro: "dont print that nonsense any
// more, its unsightly" — the previous version stacked one full-width red
// banner per failure, permanently, at the very top of the viewport; a
// batch import gone wrong could push several rows deep before the actual
// 3D view even started). A small badge in the toolbar row instead, same
// spot the old "⏳ Saving N models…" text lived — the count is still
// always visible (nothing's hidden), but the actual messages only take
// screen space when you click through to look at them.
export function ImportErrorsBadge({ errors, onDismissOne, onDismissAll }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (errors.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(v => !v)}
        title="Click for details"
        className="text-xs px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
      >
        ⚠ {errors.length} save issue{errors.length === 1 ? '' : 's'}
      </button>
      {expanded && (
        <div className="absolute z-20 top-full left-0 mt-1 w-96 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg p-2 space-y-1">
          {errors.map((message, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1">
              <span className="flex-1">{message}</span>
              <button onClick={() => onDismissOne(i)} title="Dismiss" className="text-red-400 hover:text-red-700 shrink-0">✕</button>
            </div>
          ))}
          {errors.length > 1 && (
            <button onClick={onDismissAll} className="text-xs text-gray-400 hover:text-gray-600">
              Dismiss all {errors.length}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
