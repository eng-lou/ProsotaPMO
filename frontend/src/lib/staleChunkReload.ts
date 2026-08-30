// Recovers from "Failed to fetch dynamically imported module" (2026-08-30,
// per Maro hitting this live on prosota.com right after several deploys in
// one session) — every route in App.tsx is React.lazy()-loaded, each its
// own JS chunk file named with a content hash (e.g. Scheduling-C_DviMBD.js).
// A deploy replaces those hashes; a browser tab that was already open
// *before* the deploy still has the *old* hashes baked into its already-
// loaded main bundle, so navigating to a route it hasn't loaded yet tries
// to fetch a chunk file the server no longer has — a real 404, not a bug
// in the route itself. React.lazy's import() rejects, which ErrorBoundary
// then (correctly, but unhelpfully here) catches as a generic render
// error. The fix isn't in the route code at all: reload the tab once to
// pick up the *current* build's own (correct) chunk hashes.
//
// Vite instruments every dynamic import for exactly this scenario and
// fires a `vite:preloadError` window event when one fails — the intended,
// documented hook for this (https://vitejs.dev/guide/build.html, "Load
// Error Handling"), more reliable than pattern-matching the thrown error's
// message text (which varies by browser: Chrome says "Failed to fetch
// dynamically imported module: ...", Firefox/Safari phrase it
// differently). ErrorBoundary.tsx also pattern-matches as a fallback, in
// case some future non-lazy dynamic import fails without going through
// Vite's own preload machinery.
//
// sessionStorage (not a plain in-memory flag) guards against a reload
// loop if the deploy is genuinely broken (a chunk that 404s even on a
// fresh load) — survives the reload itself, since a flag reset by the
// reload it's meant to gate would defeat the point; cleared per-tab by
// the browser closing, not persisted across sessions, so a later, working
// deploy gets a fresh attempt.
const RELOADED_FLAG = 'prosota-reloaded-after-stale-chunk'

export function isStaleChunkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(message)
}

// Shared by both recovery paths (the vite:preloadError listener below and
// ErrorBoundary.tsx's own fallback) so they share one guard flag — either
// one reloading marks the tab as "already tried," so the other doesn't
// also fire a second reload on top of it.
export function reloadOnceForStaleChunk(): boolean {
  if (sessionStorage.getItem(RELOADED_FLAG)) return false
  sessionStorage.setItem(RELOADED_FLAG, '1')
  window.location.reload()
  return true
}

export function installStaleChunkReload() {
  window.addEventListener('vite:preloadError', reloadOnceForStaleChunk)
}
