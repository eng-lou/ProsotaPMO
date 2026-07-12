// Real, working controls only (2026-07-10, per Maro: "based on the 3d
// capabilities") — trimmed from the full Navisworks reference screenshot to
// what's actually controllable given what's built: no appearance
// profiles/baselines/date-colouring/legend yet, those need a schedule-
// linkage data model that doesn't exist. Local/per-browser only, same
// load/save-to-localStorage convention as resourcesLayout.ts.
// 2026-07-11, per Maro comparing this app's render modes against Synchro's
// own Wireframe/Hidden Line/Flat Shaded/Gouraud Shaded/Phong Shaded/Iray
// dropdown (see renderModeMaterials.ts's own header for exactly how each is
// achieved, and why true path-traced Iray-equivalent rendering isn't in
// scope). Phong Shaded was tried and dropped same-day, per Maro: "leave
// wireframe, hidden line, flat shaded and gouraud" — Gouraud alone already
// covers "a non-PBR lighting model," so the extra Phong variant wasn't
// worth the added complexity. 'shaded' — this app's original, only-ever
// mode — is now the PBR tier ("Rendered" in the UI label), kept as the
// string literal 'shaded' rather than renamed, so an existing
// localStorage-persisted ViewerSettings from before this change still
// resolves to a valid value with no migration needed.
export type RenderMode = 'wireframe' | 'hiddenLine' | 'flat' | 'gouraud' | 'shaded'

export interface ViewerSettings {
  renderMode: RenderMode
  fieldOfView: number
  // Blender's View tab "Clip Start"/"Clip End" (2026-07-11, per Maro) — the
  // camera's near/far planes; anything closer than clipStart or farther
  // than clipEnd isn't rendered. Defaults wide (0.1–10000) for BIM/site-
  // scale models spanning centimetres to kilometres; tighten clipStart to
  // inspect fine detail up close without near-plane clipping, or shrink
  // clipEnd for better depth-buffer precision on a small model.
  clipStart: number
  clipEnd: number
  showFaces: boolean
  showEdges: boolean
  showGrid: boolean
  showAxisIndicator: boolean
  shadows: boolean
  // Ambient occlusion (2026-07-09, per Maro — N8AO via
  // @react-three/postprocessing, chosen over hand-rolling SSAO: mature,
  // actively maintained, same pmndrs family as drei, already a dependency
  // here). Off by default, same caution as shadows above — a real GPU
  // cost worth opting into deliberately rather than surprising someone on
  // a large BIM model.
  ambientOcclusion: boolean
  // Blender's "Scene World" checkbox equivalent (2026-07-11, per Maro: "see
  // the sky as well from the added HDR"). Defaults on — Viewport3D.tsx's
  // DEFAULT_ENVIRONMENT_URL is an actual outdoor sky (a self-hosted HDR,
  // per Maro: "copy and save it in our files for default load out"), so
  // showing it as the backdrop is the right out-of-the-box look, unlike
  // the earlier "apartment" CDN preset (an indoor scene) this replaced.
  environmentBackground: boolean
  // Blender is Z-up; three.js (and every GLTF/OBJ/FBX import) is natively
  // Y-up (2026-07-08, per Maro: "the axis differs from blender... swap y
  // and z... make sure z up is the default"). See upAxis.ts for exactly how
  // the swap is applied. Defaults to 'z' per that instruction; 'y' is kept
  // as an option for anyone who'd rather match three.js/glTF's own native
  // convention.
  upAxis: 'y' | 'z'
  // Schedule variance colour-coding (2026-07-12, per Maro: "Colour coded
  // elements by variance" — 4D-native use of the Scheduling module's
  // already-existing baseline/variance feature, Activity.variance_days,
  // set once a baseline is assigned). Off by default, same "real GPU/visual
  // cost worth opting into deliberately" caution as shadows/AO above — a
  // model with no baseline assigned yet would just render everything
  // untinted regardless, but the toggle itself should still default off so
  // it doesn't surprise someone the first time a baseline does exist.
  showVarianceColors: boolean
  // Clash Detective (2026-07-12, per Maro's Navisworks reference
  // screenshot) — same "off by default" reasoning as showVarianceColors
  // just above.
  showClashColors: boolean
}

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  renderMode: 'shaded',
  fieldOfView: 35,
  clipStart: 0.1,
  clipEnd: 10000,
  showFaces: true,
  showEdges: false,
  showGrid: true,
  showAxisIndicator: true,
  shadows: false,
  ambientOcclusion: false,
  environmentBackground: true,
  upAxis: 'z',
  showVarianceColors: false,
  showClashColors: false,
}

const STORAGE_KEY = 'prosota_4d_viewer_settings'

export function loadViewerSettings(): ViewerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_VIEWER_SETTINGS, ...JSON.parse(raw) } : DEFAULT_VIEWER_SETTINGS
  } catch {
    return DEFAULT_VIEWER_SETTINGS
  }
}

export function saveViewerSettings(settings: ViewerSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
