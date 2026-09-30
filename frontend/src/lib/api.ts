import axios from 'axios'

// Every call site already includes the full `/api/v1/...` path itself
// (e.g. api.get('/api/v1/projects/')) — VITE_API_URL only ever needs to
// supply whatever comes *before* that, not a prefix. Local dev's own
// frontend/.env sets it to the full http://localhost:8000 origin; a
// same-domain deploy (frontend + backend behind one vercel.json rewrite,
// backend mounted at /api) needs no prefix at all, so the empty-string
// default here — not 'http://localhost:8000' — is what's actually correct
// for that case: '' + '/api/v1/projects/' resolves relative to the
// current origin, matching the rewrite; the old default caused an
// accidental /api/api/v1/... double-prefix in production the one time
// VITE_API_URL got set to '/api' to try to fix this the wrong way.
// timeout (2026-09-16, per Maro: on a work laptop, every module except
// FourD was stuck on its "Loading…" state forever) — every other module's
// data fetch is the same hand-rolled `api.get(...).then(setData).finally(()
// => setLoading(false))` shape (Overview.tsx, Scheduling.tsx, CostPlan.tsx,
// RiskRegister.tsx, IcdTracker.tsx and 50+ more call sites), almost none of
// which attach a `.catch()`. Axios had no timeout at all, so a request that
// never gets a response — not a 404, not a 500, just a connection some
// network intermediary (a corporate proxy doing TLS inspection, in the
// case that surfaced this) holds open without ever delivering a response —
// left that promise permanently unsettled: `.then` never runs, but neither
// does `.finally`, so `loading` never flips back to false and the screen
// is stuck on its loading state with no error, no retry, forever. FourD
// wasn't affected by the same failure mode because its initial mount
// doesn't fire this kind of request burst the way Dashboard's ~45 widgets
// or Scheduling's own initial loads do. A real ceiling here doesn't fix
// *why* a given request stalls, but it guarantees every one of those
// `.finally()` calls actually fires within a bounded time, so the UI can
// recover (or at least go blank/erroring) instead of hanging indefinitely
// — a real fix belongs in each call site's own error handling, but this is
// the one change that protects all 200+ of them at once.
const REQUEST_TIMEOUT_MS = 25_000

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  timeout: REQUEST_TIMEOUT_MS,
})

// Large file downloads (2026-09-30, per Maro: "reloading models is still a
// very big issue... a few always gets left out" — two ~100MB+ IFC files
// failed every reload with "timeout of 25000ms exceeded"). REQUEST_TIMEOUT_MS
// above is a *total* ceiling, which is right for a JSON call but wrong for a
// big blob: a healthy download that's simply still transferring (several
// models are fetched in parallel on restore, sharing the bandwidth) got
// killed mid-stream. This swaps the total ceiling for a stall watchdog —
// the request only aborts if no bytes arrive for STALL_TIMEOUT_MS, which
// still protects against the never-responding-connection case the global
// timeout exists for, without capping how long a real transfer may take.
const STALL_TIMEOUT_MS = 60_000

export async function downloadLargeBlob(url: string): Promise<Blob> {
  const controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
  const resetWatchdog = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
  }
  try {
    const res = await api.get<Blob>(url, {
      responseType: 'blob',
      timeout: 0,
      signal: controller.signal,
      onDownloadProgress: resetWatchdog,
    })
    return res.data
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`download stalled — no data received for ${STALL_TIMEOUT_MS / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
