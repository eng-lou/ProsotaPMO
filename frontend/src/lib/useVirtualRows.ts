import { useLayoutEffect, useState, type RefObject } from 'react'

// Fixed-height lists: update at most once per frame, including programmatic
// scrolling and dock/viewport resizes. No trailing debounce/blank scroll gaps.
export function useVirtualRows(ref: RefObject<HTMLElement>, count: number, rowHeight: number, offset = 0, enabled = true) {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 30) })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    let frame = 0
    const measure = () => {
      frame = 0
      const maxTop = Math.max(0, offset + count * rowHeight - element.clientHeight)
      const top = Math.min(element.scrollTop, maxTop)
      if (element.scrollTop > maxTop) element.scrollTop = maxTop
      const start = Math.max(0, Math.floor((top - offset) / rowHeight) - 8)
      const end = Math.min(count, Math.ceil((top + element.clientHeight - offset) / rowHeight) + 8)
      setRange(prev => prev.start === start && prev.end === end ? prev : { start, end })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    element.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      element.removeEventListener('scroll', schedule)
    }
  }, [ref, count, rowHeight, offset, enabled])
  const end = Math.min(count, range.end)
  return { start: Math.min(range.start, end), end }
}
