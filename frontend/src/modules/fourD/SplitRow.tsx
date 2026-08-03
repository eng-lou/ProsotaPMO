import { Fragment, useEffect, useRef } from 'react'

interface Props {
  children: React.ReactNode[]
  ratios: number[]
  onRatiosChange: (ratios: number[]) => void
  // 'row' (default, every pre-existing call site) lays children out side
  // by side, dragging along X. 'column' (2026-08-03, for the multi-
  // viewport Compare Baseline generalization — Maro: "split into two up
  // and down") stacks them top to bottom, dragging along Y instead — same
  // ratio-state/MIN_RATIO drag math otherwise, just swapping which axis
  // the container flexes along and which mouse coordinate/container
  // dimension the drag reads.
  orientation?: 'row' | 'column'
}

const MIN_RATIO = 0.15

// Resizable horizontal split (2026-07-11, per Maro: "split the top for the
// schedule and gantt to share") — N windows sharing a dock (see FourD.tsx's
// windowDock) are laid out side by side here, starting at an equal share of
// the row's width, with a drag handle between every adjacent pair.
//
// Ratios are controlled (lifted to FourD.tsx, 2026-07-11) rather than local
// state — needed so a saved DockLayout (per Maro: "create different
// dockable layouts sizes etc.") can capture and restore them. Re-equalizes
// whenever the number of windows sharing this dock changes, since an N-1
// ratio set from before a window was added/removed doesn't map cleanly onto
// the new count.
//
// Drag math recomputes each pane's ratio from a fixed anchor
// (startRatios/startX captured once at mousedown) rather than incrementally
// adjusting from the previous frame — avoids compounding floating-point
// drift over a long drag.
export function SplitRow({ children, ratios, onRatiosChange, orientation = 'row' }: Props) {
  const count = children.length
  const containerRef = useRef<HTMLDivElement>(null)
  const isRow = orientation === 'row'

  useEffect(() => {
    if (ratios.length !== count) onRatiosChange(Array(count).fill(1 / count))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, ratios.length])

  const startDrag = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const extent = isRow ? rect.width : rect.height
    const startCoord = isRow ? e.clientX : e.clientY
    const startRatios = ratios

    const onMove = (moveEvent: MouseEvent) => {
      const coord = isRow ? moveEvent.clientX : moveEvent.clientY
      const deltaRatio = (coord - startCoord) / extent
      let before = startRatios[index] + deltaRatio
      let after = startRatios[index + 1] - deltaRatio
      if (before < MIN_RATIO) { after -= (MIN_RATIO - before); before = MIN_RATIO }
      if (after < MIN_RATIO) { before -= (MIN_RATIO - after); after = MIN_RATIO }
      const next = [...startRatios]
      next[index] = before
      next[index + 1] = after
      onRatiosChange(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (count === 0) return null

  return (
    <div ref={containerRef} className={`flex-1 flex min-w-0 min-h-0 ${isRow ? '' : 'flex-col'}`}>
      {children.map((child, i) => (
        <Fragment key={i}>
          <div style={{ flex: `0 0 ${(ratios[i] ?? 1 / count) * 100}%` }} className="min-w-0 min-h-0 overflow-hidden flex flex-col">
            {child}
          </div>
          {i < count - 1 && (
            <div
              onMouseDown={startDrag(i)}
              title="Drag to resize"
              className={isRow
                ? 'w-1.5 shrink-0 cursor-col-resize bg-gray-100 dark:bg-prosota-panel2 hover:bg-gray-300 dark:hover:bg-prosota-line active:bg-gray-400 dark:active:bg-prosota-azure/40 transition-colors'
                : 'h-1.5 shrink-0 cursor-row-resize bg-gray-100 dark:bg-prosota-panel2 hover:bg-gray-300 dark:hover:bg-prosota-line active:bg-gray-400 dark:active:bg-prosota-azure/40 transition-colors'}
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}
