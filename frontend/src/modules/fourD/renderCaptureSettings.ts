// Capture/Export Video's own render settings (2026-07-11, per Maro: "give
// me the option to show hdr background when rendering/capturing" +
// resolution/duration/frame rate for both stills and video). Deliberately
// separate from ViewerSettings (viewerSettings.ts) — these describe what a
// captured/exported *output* should look like, independent of whatever the
// live viewport happens to be showing right now (e.g. HDR background
// hidden live for a cleaner working view, but wanted in the final render).
// Local/per-browser only, same load/save-to-localStorage convention as
// viewerSettings.ts.
export interface RenderCaptureSettings {
  // Overrides ViewerSettings.environmentBackground for the duration of a
  // capture/export only — Viewport3D.tsx forces the live <Environment>'s
  // own background prop to this value right before capturing, then reverts
  // it, the same "force a state, wait a few real frames, capture, revert"
  // pattern boostQuality already established.
  showHdrBackground: boolean
  // Multiplies Canvas's own dpr clamp (same mechanism boostQuality already
  // uses for its idle supersampling boost) — 2x/4x renders at a higher
  // internal resolution before the browser downsamples to the canvas's own
  // CSS size, a straightforward way to get a higher-resolution output
  // without a second offscreen render pass.
  resolutionMultiplier: 1 | 2 | 4
  videoDurationSec: number
  videoFps: number
}

export const DEFAULT_RENDER_CAPTURE_SETTINGS: RenderCaptureSettings = {
  showHdrBackground: true,
  resolutionMultiplier: 1,
  videoDurationSec: 8,
  videoFps: 30,
}

const STORAGE_KEY = 'prosota_4d_render_capture_settings'

export function loadRenderCaptureSettings(): RenderCaptureSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_RENDER_CAPTURE_SETTINGS, ...JSON.parse(raw) } : DEFAULT_RENDER_CAPTURE_SETTINGS
  } catch {
    return DEFAULT_RENDER_CAPTURE_SETTINGS
  }
}

export function saveRenderCaptureSettings(settings: RenderCaptureSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
