import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { TilesRenderer, TilesPlugin, TilesAttributionOverlay } from '3d-tiles-renderer/r3f'
import type { TilesRenderer as TilesRendererImpl } from '3d-tiles-renderer/three'
import { axisCorrectionRotation, type UpAxis } from './upAxis'
import type { SiteContext } from './siteContext'

interface Props {
  apiKey: string
  ctx: SiteContext
  upAxis: UpAxis
  // LOD/cache controls (2026-09-02, see viewerSettings.ts's own header on
  // tilesErrorTarget/tilesCacheSizeMb for the full "why") — passed straight
  // through to <TilesRenderer> below via its own dot-notation prop
  // convention (confirmed against the installed library's TilesRenderer.jsx
  // doc comment: "properties on the TilesRenderer instance can be set as
  // props using dot-notation for nested properties, e.g. lruCache-minSize").
  errorTarget: number
  cacheSizeMb: number
}

// Stands in for 3d-tiles-renderer/plugins' own GoogleCloudAuthPlugin
// (2026-08-19 workaround, per two real, sequential bugs Maro actually hit
// — read from this library's own source both times, not guessed):
//
// 1. Its "session token" bootstrap (core/plugins/auth/GoogleCloudAuth.js's
//    getSessionToken, walking the root tileset response for a content.uri
//    carrying a `session=` param via a stack-based traverseSet) throws —
//    "Cannot read properties of undefined (reading 'content')" — against
//    the real Google API in practice, and once that first parse fails,
//    sessionToken never gets set, so *every* later request re-enters the
//    same broken path and fails the same way, including binary .glb tiles.
// 2. Session tokens turned out NOT to be optional, though — dropping them
//    outright (this class's own first cut) fixed the crash but broke
//    actual tile loading: Google's tile-content (.glb) endpoint answers
//    `400 Bad Request` to key-only requests; only the tileset *structure*
//    (.json) endpoints tolerate a bare key. So the real fix is extracting
//    the session correctly, not skipping it.
//
// findSessionToken below does the same walk as the library's own
// getSessionToken, just recursively and null-safe instead of over a
// stack that can hold an undefined entry — the actual bug fix, not a
// workaround. Already on the latest published version of the library
// (0.5.1) — no upstream release with this fixed to pick up instead.
function findSessionToken(node: { content?: { uri?: string }; children?: unknown[] } | null | undefined): string | null {
  if (!node) return null
  if (node.content?.uri) {
    const queryIndex = node.content.uri.indexOf('?')
    if (queryIndex !== -1) {
      const session = new URLSearchParams(node.content.uri.slice(queryIndex + 1)).get('session')
      if (session) return session
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findSessionToken(child as typeof node)
      if (found) return found
    }
  }
  return null
}

class SimpleGoogleTilesAuthPlugin {
  private apiToken: string
  private sessionToken: string | null = null
  // Guards the session-extraction attempt to exactly once — checking
  // sessionAttempted rather than `sessionToken !== null` means a real
  // tileset that genuinely has no embedded session token (unlikely for
  // Google's own API, but not this class's assumption to bake in) doesn't
  // retry the parse on every single subsequent request the way the
  // original bug did.
  private sessionAttempted = false

  constructor({ apiToken }: { apiToken: string }) {
    this.apiToken = apiToken
  }

  init(tiles: TilesRendererImpl) {
    // Same default-rootURL convenience the real GoogleCloudAuthPlugin
    // provides, so callers don't need their own `url` prop either.
    if ((tiles as unknown as { rootURL: string | null }).rootURL == null) {
      (tiles as unknown as { rootURL: string }).rootURL = 'https://tile.googleapis.com/v1/3dtiles/root.json'
    }
  }

  async fetchData(url: string, options: RequestInit) {
    const fetchUrl = new URL(url)
    fetchUrl.searchParams.set('key', this.apiToken)
    if (this.sessionToken) fetchUrl.searchParams.set('session', this.sessionToken)

    const res = await fetch(fetchUrl.toString(), options)

    if (!this.sessionAttempted) {
      this.sessionAttempted = true
      // res.clone() — the root tileset response body can only be read
      // once; loadRootTileset() (TilesRendererBase.js) still needs to
      // read the *original* res.json() itself right after this returns,
      // so this reads its own copy rather than consuming the one the
      // caller needs.
      if (res.ok) {
        try {
          const json = await res.clone().json()
          this.sessionToken = findSessionToken(json.root)
        } catch {
          // Not JSON (this "first" request wasn't actually the root
          // tileset for some reason) — nothing to extract.
        }
      }
    }

    return res
  }

  // No per-tile copyright aggregation (the real plugin hooks
  // tile-visibility-change for that) — a fixed line satisfies Google's
  // attribution requirement without needing the part of the plugin that's
  // actually broken.
  getAttributions(target: { type: string; value: string; collapsible: boolean }[]) {
    target.push({ type: 'string', value: 'Google', collapsible: false })
  }
}

