import { GeographicContextPanel } from './GeographicContextPanel'
import type { useSiteScene } from './siteScene'
import { useEffect, useState } from 'react'
import { parseCoordinate, parseCoordinatePair, type SiteContext } from './siteContext'
import type { Zone } from './zones'
import type { UpAxis } from './upAxis'
import { isConvexPolygon } from './tileCutoutGeometry'

type SiteContextPatch = Partial<Pick<SiteContext,
  'enabled' | 'lat' | 'lon' | 'elevation' | 'label' | 'offset_x' | 'offset_y' | 'offset_z' | 'offset_yaw_deg' | 'scale'
  | 'cutout_zone_id' | 'cutout_active' | 'cutout_mode' | 'view_isolation'
>>

interface Props {
  onPlan?(action:'plan'|'capture'|'orbit'):void
  planArea?:import('./reconstructionPlan').ReconstructionArea|null
  onIsolateView(): void
  sceneState: ReturnType<typeof useSiteScene>
  ctx: SiteContext
  error: string | null
  apiKey: string | null
  onUpdate: (patch: SiteContextPatch) => void
  onSaveApiKey: (key: string) => Promise<void>
  // Tile Cutout (2026-09-02) — reuses an existing Zone's own footprint as
  // the shape to cut out of Site Context Tiles (see site_context.py's own
  // model docstring for the full "why", incl. the v1 convex-only/
  // single-cutout scope) rather than a second, parallel polygon-drawing
  // system.
  zones: Zone[]
  upAxis: UpAxis
}

// "Site Context" dockable panel — real-world Google Photorealistic 3D
// Tiles embedded in the main viewport (SiteTilesLayer.tsx). Same "single
// settings form, no create/delete/rename" shape as TimelineStripPanel.tsx
// (site_context.py's own docstring explains why: a project only ever has
// one real-world location).
//
// Numeric fields here are deliberately plain typed inputs, not a drag
// gizmo (2026-08-19, per the plan agreed with Maro) — a lower-risk v1
// than wiring the existing Move gizmo to a layer that isn't an "imported
// object." Worth revisiting only if nudging numbers turns out too fiddly
// in practice.
function formatCoord(v: number | null): string {
  return v === null ? '' : String(v)
}

