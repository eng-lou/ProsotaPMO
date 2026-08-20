import { api } from '@/lib/api'

// Frontend for site_context.py's backend — a project's real-world anchor
// for the 4D viewport's "Site Context" layer, Google Photorealistic 3D
// Tiles embedded as a real object in the main three.js viewport
// (2026-08-19 — a separate CesiumJS panel was tried and dropped, see
// site_context.py's model docstring for the full "why": it worked but had
// none of the main viewport's own tooling, a hard limit of two separate
// WebGL engines, not a missing feature). Real singleton like TimelineStrip/
// ProjectLetterhead: one row per project, GET/PUT only, no create/delete/
// list.
export interface SiteContext {
  // null = nothing saved yet for this project — getSiteContext still
  // returns a full object with real defaults in that case (never a 404).
  id: string | null
  project_id: string
  enabled: boolean
  lat: number | null
  lon: number | null
  label: string | null
  // Manual nudge on top of the tileset's own real-world recentre
  // (SiteTilesLayer.tsx) — local scene units/degrees, not a two-point
  // calibration. See site_context.py's own docstring for why.
  offset_x: number
  offset_y: number
  offset_z: number
  offset_yaw_deg: number
  scale: number
  created_at: string | null
  updated_at: string | null
}

export function hasAnchor(ctx: SiteContext): boolean {
  return ctx.lat !== null && ctx.lon !== null
}

export async function getSiteContext(projectId: string): Promise<SiteContext> {
  const res = await api.get<SiteContext>('/api/v1/site-context/', { params: { project_id: projectId } })
  return res.data
}

// PUT upserts the *whole* row — unlike RadialChart/Zone's own PATCH, there's
// no partial-update endpoint (a singleton's "update" is just "save the
// current full state again"), so callers always send every field.
export async function saveSiteContext(data: Omit<SiteContext, 'id' | 'created_at' | 'updated_at'>): Promise<SiteContext> {
  const res = await api.put<SiteContext>('/api/v1/site-context/', data)
  return res.data
}

// The app-level Google Maps Platform key (site_context.py's own
// GET/PUT /tiles-key) — fetched once per session, not baked into the
// frontend bundle. Editable straight from SiteContextPanel.tsx itself
// (2026-08-19, per Maro: editing backend/.env by hand "is not good" UX) —
// the saved-in-app value always wins over the .env-based fallback, see
// api/site_context.py's own GET handler for the precedence.
export async function getTilesApiKey(): Promise<string> {
  const res = await api.get<{ api_key: string }>('/api/v1/site-context/tiles-key')
  return res.data.api_key
}

export async function saveTilesApiKey(apiKey: string): Promise<string> {
  const res = await api.put<{ api_key: string }>('/api/v1/site-context/tiles-key', { api_key: apiKey })
  return res.data.api_key
}
