// Numeric inspectors need fresh values, not a rerender of the entire workspace
// for every animation frame. Keep a trailing update so the final pose is shown.
export function createFrameNotifier(notify: () => void, intervalMs = 100) {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => { timer = undefined; last = performance.now(); notify() }
  return {
    trigger() {
      const remaining = intervalMs - (performance.now() - last)
      if (remaining <= 0) {
        if (timer !== undefined) clearTimeout(timer)
        flush()
      } else if (timer === undefined) timer = setTimeout(flush, remaining)
    },
    dispose() { if (timer !== undefined) clearTimeout(timer); timer = undefined },
  }
}
