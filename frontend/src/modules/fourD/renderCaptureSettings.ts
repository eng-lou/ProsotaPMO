// Capture/Export Video's own render settings (2026-07-11, per Maro: "give
// me the option to show hdr background when rendering/capturing" +
// resolution/duration/frame rate for both stills and video). Deliberately
// separate from ViewerSettings (viewerSettings.ts) — these describe what a
// captured/exported *output* should look like, independent of whatever the
// live viewport happens to be showing right now (e.g. HDR background
// hidden live for a cleaner working view, but wanted in the final render).
// Local/per-browser only, same load/save-to-localStorage convention as
// viewerSettings.ts.
export type ResolutionPreset = '720p' | '1080p' | '1440p' | '4kUHD' | '4kDCI' | 'custom'

// Modern/curated set (2026-07-25, confirmed with Maro over Blender's own
// literal preset list — legacy broadcast/NTSC-PAL formats aren't relevant
// to sharing a BIM sequence video via PowerPoint/web/social). 'custom' has
// no entry here — it means "whatever's currently in resolutionWidth/Height,
// not one of these."
export const RESOLUTION_PRESETS: Record<Exclude<ResolutionPreset, 'custom'>, { label: string; width: number; height: number }> = {
  '720p': { label: '720p HD', width: 1280, height: 720 },
  '1080p': { label: '1080p Full HD', width: 1920, height: 1080 },
  '1440p': { label: '1440p QHD', width: 2560, height: 1440 },
  '4kUHD': { label: '4K UHD', width: 3840, height: 2160 },
  '4kDCI': { label: '4K DCI', width: 4096, height: 2160 },
}

