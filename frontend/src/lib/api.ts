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
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
})
