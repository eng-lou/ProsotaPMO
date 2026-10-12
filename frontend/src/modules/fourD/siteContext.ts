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
  // Real-world height above the WGS84 ellipsoid, metres, at lat/lon — see
  // SiteTilesLayer.tsx's own recentre effect for where this actually feeds
  // in. Distinct from offset_z below, a manual local-scene-unit nudge on
  // top of that recentre, not a real-world value.
  elevation: number
  label: string | null
  // Manual nudge on top of the tileset's own real-world recentre
  // (SiteTilesLayer.tsx) — local scene units/degrees, not a two-point
  // calibration. See site_context.py's own docstring for why.
  offset_x: number
  offset_y: number
  offset_z: number
  offset_yaw_deg: number
  scale: number
  // Tile Cutout (2026-09-02, per Maro: "add a polygon like the zones but
  // this will allow me to actually clip the 3d tile so i can have my ifc
  // model or 3d in that space") — reuses an existing Zone's own footprint
  // (zones.ts) as the shape to cut out of the Site Context Tiles layer,
  // rather than a second, parallel polygon-drawing system. v1 scope,
  // deliberate (see site_context.py's own model docstring): exactly one
  // cutout Zone at a time, and its footprint must be convex — three.js
  // clipping can't express an arbitrary concave hole or more than one
  // independent cutout on the same material at once the way CesiumJS's
  // own ClippingPolygonCollection can. null = no cutout Zone selected.
  cutout_zone_id: string | null
  cutout_active: boolean
  created_at: string | null
  updated_at: string | null
}

export function hasAnchor(ctx: SiteContext): boolean {
  return ctx.lat !== null && ctx.lon !== null
}

// Accept decimal degrees, decimal degrees with a hemisphere, and DMS.
// Hemisphere-labelled pairs can be pasted into either coordinate field.
const COORDINATE_TOKEN = /([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]?\s*)?)?([NSEW])?/gi

type CoordinateAxis = 'lat' | 'lon'

function tokenValue(match: RegExpMatchArray, axis?: CoordinateAxis): number | null {
  const [, degrees, minutes, seconds, direction] = match
  const hemisphere = direction?.toUpperCase()
  if (axis === 'lat' && hemisphere && !'NS'.includes(hemisphere)) return null
  if (axis === 'lon' && hemisphere && !'EW'.includes(hemisphere)) return null
  const deg = Number(degrees), min = Number(minutes ?? 0), sec = Number(seconds ?? 0)
  if (min >= 60 || sec >= 60) return null
  const magnitude = Math.abs(deg) + min / 60 + sec / 3600
  const limit = axis === 'lat' || hemisphere === 'N' || hemisphere === 'S' ? 90 : 180
  if (!Number.isFinite(magnitude) || magnitude > limit) return null
  // Reject a negative sign that contradicts an explicit north/east direction.
  if (degrees.startsWith('-') && (hemisphere === 'N' || hemisphere === 'E')) return null
  const negative = degrees.startsWith('-') || hemisphere === 'S' || hemisphere === 'W'
  const value = negative ? -magnitude : magnitude
  return minutes === undefined ? value : Math.round(value * 1e6) / 1e6
}

export function parseCoordinate(raw: string, axis?: CoordinateAxis): number | null {
  const text = raw.trim()
  const matches = [...text.matchAll(COORDINATE_TOKEN)]
  if (matches.length !== 1 || matches[0][0].trim() !== text) return null
  return tokenValue(matches[0], axis)
}

export function parseCoordinatePair(raw: string): { lat: number; lon: number } | null {
  const matches = [...raw.matchAll(COORDINATE_TOKEN)]
  if (matches.length !== 2 || raw.replace(COORDINATE_TOKEN, '').replace(/[\s,;]/g, '') !== '') return null
  let lat: number | null = null
  let lon: number | null = null
  for (const match of matches) {
    const hemisphere = match[4]?.toUpperCase()
    if (hemisphere === 'N' || hemisphere === 'S') lat = tokenValue(match, 'lat')
    else if (hemisphere === 'E' || hemisphere === 'W') lon = tokenValue(match, 'lon')
  }
  return lat !== null && lon !== null ? { lat, lon } : null
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