// Real-world Google Photorealistic 3D Tiles, embedded as a real object in
// the main viewport's own scene (2026-08-19, per Maro — replaces an
// earlier, now-deleted CesiumSitePane.tsx: that ran real CesiumJS but as a
// genuinely separate engine, so none of this viewport's own tooling
// (Select All/Isolate/Capture/Export Video) could reach it, a hard limit
// of two WebGL engines rather than a missing feature). Added as a sibling
// to Grid/ModelObjects inside Viewport3D.tsx's <Canvas> — same "each layer
// self-wraps in its own axis-correction group" convention every other
// layer there already follows.
//
// tiles.update()/setCamera()/setResolutionFromRenderer() are all handled
// internally by <TilesRenderer>'s own useFrame — it automatically respects
// whatever frameloop mode the parent <Canvas> is in, so this needs no
// separate `active` gating of its own.
export function SiteTilesLayer({ apiKey, ctx, upAxis, errorTarget, cacheSizeMb }: Props) {
  const [tiles, setTiles] = useState<TilesRendererImpl | null>(null)

  // Recentres the tileset's own root group so the saved lat/lon lands at
  // local (0,0,0) instead of the real ECEF distance from Earth's centre
  // (millions of units away) — the standard technique for placing a
  // globally-rooted tileset near a point of interest. getEastNorthUpFrame
  // returns X=East, Y=North, Z=Up (NOT three.js's native Y-up — see its
  // own doc comment in Ellipsoid.js), inverted so world-space ECEF maps
  // to this local ENU frame; matrixAutoUpdate = false so three.js never
  // overwrites it from position/rotation/scale, which this group
  // deliberately never sets. Uses tiles.ellipsoid (not a fresh WGS84
  // instance) since a tileset's own `3DTILES_ellipsoid` extension can
  // override it — re-applied on 'load-tileset' for exactly that case,
  // same pattern 3d-tiles-renderer's own EastNorthUpFrame component uses
  // internally. getEastNorthUpFrame's third argument is real-world height
  // above the ellipsoid at that lat/lon (2026-08-30, per Maro: "add
  // elevation input" — previously always 0/sea level regardless of the
  // site's actual altitude).
  useEffect(() => {
    if (!tiles || ctx.lat === null || ctx.lon === null) return
    const lat = ctx.lat
    const lon = ctx.lon
    const elevation = ctx.elevation
    const recentre = () => {
      const matrix = new THREE.Matrix4()
      tiles.ellipsoid.getEastNorthUpFrame(
        THREE.MathUtils.degToRad(lat), THREE.MathUtils.degToRad(lon), elevation, matrix,
      )
      tiles.group.matrix.copy(matrix).invert()
      tiles.group.matrixAutoUpdate = false
      tiles.group.matrixWorldNeedsUpdate = true
    }
    recentre()
    tiles.addEventListener('load-tileset', recentre)
    // try/catch, not just a null-guard (2026-08-19 fix, per Maro's own
    // crash — "Cannot read properties of null (reading
    // 'removeEventListener')" on opening the Site Context panel):
    // StrictMode (main.tsx) deliberately mounts→cleans-up→remounts every
    // component once in dev to surface exactly this class of bug. Cleanup
    // order for this effect (declared in the *parent*, SiteTilesLayer) vs.
    // <TilesRenderer>'s own internal effect (declared in the *child*) puts
    // the child's cleanup first — which calls tiles.dispose() — so by the
    // time this cleanup runs, `tiles` is still a real object reference
    // (closures don't go null), but an already-disposed one. Whatever
    // internal state removeEventListener relies on post-dispose isn't
    // this component's concern to fix (that's 3d-tiles-renderer's own
    // internal lifecycle) — the object is being torn down regardless, so
    // best-effort unsubscribe and swallow the failure rather than crash
    // the whole 4D module over a listener that's about to be garbage
    // anyway.
    return () => {
      try {
        tiles.removeEventListener('load-tileset', recentre)
      } catch {
        // tiles already disposed by a StrictMode double-invoke — nothing
        // left to actually unsubscribe from.
      }
    }
  }, [tiles, ctx.lat, ctx.lon, ctx.elevation])

  if (ctx.lat === null || ctx.lon === null) return null

  const yawRad = THREE.MathUtils.degToRad(ctx.offset_yaw_deg)
  return (
    <group
      position={[ctx.offset_x, ctx.offset_y, ctx.offset_z]}
      rotation={upAxis === 'z' ? [0, 0, yawRad] : [0, yawRad, 0]}
      scale={[ctx.scale, ctx.scale, ctx.scale]}
    >
      <group rotation={axisCorrectionRotation('z', upAxis)}>
        <TilesRenderer
          ref={setTiles}
          errorTarget={errorTarget}
          lruCache-maxBytesSize={cacheSizeMb * 1024 * 1024}
          lruCache-minBytesSize={cacheSizeMb * 1024 * 1024 * 0.75}
        >
          <TilesPlugin plugin={SimpleGoogleTilesAuthPlugin} args={[{ apiToken: apiKey }]} />
          {/* Required, not decorative — Google's terms require on-screen
              attribution whenever their Photorealistic 3D Tiles are shown.
              Ships as a ready-made component (3d-tiles-renderer/r3f) that
              reads live attributions off the tiles renderer itself, unlike
              the deleted Cesium panel this replaced, no hand-built overlay
              needed this time. */}
          <TilesAttributionOverlay />
        </TilesRenderer>
      </group>
    </group>
  )
}