export interface RenderCaptureSettings {
  // Overrides ViewerSettings.environmentBackground for the duration of a
  // capture/export only — Viewport3D.tsx forces the live <Environment>'s
  // own background prop to this value right before capturing, then reverts
  // it, the same "force a state, wait a few real frames, capture, revert"
  // pattern boostQuality already established.
  showHdrBackground: boolean
  // Explicit output resolution (2026-07-25 rework, per Maro: "the
  // resolution options we have are very simplistic and insufficient
  // compared to blender" — the old `resolutionMultiplier: 1|2|4` just
  // boosted Canvas's own dpr clamp, so the actual output pixel size was
  // `(on-screen CSS width of the 3D pane) × devicePixelRatio × multiplier`
  // — entirely dependent on how big the browser window happened to be,
  // with no way to target a specific resolution the way Blender's Format
  // panel does). resolutionWidth/Height are the real target output pixel
  // dimensions now, independent of the live viewport's own on-screen
  // size — Viewport3D.tsx's handleCaptureImage/handleExportVideo always
  // composite into a canvas sized to exactly these dimensions (see
  // exportOverlays.ts's own computeExportLayout/drawCoverFit), cropping
  // rather than stretching the 3D content if the live pane's on-screen
  // aspect ratio doesn't match.
  resolutionWidth: number
  resolutionHeight: number
  // Which named preset (if any) resolutionWidth/Height currently match —
  // drives the popover's preset dropdown selection and which of
  // resolutionWidth/Height are shown as read-only vs freely editable.
  // 'custom' whenever the width/height fields have been hand-edited away
  // from a preset's own values, same "typing your own numbers silently
  // deselects the preset" behaviour as Blender's own Resolution X/Y.
  resolutionPreset: ResolutionPreset
  videoDurationSec: number
  videoFps: number
  // MP4 option (2026-07-25, per Maro: "can we get an mp4 rendering option"
  // — webm plays fine in a browser but isn't reliably accepted by
  // PowerPoint/Word/most phones/social platforms the way mp4 is). Chrome
  // (confirmed live via MediaRecorder.isTypeSupported) can record straight
  // to H.264/mp4 with zero new dependencies — same captureStream()+
  // MediaRecorder approach this file already uses for webm, just a
  // different mimeType — so this is a real encode, not a post-hoc
  // transcode. Defaults to 'mp4' since that's the actual ask; Viewport3D.tsx's
  // own handleExportVideo falls back to webm automatically if the running
  // browser's MediaRecorder can't do mp4 (Firefox, notably, as of this
  // writing) — see that function's own isTypeSupported check.
  videoFormat: 'mp4' | 'webm'
  // Include Baseline (2026-07-24, per Maro: "an option to include the
  // baseline 3d while capturing still and video. so side by side") —
  // composites the Baseline (planned) pane's own canvas alongside the
  // main viewport in the captured PNG/webm, matching the two-pane layout
  // already on screen while Compare Baseline is open. Silently has no
  // effect if Compare Baseline isn't open (nothing to composite) — see
  // Viewport3D.tsx's own compareBaselineOpen prop. Off by default, same
  // "opt in to the extra cost/output size" reasoning as resolutionWidth/Height.
  includeBaseline: boolean
  // Export Content overlays (2026-07-25, per Maro's Synchro "Export
  // Animation" reference: "gantt bar on top, activity table on the left...
  // appearance profile legend if set") — each independently opt-in, off by
  // default same as includeBaseline above. See exportOverlays.ts's own
  // header for why these are a purpose-built rendition rather than a
  // screenshot of the real GanttChart.tsx/ScheduleWindow.tsx windows.
  includeGanttChart: boolean
  includeActivityTable: boolean
  // Silently draws nothing with zero AnimationProfiles in the project
  // ("if set") — see exportOverlays.ts's own drawAppearanceLegend.
  includeAppearanceLegend: boolean
  includeDateOverlay: boolean
  // Radial Progress Charts (2026-07-31, per Maro: "this can be enabled in
  // the render/capture settings to be seen as well") — one master opt-in
  // switch, same "off by default, each individual item's own visibility
  // still gates it" convention as includeAppearanceLegend; a chart hidden
  // live (RadialChart.visible off) is never exported even with this on —
  // see exportOverlays.ts's own drawRadialChart/composeExportFrame.
  includeRadialCharts: boolean
  // Timeline Strip (2026-08-03) — same master opt-in switch shape as
  // includeRadialCharts just above; the strip's own `visible` still gates
  // it individually (a hidden-live strip is never exported even with this
  // on) — see exportOverlays.ts's own drawTimelineStrip/composeExportFrame.
  includeTimelineStrip: boolean
  // View titles (2026-07-25, per Maro: "add a title for both 3d views,
  // Current for the left and Baseline for the right, allow me to name the
  // titles") — always drawn when non-blank (not behind a separate on/off
  // toggle like the other overlays above: clearing the text is itself
  // "off"). mainViewTitle labels the primary viewport; baselineViewTitle
  // only ever actually appears when Include Baseline is also on, since
  // that's the only time there's a second view to label at all.
  mainViewTitle: string
  baselineViewTitle: string
  // Cost Profile (2026-07-25, per Maro: "include... the cost profile over
  // time at the bottom" — pointed at the Resource Usage tab's own "cost"
  // unit as the reference, not a bespoke calculation. See
  // exportOverlays.ts's own drawCostProfileChart header.
  includeCostProfile: boolean
  // Title/narrative block (2026-07-25, per Maro: "there's a corner at left
  // which is empty. Allow me to add a title (e.g project title) and a
  // description or narrative so i can utilise the space properly") — draws
  // into the corner left blank by Gantt Chart + Activity Table both being
  // on (see exportOverlays.ts's own computeExportLayout, titleBlockRect);
  // no separate on/off toggle, same "blank text = off" convention as the
  // view titles above.
  exportTitle: string
  exportNarrative: string
}

export const DEFAULT_RENDER_CAPTURE_SETTINGS: RenderCaptureSettings = {
  showHdrBackground: true,
  resolutionWidth: RESOLUTION_PRESETS['1080p'].width,
  resolutionHeight: RESOLUTION_PRESETS['1080p'].height,
  resolutionPreset: '1080p',
  videoDurationSec: 8,
  videoFps: 30,
  videoFormat: 'mp4',
  includeBaseline: false,
  includeGanttChart: false,
  includeActivityTable: false,
  includeAppearanceLegend: false,
  includeDateOverlay: false,
  includeRadialCharts: false,
  includeTimelineStrip: false,
  mainViewTitle: 'Current',
  baselineViewTitle: 'Baseline',
  includeCostProfile: false,
  exportTitle: '',
  exportNarrative: '',
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
