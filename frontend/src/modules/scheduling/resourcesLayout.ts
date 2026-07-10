import type { GanttFontFamily } from '@/lib/ganttLayout'

// Shared screen-display prefs across all three Resources-tab tables (Pool/
// Tracking/Profile) — local/session only (localStorage), not a backend-saved
// named-layout system like Scheduling's own GanttStyle (2026-07-08, per
// Maro: "lean v1"). headerColor is Resource Tracking's rollup-row
// background, previously hardcoded blue ("it should be editable in the
// layout/page setup").
export interface ResourcesLayoutPrefs {
  fontFamily: GanttFontFamily
  fontSize: number
  headerColor: string
}
export const DEFAULT_RESOURCES_LAYOUT: ResourcesLayoutPrefs = { fontFamily: 'sans', fontSize: 11, headerColor: '#1d4ed8' }

const LAYOUT_STORAGE_KEY = 'prosota_resources_layout'
export function loadResourcesLayout(): ResourcesLayoutPrefs {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    return raw ? { ...DEFAULT_RESOURCES_LAYOUT, ...JSON.parse(raw) } : DEFAULT_RESOURCES_LAYOUT
  } catch {
    return DEFAULT_RESOURCES_LAYOUT
  }
}
export function saveResourcesLayout(prefs: ResourcesLayoutPrefs) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs))
}

// Print-only font prefs (2026-07-08, per Maro: "I want it in the page setup
// but for print") — same screen/print split convention as GanttStyle vs
// ProjectLetterhead elsewhere, just local/session for this lean v1 rather
// than a new backend column.
export interface ResourcesPrintFontPrefs {
  fontFamily: GanttFontFamily
  fontSize: number
}
export const DEFAULT_RESOURCES_PRINT_FONTS: ResourcesPrintFontPrefs = { fontFamily: 'sans', fontSize: 9 }

const PRINT_FONTS_STORAGE_KEY = 'prosota_resources_print_fonts'
export function loadResourcesPrintFonts(): ResourcesPrintFontPrefs {
  try {
    const raw = localStorage.getItem(PRINT_FONTS_STORAGE_KEY)
    return raw ? { ...DEFAULT_RESOURCES_PRINT_FONTS, ...JSON.parse(raw) } : DEFAULT_RESOURCES_PRINT_FONTS
  } catch {
    return DEFAULT_RESOURCES_PRINT_FONTS
  }
}
export function saveResourcesPrintFonts(prefs: ResourcesPrintFontPrefs) {
  localStorage.setItem(PRINT_FONTS_STORAGE_KEY, JSON.stringify(prefs))
}

// Which of the three tables to include next time Print/Export runs
// (2026-07-08, per Maro: "a checkbox to choose what table to print or all
// three" / "give the option to export any of the three tables or all").
export type ResourcesPrintTable = 'pool' | 'tracking' | 'profile'
export const ALL_RESOURCES_PRINT_TABLES: ResourcesPrintTable[] = ['pool', 'tracking', 'profile']
export const RESOURCES_PRINT_TABLE_LABELS: Record<ResourcesPrintTable, string> = {
  pool: 'Resource Pool', tracking: 'Resource Tracking', profile: 'Resource Usage Profile',
}

// Shared print column geometry — Resource Tracking's period columns and
// Resource Usage Profile's chart bars must land under the same horizontal
// position when printed one after another (2026-07-09, per Maro: "the
// spreadsheet timeline position and the usage profile timeline chart should
// be aligned in the same horizontal axis... in print"). Both print views use
// these exact numbers instead of auto/content-driven widths.
// 460/60 (not the original 300/44) — too little room for the Activity Name,
// Start, and Finish columns, and for the period headers themselves (e.g.
// "Sept 2026"), all truncating to ellipsis or wrapping (2026-07-10 fix, per
// Maro: "not just the activity name column, the start, finish and the
// timescales").
export const PRINT_LEFT_PANE_WIDTH = 460
export const PRINT_PERIOD_COL_WIDTH = 60

// Resource Usage Profile's y-axis gutter (title + gridline value labels) —
// sits between the left resource table and the scrollable chart, both on
// screen and in print (2026-07-09, per Maro: "add y axis fields, e.g in x
// axis you have the time periods"). Resource Tracking reserves an identical
// blank column in the same spot so the two tables' period columns still
// land under each other despite Profile's own gutter.
export const RESOURCE_CHART_Y_AXIS_WIDTH = 40

const PRINT_TABLES_STORAGE_KEY = 'prosota_resources_print_tables'
export function loadResourcesPrintTables(): Set<ResourcesPrintTable> {
  try {
    const raw = localStorage.getItem(PRINT_TABLES_STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as ResourcesPrintTable[]) : new Set(ALL_RESOURCES_PRINT_TABLES)
  } catch {
    return new Set(ALL_RESOURCES_PRINT_TABLES)
  }
}
export function saveResourcesPrintTables(tables: Set<ResourcesPrintTable>) {
  localStorage.setItem(PRINT_TABLES_STORAGE_KEY, JSON.stringify([...tables]))
}