export function SiteContextPanel({ ctx, error, apiKey, onUpdate, onSaveApiKey, zones, upAxis, onIsolateView, sceneState, onPlan, planArea }: Props) {
  const [keyDraft, setKeyDraft] = useState(apiKey ?? '')
  const [savingKey, setSavingKey] = useState(false)

  const handleSaveKey = async () => {
    setSavingKey(true)
    try {
      await onSaveApiKey(keyDraft.trim())
    } finally {
      setSavingKey(false)
    }
  }

  // Latitude/Longitude as free text, not a controlled `type="number"` bound
  // straight to ctx.lat/lon (2026-08-30, per Maro: "input the latitude/
  // longitude in this format too 51°21'30.86"N 0°26'33.93"E") — a DMS
  // string is several characters long and only parses once it's complete,
  // so a value bound directly to ctx (which only updates once a parse
  // actually succeeds) would snap back to the last valid number after every
  // keystroke that doesn't parse on its own, making it impossible to type
  // one at all. These drafts hold whatever's actually been typed; parsing
  // (parseCoordinate/parseCoordinatePair below) only happens on blur, once
  // there's a complete value to parse — not per keystroke like the rest of
  // this panel's plain numeric fields.
  const [latDraft, setLatDraft] = useState(() => formatCoord(ctx.lat))
  const [lonDraft, setLonDraft] = useState(() => formatCoord(ctx.lon))
  const [coordError, setCoordError] = useState<string | null>(null)
  useEffect(() => { setLatDraft(formatCoord(ctx.lat)) }, [ctx.lat])
  useEffect(() => { setLonDraft(formatCoord(ctx.lon)) }, [ctx.lon])

  // Elevation needs the same blur-committed draft as lat/lon above, for a
  // different reason (2026-08-30 fix, found live-testing "add elevation
  // input" itself) — every OTHER plain numeric field in this panel
  // (offset_x/y/z, rotation, scale) fires onUpdate on every keystroke via a
  // value bound straight to ctx, same as this field started out. That's
  // fine only because a human typing rarely outruns one save round-trip
  // per digit; typed fast enough (or against enough latency) that a
  // response for an early keystroke lands *after* a later one, its
  // now-stale ctx value re-renders the controlled input and truncates
  // whatever's been typed since — reproduced live typing "42.7" into
  // Elevation and getting "4". The other numeric fields below share this
  // same latent bug (pre-existing, not introduced here) but are out of
  // scope for this fix.
  const [elevDraft, setElevDraft] = useState(() => String(ctx.elevation))
  useEffect(() => { setElevDraft(String(ctx.elevation)) }, [ctx.elevation])
  const commitElevation = () => {
    const value = Number(elevDraft)
    if (elevDraft.trim() !== '' && Number.isFinite(value)) { onUpdate({ elevation: value }); setElevDraft(String(value)) }
    else setElevDraft(String(ctx.elevation))
  }

  // A pair pasted into either field sets both at once (matching how
  // Google Maps' own "Copy coordinates" gives you both together); a single
  // coordinate — DMS or plain decimal — sets just the field it was typed
  // into. Keep invalid drafts visible so the user can correct them.
  const commitLat = () => {
    setCoordError(null)
    const pair = parseCoordinatePair(latDraft)
    if (pair) { onUpdate({ lat: pair.lat, lon: pair.lon }); setLatDraft(formatCoord(pair.lat)); setLonDraft(formatCoord(pair.lon)); return }
    if (latDraft.trim() === '') { onUpdate({ lat: null }); return }
    const value = parseCoordinate(latDraft, 'lat')
    if (value !== null) { onUpdate({ lat: value }); setLatDraft(formatCoord(value)) }
    else setCoordError('Latitude: enter valid decimal degrees or DMS between -90 and 90.')
  }
  const commitLon = () => {
    setCoordError(null)
    const pair = parseCoordinatePair(lonDraft)
    if (pair) { onUpdate({ lat: pair.lat, lon: pair.lon }); setLatDraft(formatCoord(pair.lat)); setLonDraft(formatCoord(pair.lon)); return }
    if (lonDraft.trim() === '') { onUpdate({ lon: null }); return }
    const value = parseCoordinate(lonDraft, 'lon')
    if (value !== null) { onUpdate({ lon: value }); setLonDraft(formatCoord(value)) }
    else setCoordError('Longitude: enter valid decimal degrees or DMS between -180 and 180.')
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line sticky top-0 bg-white dark:bg-prosota-panel">
        <span className="text-xs text-gray-500 dark:text-prosota-muted">Site Context</span>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="px-3 py-2 space-y-1.5">
        <div className="space-y-1 bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">API Key</span>
            <input
              type="password" placeholder="AIza…" value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              autoComplete="off"
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <div className="flex items-center gap-2 pl-[86px]">
            <button
              onClick={handleSaveKey}
              disabled={savingKey || keyDraft === apiKey}
              className="text-[11px] px-2 py-0.5 rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {savingKey ? 'Saving…' : 'Save Key'}
            </button>
            {apiKey && <span className="text-[11px] text-gray-400 dark:text-prosota-muted">configured ✓</span>}
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500 dark:text-prosota-muted">
            <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">Get a Google Maps API key ↗</a>
            {' · '}
            <a href="https://developers.google.com/maps/documentation/tile/get-api-key" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">Setup guide ↗</a>
            <br />Enable billing and the Map Tiles API in your Google Cloud project for 3D site context.
          </p>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
          <input type="checkbox" checked={ctx.enabled} onChange={e => onUpdate({ enabled: e.target.checked })} />
          {ctx.view_isolation ? 'Show isolated Google tiles' : 'Show Google Tiles'}
        </label>
        {ctx.enabled && !apiKey && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">No Google Maps API key configured yet.</p>
        )}

        <div className="space-y-1 bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Label</span>
            <input
              type="text" placeholder="Site boundary" value={ctx.label ?? ''}
              onChange={e => onUpdate({ label: e.target.value === '' ? null : e.target.value })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Latitude</span>
            <input
              type="text" inputMode="decimal" placeholder={`51.358572 or 51°21'30.86"N`}
              value={latDraft}
              onChange={e => setLatDraft(e.target.value)}
              onBlur={commitLat}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Longitude</span>
            <input
              type="text" inputMode="decimal" placeholder={`0.442758 or 0°26'33.93"E`}
              value={lonDraft}
              onChange={e => setLonDraft(e.target.value)}
              onBlur={commitLon}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Elevation</span>
            <input
              type="number" step="any" value={elevDraft}
              onChange={e => setElevDraft(e.target.value)}
              onBlur={commitElevation}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
            <span className="text-gray-400 dark:text-prosota-muted">m</span>
          </label>
        </div>

        {coordError && <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">{coordError}</p>}
        <p className="text-[11px] text-gray-400 dark:text-prosota-muted">
          Decimal degrees such as 53.2907° N are accepted. The tiles land near the model automatically; nudge these until they line up. Either
          lat/lon field also accepts a full DMS pair pasted in one go — e.g.
          51°21'30.86"N 0°26'33.93"E. Elevation is real-world height above the ellipsoid, in
          metres — leave at 0 for sea level.
        </p>
        <div className="space-y-1 bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
          {(['offset_x', 'offset_y', 'offset_z'] as const).map((field, i) => (
            <label key={field} className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
              <span className="w-20 shrink-0">Offset {['X', 'Y', 'Z'][i]}</span>
              <input
                type="number" step={0.5} value={ctx[field]}
                onChange={e => onUpdate({ [field]: Number(e.target.value) } as SiteContextPatch)}
                className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
              />
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Rotation</span>
            <input
              type="number" step={1} value={ctx.offset_yaw_deg}
              onChange={e => onUpdate({ offset_yaw_deg: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
            <span className="text-gray-400 dark:text-prosota-muted">°</span>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Scale</span>
            <input
              type="number" step={0.01} min={0.01} value={ctx.scale}
              onChange={e => onUpdate({ scale: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
        </div>

        <div className="pt-2 mt-1 border-t border-gray-100 dark:border-prosota-line space-y-1.5">
          <div className="text-[10px] font-bold text-gray-400 dark:text-prosota-muted uppercase tracking-wide">Tile isolation / cutout</div>
          <p className="text-[11px] text-gray-400 dark:text-prosota-muted">
            Keep only the current camera frame or a convex Zone. The region stays fixed while you orbit. Live tiles still stream; no tile download is saved.
          </p>
          <div className="flex flex-wrap gap-1"><button className="rounded border p-1.5 dark:border-prosota-line" onClick={onIsolateView} disabled={!ctx.enabled}>Isolate current view</button><button className="rounded border p-1.5 dark:border-prosota-line" onClick={()=>onUpdate({enabled:true,view_isolation:null,cutout_active:false})}>Clear isolation / show all</button></div>
          {ctx.view_isolation && <p className="text-blue-500">{ctx.enabled ? 'Showing saved camera region.' : 'Tiles hidden. Your camera region is saved.'} Hide/show retains this frame. Clear isolation explicitly removes it.</p>}
          <label className="block text-xs">Zone operation<select className="w-full rounded border p-1 dark:bg-prosota-panel2" value={ctx.cutout_mode||'remove'} onChange={e=>onUpdate({cutout_mode:e.target.value as 'remove'|'isolate',view_isolation:null})}><option value="isolate">Keep inside zone</option><option value="remove">Remove inside zone</option></select></label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-20 shrink-0">Zone</span>
            <select
              value={ctx.cutout_zone_id ?? ''}
              onChange={e => onUpdate({ cutout_zone_id: e.target.value || null })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5 bg-white dark:bg-prosota-panel2"
            >
              <option value="">None</option>
              {zones.filter(z => z.shape === 'polygon').map(z => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </label>
          <label className={`flex items-center gap-1.5 text-[11px] ${ctx.cutout_zone_id ? 'text-gray-500 dark:text-prosota-muted' : 'text-gray-300 dark:text-prosota-line'}`}>
            <input
              type="checkbox"
              checked={ctx.cutout_active}
              disabled={!ctx.cutout_zone_id}
              onChange={e => onUpdate({ cutout_active: e.target.checked, view_isolation:null })}
            />
            Active
          </label>
          {(() => {
            const selectedZone = zones.find(z => z.id === ctx.cutout_zone_id)
            if (!selectedZone || !ctx.cutout_active) return null
            if (selectedZone.points.length < 3) {
              return <p className="text-[11px] text-amber-600 dark:text-amber-400">This Zone doesn't have enough points to form a shape yet.</p>
            }
            if (!isConvexPolygon(selectedZone.points, upAxis)) {
              return (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  "{selectedZone.name}" needs a simple convex outline with 3–64 points. Clipping is disabled for this shape; choose another Zone or isolate the camera view.
                </p>
              )
            }
            return null
          })()}
        </div>
        <GeographicContextPanel ctx={ctx} state={sceneState} upAxis={upAxis} onHideTiles={()=>onUpdate({enabled:false})} onShowTiles={()=>onUpdate({enabled:true})} onPlan={onPlan} planArea={planArea}/>
      </div>
    </div>
  )
}
