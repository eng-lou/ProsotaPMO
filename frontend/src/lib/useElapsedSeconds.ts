import { useEffect, useState } from 'react'

// Elapsed-time counter for a long-running, opaque request with no real
// progress data to report (2026-09-04, per Maro: "the import process and
// the promote to master schedule process takes quite a long time" — a
// plain static "Importing…"/"Promoting…" label gave no sense of whether
// anything was actually happening, which is exactly what made an earlier,
// genuinely slow promote look "stuck" — see backend/app/services/
// cost_sync.py:sync_cost_elements_from_resources_bulk's own header for the
// real backend cost that turned out to be). Ticks off wall-clock time via
// Date.now(), not a naive setInterval increment, so it can't drift from the
// tab being backgrounded/throttled. Resets to 0 the moment `active` goes
// false, so a second run of the same action starts counting fresh.
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const start = Date.now()
    setSeconds(0)
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(id)
  }, [active])
  return seconds
}
