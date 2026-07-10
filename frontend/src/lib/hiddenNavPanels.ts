// Which sidebar nav panels (Sidebar.tsx's own NAV list, keyed by route path)
// the user has chosen to hide (2026-07-10, per Maro: "give me a setting...
// to be able to hide panels, e.g. Controls Dashboard") — local/per-browser
// only, same Set+localStorage shape as ResourcesPrintTable
// (frontend/src/modules/scheduling/resourcesLayout.ts). Hiding a panel only
// removes it from the sidebar list; its route still works if visited
// directly, so nothing is actually lost by hiding one.
const STORAGE_KEY = 'prosota_hidden_nav_panels'

export function loadHiddenNavPanels(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

export function saveHiddenNavPanels(hidden: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden]))
}
