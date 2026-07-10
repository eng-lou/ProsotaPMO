import { Fragment, useEffect, useRef } from 'react'

interface Props {
  children: React.ReactNode[]
  ratios: number[]
  onRatiosChange: (ratios: number[]) => void
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
export function SplitRow({ children, ratios, onRatiosChange }: Props) {
  const count = children.length
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ratios.length !== count) onRatiosChange(Array(count).fill(1 / count))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, ratios.length])

  const startDrag = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const width = container.getBoundingClientRect().width
    const startX = e.clientX
    const startRatios = ratios

    const onMove = (moveEvent: MouseEvent) => {
      const deltaRatio = (moveEvent.clientX - startX) / width
      let left = startRatios[index] + deltaRatio
      let right = startRatios[index + 1] - deltaRatio
      if (left < MIN_RATIO) { right -= (MIN_RATIO - left); left = MIN_RATIO }
      if (right < MIN_RATIO) { left -= (MIN_RATIO - right); right = MIN_RATIO }
      const next = [...startRatios]
      next[index] = left
      next[index + 1] = right
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
    <div ref={containerRef} className="flex-1 flex min-w-0 min-h-0">
      {children.map((child, i) => (
        <Fragment key={i}>
          <div style={{ flex: `0 0 ${(ratios[i] ?? 1 / count) * 100}%` }} className="min-w-0 min-h-0 overflow-hidden flex flex-col">
            {child}
          </div>
          {i < count - 1 && (
            <div
              onMouseDown={startDrag(i)}
              title="Drag to resize"
              className="w-1.5 shrink-0 cursor-col-resize bg-gray-100 hover:bg-gray-300 active:bg-gray-400 transition-colors"
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}
