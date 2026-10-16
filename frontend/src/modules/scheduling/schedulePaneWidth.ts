import { useLayoutEffect, useState } from 'react'

export const DEFAULT_SCHEDULE_TABLE_WIDTH = 700
export const MIN_GANTT_PANE_WIDTH = 240
export const SCHEDULE_DIVIDER_WIDTH = 6

export function clampScheduleTableWidth(preferred: number, containerWidth: number): number {
  const wanted = Number.isFinite(preferred) && preferred > 0 ? preferred : DEFAULT_SCHEDULE_TABLE_WIDTH
  const available = Math.max(0, Number.isFinite(containerWidth) ? containerWidth - SCHEDULE_DIVIDER_WIDTH : 0)
  // Keep a usable timeline, including on screens too narrow for both usual minimums.
  const maxTable = Math.max(0, available - Math.min(MIN_GANTT_PANE_WIDTH, available / 2))
  return Math.min(maxTable, Math.max(Math.min(320, maxTable), wanted))
}

/** Measure the actual split panel: the sidebar and embedded layouts consume viewport width. */
export function useSchedulePaneWidth(preferred: number) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [available, setAvailable] = useState(0)
  useLayoutEffect(() => {
    if (!container) return
    const measure = () => setAvailable(container.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])
  return { splitPaneRef: setContainer, tableWidth: clampScheduleTableWidth(preferred, available) }
}
