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

// Coordinate parsing (2026-08-30, per Maro: "i need to also be able to
// input the lattitude/longitude in this format too 51°21'30.86"N
// 0°26'33.93"E") — the DMS (degrees/minutes/seconds) format Google Maps'
// own "Copy coordinates" produces, alongside the plain decimal degrees
// SiteContextPanel.tsx already accepted. A hemisphere letter (N/S/E/W) is
// what actually identifies which token is lat vs lon — not its position in
// the string — so parseCoordinatePair below works regardless of order.
const DMS_TOKEN = /(-?\d+(?:\.\d+)?)\s*°\s*(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)\s*(?:["″])?\s*([NSEWnsew])?/g

function dmsToDecimal(deg: number, min: number, sec: number, hemisphere?: string): number {
  const magnitude = Math.abs(deg) + min / 60 + sec / 3600
  const negative = deg < 0 || hemisphere === 'S' || hemisphere === 'W'
  // Rounded to ~0.1m precision — an unrounded deg+min/60+sec/3600 division
  // carries a long, meaningless-past-that-precision floating point tail.
  return Math.round((negative ? -magnitude : magnitude) * 1e6) / 1e6
}

// A single coordinate for one field: a plain decimal ("51.358572") or one
// full DMS token ("51°21'30.86"N"). Null if it's neither, whole-string only
// (no trailing junk) so a pasted pair doesn't half-parse as garbage here.
export function parseCoordinate(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  DMS_TOKEN.lastIndex = 0
  const match = DMS_TOKEN.exec(text)
  if (!match || match[0] !== text) return null
  const [, deg, min, sec, hemisphere] = match
  return dmsToDecimal(Number(deg), Number(min), Number(sec), hemisphere?.toUpperCase())
}

// A lat+lon pair pasted together into either field at once — the same
// convenience as pasting straight out of Google Maps without splitting it
// yourself first. Requires exactly two DMS tokens, one N/S and one E/W;
// anything else (plain decimals, a single token, three+ tokens) isn't a
// pair and is left to parseCoordinate/the caller instead.
export function parseCoordinatePair(raw: string): { lat: number; lon: number } | null {
  DMS_TOKEN.lastIndex = 0
  const matches = [...raw.matchAll(DMS_TOKEN)]
  if (matches.length !== 2) return null
  let lat: number | null = null
  let lon: number | null = null
  for (const [, deg, min, sec, hemisphereRaw] of matches) {
    const hemisphere = hemisphereRaw?.toUpperCase()
    const value = dmsToDecimal(Number(deg), Number(min), Number(sec), hemisphere)
    if (hemisphere === 'N' || hemisphere === 'S') lat = value
    else if (hemisphere === 'E' || hemisphere === 'W') lon = value
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
