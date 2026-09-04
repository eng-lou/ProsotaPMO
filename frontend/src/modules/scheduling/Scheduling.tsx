import axios from 'axios'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { useProject } from '@/lib/ProjectContext'
import { useTheme } from '@/lib/ThemeContext'
import { groupAssignmentsByActivityId, resourceLabelForActivity } from '@/lib/resourceLabel'
import { activityRowBackground, FONT_FAMILY_CSS, useActiveGanttStyle, useGanttLayouts, type GanttFontFamily, type GanttStyle } from '@/lib/ganttLayout'
import { useProjectLetterhead } from '@/lib/letterhead'
import { evaluateFilter, useSchedulingFilters } from '@/lib/schedulingFilters'
import { useSchedulingHighlights } from '@/lib/schedulingHighlights'
import { useScheduleSubprojects } from '@/lib/scheduleSubprojects'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { useUserDefinedFieldDefinitions, useUserDefinedFieldValues } from '@/lib/userDefinedFields'
import { listModelElementLinks, type ModelElementLink } from '@/modules/fourD/modelElementLinks'
import { useAnimationProfiles } from '@/modules/fourD/animationProfiles'
import { buildResourceRecipe, type ResourceRecipeActivity } from '@/modules/fourD/scheduleGeneration'
import { LetterheadEditorWidget } from '@/components/LetterheadEditorWidget'
import { ReassessmentLog } from '@/components/ReassessmentLog'
import { ActivityForm, toActivityPayload, type ActivityFormValues } from './ActivityForm'
import { ActivityLogic } from './ActivityLogic'
import { ActivityStepsWidget } from './ActivityStepsWidget'
import { BaselineWidget } from './BaselineWidget'
import { BulkAssignWidget, type BulkAssignMode } from './BulkAssignWidget'
import { CalendarWidget } from './CalendarWidget'
import { CodeHistory } from './CodeHistory'
import { formatDateTime, toDatetimeLocalValue } from './dateTime'
import { buildCalendarLookup, formatFloatDays, resolveHoursPerDay } from './durationDisplay'
import { downloadActivitiesCsv } from './exportActivities'
import { downloadP6Xml } from './exportP6'
import { P6ImportDialog } from './P6ImportDialog'
import { GanttChart, GANTT_ROW_HEIGHT, HEADER_HEIGHT, type GanttChartHandle } from './GanttChart'
import { loadGanttZoom, saveGanttZoom, ZOOM_OPTIONS, type GanttZoom } from './ganttZoom'
import { LayoutWidget } from './LayoutWidget'
import { PasteFieldsWidget } from './PasteFieldsWidget'
import { ResourceAssignments } from './ResourceAssignments'
import { ResourcePoolWidget } from './ResourcePoolWidget'
import { ResourceTrackingWidget } from './ResourceTrackingWidget'
import { RESOURCE_USAGE_COLORS, ResourceUsageProfileWidget } from './ResourceUsageProfileWidget'
import { ResourcesPrintView } from './ResourcesPrintView'
import type { PrintResourceGroup } from './ResourceTrackingPrintView'
import {
  ALL_RESOURCES_PRINT_TABLES, DEFAULT_RESOURCES_LAYOUT, DEFAULT_RESOURCES_PRINT_FONTS, loadResourcesLayout,
  loadResourcesPrintFonts, loadResourcesPrintTables, RESOURCES_PRINT_TABLE_LABELS, saveResourcesLayout,
  saveResourcesPrintFonts, saveResourcesPrintTables, type ResourcesLayoutPrefs, type ResourcesPrintTable,
} from './resourcesLayout'
import { RescheduleWidget } from './RescheduleWidget'
import { SchedulingPrintView } from './SchedulingPrintView'
import { SchedulingFiltersWidget } from './SchedulingFiltersWidget'
import { SchedulingHighlightsWidget } from './SchedulingHighlightsWidget'
import { SchedulingQualityPrintView } from './SchedulingQualityPrintView'
import { SchedulingQualityWidget } from './SchedulingQualityWidget'
import { ScheduleVariantWidget } from './ScheduleVariantWidget'
import { SubProjectsWidget } from './SubProjectsWidget'
import { UdfCell } from './UdfCell'
import { UserDefinedFieldsWidget } from './UserDefinedFieldsWidget'
import {
  findNextOverallocatedTarget, levelTarget,
  type LevelingGranularity, type LevelingMode, type LevelingTarget,
} from './resourceLeveling'
import { computeUsageProfileBars, eachDate, indexSpread, usageUnitFactor, useResourcesTabData } from './useResourcesTabData'
import {
  ACTIVITY_TYPES, type Activity, type ActivityRelationship, type Calendar, type QualityReport, type Resource, type ResourceAssignment,
  type SchedulingFilter,
} from './types'

const PANE_MAX_HEIGHT = 600

export type ColumnKey =
  | 'code' | 'wbs' | 'type' | 'duration' | 'start' | 'bl_start' | 'finish' | 'bl_finish'
  | 'variance' | 'float' | 'critical' | 'free_float' | 'sub_float' | 'sub_critical' | 'pct_complete' | 'status' | 'resources'
  | 'bac' | 'pv' | 'ev' | 'ac' | 'cv' | 'sv' | 'cpi' | 'spi' | 'eac' | 'etc'
  | 'element_count' | 'elements' | 'animation_profile'

// Activity status (2026-09-03, per Maro: "we need an activity status
// field/column. Planned, In Progress, Suspended, Completed", then "obviously
// it needs to be editable" with a full worked spec, then, once built as a
// read/write VIEW onto % Complete/Actual Start-Finish/Suspend-Resume Date
// (no new stored field), "it needs a column on its own" — P6/MSP-style
// planners treat Status as the primary, independently-set fact (setting it
// DRIVES the dates), not something reverse-engineered from them on every
// read. `status` is now a real column (`Activity['status']`, backend
// app/models/activity.py) — this file only maps its snake_case wire values
// to the Title Case labels Maro's own words used for this column, and
// still doesn't touch the underlying fields directly: picking a value
// PATCHes `status` alone, and app/services/activity.py:_apply_status_change
// is what sets % Complete/Actual Start/Actual Finish/Suspend/Resume Date to
// match, in one place, for every caller (this grid, a future bulk edit, a
// P6 import), not just whichever frontend built the dropdown first. Still
// not a second, independently-drifting source of truth in the sense
// [[feedback_computed_fields]] warns against: a WBS/Project summary row's
// own status is a rollup from its children (backend _recompute_hierarchy),
// never independently settable there, same as its pct_complete/duration/
// finish. Milestones (zero duration) can only ever be Planned or
// Completed — enforced both here (the dropdown's own option list) and
// server-side.
export type ActivityStatus = 'Planned' | 'In Progress' | 'Suspended' | 'Completed'

const ACTIVITY_STATUS_LABELS: Record<Activity['status'], ActivityStatus> = {
  planned: 'Planned', in_progress: 'In Progress', suspended: 'Suspended', completed: 'Completed',
}
const ACTIVITY_STATUS_VALUES: Record<ActivityStatus, Activity['status']> = {
  Planned: 'planned', 'In Progress': 'in_progress', Suspended: 'suspended', Completed: 'completed',
}

export function activityStatus(a: Pick<Activity, 'status'>): ActivityStatus {
  return ACTIVITY_STATUS_LABELS[a.status]
}

const ACTIVITY_STATUS_CLASSES: Record<ActivityStatus, string> = {
  Planned: 'text-gray-500 dark:text-prosota-muted',
  'In Progress': 'text-blue-600 dark:text-blue-400 font-medium',
  Suspended: 'text-amber-600 dark:text-amber-400 font-medium',
  Completed: 'text-green-600 dark:text-green-400 font-medium',
}

const ACTIVITY_STATUS_RANK: Record<ActivityStatus, number> = { Planned: 0, 'In Progress': 1, Suspended: 2, Completed: 3 }

export const ALL_COLUMNS: { key: ColumnKey; label: string; width: string; title?: string }[] = [
  { key: 'code', label: 'Code', width: 'w-24' },
  { key: 'wbs', label: 'WBS', width: 'w-16' },
  { key: 'type', label: 'Type', width: 'w-24' },
  { key: 'duration', label: 'Dur (d)', width: 'w-16' },
  { key: 'status', label: 'Status', width: 'w-24', title: 'Planned, In Progress, Suspended, or Completed. Double-click to set directly — it drives % Complete, Actual Start/Finish, and Suspend/Resume Date rather than being a separate field of its own, so those update to match whatever you pick.' },
  { key: 'start', label: 'Start', width: 'w-24' },
  { key: 'bl_start', label: 'BL Start', width: 'w-24', title: 'Baseline start — captured by whichever baseline is assigned, the plan this activity is measured against' },
  { key: 'finish', label: 'Finish', width: 'w-24' },
  { key: 'bl_finish', label: 'BL Finish', width: 'w-24', title: 'Baseline finish — captured by whichever baseline is assigned, the plan this activity is measured against' },
  { key: 'variance', label: 'Fin. Var (d)', width: 'w-16', title: 'Current Finish vs Baseline Finish, in days. Positive = running later than the baseline plan. Blank until a baseline exists.' },
  { key: 'float', label: 'Total Float (d)', width: 'w-20', title: 'How much this activity could slip without delaying the whole project — stored/computed in hours, shown rounded to whole days here, same as Duration' },
  { key: 'critical', label: 'Critical', width: 'w-16', title: 'On the master critical path — zero (or negative) Total Float. The whole schedule\'s longest, most schedule-driving chain.' },
  { key: 'free_float', label: 'Free Float (d)', width: 'w-20', title: 'How much this activity could slip without delaying its own successors — always ≤ Total Float. Stored/computed in hours, shown rounded to whole days here, same as Duration' },
  { key: 'sub_float', label: 'Sub Total Float (d)', width: 'w-24', title: 'Total Float within its own tagged sub-project\'s branch, calculated in isolation from the rest of the schedule — blank for anything outside a tagged sub-project. See the 🏗️ Sub-Projects widget.' },
  { key: 'sub_critical', label: 'Sub Critical', width: 'w-20', title: 'Critical within its own tagged sub-project\'s branch, even if not critical on the master schedule — the whole point of tagging a sub-project. Blank for anything outside a tagged sub-project.' },
  { key: 'pct_complete', label: '% Comp', width: 'w-20' },
  { key: 'resources', label: 'Resources', width: 'w-24', title: 'Click to assign labour, equipment, material or a subcontractor to this activity' },
  { key: 'element_count', label: '3D Elements', width: 'w-16', title: 'How many 3D model elements are linked to this activity — set at schedule generation time, or via the 4D module\'s own element-to-activity linking' },
  { key: 'elements', label: 'Browse Elements', width: 'w-28', title: 'Click to browse the individual 3D elements linked to this activity' },
  { key: 'animation_profile', label: '3D Profile', width: 'w-28', title: 'Animation profile every 3D element linked to this activity uses in the 4D timeline, unless one has its own override — set once here to bulk-drive all of them. "Default" = the plain opacity-only fade every schedule-generated link starts with.' },
  { key: 'bac', label: 'BAC', width: 'w-24', title: 'Budget At Completion — this activity\'s resourced budget (from Cost Plan). Blank until resources are assigned.' },
  { key: 'pv', label: 'PV', width: 'w-24', title: 'Planned Value — how much of BAC should be earned by today, based on how far along this activity\'s own current duration it should be. Uses this activity\'s own live dates, not the assigned baseline.' },
  { key: 'ev', label: 'EV', width: 'w-24', title: 'Earned Value — BAC × physical % complete, as assessed on the linked Cost Plan line.' },
  { key: 'ac', label: 'AC', width: 'w-24', title: 'Actual Cost — actuals recorded against this activity\'s linked Cost Plan line.' },
  { key: 'cv', label: 'CV', width: 'w-24', title: 'Cost Variance — EV minus AC. Negative = over budget for the work done.' },
  { key: 'sv', label: 'SV', width: 'w-24', title: 'Schedule Variance — EV minus PV. Negative = behind schedule.' },
  { key: 'cpi', label: 'CPI', width: 'w-20', title: 'Cost Performance Index — EV ÷ AC. Below 1.0 = over budget.' },
  { key: 'spi', label: 'SPI', width: 'w-20', title: 'Schedule Performance Index — EV ÷ PV. Below 1.0 = behind schedule.' },
  { key: 'eac', label: 'EAC', width: 'w-24', title: 'Estimate At Completion — BAC ÷ CPI, the forecast final cost at current performance.' },
  { key: 'etc', label: 'ETC', width: 'w-24', title: 'Estimate To Complete — EAC minus AC, the forecast remaining cost.' },
]

const VISIBLE_COLUMNS_STORAGE_KEY = 'prosota_scheduling_visible_columns'

// A lean starting set (2026-08-28, per Maro: "by default i want these
// columns activated not all of them") — every column used to show by
// default, which meant a brand-new user's table was crowded with EVM/3D/
// sub-project columns they'd never touched. Only ever applies to a fresh
// browser with nothing saved yet; anyone who's already customized their
// own visible set keeps exactly what they chose.
const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ['code', 'duration', 'status', 'start', 'finish']

function loadVisibleColumns(): Set<ColumnKey> {
  try {
    const raw = localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw) as ColumnKey[])
  } catch {
    // fall through to default
  }
  return new Set(DEFAULT_VISIBLE_COLUMNS)
}

// User Defined Fields (docs/SCHEDULING_GAPS_PLAN.md Phase 9) — unlike the
// built-in columns above, a brand new UDF is off by default (empty set), not
// on: a project may accumulate several custom fields over time that not
// every planner wants cluttering their own grid.
const VISIBLE_UDF_FIELDS_STORAGE_KEY = 'prosota_scheduling_visible_udf_fields'

function loadVisibleUdfFields(): Set<string> {
  try {
    const raw = localStorage.getItem(VISIBLE_UDF_FIELDS_STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    // fall through to default
  }
  return new Set()
}

// Resizable columns — 'activity' (always visible) isn't in ALL_COLUMNS (that's only
// the toggleable ones) but is still user-resizable, so it gets an entry here too.
// The old trailing 'actions' icon column is gone — those tools now live in the
// toolbar and act on the checkbox selection instead of one row at a time.
export type ResizableColumnKey = ColumnKey | 'activity'

// Print gets its own column widths, independent of the on-screen resized
// ones (2026-07-07, per Maro — reusing on-screen widths directly gave a
// truncated "DUR (..." header in print, since a width tuned for on-screen's
// narrow numbers doesn't leave room for print's own uppercase, tracking-wide
// header font; the Activity/UDF columns also came out far wider in print
// than intended). Saved project-wide as part of Page Setup (letterhead.
// print_column_widths/print_udf_column_width — "let that be inside the page
// setup, like the way print timescale is in there," per Maro), not per-
// browser localStorage — these are the fallback defaults for any column
// whose width hasn't been explicitly set there yet, exported so both
// Scheduling.tsx and LetterheadEditorWidget.tsx (its own editor, under
// Page Setup) share exactly one copy.
export const PRINT_COLUMN_DEFAULTS: Record<ResizableColumnKey, number> = {
  activity: 220, code: 70, wbs: 56, type: 90, duration: 70,
  start: 120, bl_start: 120, finish: 120, bl_finish: 120,
  variance: 90, float: 100, critical: 64, free_float: 100, sub_float: 110, sub_critical: 90,
  pct_complete: 70, status: 90, resources: 130,
  bac: 90, pv: 90, ev: 90, ac: 90, cv: 90, sv: 90, cpi: 70, spi: 70, eac: 90, etc: 90,
  element_count: 70, elements: 130, animation_profile: 110,
}
export const PRINT_UDF_COLUMN_DEFAULT_WIDTH = 90

// Column sort (2026-07-05, per Maro). Sorts within each WBS parent's sibling
// group rather than flattening the whole tree — matches P6's "sort within
// grouping" convention, so the outline/indentation stays intact.
type SortKey = ResizableColumnKey

// resourceAssignments params below take the pre-grouped Map
// (groupAssignmentsByActivityId, resourceLabel.ts), not the raw array — see
// that helper's own 2026-07-15 header for why: these run once per activity
// on every sort/group pass over a list that can run to a couple thousand
// rows after a real Generate Schedule, and an O(n) `.filter()` per call
// there is exactly the "O(activities × assignments), redone on every
// render" pattern that was freezing this page.
function sortValue(
  a: Activity, key: SortKey, resourceAssignments: Map<string, ResourceAssignment[]>,
  elementLinksByActivityId: Map<string, ModelElementLink[]>,
  profileNameById: Map<string, string>,
): string | number | null {
  switch (key) {
    case 'code': return a.code
    case 'wbs': return a.wbs_path
    case 'activity': return a.task_name
    case 'type': return a.activity_type
    case 'duration': return a.duration_days !== null ? Number(a.duration_days) : null
    case 'start': return a.start ? new Date(a.start).getTime() : null
    case 'bl_start': return a.bl_start ? new Date(a.bl_start).getTime() : null
    case 'finish': return a.finish ? new Date(a.finish).getTime() : null
    case 'bl_finish': return a.bl_finish ? new Date(a.bl_finish).getTime() : null
    case 'variance': return a.variance_days
    case 'float': return a.total_float_hours
    case 'critical': return a.is_critical === null ? null : a.is_critical ? 1 : 0
    case 'free_float': return a.free_float_hours
    case 'sub_float': return a.sub_total_float_hours
    case 'sub_critical': return a.sub_is_critical === null ? null : a.sub_is_critical ? 1 : 0
    case 'pct_complete': return a.pct_complete !== null ? Number(a.pct_complete) : null
    case 'status': return ACTIVITY_STATUS_RANK[activityStatus(a)]
    case 'resources': {
      const names = (resourceAssignments.get(a.id) ?? []).map(ra => ra.resource_name)
      return names.length ? names.join(', ') : null
    }
    case 'bac': return a.bac !== null ? Number(a.bac) : null
    case 'pv': return a.pv !== null ? Number(a.pv) : null
    case 'ev': return a.ev !== null ? Number(a.ev) : null
    case 'ac': return a.ac !== null ? Number(a.ac) : null
    case 'cv': return a.cv !== null ? Number(a.cv) : null
    case 'sv': return a.sv !== null ? Number(a.sv) : null
    case 'cpi': return a.cpi !== null ? Number(a.cpi) : null
    case 'spi': return a.spi !== null ? Number(a.spi) : null
    case 'eac': return a.eac !== null ? Number(a.eac) : null
    case 'etc': return a.etc !== null ? Number(a.etc) : null
    case 'element_count': {
      const count = elementLinksByActivityId.get(a.id)?.length ?? 0
      return count > 0 ? count : null
    }
    case 'elements': {
      const links = elementLinksByActivityId.get(a.id) ?? []
      return links.length ? links[0].element_label : null
    }
    // "Default" (no override) sorts as null — same "unset sorts last" rule
    // every other blank/n-a value already gets, rather than clumping every
    // un-customised activity under a literal "Default" string sort.
    case 'animation_profile': return a.animation_profile_id ? (profileNameById.get(a.animation_profile_id) ?? null) : null
    default: return null
  }
}

// Nulls always sort last regardless of direction (a blank Start/Var/etc. isn't
// "smaller" than a real value, it's unknown/not-yet-applicable).
function compareBySortKey(
  a: Activity, b: Activity, key: SortKey, direction: 'asc' | 'desc', resourceAssignments: Map<string, ResourceAssignment[]>,
  elementLinksByActivityId: Map<string, ModelElementLink[]>, profileNameById: Map<string, string>,
): number {
  const av = sortValue(a, key, resourceAssignments, elementLinksByActivityId, profileNameById)
  const bv = sortValue(b, key, resourceAssignments, elementLinksByActivityId, profileNameById)
  if (av === null && bv === null) return 0
  if (av === null) return 1
  if (bv === null) return -1
  const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
  return direction === 'asc' ? cmp : -cmp
}

// Group By (2026-07-10, per Maro) — same GROUP_OPTIONS/GroupByField/single-
// select pattern as CostPlan.tsx/RiskRegister.tsx/IcdTracker.tsx. Extended
// 2026-07-17 (per Maro: "create a udf column called Discipline... so i can
// also choose to group by discipline") — any *text* UDF definition (not
// just Discipline specifically — no reason to special-case one field name)
// becomes its own selectable group-by option, `udf:${definitionId}`,
// computed alongside these fixed ones inside the component itself (see
// groupOptions below) since UDF definitions are per-project/dynamic, not a
// module-level constant. Number/date/indicator UDFs are left out for now —
// grouping by "the raw indicator token" or "one row per exact date" isn't
// a useful grouping the way a handful of text categories is.
const BASE_GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'resource', label: 'Resource' },
  { value: 'type', label: 'Type' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'critical', label: 'Critical' },
] as const
type GroupByField = (typeof BASE_GROUP_OPTIONS)[number]['value'] | `udf:${string}`

const GROUP_TYPE_LABELS: Record<Activity['activity_type'], string> = {
  task: 'Task', start_milestone: 'Start Milestone', finish_milestone: 'Finish Milestone', wbs_summary: 'Work Package',
}

function groupKeyFor(
  a: Activity, groupBy: GroupByField, resourceAssignments: Map<string, ResourceAssignment[]>, calendars: Calendar[],
  getUdfValue: (fieldDefinitionId: string, recordId: string) => { value_text?: string | null } | undefined,
): string {
  // `udf:${definitionId}` (2026-07-17) — checked before the switch since a
  // template-literal type isn't a plain switch-case match. Same "(none)"
  // fallback empty text already gets elsewhere in this app's own UDF grid
  // cells — a WBS/milestone row with no Discipline value (by design, see
  // BulkActivityInput.discipline's own header) lands in its own visible
  // "(none)" group instead of silently vanishing from the grouped view.
  if (groupBy.startsWith('udf:')) {
    const definitionId = groupBy.slice('udf:'.length)
    return getUdfValue(definitionId, a.id)?.value_text || '(none)'
  }
  switch (groupBy) {
    case 'resource': return resourceLabelForActivity(a.id, resourceAssignments)
    case 'type': return GROUP_TYPE_LABELS[a.activity_type] ?? a.activity_type
    case 'calendar': return a.calendar_id ? (calendars.find(c => c.id === a.calendar_id)?.name ?? '(none)') : '(project default)'
    case 'critical': return a.is_critical === null ? '(n/a)' : a.is_critical ? 'Critical' : 'Not Critical'
    default: return ''
  }
}

// Placeholder row for a group header (2026-08-28, per Maro: "when using
// grouping the gantt chart doesnt show anymore"). GanttChart positions bar i
// at `i * GANTT_ROW_HEIGHT` purely from array index — it has no concept of
// the flat grouped table's header/activity row shape. Feeding it a row-for-
// row mirror of flatGroupRows (a real activity at each 'activity' slot, one
// of these at each 'header' slot) keeps the two panes' rows aligned under
// the same shared scroll sync the ungrouped tree+Gantt view already uses,
// without GanttChart needing to know grouping exists at all. No start/
// finish means it draws no bar/milestone for this slot — the row's height
// is still counted, which is the only thing that matters here.
function groupHeaderPlaceholder(key: string): Activity {
  return {
    id: `group-header:${key}`,
    code: '', project_id: '', schedule_variant_id: '', schedule_period_id: '',
    task_name: '', activity_type: 'task', parent_id: null, wbs_path: null, sort_order: null,
    duration_hours: null, duration_days: null, start: null, finish: null,
    actual_start: null, actual_finish: null, suspend_date: null, resume_date: null, status: 'planned',
    remaining_duration_hours: null, bl_start: null, bl_finish: null, bl_duration_hours: null,
    variance_days: null, total_float_hours: null, free_float_hours: null, is_critical: null,
    sub_total_float_hours: null, sub_is_critical: null, pct_complete: null, commentary: null,
    constraint_type: null, constraint_date: null, calendar_id: null, animation_profile_id: null,
    created_at: '', updated_at: '', schedule_pct_complete: null,
    bac: null, ac: null, pv: null, ev: null, cv: null, sv: null, cpi: null, spi: null, eac: null, etc: null,
    wbs_role: '', is_archived: false, is_archive_container: false,
    schedule_category: null, schedule_phase_key: null, schedule_quantity: null,
    schedule_material_name: null, schedule_material_quantity: null, schedule_material_unit: null,
    schedule_material_cost_per_unit: null,
  }
}

const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnKey, number> = {
  code: 96, wbs: 64, activity: 224, type: 96, duration: 64, start: 96, bl_start: 96,
  finish: 96, bl_finish: 96, variance: 80, float: 80, critical: 72, free_float: 80, sub_float: 96, sub_critical: 80,
  pct_complete: 80,
  status: 96,
  resources: 96,
  bac: 96, pv: 96, ev: 96, ac: 96, cv: 96, sv: 96, cpi: 72, spi: 72, eac: 96, etc: 96,
  element_count: 80, elements: 130, animation_profile: 110,
}

const COLUMN_WIDTHS_STORAGE_KEY = 'prosota_scheduling_column_widths'

function loadColumnWidths(): Record<ResizableColumnKey, number> {
  try {
    const raw = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY)
    if (raw) return { ...DEFAULT_COLUMN_WIDTHS, ...(JSON.parse(raw) as Partial<Record<ResizableColumnKey, number>>) }
  } catch {
    // fall through to default
  }
  return DEFAULT_COLUMN_WIDTHS
}

// A plain right-pointing triangle, rotated 90° when expanded — used for both
// the per-row WBS collapse toggle and the Collapse All/Expand All buttons, so
// they're guaranteed the same colour (2026-07-04, per Maro: the two looked
// inconsistent). Drawn as an SVG rather than the ▶/▼ Unicode characters used
// before — some fonts render those as fixed-colour glyphs that ignore CSS
// `color` entirely, which is why the per-row icon and the toolbar buttons
// could show different colours despite having the same Tailwind classes.
function CollapseIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="7" height="7" viewBox="0 0 8 8"
      className={`inline-block shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
    >
      <path d="M1,0 L7,4 L1,8 Z" fill="currentColor" />
    </svg>
  )
}

// A <th> with a drag handle on its right edge. Requires the parent <table> to use
// table-layout:fixed (Tailwind's table-fixed) — otherwise the browser can ignore
// an explicit header width once cell content forces the column wider.
function ResizableTh({
  width, onResizeStart, children, className = '', title, onSortClick, sortDirection,
}: {
  width: number
  onResizeStart: (e: React.MouseEvent) => void
  children?: React.ReactNode
  className?: string
  title?: string
  onSortClick?: () => void
  sortDirection?: 'asc' | 'desc' | null
}) {
  return (
    <th className={`relative px-3 py-2.5 ${className}`} style={{ width }} title={title}>
      <div
        className={`truncate pr-2 ${onSortClick ? 'cursor-pointer select-none hover:text-gray-900' : ''}`}
        onClick={onSortClick}
      >
        {children}
        {sortDirection && <span className="ml-0.5">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
      </div>
      <span
        onMouseDown={onResizeStart}
        onClick={e => e.stopPropagation()}
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-300 active:bg-blue-400"
      />
    </th>
  )
}

// Same formatting convention as Cost Plan (frontend/src/modules/costs/CostPlan.tsx)
// so a figure reads identically whether seen here or on its linked Cost Plan line.
// Exported so SchedulingPrintView.tsx renders the exact same figures, not a second,
// independently-formatted copy.
export function formatMoney(value: string | null) {
  if (value === null) return '—'
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString()}` : `£${n.toLocaleString()}`
}

export function formatRatio(value: string | null) {
  if (value === null) return '—'
  return Number(value).toFixed(3)
}

// Duration is stored/served with 2 decimal places (e.g. "1.33"), but that
// precision never actually means anything to read (2026-07-05, per Maro) —
// always rounds to a whole number of days. Exported so SchedulingPrintView.tsx
// renders the exact same figure.
export function formatDuration(value: number | string | null): string {
  if (value === null) return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return String(Math.round(n))
}

// Inline-editable fields (double-click a cell) — the value types PATCH accepts.
// start/finish aren't plain passthrough fields: editing Start applies a soft "Start
// On or After" constraint (P6/MS Project convention — the activity's normal logic
// can still push it later, it just can't start earlier); editing Finish is
// translated server-side into the duration that produces it, Start unchanged — see
// commitEdit below and backend app/services/scheduling_cpm.py:compute_duration_for_finish.
type EditableField = 'task_name' | 'code' | 'duration_hours' | 'pct_complete' | 'status' | 'activity_type' | 'start' | 'finish' | 'animation_profile_id'

// Mirrors the backend's own lockdown (app/services/activity.py:update_activity —
// Duration/Finish/% Complete/Constraint/Type/Calendar are rejected outright,
// 422, while a WBS/Project summary row still has children) — these are
// rollups from its children, not something to type in. 'start' is included
// because double-clicking it doesn't set Start directly at all; it applies a
// Start On or After *constraint*, which is one of the locked fields. Without
// this, double-clicking any of them on a summary row opened a real inline
// editor whose commit then 422'd, surfacing as a jarring window.alert() —
// "flashes the warning" — instead of the cell simply not being editable in
// the first place, the same way the detail panel (ActivityForm.tsx) already
// disables them (2026-07-06, per Maro).
const LOCKED_ON_WBS_SUMMARY: readonly EditableField[] = ['activity_type', 'duration_hours', 'start', 'finish', 'pct_complete', 'status']

// Copy/paste is checkbox-driven (2026-07-04, per Maro): copying a row grabs a
// full snapshot, and pasting lets you pick exactly which of these fields
// actually get applied — see PasteFieldsWidget below. defaultChecked mirrors
// the previous all-or-nothing behaviour for the fields that already existed;
// name/start/finish are new, opt-in (unusual to copy, or carry a side effect).
// Commentary is deliberately not offered — it was removed from the activity
// form back in session 16 (the reassessment log already covers "what changed
// and why"), so it shouldn't reappear here as something to templatize either.
type PasteFieldKey =
  | 'task_name' | 'activity_type' | 'duration_hours' | 'start' | 'finish'
  | 'pct_complete' | 'constraint' | 'calendar_id'

interface PasteFieldOption {
  key: PasteFieldKey
  label: string
  hint?: string
  defaultChecked: boolean
}

const PASTE_FIELD_OPTIONS: PasteFieldOption[] = [
  { key: 'task_name', label: 'Name', defaultChecked: false },
  { key: 'activity_type', label: 'Type', defaultChecked: true },
  { key: 'duration_hours', label: 'Duration', defaultChecked: true },
  { key: 'start', label: 'Start date', hint: 'applies a soft "Start On or After" constraint, like inline-editing Start', defaultChecked: false },
  { key: 'finish', label: 'Finish date', hint: 'recomputes duration to match, like inline-editing Finish', defaultChecked: false },
  { key: 'pct_complete', label: '% Complete', defaultChecked: true },
  { key: 'constraint', label: 'Constraint', hint: 'copies the constraint type/date as-is; Start date above takes precedence if both are ticked', defaultChecked: true },
  { key: 'calendar_id', label: 'Calendar', defaultChecked: true },
]

export function Scheduling() {
  const { selectedProject } = useProject()
  const { theme } = useTheme()
  const stickyHeaderBg = theme === 'dark' ? '#101F36' : '#f9fafb'
  const {
    variant: activeVariant, variants: scheduleVariants, period, loading: periodLoading, error: periodError,
    refetch: refetchPeriod, refetchVariants, selectVariant, createVariant, renameVariant, deleteVariant, promoteVariant,
    promoteBaselineToVariant,
  } = useActiveScheduleVariant(selectedProject?.id)
  const { letterhead, save: saveLetterhead, refetch: refetchLetterhead } = useProjectLetterhead(selectedProject?.id)
  const { style: ganttStyle, refetch: refetchGanttStyle } = useActiveGanttStyle(selectedProject?.id)
  const {
    layouts, create: createLayout, update: updateLayoutRequest, apply: applyLayout, remove: removeLayout, reset: resetLayout,
  } = useGanttLayouts(selectedProject?.id)
  const {
    filters: customFilters, create: createSchedulingFilter, update: updateSchedulingFilter, remove: removeSchedulingFilter,
  } = useSchedulingFilters(selectedProject?.id)
  const {
    highlights: customHighlights, create: createSchedulingHighlight, update: updateSchedulingHighlight, remove: removeSchedulingHighlight,
  } = useSchedulingHighlights(selectedProject?.id)
  const {
    subprojects, create: createSubproject, update: updateSubproject, remove: removeSubproject,
  } = useScheduleSubprojects(selectedProject?.id)
  // Applying/resetting also changes the live letterhead server-side (a saved
  // snapshot gets pushed in, or the row is cleared) — refresh both so the
  // toolbar and print view immediately reflect it, not just on next reload.
  const handleApplyLayout = async (layoutId: string) => {
    await applyLayout(layoutId)
    await Promise.all([refetchGanttStyle(), refetchLetterhead()])
  }
  const handleUpdateLayout = async (layoutId: string, name: string, layoutStyle: GanttStyle) => {
    await updateLayoutRequest(layoutId, name, layoutStyle)
    await refetchGanttStyle()
  }
  const handleDeleteLayout = async (layoutId: string) => {
    await removeLayout(layoutId)
    await refetchGanttStyle()
  }
  const handleResetLayout = async () => {
    await resetLayout()
    await Promise.all([refetchGanttStyle(), refetchLetterhead()])
  }
  const [activities, setActivities] = useState<Activity[]>([])
  const [relationships, setRelationships] = useState<ActivityRelationship[]>([])
  const [calendars, setCalendars] = useState<Calendar[]>([])
  // Built once per real `calendars` change, not per row (2026-07-17 perf fix)
  // — resolveHoursPerDay/formatFloatDays used to linear-scan the raw array on
  // every call; this feeds every call site in this file an O(1) lookup
  // instead. See durationDisplay.ts's own header for the full story.
  const calendarLookup = useMemo(() => buildCalendarLookup(calendars), [calendars])
  const [resources, setResources] = useState<Resource[]>([])
  const [resourceAssignments, setResourceAssignments] = useState<ResourceAssignment[]>([])
  // Project-scoped, not schedule_period-scoped (2026-07-22, per Maro: "a
  // derived schedule column... how many 3d elements are assigned... another
  // column to see the dropdown... so i browse down the list") — same API
  // FourD.tsx already uses to restore/manage these links, listed here purely
  // read-only so the grid can show what's already there; ModelElementLink
  // itself has no schedule_period_id at all (see that model's own header —
  // element_ref is a loose string identity, not scoped to a period).
  const [modelElementLinks, setModelElementLinks] = useState<ModelElementLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // expandedId now drives one unified activity-detail panel (fields + Logic +
  // Resources + Reassessment) — single click on an activity's name opens it;
  // "+ Add Activity" just creates a blank row and jumps straight here too
  // (2026-07-03, per Maro) rather than opening a separate modal form.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Which row's "Browse Elements" dropdown is currently open, plus where to
  // anchor it (2026-07-22, per Maro's own "another column to see the
  // dropdown of 3d elements assigned so i browse down the list") — a
  // lightweight popover anchored to that row's own cell, not the full
  // expandedId detail panel (Resources' own click-to-expand pattern above):
  // browsing a possibly long element list is a quick lookup, not an edit,
  // so it doesn't need this page's whole side panel machinery. Rendered via
  // a React portal straight onto document.body (see its own render site
  // below) rather than as a plain absolutely-positioned child of the
  // triggering <td> — confirmed live that every grid cell in this table has
  // its own overflow:hidden (needed elsewhere for text truncation), which
  // silently clips a same-subtree popover at the cell's own edge no matter
  // how correctly it's positioned; a portal escapes that ancestor
  // clipping entirely. x/y are the trigger button's own getBoundingClientRect
  // (viewport-relative), read once on click — doesn't track scroll/resize
  // while open, an accepted tradeoff for a dismiss-on-click-anywhere popover.
  const [elementsBrowse, setElementsBrowse] = useState<{ activityId: string; x: number; y: number } | null>(null)
  // Detail panel visibility (2026-07-03, per Maro): default auto-hides unless
  // an activity is selected; pinning keeps it permanently docked (showing a
  // placeholder when nothing's selected) so a planner working through rows
  // one after another doesn't get layout jumps as the panel appears/disappears.
  const [panelPinned, setPanelPinned] = useState<boolean>(() => localStorage.getItem('prosota_scheduling_panel_pinned') === 'true')
  const togglePanelPinned = () => {
    setPanelPinned(p => {
      localStorage.setItem('prosota_scheduling_panel_pinned', String(!p))
      return !p
    })
  }

  // WBS collapse/expand (2026-07-04, per Maro) — collapsedIds holds WBS
  // summary activities whose descendants are currently hidden. Persisted so
  // a planner's chosen outline state survives a reload, same convention as
  // column widths/visibility.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('prosota_scheduling_collapsed_wbs')
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })
  const persistCollapsed = (next: Set<string>) => {
    localStorage.setItem('prosota_scheduling_collapsed_wbs', JSON.stringify([...next]))
  }
  const toggleCollapsed = (id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persistCollapsed(next)
      return next
    })
  }
  const handleCollapseAll = () => {
    const next = new Set(activities.filter(a => a.activity_type === 'wbs_summary').map(a => a.id))
    setCollapsedIds(next)
    persistCollapsed(next)
  }
  const handleExpandAll = () => {
    setCollapsedIds(new Set())
    persistCollapsed(new Set())
  }
  // Two lookup maps, built once per activities/resourceAssignments change
  // rather than re-scanned per activity (2026-07-15, per Maro: "its very
  // laggy" — a real generate-schedule-sized activity list, a few hundred to
  // a couple thousand rows across a deep WBS, froze the whole tab). Every
  // place below that used to do `activities.find(...)` or
  // `resourceAssignments.filter(...)` inside a per-row/per-activity pass
  // now does an O(1) Map lookup instead.
  const activityById = useMemo(() => new Map(activities.map(a => [a.id, a])), [activities])
  const assignmentsByActivityId = useMemo(() => groupAssignmentsByActivityId(resourceAssignments), [resourceAssignments])
  // Same O(1)-lookup reasoning as assignmentsByActivityId above — a real
  // generated schedule can carry tens of thousands of these links.
  const elementLinksByActivityId = useMemo(() => {
    const map = new Map<string, ModelElementLink[]>()
    for (const link of modelElementLinks) {
      const list = map.get(link.activity_id)
      if (list) list.push(link)
      else map.set(link.activity_id, [link])
    }
    return map
  }, [modelElementLinks])
  // Animation Profile column (2026-07-22, per Maro: "allow me set animation
  // profile per activity not just per element, this will allow for bulk
  // profile setting") — same project-scoped list ElementLinkFields.tsx (4D
  // module) already uses for the per-element picker; this just gives the
  // activity itself the same choice, one bulk assignment instead of clicking
  // through every linked element individually.
  const { profiles: animationProfiles } = useAnimationProfiles(selectedProject?.id)
  const profileNameById = useMemo(() => new Map(animationProfiles.map(p => [p.id, p.name])), [animationProfiles])

  // True if any ancestor (parent, grandparent, ...) is currently collapsed —
  // walks parent_id against the *full* activity list (not visibleActivities),
  // same reasoning as sortedSiblingsOf below: the real hierarchy, regardless
  // of what a search/filter is hiding. Was `activities.find(...)` per
  // ancestor hop (2026-07-15 fix, per Maro — see activityById's own header
  // above): for every activity in a deep WBS, that meant walking the chain
  // *and* linear-scanning the full activity list at every hop — O(n² ×
  // depth) across the whole visibleActivities pass, redone on every
  // keystroke in the search box. activityById turns each hop into an O(1)
  // lookup.
  const isHiddenByCollapse = (a: Activity): boolean => {
    let current = a
    while (current.parent_id) {
      const parent = activityById.get(current.parent_id)
      if (!parent) return false
      if (collapsedIds.has(parent.id)) return true
      current = parent
    }
    return false
  }

  // Resources tab: checking one or more resource rows in Resource Pool scopes
  // Resource Tracking/Profile below to just those (2026-07-07, per Maro) —
  // same "select rows here, scope something else" shape as Cost Plan's own
  // selectedForPrint. Empty means "show everything," unchanged from today.
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set())
  // useCallback (2026-07-17, perf fix) — passed straight through to the now
  // memo()'d ResourceTrackingWidget/ResourceUsageProfileWidget; a plain
  // closure here would get a new identity every Scheduling.tsx render and
  // defeat that memo boundary immediately.
  const toggleResourceSelected = useCallback((id: string) => {
    setSelectedResourceIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Resource Tracking's own tree (resource -> its assigned activities) —
  // same collapse/expand shape as collapsedIds above, just not persisted (a
  // much shallower 2-level tree, less need to remember across reloads).
  const [collapsedResourceIds, setCollapsedResourceIds] = useState<Set<string>>(new Set())
  // useCallback — same memo-defeating-closure reasoning as toggleResourceSelected above.
  const toggleResourceCollapsed = useCallback((id: string) => {
    setCollapsedResourceIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const handleCollapseAllResources = () => {
    setCollapsedResourceIds(new Set(
      resources
        .filter(r => (r.resource_type === 'labour' || r.resource_type === 'equipment' || r.resource_type === 'crew') && resourceAssignments.some(a => a.resource_id === r.id))
        .map(r => r.id)
    ))
  }
  const handleExpandAllResources = () => setCollapsedResourceIds(new Set())

  // "select an activity in the tracking, I want to see the usage profile
  // reflected... full interactivity" (2026-07-08, per Maro) — shared with
  // selectedResourceIds above; Resource Tracking's own activity-row
  // checkboxes write here, Resource Usage Profile's chart reads it.
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<string>>(new Set())
  // useCallback — same memo-defeating-closure reasoning as toggleResourceSelected above.
  const toggleActivitySelected = useCallback((id: string) => {
    setSelectedActivityIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // One shared toolbar (zoom/unit/date-range/layout/page-setup/print) above
  // all three Resources-tab tables (2026-07-08, per Maro: "I want all the
  // toolbars in the same area... I want this looking neat") instead of each
  // table owning its own. useResourcesTabData does the actual data
  // fetching/derivation once, shared by Tracking, Profile, and Print/Export.
  const [resourcesZoom, setResourcesZoom] = useState<GanttZoom>(loadGanttZoom)
  const [resourcesUnit, setResourcesUnit] = useState<'hours' | 'days' | 'cost'>('hours')
  const [resourcesRangeStartOverride, setResourcesRangeStartOverride] = useState<Date | null>(null)
  const [resourcesRangeEndOverride, setResourcesRangeEndOverride] = useState<Date | null>(null)
  const [resourcesLayoutPrefs, setResourcesLayoutPrefsState] = useState<ResourcesLayoutPrefs>(loadResourcesLayout)
  const saveResourcesLayoutPrefs = (next: ResourcesLayoutPrefs) => {
    setResourcesLayoutPrefsState(next)
    saveResourcesLayout(next)
  }
  const [resourcesLayoutOpen, setResourcesLayoutOpen] = useState(false)
  const [resourcesPrintFonts, setResourcesPrintFontsState] = useState(loadResourcesPrintFonts)
  const saveResourcesPrintFontsPrefs = (next: typeof resourcesPrintFonts) => {
    setResourcesPrintFontsState(next)
    saveResourcesPrintFonts(next)
  }
  const [resourcesPrintTables, setResourcesPrintTablesState] = useState<Set<ResourcesPrintTable>>(loadResourcesPrintTables)
  const toggleResourcesPrintTable = (table: ResourcesPrintTable) => {
    setResourcesPrintTablesState(prev => {
      const next = new Set(prev)
      if (next.has(table)) next.delete(table)
      else next.add(table)
      saveResourcesPrintTables(next)
      return next
    })
  }
  const [resourcesPageSetupOpen, setResourcesPageSetupOpen] = useState(false)
  const [resourcesPrintTrigger, setResourcesPrintTrigger] = useState(0)
  // Export's own dropdown (2026-07-15, per Maro: "its stupid ui/ux to hide
  // that in the page setup, that was meant for print not export" — the
  // which-tables-to-include checkboxes used to live only inside the
  // collapsed Page Setup panel, which is genuinely about print-specific
  // concerns (letterhead, print font) and has nothing to do with a one-off
  // Export click. Same table selection is still shared with Print (both
  // legitimately mean "which tables"), but Export now has its own directly-
  // visible control instead of silently inheriting whatever Page Setup last
  // left checked.
  const [resourcesExportOpen, setResourcesExportOpen] = useState(false)

  // Keeps Resource Tracking's and Resource Usage Profile's tree/timeline
  // dividers lined up (2026-07-09, per Maro) — owned here since these are
  // two sibling widgets. 516 = Tracking's own default 4 fixed columns +
  // checkbox column, before Tracking's own effect reports its real current
  // width on mount. Their timeline scroll positions used to be mirrored
  // both ways too; see ResourceTrackingWidget's own Props header comment
  // for why that was dropped (2026-07-14, per Maro: "just make both
  // independent at this point").
  const [resourcesLeftPaneWidth, setResourcesLeftPaneWidth] = useState(516)

  const resourcesTabData = useResourcesTabData(
    resources, resourceAssignments, activities, selectedResourceIds,
    resourcesZoom, resourcesRangeStartOverride, resourcesRangeEndOverride,
  )

  useEffect(() => {
    if (resourcesPrintTrigger > 0) window.print()
  }, [resourcesPrintTrigger])

  // Print/export scope, driven by whatever's checked anywhere in Resource
  // Pool/Tracking/Profile (2026-07-10, per Maro: "if nothing checked then
  // print all... if a resource is checked... print based on that resource
  // across all tables... if i check a single activity then that's what i
  // want"). Checking a resource scopes all three tables to it directly;
  // checking only an activity (no resource) derives the owning resource(s)
  // from it — same precedent as Level Resources' own scope logic just above.
  // null = no filter (nothing checked anywhere = print everything).
  const printScopedResourceIds = useMemo(() => {
    if (selectedResourceIds.size > 0) return selectedResourceIds
    if (selectedActivityIds.size > 0) {
      const ids = new Set<string>()
      for (const a of resourceAssignments) {
        if (selectedActivityIds.has(a.activity_id)) ids.add(a.resource_id)
      }
      return ids
    }
    return null
  }, [selectedResourceIds, selectedActivityIds, resourceAssignments])

  // Resource Pool print/export shows every resource type (material/
  // subcontractor included), unlike resourcesTabData.trackedResources
  // (labour/equipment with assignments only) — scoped independently here.
  const printScopedResources = useMemo(
    () => printScopedResourceIds ? resources.filter(r => printScopedResourceIds.has(r.id)) : resources,
    [resources, printScopedResourceIds]
  )

  const printScopedTrackedResources = useMemo(
    () => printScopedResourceIds
      ? resourcesTabData.trackedResources.filter(r => printScopedResourceIds.has(r.id))
      : resourcesTabData.trackedResources,
    [resourcesTabData.trackedResources, printScopedResourceIds]
  )

  // Pre-computed once here (not inside ResourceTrackingWidget any more) so
  // both the on-screen widget and the unified print/export can share it —
  // print/export additionally scope by printScopedResourceIds/
  // selectedActivityIds; the on-screen widget (which reads resourcesTabData
  // directly, not this) intentionally keeps showing everything while you're
  // still working, only print narrows down to the current selection.
  const resourcesPrintGroups: PrintResourceGroup[] = useMemo(() => printScopedTrackedResources.map(resource => {
    const allRows = resourcesTabData.assignmentsByResource.get(resource.id) ?? []
    const rows = selectedActivityIds.size > 0 ? allRows.filter(row => selectedActivityIds.has(row.activity.id)) : allRows
    const spread = resourcesTabData.spreadByResource.get(resource.id)
    const { hoursByAssignmentDate } = indexSpread(spread)
    // Print/export mirror whatever unit is currently selected on screen
    // (2026-07-10, per Maro) — same per-resource factor as the screen
    // widget's own toDisplay/computeUsageProfileBars.
    const factor = usageUnitFactor(resource, resourcesUnit)
    const bucketHoursFor = (assignmentId: string) => resourcesTabData.buckets.map(bucket => {
      let hours = 0
      for (const d of eachDate(bucket.start, bucket.end)) {
        hours += hoursByAssignmentDate.get(`${assignmentId}:${d}`)?.hours ?? 0
      }
      return hours * factor
    })
    // Computed once per row, not once per (bucket x row) pair (2026-07-17
    // perf fix, per a real perf audit) — rollup used to re-derive each
    // row's WHOLE bucketHoursFor array (itself an O(buckets x days) scan)
    // just to pluck out a single bucket's value, for every bucket, an
    // O(buckets^2 x rows x days) blowup. Same "compute once, reuse" fix as
    // computeUsageProfileBars' own 2026-07-17 header in useResourcesTabData.ts.
    const rowsWithHours = rows.map(row => ({ row, bucketHours: bucketHoursFor(row.assignment.id) }))
    const rollup = resourcesTabData.buckets.map((_, i) => rowsWithHours.reduce((sum, { bucketHours }) => sum + bucketHours[i], 0))
    return {
      resourceName: resource.name,
      bucketHours: rollup,
      rows: rowsWithHours.map(({ row, bucketHours }) => ({
        code: row.activity.code, name: row.activity.task_name,
        start: row.activity.start ? formatDateTime(row.activity.start, false) : null,
        finish: row.activity.finish ? formatDateTime(row.activity.finish, false) : null,
        bucketHours,
      })),
    }
  }).filter(group => group.rows.length > 0), [printScopedTrackedResources, resourcesTabData, selectedActivityIds, resourcesUnit])

  const resourcesProfileBars = useMemo(
    () => computeUsageProfileBars(
      printScopedTrackedResources, resourcesTabData.assignmentsByResource, resourcesTabData.buckets,
      resourcesTabData.spreadByResource, selectedActivityIds, resourcesUnit,
    ),
    [printScopedTrackedResources, resourcesTabData, selectedActivityIds, resourcesUnit]
  )

  const handleResourcesExport = async () => {
    // A workbook needs at least one sheet — every table unchecked (possible
    // now that "Select all" makes it easy to get back from) would otherwise
    // hand exceljs an empty tables Set and either throw or hand back a
    // corrupt .xlsx with no visible error at all.
    if (resourcesPrintTables.size === 0) {
      window.alert('Check at least one table in Page Setup before exporting.')
      return
    }
    // Dynamic import (2026-09-03 perf pass, per Maro: "switching between
    // modules... takes a longer time") — exceljs is a genuinely heavy
    // library (see exportResourcesExcel.ts's own docstring on why it's used
    // over xlsx/SheetJS despite the size) that was previously bundled
    // straight into Scheduling's main chunk via a static import, paid by
    // every visitor to this module even if they never click Export Excel.
    // Loaded on demand instead, matching the same lazy-chunk pattern
    // App.tsx's own routes already use for FourD/Scheduling/etc.
    const { downloadResourcesExcel } = await import('./exportResourcesExcel')
    await downloadResourcesExcel({
      tables: resourcesPrintTables, projectName: selectedProject?.name ?? 'Project',
      resources: printScopedResources, calendars,
      printGroups: resourcesPrintGroups, bucketLabels: resourcesTabData.buckets.map(b => b.label),
      profileBarValues: resourcesProfileBars.barValues, profileLimit: resourcesProfileBars.limitValue,
      unit: resourcesUnit,
    })
  }

  // Real leveling vs smoothing (2026-07-09, per Maro's own definitions) —
  // a manual "find the next overallocated resource/activity, then level it"
  // loop, not a one-shot bulk pass. See resourceLeveling.ts for exactly what
  // each mode does to activity dates.
  const [levelPanelOpen, setLevelPanelOpen] = useState(false)
  const [levelAllAtOnce, setLevelAllAtOnce] = useState(true)
  const [levelGranularity, setLevelGranularity] = useState<LevelingGranularity>('resource')
  const [levelMode, setLevelMode] = useState<LevelingMode>('level')
  const [levelExcludeIds, setLevelExcludeIds] = useState<Set<string>>(new Set())
  const [levelFoundTarget, setLevelFoundTarget] = useState<LevelingTarget | null>(null)
  const [levelExhausted, setLevelExhausted] = useState(false)
  const [levelSearching, setLevelSearching] = useState(false)
  const [leveling, setLeveling] = useState(false)
  const [levelResultMessage, setLevelResultMessage] = useState<string | null>(null)

  const resetLevelSearch = () => {
    setLevelExcludeIds(new Set())
    setLevelFoundTarget(null)
    setLevelExhausted(false)
    setLevelResultMessage(null)
  }

  // Re-scoping (checking/unchecking a resource or activity while "Level all
  // at once" is off) invalidates whatever was already found — a stale
  // target from the old scope shouldn't still be levelable.
  useEffect(() => {
    if (!levelAllAtOnce) resetLevelSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedResourceIds, selectedActivityIds])

  const levelScopeResources = (): Resource[] => {
    if (levelAllAtOnce) return resourcesTabData.trackedResources
    if (selectedResourceIds.size > 0) return resourcesTabData.trackedResources.filter(r => selectedResourceIds.has(r.id))
    const ids = new Set<string>()
    for (const r of resourcesTabData.trackedResources) {
      const rows = resourcesTabData.assignmentsByResource.get(r.id) ?? []
      if (rows.some(row => selectedActivityIds.has(row.activity.id))) ids.add(r.id)
    }
    return resourcesTabData.trackedResources.filter(r => ids.has(r.id))
  }

  const handleFindNextOverallocated = () => {
    setLevelSearching(true)
    setLevelResultMessage(null)
    try {
      const target = findNextOverallocatedTarget(
        levelScopeResources(), levelGranularity, resourcesTabData.assignmentsByResource,
        resourcesTabData.buckets, resourcesTabData.spreadByResource, levelExcludeIds,
      )
      setLevelFoundTarget(target)
      if (!target) setLevelExhausted(true)
    } finally {
      setLevelSearching(false)
    }
  }

  const handleLevelFoundTarget = async () => {
    if (!levelFoundTarget || !period || !selectedProject) return
    const isSmooth = levelMode === 'smooth'
    const warning = isSmooth
      ? `Apply resource smoothing to "${levelFoundTarget.label}"? This only shifts work within its own available float, so the project end date and critical path stay fixed — if there isn't enough float to fully clear the overallocation, it may be left partially unresolved.`
      : `Apply resource leveling to "${levelFoundTarget.label}"? This delays activities to resolve the overallocation and can push activity dates beyond their current float — the project end date and/or critical path may change as a result.`
    if (!(await confirmWithDontAsk(isSmooth ? 'scheduling.resource-smooth' : 'scheduling.resource-level', warning))) return
    setLeveling(true)
    setLevelResultMessage(null)
    try {
      const result = await levelTarget(
        levelFoundTarget, levelMode, selectedProject.id, period.id, calendars,
        resourcesTabData.rangeStart, resourcesTabData.rangeEnd, resourcesTabData.buckets,
      )
      await refresh()
      await resourcesTabData.refetchResource(levelFoundTarget.resourceId)
      setLevelExcludeIds(prev => new Set(prev).add(levelFoundTarget.id))
      setLevelFoundTarget(null)
      const movedCount = result.movedActivityIds.length
      setLevelResultMessage(
        result.fullyResolved
          ? `Resolved — moved ${movedCount} activit${movedCount === 1 ? 'y' : 'ies'}.`
          : result.blockedByFloat
            ? `Moved ${movedCount} activit${movedCount === 1 ? 'y' : 'ies'}, but ran out of available float — switch to Leveling for a full fix.`
            : `Moved ${movedCount} activit${movedCount === 1 ? 'y' : 'ies'}; some overallocation may remain.`
      )
    } catch (err) {
      // Was silently swallowed before this fix (2026-08-29, per Maro: "I've
      // not been successful at using it at all") — no catch at all meant a
      // failed PATCH mid-run just vanished, "Level" looked like it did
      // nothing. Same axios-error-detail convention as handleCellCommit
      // above.
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
      setLevelResultMessage(message ?? 'Could not level that target — see the console for details.')
    } finally {
      setLeveling(false)
    }
  }

  // Jumps to a specific activity from anywhere else in the UI (2026-07-05,
  // per Maro: clicking a predecessor/successor's name in the Logic panel
  // should select it and bring it into view) — expands any collapsed WBS
  // ancestor so the row actually exists in visibleActivities first, opens
  // its detail panel, then scrolls the grid pane to its index once the
  // (possibly just-expanded) list has had a render to update.
  //
  // Rewritten 2026-07-17 for row virtualization — used to find the row's own
  // DOM node via a rowRefs Map and call scrollIntoView on it; once rows
  // aren't all permanently mounted, an off-window row's ref is never
  // populated and this would silently no-op. Now computes the target's
  // index directly and sets leftPaneRef's scrollTop from it instead — a real
  // scrollTo dispatches a genuine scroll event, so the existing onScroll
  // handler (handleGridScroll) picks it up and both keeps the Gantt pane in
  // sync and recomputes the grid's own visible window, no separate code path
  // needed for that side. visibleActivitiesRef (not the closed-over
  // visibleActivities) because this runs inside a requestAnimationFrame +
  // setTimeout, after the ancestor-expanding setCollapsedIds above has had a
  // chance to actually re-render — the ref stays current across that render,
  // the closed-over value would not.
  const handleFocusActivity = (activityId: string) => {
    const target = activities.find(a => a.id === activityId)
    if (!target) return
    setCollapsedIds(prev => {
      let next = prev
      let current = target
      while (current.parent_id) {
        const parent = activities.find(x => x.id === current.parent_id)
        if (!parent) break
        if (next.has(parent.id)) {
          if (next === prev) next = new Set(prev)
          next.delete(parent.id)
        }
        current = parent
      }
      if (next !== prev) persistCollapsed(next)
      return next
    })
    setExpandedId(activityId)
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = leftPaneRef.current
        if (!el) return
        const index = visibleActivitiesRef.current.findIndex(a => a.id === activityId)
        if (index === -1) return
        const targetTop = index * GANTT_ROW_HEIGHT - el.clientHeight / 2 + GANTT_ROW_HEIGHT / 2
        el.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
      }, 50)
    })
  }

  // Schedule vs Resources tab (docs/SCHEDULING_GAPS_PLAN.md Phase 7, per Maro
  // — "add a second tab dedicated for resources, move current resource
  // widget in there"). Assign-resources-to-an-activity stays in the bottom
  // detail panel (ResourceAssignments, below) — only the resource *pool*
  // definitions move.
  const [activeTab, setActiveTab] = useState<'schedule' | 'resources'>('schedule')
  // "Generate Resources" / "Auto Assign Resources" (2026-07-17, per Maro's
  // two-stage flow — schedule generation itself no longer creates any
  // Resource/ResourceAssignment rows, see buildStagedSchedule's own header
  // in scheduleGeneration.ts): 'generate' populates the pool from every
  // IFC-generated activity's own schedule_category/schedule_phase_key,
  // reusing an existing same-named resource rather than duplicating it;
  // 'assign' then links that pool to those same activities. Both are plain
  // busy/message state, not a modal — these are one-shot batch actions, not
  // a form.
  const [resourceGenBusy, setResourceGenBusy] = useState<'generate' | 'assign' | null>(null)
  const [resourceGenMessage, setResourceGenMessage] = useState<string | null>(null)
  const [calendarWidgetOpen, setCalendarWidgetOpen] = useState(false)
  const [baselineWidgetOpen, setBaselineWidgetOpen] = useState(false)
  const [letterheadWidgetOpen, setLetterheadWidgetOpen] = useState(false)
  const [layoutWidgetOpen, setLayoutWidgetOpen] = useState(false)
  // Gantt timescale zoom — a view preference (like column widths), persisted
  // per-browser rather than saved with a Layout, so switching it while
  // looking at the chart doesn't require a save/apply round trip.
  const [ganttZoom, setGanttZoom] = useState<GanttZoom>(loadGanttZoom)
  const handleZoomChange = (zoom: GanttZoom) => {
    setGanttZoom(zoom)
    saveGanttZoom(zoom)
  }
  const [qualityWidgetOpen, setQualityWidgetOpen] = useState(false)
  const [subProjectsWidgetOpen, setSubProjectsWidgetOpen] = useState(false)
  const [scheduleVariantWidgetOpen, setScheduleVariantWidgetOpen] = useState(false)
  // Two independently-printable views share this page (the schedule
  // table+Gantt, and the Quality Analysis) — only one .print-only block may
  // be shown at a time, so printTarget picks which. qualityPrintReport is
  // fed up from SchedulingQualityWidget (whatever it's currently displaying,
  // live or a viewed saved run) purely so SchedulingQualityPrintView has
  // something to render without lifting that widget's whole state up here.
  const [printTarget, setPrintTarget] = useState<'schedule' | 'quality'>('schedule')
  const [printTrigger, setPrintTrigger] = useState(0)
  const [qualityPrintReport, setQualityPrintReport] = useState<QualityReport | null>(null)
  const [qualityPrintRunName, setQualityPrintRunName] = useState<string | undefined>(undefined)

  // Fires window.print() only after printTarget has committed to the DOM —
  // same reasoning as Risk/ICD/Cost's own print-trigger pattern (state
  // updates are batched/async, so calling print() directly after
  // setPrintTarget could still print the previous target's content).
  useEffect(() => {
    if (printTrigger > 0) window.print()
  }, [printTrigger])

  const printSchedule = () => {
    setPrintTarget('schedule')
    setPrintTrigger(t => t + 1)
  }
  const printQuality = () => {
    setPrintTarget('quality')
    setPrintTrigger(t => t + 1)
  }
  const [rescheduleWidgetOpen, setRescheduleWidgetOpen] = useState(false)
  const [reassessmentRefreshKey, setReassessmentRefreshKey] = useState(0)

  // Row selection (checkbox column) — drives the bulk action toolbar next to Print.
  // Replaces the old per-row copy/paste/move/indent/outdent/delete icon column;
  // those tools now act on whichever rows are checked here instead of one at a time.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAssignMode, setBulkAssignMode] = useState<BulkAssignMode | null>(null)
  const [bulkAssignMenuOpen, setBulkAssignMenuOpen] = useState(false)
  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Search / Filters — client-side, matching the prototype's toolbar row.
  //
  // Group-by (2026-07-10, per Maro — reverses the original decision here: a
  // second grouping layer would duplicate the WBS outline hierarchy and break
  // the Gantt's fixed per-row index alignment, same way an inline-expanding
  // row once did). Resolved by making grouping its own alternate flat view —
  // when active, it replaces the WBS tree + Gantt entirely (Gantt hidden,
  // since its row-index math assumes WBS tree order) with a flat grouped
  // list, same shape as Cost Plan/Risk/ICD's own Group By. "No grouping"
  // restores today's exact WBS tree + Gantt view, untouched.
  const [groupBy, setGroupBy] = useState<GroupByField>('none')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroupCollapsed = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const [searchQuery, setSearchQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterCritical, setFilterCritical] = useState(false)
  const [filterDelayed, setFilterDelayed] = useState(false)
  // Archived activities are visible by default (2026-07-04, per Maro) — this
  // only ever narrows the list when explicitly ticked, same as the other
  // filter checkboxes below.
  // Persisted (2026-07-26 fix, per Maro: "when i click hide archived, and
  // switch tabs. archived goes back to being visible" — this was plain,
  // unpersisted local state; Scheduling is a normal react-router route
  // (App.tsx), not given the same always-mounted treatment PersistentFourD
  // gives the 4D module, so navigating to any other page and back genuinely
  // unmounts and remounts this whole component, resetting it to its
  // useState default every time. Same localStorage convention this file
  // already uses for highlightCritical/panelPinned/collapsed WBS rows just
  // below/above).
  const [hideArchived, setHideArchivedState] = useState(() => localStorage.getItem('prosota_scheduling_hide_archived') === 'true')
  const setHideArchived = (value: boolean) => {
    setHideArchivedState(value)
    try { localStorage.setItem('prosota_scheduling_hide_archived', String(value)) } catch { /* ignore */ }
  }
  const [filterAtRisk, setFilterAtRisk] = useState(false)

  // Custom filters (2026-07-05, per Maro, modelled on P6's own Filters
  // dialog) — a "User Defined" tier alongside the 3 built-in checkboxes
  // above. Each enabled custom filter has its own Show/Hide mode — a filter
  // matching an activity either keeps it (Show, the default) or removes it
  // (Hide) — kept separate from the saved filter's own conditions, since the
  // same saved filter (e.g. "Milestones") is equally useful either way
  // depending on the moment ("show me only milestones" vs "hide all
  // milestones"), per Maro: a filter he'd built matched an activity but
  // ticking it hid that activity instead of keeping it — the fix isn't a
  // bug fix, it's this explicit Show/Hide choice replacing an implicit
  // "ticked = show-only-matches" assumption. Modes + which filters are
  // enabled, and the global "match All selected filters / Any selected
  // filter" mode combining *all* enabled filters (built-in + custom)
  // together, are all UI preferences (localStorage), not server-side — only
  // the filters' own name/conditions/match_mode are (see useSchedulingFilters).
  const [customFilterModes, setCustomFilterModes] = useState<Record<string, 'show' | 'hide'>>(() => {
    try {
      const saved = localStorage.getItem('prosota_scheduling_custom_filter_modes')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  const setCustomFilterMode = (filterId: string, mode: 'off' | 'show' | 'hide') => {
    setCustomFilterModes(prev => {
      const next = { ...prev }
      if (mode === 'off') delete next[filterId]
      else next[filterId] = mode
      localStorage.setItem('prosota_scheduling_custom_filter_modes', JSON.stringify(next))
      return next
    })
  }
  const [filterMatchMode, setFilterMatchMode] = useState<'all' | 'any'>(() => {
    const saved = localStorage.getItem('prosota_scheduling_filter_match_mode')
    return saved === 'any' ? 'any' : 'all'
  })
  const handleFilterMatchModeChange = (mode: 'all' | 'any') => {
    setFilterMatchMode(mode)
    localStorage.setItem('prosota_scheduling_filter_match_mode', mode)
  }
  const handleClearAllFilters = () => {
    setFilterCritical(false); setFilterDelayed(false); setFilterAtRisk(false)
    setCustomFilterModes({})
    localStorage.removeItem('prosota_scheduling_custom_filter_modes')
  }

  // Highlight widget (2026-07-06, per Maro: "works exactly like the filter" —
  // same built-in/custom two-tier shape as the Filters above, but tints
  // matching rows instead of narrowing the list; see activityRowBackground's
  // isHighlighted). "Critical" replaces what used to be an always-on,
  // automatic row tint — off by default, same as every other opt-in toggle
  // here, until explicitly turned on.
  const [highlightsWidgetOpen, setHighlightsWidgetOpen] = useState(false)
  const [highlightCritical, setHighlightCritical] = useState(() => localStorage.getItem('prosota_scheduling_highlight_critical') === 'true')
  const handleHighlightCriticalChange = (v: boolean) => {
    setHighlightCritical(v)
    localStorage.setItem('prosota_scheduling_highlight_critical', String(v))
  }
  const [enabledHighlightIds, setEnabledHighlightIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('prosota_scheduling_enabled_highlight_ids')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch {
      return new Set()
    }
  })
  const handleToggleHighlight = (highlightId: string, enabled: boolean) => {
    setEnabledHighlightIds(prev => {
      const next = new Set(prev)
      if (enabled) next.add(highlightId)
      else next.delete(highlightId)
      localStorage.setItem('prosota_scheduling_enabled_highlight_ids', JSON.stringify([...next]))
      return next
    })
  }
  const handleClearAllHighlights = () => {
    handleHighlightCriticalChange(false)
    setEnabledHighlightIds(new Set())
    localStorage.removeItem('prosota_scheduling_enabled_highlight_ids')
  }
  // Union, not the Filters' configurable All/Any — each enabled highlight
  // (built-in Critical + any custom rule) is independently "a reason to
  // flag this row", so an activity is highlighted if it matches *any* one
  // of them, not only when every enabled highlight matches simultaneously.
  const highlightedActivityIds = useMemo(() => {
    const ids = new Set<string>()
    const enabledCustomHighlights = customHighlights.filter(h => enabledHighlightIds.has(h.id))
    for (const a of activities) {
      if (highlightCritical && a.is_critical === true) { ids.add(a.id); continue }
      if (enabledCustomHighlights.some(h => evaluateFilter(a, h))) ids.add(a.id)
    }
    return ids
  }, [activities, highlightCritical, customHighlights, enabledHighlightIds])

  // Show/Hide Columns — persisted per-browser so a planner's chosen layout survives
  // a reload. Activity name + checkbox columns are always shown (not toggleable).
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(loadVisibleColumns)
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false)
  // Column sort — 3-state cycle per header click: unsorted -> asc -> desc -> unsorted.
  // Not persisted (unlike column widths/visibility) since it's a transient view
  // of "what am I looking for right now", not a durable layout preference.
  const [sortColumn, setSortColumn] = useState<SortKey | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const handleSort = (key: SortKey) => {
    if (sortColumn !== key) {
      setSortColumn(key)
      setSortDirection('asc')
    } else if (sortDirection === 'asc') {
      setSortDirection('desc')
    } else {
      setSortColumn(null)
    }
  }
  const sortHeader = (key: SortKey) => ({
    onSortClick: () => handleSort(key),
    sortDirection: sortColumn === key ? sortDirection : null,
  })
  const isColumnVisible = (key: ColumnKey) => visibleColumns.has(key)
  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }

  // User Defined Fields (docs/SCHEDULING_GAPS_PLAN.md Phase 9) — same
  // show/hide-and-persist shape as the built-in columns above, just for a
  // per-project, dynamic set of custom fields instead of a fixed union.
  // Values are fetched further below, once visibleActivities exists.
  const {
    definitions: udfDefinitions, loading: udfDefinitionsLoading,
    create: createUdfDefinition, update: updateUdfDefinition, remove: removeUdfDefinition,
  } = useUserDefinedFieldDefinitions(selectedProject?.id, 'activity')
  const [visibleUdfFieldIds, setVisibleUdfFieldIds] = useState<Set<string>>(loadVisibleUdfFields)
  const isUdfColumnVisible = (id: string) => visibleUdfFieldIds.has(id)
  const toggleUdfColumn = (id: string) => {
    setVisibleUdfFieldIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(VISIBLE_UDF_FIELDS_STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }
  const visibleUdfDefinitions = udfDefinitions.filter(d => isUdfColumnVisible(d.id))
  // Widened for value-fetching only, not column rendering (2026-07-17) —
  // grouping by a UDF (groupBy = `udf:${id}`) still needs its values
  // fetched even when that field's own grid column isn't separately
  // toggled visible; every other visibleUdfDefinitions consumer (column
  // headers/cells) keeps reading the narrower, column-visibility-only list
  // above unchanged.
  const groupByUdfDefinition = groupBy.startsWith('udf:') ? udfDefinitions.find(d => d.id === groupBy.slice(4)) : undefined
  const udfDefinitionsForValues = groupByUdfDefinition && !visibleUdfDefinitions.includes(groupByUdfDefinition)
    ? [...visibleUdfDefinitions, groupByUdfDefinition]
    : visibleUdfDefinitions
  // Group By dropdown options — the fixed built-ins plus one entry per
  // *text* UDF definition (2026-07-17, per Maro's "Discipline" request —
  // see BASE_GROUP_OPTIONS' own header for why only text UDFs qualify).
  const groupOptions = [
    ...BASE_GROUP_OPTIONS,
    ...udfDefinitions.filter(d => d.data_type === 'text').map(d => ({ value: `udf:${d.id}` as const, label: d.name })),
  ]
  const [udfWidgetOpen, setUdfWidgetOpen] = useState(false)

  // Print Preview (2026-07-07, per Maro: "I need controls and a way to
  // review before going to print") — a live, on-screen rendering of the
  // exact same SchedulingPrintView component instead of only via @media
  // print. Column widths themselves are edited in Page Setup (letterhead.
  // print_column_widths/print_udf_column_width — "let that be inside the
  // page setup, like the way print timescale is in there"), not here; this
  // just derives the effective widths (an explicit save, falling back to
  // PRINT_COLUMN_DEFAULTS for anything never customized) for the preview and
  // the real print to both read.
  const printColumnWidths: Record<ResizableColumnKey, number> = { ...PRINT_COLUMN_DEFAULTS, ...(letterhead?.print_column_widths ?? {}) }
  const printUdfColumnWidth = letterhead?.print_udf_column_width ?? PRINT_UDF_COLUMN_DEFAULT_WIDTH
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false)
  // Export to P6 (2026-07-15, per Maro: "so I can directly export from
  // prosota and p6 can import my file") — a single "Download .xml" button;
  // this used to be a dropdown offering XER or XML, but XER was removed
  // 2026-07-16 (per Maro: "stick to xml. remove the xer functionality
  // completely") once XML alone was confirmed working end-to-end against a
  // real P6 install, so there's no longer a format choice to make.
  const [p6Exporting, setP6Exporting] = useState(false)
  const handleP6Export = async () => {
    if (!period) return
    const projectName = selectedProject?.name ?? 'Project'
    setP6Exporting(true)
    try {
      await downloadP6Xml(period.id, projectName)
    } finally {
      setP6Exporting(false)
    }
  }
  // Import from P6 (2026-07-16, per Maro: "time for the import workflow")
  // — always lands in a brand new Schedule Variant (p6_import.py's own
  // header), so switching to it after a successful import is an explicit
  // choice in the dialog itself, not automatic — refetchVariants (list-only)
  // first so the variant picker's own list includes it before selectVariant
  // runs. Deliberately NOT refetchPeriod/bootstrap here (2026-07-16 fix,
  // found on a real EC00610 import — bootstrap re-settles onto the
  // restored/master variant and swallows its own errors into a generic
  // "Failed to load schedule" state that nothing then clears, even once the
  // very next selectVariant(v) call below succeeds and the imported
  // schedule is actually showing correctly).
  const [p6ImportOpen, setP6ImportOpen] = useState(false)

  // Resizable columns + the pane divider — both drag-to-resize with the same
  // "attach document listeners on mousedown, detach on mouseup, persist on
  // release" pattern, since neither is a fixed set of DOM nodes React can bind
  // cleanup to. Text selection is suppressed for the drag's duration — without
  // it, a fast drag also selects the table's text, which visually fights the
  // resize and can make it look like dragging isn't doing anything.
  const beginDrag = (onMove: (deltaX: number) => void, onEnd: () => void) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const onMouseMove = (moveEvent: MouseEvent) => onMove(moveEvent.clientX - startX)
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = previousUserSelect
      onEnd()
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const [columnWidths, setColumnWidths] = useState<Record<ResizableColumnKey, number>>(loadColumnWidths)
  const startColumnResize = (key: ResizableColumnKey) => {
    const startWidth = columnWidths[key]
    return beginDrag(
      deltaX => setColumnWidths(w => ({ ...w, [key]: Math.max(40, startWidth + deltaX) })),
      () => setColumnWidths(w => {
        localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(w))
        return w
      }),
    )
  }

  // The Gantt pane beside this one is flex-1 with no minimum of its own, so
  // an unbounded leftPaneWidth can squeeze it down to ~0px — invisible, and
  // with its own resize divider pushed off past the right edge along with
  // it, unreachable to drag back (2026-07-12 fix, per Maro: "what did you
  // do to my gantt chart" — the chart wasn't touched, this divider had
  // silently grown wide enough to hide it, with no way to recover short of
  // clearing localStorage by hand). MIN_GANTT_PANE_WIDTH below is enforced
  // both when *loading* a previously-saved width (so a value already stuck
  // in someone's browser self-corrects on the next visit, not just future
  // drags) and while dragging.
  //
  // The *real* trigger turned out to be a second, related bug (2026-07-12,
  // same report — "you enabled all my columns so it pushed the gantt to
  // the right"): whenever leftPaneWidth had never been manually dragged
  // (null), the pane's style fell through to `width: undefined` — no
  // explicit width at all — so with this pane's own flex-shrink:0, it
  // sized itself to its *content's* natural width (every enabled column
  // added together) instead of ever being capped, and being flex-shrink:0
  // meant its flex-1 Gantt sibling was the only one left to absorb the
  // compression, all the way down to nothing. DEFAULT_LEFT_PANE_WIDTH
  // below closes that: the pane always gets a real, capped pixel width,
  // dragged or not — and overflow-x is now `auto`, not `hidden` (was
  // silently clipping instead of scrolling), so extra columns beyond that
  // width are reachable by scrolling the activity table itself, per
  // Maro's own explicit ask: "the activity can be scrollable if there are
  // excess columns."
  const MIN_GANTT_PANE_WIDTH = 240
  const DEFAULT_LEFT_PANE_WIDTH = 700
  const clampLeftPaneWidth = (width: number) => Math.max(320, Math.min(width, window.innerWidth - MIN_GANTT_PANE_WIDTH))
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(() => {
    const saved = localStorage.getItem('prosota_scheduling_left_pane_width')
    return clampLeftPaneWidth(saved ? Number(saved) : DEFAULT_LEFT_PANE_WIDTH)
  })
  const startPaneResize = (e: React.MouseEvent) => {
    const startWidth = leftPaneRef.current?.getBoundingClientRect().width ?? 700
    const containerWidth = leftPaneRef.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth
    const maxWidth = Math.max(320, containerWidth - MIN_GANTT_PANE_WIDTH)
    beginDrag(
      deltaX => setLeftPaneWidth(Math.min(maxWidth, Math.max(320, startWidth + deltaX))),
      () => setLeftPaneWidth(w => {
        localStorage.setItem('prosota_scheduling_left_pane_width', String(w))
        return w
      }),
    )(e)
  }

  // Same drag pattern as beginDrag, tracking clientY instead — the divider
  // between the grid+Gantt pane and the activity-detail panel below it
  // (2026-07-05, per Maro: wanted that split resizable too).
  const beginDragY = (onMove: (deltaY: number) => void, onEnd: () => void) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const onMouseMove = (moveEvent: MouseEvent) => onMove(moveEvent.clientY - startY)
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = previousUserSelect
      onEnd()
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const [topPaneHeight, setTopPaneHeight] = useState<number>(() => {
    const saved = localStorage.getItem('prosota_scheduling_top_pane_height')
    return saved ? Number(saved) : PANE_MAX_HEIGHT
  })
  const startTopPaneResize = (e: React.MouseEvent) => {
    const startHeight = topPaneHeight
    beginDragY(
      deltaY => setTopPaneHeight(Math.max(200, startHeight + deltaY)),
      () => setTopPaneHeight(h => {
        localStorage.setItem('prosota_scheduling_top_pane_height', String(h))
        return h
      }),
    )(e)
  }

  // Inline editing — double-click a cell to edit it in place instead of opening the
  // modal form. Only a handful of fields are safe to edit this way (everything else
  // is either computed by the CPM engine or benefits from the modal's fuller context).
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null)
  const [editingValue, setEditingValue] = useState('')

  // The task_name cell needs both a single-click (open the unified activity-detail
  // panel below the grid) and a double-click (inline rename) behaviour on the same
  // element. The DOM fires two ordinary `click` events before `dblclick` — so
  // naively wiring onClick straight to "expand" means every double-click expands
  // (twice, toggling back off) before inline-editing a moment later. Delaying the
  // single-click action lets a following dblclick cancel it — the standard fix for
  // this browser quirk.
  // Keyed by which activity the pending timer belongs to, not just "is one
  // pending" — a bare boolean guard meant a rapid click on a *different* row
  // while the previous row's timer was still pending got silently dropped,
  // and only the stale first row's delayed action ever fired: clicking
  // Building Pad then quickly clicking Fourth Floor Masonry left the panel
  // showing Building Pad, requiring a second, now-unguarded click on Fourth
  // Floor to actually open it (2026-07-05, per Maro). A different row now
  // cancels the stale pending timer and starts its own immediately, instead
  // of being ignored.
  const nameClickTimer = useRef<{ id: string; timer: number } | null>(null)
  const handleNameClick = (a: Activity) => {
    if (nameClickTimer.current) {
      if (nameClickTimer.current.id === a.id) return
      window.clearTimeout(nameClickTimer.current.timer)
      nameClickTimer.current = null
    }
    const timer = window.setTimeout(() => {
      nameClickTimer.current = null
      setExpandedId(id => id === a.id ? null : a.id)
    }, 220)
    nameClickTimer.current = { id: a.id, timer }
  }
  const handleNameDoubleClick = (a: Activity) => {
    if (nameClickTimer.current && nameClickTimer.current.id === a.id) {
      window.clearTimeout(nameClickTimer.current.timer)
      nameClickTimer.current = null
    }
    startEdit(a, 'task_name')
  }

  // Row clipboard — "copy" snapshots one whole activity; "paste" opens
  // PasteFieldsWidget so exactly which fields get applied is a deliberate,
  // per-paste choice (2026-07-04, per Maro), not fixed at copy time. True
  // cell-value copy/paste is handled for free by the native browser clipboard
  // once a cell becomes a text <input> (see editingCell above); this covers
  // the "seed several similar activities from one configured row" workflow.
  const [rowClipboard, setRowClipboard] = useState<Activity | null>(null)
  const [pasteWidgetOpen, setPasteWidgetOpen] = useState(false)

  // The data grid (left) is the ONE real scrollable element — the Gantt (right)
  // has no scrollbar of its own at all anymore. Instead its row/bar content is
  // shifted by a CSS transform driven directly from the grid's live scrollTop,
  // read straight off its onScroll event every tick (below), the same
  // principle a proven reference Gantt implementation uses (see the long
  // comment on GanttChart.tsx's GanttChartHandle). There is no second scroll
  // position left to fall out of sync with the first — copying scrollTop
  // between two independently-scrolling panes (the previous approach) only
  // stays aligned if both sides' scrollHeight is pixel-identical, which
  // repeatedly turned out not to be reliably true at 140+ rows (2026-07-05,
  // per Maro, after several failed attempts at exactly that).
  //
  // The transform itself is applied via a ref-exposed method (setScrollTop),
  // not React state, so scrolling the grid never triggers a Gantt re-render —
  // going through state/props made the Gantt visibly lag behind the grid,
  // since reconciling ~140 rows of bars on every scroll tick is too slow to
  // track a native scroll gesture smoothly (2026-07-05, per Maro).
  const leftPaneRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<GanttChartHandle>(null)

  useEffect(() => {
    if (!selectedProject || !period) return
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const [activitiesRes, relationshipsRes, calendarsRes, resourcesRes, assignmentsRes, elementLinks] = await Promise.all([
          api.get<Activity[]>('/api/v1/activities/', {
            params: { project_id: selectedProject!.id, schedule_period_id: period!.id },
          }),
          api.get<ActivityRelationship[]>('/api/v1/activity-relationships/', {
            params: { schedule_period_id: period!.id },
          }),
          api.get<Calendar[]>('/api/v1/calendars/', {
            params: { project_id: selectedProject!.id },
          }),
          api.get<Resource[]>('/api/v1/resources/', {
            params: { project_id: selectedProject!.id },
          }),
          api.get<ResourceAssignment[]>('/api/v1/resource-assignments/', {
            params: { schedule_period_id: period!.id },
          }),
          listModelElementLinks(selectedProject!.id),
        ])
        if (!cancelled) {
          setActivities(activitiesRes.data)
          setRelationships(relationshipsRes.data)
          setCalendars(calendarsRes.data)
          setResources(resourcesRes.data)
          setResourceAssignments(assignmentsRes.data)
          setModelElementLinks(elementLinks)
        }
      } catch {
        if (!cancelled) setError('Failed to load schedule')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedProject, period])

  // Delayed/At Risk are computed badges, not stored fields — consistent with how
  // Cost Plan's variance-band fix went (never expose a derivable value as manual
  // input). Delayed = finished later than baseline; At Risk = has float, but not much.
  // Sorts within each WBS parent's sibling group, then re-flattens depth-first —
  // preserves the outline/indentation instead of flattening the whole tree.
  const orderedActivities = useMemo(() => {
    if (!sortColumn) return activities
    const byParent = new Map<string | null, Activity[]>()
    for (const a of activities) {
      const list = byParent.get(a.parent_id)
      if (list) list.push(a)
      else byParent.set(a.parent_id, [a])
    }
    const result: Activity[] = []
    const visit = (parentId: string | null) => {
      const siblings = [...(byParent.get(parentId) ?? [])]
        .sort((a, b) => compareBySortKey(a, b, sortColumn, sortDirection, assignmentsByActivityId, elementLinksByActivityId, profileNameById))
      for (const a of siblings) {
        result.push(a)
        visit(a.id)
      }
    }
    visit(null)
    // Guards against a stale/orphaned parent_id (parent not present in the
    // current list) silently dropping activities from the sorted view.
    if (result.length < activities.length) {
      const seen = new Set(result.map(a => a.id))
      for (const a of activities) if (!seen.has(a.id)) result.push(a)
    }
    return result
  }, [activities, sortColumn, sortDirection, assignmentsByActivityId, elementLinksByActivityId, profileNameById])

  const visibleActivities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const enabledCustomFilters = customFilters
      .map(f => ({ filter: f, mode: customFilterModes[f.id] }))
      .filter((x): x is { filter: SchedulingFilter; mode: 'show' | 'hide' } => x.mode !== undefined)
    return orderedActivities.filter(a => {
      if (isHiddenByCollapse(a)) return false
      if (q) {
        const haystack = [a.code, a.task_name, a.commentary].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      // Hiding archived work also hides the reserved Archived container itself —
      // an empty "Archived" heading with nothing under it is just clutter. Kept
      // as its own always-applied toggle, not folded into the match-mode
      // combination below — "hide archived" is a display preference, not one
      // of the P6-style filter criteria being combined by All/Any.
      if (hideArchived && (a.is_archived || a.is_archive_container)) return false

      // Built-in (P6's "Global" tier) + custom ("User Defined") filters,
      // whichever are currently enabled, combined via the single global
      // match-mode radio — same two-tier model as P6's own Filters dialog.
      // Each custom filter's Show/Hide mode inverts its own result before
      // joining the combination, so "Hide" and "Show" filters can be mixed
      // freely under the same All/Any radio.
      const results: boolean[] = []
      if (filterCritical) results.push(a.is_critical === true)
      if (filterDelayed) results.push(a.variance_days !== null && a.variance_days > 0)
      // ~1-5 working days of float at a nominal 8h/day — an approximation, same as
      // the backend quality module's DCMA thresholds (app/services/scheduling_quality.py).
      if (filterAtRisk) results.push(a.total_float_hours !== null && a.total_float_hours > 0 && a.total_float_hours <= 40)
      for (const { filter, mode } of enabledCustomFilters) {
        const matched = evaluateFilter(a, filter)
        results.push(mode === 'show' ? matched : !matched)
      }
      if (results.length === 0) return true
      return filterMatchMode === 'all' ? results.every(Boolean) : results.some(Boolean)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orderedActivities, searchQuery, filterCritical, filterDelayed, filterAtRisk, hideArchived, collapsedIds,
    customFilters, customFilterModes, filterMatchMode,
  ])

  const { getValue: getUdfValue, setValue: setUdfValue } = useUserDefinedFieldValues(
    udfDefinitionsForValues, visibleActivities.map(a => a.id)
  )

  // Row virtualization for the main Activities grid (2026-07-17 perf fix,
  // per Maro: P6-imported/IFC-generated schedules with real scale made this
  // the laggiest surface in the whole app — every activity used to render
  // as a real <tr> regardless of scroll position). visibleActivities is
  // already the fully filtered/collapse-aware flat list (see its own header
  // above), so this is the simplest virtualization target in the app: pure
  // `index * GANTT_ROW_HEIGHT`, no cumulative-offset pass needed (unlike the
  // two-level Resources-tab trees). Reuses the existing leftPaneRef and its
  // own onScroll handler (below) rather than a new ref — one scroll
  // container already drives the Gantt pane's scroll sync too.
  const GRID_ROW_BUFFER = 20
  const [visibleGridRowRange, setVisibleGridRowRange] = useState<{ start: number; end: number }>({ start: 0, end: Math.min(visibleActivities.length, 40) })

  const recomputeVisibleGridRowRange = () => {
    const el = leftPaneRef.current
    if (!el) return
    const firstVisible = Math.floor(el.scrollTop / GANTT_ROW_HEIGHT)
    const lastVisible = Math.ceil((el.scrollTop + el.clientHeight) / GANTT_ROW_HEIGHT)
    const start = Math.max(0, firstVisible - GRID_ROW_BUFFER)
    const end = Math.min(visibleActivities.length, lastVisible + GRID_ROW_BUFFER)
    setVisibleGridRowRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end })
  }

  // useLayoutEffect, not useEffect — corrects the window before paint
  // whenever visibleActivities itself changes, critical for exactly the
  // P6-import/IFC-generate moment that triggers the reported lag: a stale,
  // possibly-huge previous window must never paint first against a brand
  // new (much larger or smaller) activity list.
  useLayoutEffect(() => {
    recomputeVisibleGridRowRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleActivities])

  const gridScrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleGridScroll = (scrollTop: number) => {
    // Unchanged from before this fix — the Gantt pane still needs to track
    // scroll position immediately, every tick, not debounced.
    ganttRef.current?.setScrollTop(scrollTop)
    if (gridScrollDebounceRef.current !== null) clearTimeout(gridScrollDebounceRef.current)
    gridScrollDebounceRef.current = setTimeout(() => {
      gridScrollDebounceRef.current = null
      recomputeVisibleGridRowRange()
    }, 150)
  }

  useEffect(() => {
    window.addEventListener('resize', recomputeVisibleGridRowRange)
    return () => window.removeEventListener('resize', recomputeVisibleGridRowRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clamped to visibleActivities.length for the same reason every other
  // virtualized table's window is — a filter/search/collapse change can
  // shrink the list before this render's own layout effect has corrected
  // the range.
  const clampedGridRowEnd = Math.min(visibleGridRowRange.end, visibleActivities.length)
  const clampedGridRowStart = Math.min(visibleGridRowRange.start, clampedGridRowEnd)
  const visibleGridRowIndices = useMemo(
    () => Array.from({ length: Math.max(0, clampedGridRowEnd - clampedGridRowStart) }, (_, k) => clampedGridRowStart + k),
    [clampedGridRowStart, clampedGridRowEnd]
  )
  const leadingGridRowSpacerHeight = clampedGridRowStart * GANTT_ROW_HEIGHT
  const trailingGridRowSpacerHeight = Math.max(0, visibleActivities.length - clampedGridRowEnd) * GANTT_ROW_HEIGHT

  // Always-latest ref for handleFocusActivity's own use below — that handler
  // reads this from inside a requestAnimationFrame+setTimeout callback fired
  // *after* a WBS-ancestor-expanding setCollapsedIds call has had a chance to
  // re-render, so it needs the post-expansion visibleActivities, not the one
  // closed over at the moment the handler was originally invoked (the same
  // "read the latest, not the stale closed-over value" reason the old
  // rowRefs Map worked at all — a plain ref mutated every render, not a
  // value captured once).
  const visibleActivitiesRef = useRef(visibleActivities)
  useLayoutEffect(() => {
    visibleActivitiesRef.current = visibleActivities
  })

  // Flat groups over the same already-filtered visibleActivities every other
  // feature here reads from — empty when groupBy is 'none' (tree+Gantt render
  // path used instead, see the JSX below).
  const groupedActivities = useMemo((): [string, Activity[]][] => {
    if (groupBy === 'none') return []
    const map = new Map<string, Activity[]>()
    for (const a of visibleActivities) {
      // WBS Summary/milestone rows dropped from every grouped view (2026-07-17,
      // per Maro — the Discipline grouping's own "(none)" bucket was piling
      // up every WBS folder plus Construction Start/Substantial Completion,
      // since none of those ever carry a value for ANY groupable field, not
      // just Discipline; this was already true of grouping by Resource/
      // Calendar too, just less visible there). Grouped views are now real
      // work only — WBS/milestones stay visible in the normal ungrouped
      // tree+Gantt view (the JSX below switches to that render path whenever
      // groupBy === 'none').
      if (a.activity_type !== 'task') continue
      const key = groupKeyFor(a, groupBy, assignmentsByActivityId, calendars, getUdfValue)
      map.set(key, [...(map.get(key) ?? []), a])
    }
    return [...map.entries()].sort(([x], [y]) => x.localeCompare(y))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleActivities, groupBy, assignmentsByActivityId, calendars, getUdfValue])

  // Row virtualization for the Group-By table (2026-07-17 perf fix) — this
  // table used to render every group header AND every activity row inside
  // it (respecting collapse) unconditionally, real DOM regardless of scroll
  // position; a large P6-imported/IFC-generated schedule with many groups
  // made this table itself real, unbounded cost. Flattened into one row-list
  // unit per group header and per (non-collapsed) activity row, in on-screen
  // order — pure `index * GANTT_ROW_HEIGHT` here (unlike the two-level
  // Resources-tab trees), since the group-header row now shares the same
  // fixed height as an activity row rather than needing its own.
  const flatGroupRows = useMemo(() => {
    const out: ({ type: 'header'; key: string; count: number } | { type: 'activity'; key: string; activity: Activity })[] = []
    for (const [key, acts] of groupedActivities) {
      out.push({ type: 'header', key, count: acts.length })
      if (!collapsedGroups.has(key)) {
        for (const a of acts) out.push({ type: 'activity', key, activity: a })
      }
    }
    return out
  }, [groupedActivities, collapsedGroups])

  // Row-for-row mirror of flatGroupRows for the grouped Gantt pane — see
  // groupHeaderPlaceholder's own header above.
  const groupGanttActivities = useMemo(
    () => flatGroupRows.map(row => row.type === 'activity' ? row.activity : groupHeaderPlaceholder(row.key)),
    [flatGroupRows]
  )
  const groupScrollRef = useRef<HTMLDivElement>(null)
  const GROUP_ROW_BUFFER = 20
  const [visibleGroupRowRange, setVisibleGroupRowRange] = useState<{ start: number; end: number }>({ start: 0, end: Math.min(flatGroupRows.length, 40) })

  const recomputeVisibleGroupRowRange = () => {
    const el = groupScrollRef.current
    if (!el) return
    const firstVisible = Math.floor(el.scrollTop / GANTT_ROW_HEIGHT)
    const lastVisible = Math.ceil((el.scrollTop + el.clientHeight) / GANTT_ROW_HEIGHT)
    const start = Math.max(0, firstVisible - GROUP_ROW_BUFFER)
    const end = Math.min(flatGroupRows.length, lastVisible + GROUP_ROW_BUFFER)
    setVisibleGroupRowRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end })
  }

  useLayoutEffect(() => {
    recomputeVisibleGroupRowRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatGroupRows])

  const groupScrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleGroupScroll = (scrollTop: number) => {
    // Same "every tick, not debounced" reasoning as handleGridScroll — the
    // Gantt pane below needs to track scroll position immediately.
    ganttRef.current?.setScrollTop(scrollTop)
    if (groupScrollDebounceRef.current !== null) clearTimeout(groupScrollDebounceRef.current)
    groupScrollDebounceRef.current = setTimeout(() => {
      groupScrollDebounceRef.current = null
      recomputeVisibleGroupRowRange()
    }, 150)
  }

  useEffect(() => {
    window.addEventListener('resize', recomputeVisibleGroupRowRange)
    return () => window.removeEventListener('resize', recomputeVisibleGroupRowRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clamped to flatGroupRows.length for the same reason every other
  // virtualized table's window is — collapsing/expanding a group can shrink
  // or grow the flattened list before this render's own layout effect has
  // corrected the range.
  const clampedGroupRowEnd = Math.min(visibleGroupRowRange.end, flatGroupRows.length)
  const clampedGroupRowStart = Math.min(visibleGroupRowRange.start, clampedGroupRowEnd)
  const visibleGroupRowIndices = useMemo(
    () => Array.from({ length: Math.max(0, clampedGroupRowEnd - clampedGroupRowStart) }, (_, k) => clampedGroupRowStart + k),
    [clampedGroupRowStart, clampedGroupRowEnd]
  )
  const leadingGroupRowSpacerHeight = clampedGroupRowStart * GANTT_ROW_HEIGHT
  const trailingGroupRowSpacerHeight = Math.max(0, flatGroupRows.length - clampedGroupRowEnd) * GANTT_ROW_HEIGHT

  if (!selectedProject) return null

  const refresh = async () => {
    if (!period) return
    const [activitiesRes, relationshipsRes, calendarsRes, resourcesRes, assignmentsRes, elementLinks] = await Promise.all([
      api.get<Activity[]>('/api/v1/activities/', {
        params: { project_id: selectedProject.id, schedule_period_id: period.id },
      }),
      api.get<ActivityRelationship[]>('/api/v1/activity-relationships/', {
        params: { schedule_period_id: period.id },
      }),
      api.get<Calendar[]>('/api/v1/calendars/', {
        params: { project_id: selectedProject.id },
      }),
      api.get<Resource[]>('/api/v1/resources/', {
        params: { project_id: selectedProject.id },
      }),
      api.get<ResourceAssignment[]>('/api/v1/resource-assignments/', {
        params: { schedule_period_id: period.id },
      }),
      listModelElementLinks(selectedProject.id),
    ])
    setModelElementLinks(elementLinks)
    setActivities(activitiesRes.data)
    setRelationships(relationshipsRes.data)
    setCalendars(calendarsRes.data)
    setResources(resourcesRes.data)
    setResourceAssignments(assignmentsRes.data)
  }

  // buildResourceRecipe's own ResourceRecipeActivity expects real numbers
  // for schedule_material_quantity/schedule_material_cost_per_unit
  // (2026-07-27, per Maro: "how is concrete and steel catered for if they
  // exist") — Activity itself carries them as strings, same "Decimal
  // serializes as a string over the wire" convention schedule_quantity
  // already follows (never converted to a number anywhere before now,
  // since nothing inside buildResourceRecipe read it until this feature).
  // Shared by both call sites just below rather than inlined twice.
  const toResourceRecipeActivities = (source: Activity[]): ResourceRecipeActivity[] =>
    source.map(a => ({
      id: a.id, schedule_category: a.schedule_category, schedule_phase_key: a.schedule_phase_key,
      schedule_material_name: a.schedule_material_name,
      schedule_material_quantity: a.schedule_material_quantity !== null ? Number(a.schedule_material_quantity) : null,
      schedule_material_unit: a.schedule_material_unit,
      schedule_material_cost_per_unit: a.schedule_material_cost_per_unit !== null ? Number(a.schedule_material_cost_per_unit) : null,
    }))

  // "Generate Resources" — stage 1 of Maro's two-stage flow: reads every
  // activity's own schedule_category/schedule_phase_key (set at IFC
  // schedule-generation time, see Activity.schedule_category's backend
  // docstring), derives the crew/equipment each one needs off the same rate
  // table schedule generation itself used to use, and populates the
  // Resource Pool with them — no assignments yet, so the user can freely
  // edit/delete/rename what lands here before anything gets linked to real
  // work. dedupe_resources_by_name means running this again later (e.g.
  // after linking more IFC elements and regenerating) only adds resources
  // for genuinely new crew/equipment names, never duplicates.
  const handleGenerateResources = async () => {
    if (!period) return
    const { resources: recipeResources } = buildResourceRecipe(toResourceRecipeActivities(activities))
    if (recipeResources.length === 0) {
      setResourceGenMessage('No IFC-generated activities found (nothing has a schedule category yet).')
      return
    }
    setResourceGenBusy('generate')
    setResourceGenMessage(null)
    try {
      const { data } = await api.post('/api/v1/schedule-bulk-generate/', {
        project_id: selectedProject.id, schedule_period_id: period.id,
        activities: [], resources: recipeResources, assignments: [], relationships: [],
        dedupe_resources_by_name: true,
      })
      await refresh()
      const reused = recipeResources.length - data.resource_count
      setResourceGenMessage(
        `Resource pool updated — ${data.resource_count} new resource(s)${reused > 0 ? `, ${reused} already existed` : ''}.`
      )
    } catch (err) {
      setResourceGenMessage(axios.isAxiosError(err)
        ? `Failed to generate resources (${err.response?.data?.detail ?? err.message})`
        : 'Failed to generate resources')
    } finally {
      setResourceGenBusy(null)
    }
  }

  // "Auto Assign Resources" — stage 2: links the pool (by name — expects
  // "Generate Resources" to have already been run, but sends the same
  // dedupe_resources_by_name recipe again so it's self-sufficient even if
  // run on its own) to every one of those same activities.
  // skip_existing_assignments makes this safely repeatable too — re-running
  // after linking a few more elements only assigns the newly-eligible
  // activities, never re-assigns (and re-costs) one that already has its
  // resource.
  const handleAutoAssignResources = async () => {
    if (!period) return
    const { resources: recipeResources, assignments: recipeAssignments } = buildResourceRecipe(toResourceRecipeActivities(activities))
    if (recipeAssignments.length === 0) {
      setResourceGenMessage('No IFC-generated activities found (nothing has a schedule category yet).')
      return
    }
    setResourceGenBusy('assign')
    setResourceGenMessage(null)
    try {
      const { data } = await api.post('/api/v1/schedule-bulk-generate/', {
        project_id: selectedProject.id, schedule_period_id: period.id,
        activities: [], resources: recipeResources, assignments: recipeAssignments, relationships: [],
        dedupe_resources_by_name: true, skip_existing_assignments: true,
      })
      await refresh()
      const skipped = recipeAssignments.length - data.assignment_count
      setResourceGenMessage(
        `${data.assignment_count} assignment(s) created${skipped > 0 ? `, ${skipped} already assigned` : ''}.`
      )
    } catch (err) {
      setResourceGenMessage(axios.isAxiosError(err)
        ? `Failed to auto-assign resources (${err.response?.data?.detail ?? err.message})`
        : 'Failed to auto-assign resources')
    } finally {
      setResourceGenBusy(null)
    }
  }

  // Tagging/untagging changes the affected activities' codes (SP-####) and
  // sub_total_float_hours/sub_is_critical — refresh the activity list too,
  // not just the subprojects list itself (2026-07-06, per Maro).
  const handleCreateSubproject = async (name: string, rootWbsId: string) => {
    await createSubproject(name, rootWbsId)
    await refresh()
  }
  const handleUpdateSubproject = async (id: string, name: string, rootWbsId: string) => {
    await updateSubproject(id, name, rootWbsId)
    await refresh()
  }
  const handleDeleteSubproject = async (id: string) => {
    await removeSubproject(id)
    await refresh()
  }

  // Just adds a blank row (2026-07-03, per Maro) — the old modal form was
  // redundant since clicking any row already opens the same fields via the
  // unified detail panel below the grid; this jumps straight there.
  const handleQuickAdd = async () => {
    if (!period) return
    // duration_hours defaults to one nominal working day, not left blank —
    // a zero/null-duration task is a degenerate zero-length span, which
    // (since it starts and finishes at the very same instant as today's
    // data date) reads as 100% "Schedule % Complete" the moment it's
    // created, rather than 0% at the start of its first working day
    // (2026-07-03, per Maro).
    const { data } = await api.post<Activity>('/api/v1/activities/', {
      task_name: 'New Activity', project_id: selectedProject.id, schedule_period_id: period.id, duration_hours: 8,
    })
    await refresh()
    setExpandedId(data.id)
  }

  const handleUpdate = async (
    activity: Activity, values: ActivityFormValues, reassessmentNote: string | null, amendRelationships = false
  ) => {
    const payload = toActivityPayload(values, calendarLookup, activity.activity_type === 'wbs_summary', activity.status)
    try {
      await api.patch(`/api/v1/activities/${activity.id}`, amendRelationships ? { ...payload, amend_relationships: true } : payload)
    } catch (err) {
      // Changing activity_type to/from a Start/Finish Milestone can leave
      // existing relationships invalid — the backend flags this as a 409
      // (distinct from an ordinary 422 validation error) listing what would
      // need to change, rather than silently rejecting or silently fixing
      // it (2026-07-07, per Maro: warn, then amend on confirmation).
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const detail = (err.response.data as { detail?: string } | undefined)?.detail ?? 'This change conflicts with existing relationships.'
        if (window.confirm(`${detail}\n\nAmend them automatically and proceed?`)) {
          return handleUpdate(activity, values, reassessmentNote, true)
        }
        return
      }
      throw err
    }
    if (reassessmentNote) {
      await api.post('/api/v1/reassessments/', {
        record_type: 'activity', record_id: activity.id, note: reassessmentNote,
      })
      setReassessmentRefreshKey(k => k + 1)
    }
    await refresh()
  }

  const handleDelete = async (activity: Activity): Promise<boolean> => {
    const childCount = activities.filter(a => a.parent_id === activity.id).length
    let cascade = true

    if (childCount > 0) {
      const label = `${childCount} sub-activit${childCount === 1 ? 'y' : 'ies'}`
      // Deliberately a plain window.confirm, not confirmWithDontAsk: OK and
      // Cancel are both live, meaningful branches here (cascade-delete vs.
      // promote children), not a single "proceed/cancel" choice — there's no
      // safe default to silently remember and replay forever.
      cascade = window.confirm(
        `"${activity.task_name}" has ${label}. Delete them too?\n\n` +
        `OK = delete "${activity.task_name}" and all ${label}.\n` +
        `Cancel = delete only "${activity.task_name}" — its ${label} move up to its level instead.`
      )
    } else if (!(await confirmWithDontAsk('scheduling.activity-delete', `Delete activity "${activity.task_name}"? This cannot be undone.`))) {
      return false
    }

    const { data } = await api.delete<{ archived: boolean }>(`/api/v1/activities/${activity.id}`, { params: { cascade } })
    await refresh()
    if (data.archived) {
      window.alert(
        `"${activity.task_name}" is part of a saved baseline, so it was archived instead of deleted — ` +
        `actualised to 100% complete and moved under the Archived WBS, to keep that baseline's audit trail intact.`
      )
    }
    return true
  }

  const handleArchive = async (activity: Activity): Promise<boolean> => {
    const childCount = activities.filter(a => a.parent_id === activity.id).length
    let cascade = true
    if (childCount > 0) {
      const label = `${childCount} sub-activit${childCount === 1 ? 'y' : 'ies'}`
      cascade = window.confirm(
        `"${activity.task_name}" has ${label}. Archive them too?\n\n` +
        `OK = archive "${activity.task_name}" and all ${label}.\n` +
        `Cancel = archive only "${activity.task_name}" — its ${label} move up to its level instead.`
      )
    } else if (!(await confirmWithDontAsk(
      'scheduling.activity-archive',
      `Archive "${activity.task_name}"? It's actualised to 100% complete, its relationships are removed, and it moves under the Archived WBS — not deleted, so it stays fully referenceable.`
    ))) {
      return false
    }
    await api.post(`/api/v1/activities/${activity.id}/archive`, null, { params: { cascade } })
    await refresh()
    return true
  }

  // Indent = become a child of the row immediately above it in outline order;
  // Outdent = move up one level, to the current parent's parent — both just a
  // parent_id PATCH, the server re-derives wbs_path/activity_type/rollups. MS
  // Project style, per docs/SCHEDULING_MODULE_PLAN.md Phase 2. Now bulk-only
  // (handleBulkIndent/handleBulkOutdent below) — the single-row versions were
  // retired once selection could hold more than one row.

  // Move up/down = reorder among current siblings (display order/WBS numbering
  // only — a separate lever from indent/outdent's hierarchy level). Added per
  // Maro: indenting only lets an activity become a child of whatever row is
  // immediately above it, so repositioning it under a different summary first
  // meant deleting and recreating activities in the right order.
  const handleMoveUp = async (activity: Activity) => {
    await api.post(`/api/v1/activities/${activity.id}/move`, { direction: 'up' })
    await refresh()
  }

  const handleMoveDown = async (activity: Activity) => {
    await api.post(`/api/v1/activities/${activity.id}/move`, { direction: 'down' })
    await refresh()
  }

  const startEdit = (a: Activity, field: EditableField) => {
    if (a.activity_type === 'wbs_summary' && LOCKED_ON_WBS_SUMMARY.includes(field)) return
    // A Finish Milestone's Start (and a Start Milestone's Finish) isn't a
    // meaningful, separately-editable date — it's just populated equal to
    // the other one internally, since CPM needs a concrete instant either
    // way (2026-07-07, per Maro).
    if (a.activity_type === 'finish_milestone' && field === 'start') return
    if (a.activity_type === 'start_milestone' && field === 'finish') return
    setEditingCell({ id: a.id, field })
    setEditingValue(
      field === 'task_name' ? a.task_name
      : field === 'code' ? a.code
      // Edited in days (what planners actually type), converted to duration_hours
      // on commit below — the backend's hour-precision CPM engine is unaffected,
      // this is purely a display/input convenience.
      : field === 'duration_hours' ? String(a.duration_days ?? '')
      : field === 'pct_complete' ? String(a.pct_complete ?? '')
      : field === 'status' ? activityStatus(a)
      : field === 'start' ? toDatetimeLocalValue(a.start)
      : field === 'finish' ? toDatetimeLocalValue(a.finish)
      : field === 'animation_profile_id' ? (a.animation_profile_id ?? '')
      : a.activity_type
    )
  }

  const cancelEdit = () => setEditingCell(null)

  // overrideValue (2026-07-22, for the animation_profile_id <select> below)
  // — a plain <select>'s onChange and the blur that follows selecting an
  // option can both fire within the same native event-processing pass,
  // before React has re-rendered with the new editingValue; onBlur's own
  // commitEdit() call was then still closing over the *previous* render's
  // editingValue, silently PATCHing back whatever was already saved (a real
  // bug, confirmed live: three separate PATCH 200s in a row, each one a
  // no-op, because editingValue read '' every time no matter which profile
  // was actually clicked). Reading the value directly from the change event
  // instead of waiting for it to round-trip through state sidesteps the
  // timing gap entirely — see the select's own onChange below.
  const commitEdit = async (overrideValue?: string) => {
    if (!editingCell) return
    const { id, field } = editingCell
    const value = overrideValue ?? editingValue

    let payload: Record<string, unknown>
    if (field === 'duration_hours') {
      const days = value.trim() === '' ? null : Number(value)
      if (days !== null && Number.isNaN(days)) { setEditingCell(null); return }
      const activity = activities.find(a => a.id === id)
      const hoursPerDay = activity ? resolveHoursPerDay(activity, calendarLookup) : 8
      payload = { duration_hours: days !== null ? days * hoursPerDay : null }
    } else if (field === 'pct_complete') {
      const num = value.trim() === '' ? null : Number(value)
      if (num !== null && Number.isNaN(num)) { setEditingCell(null); return }
      payload = { pct_complete: num }
    } else if (field === 'start') {
      if (!value) { setEditingCell(null); return }
      // Soft constraint (P6/MS Project "Start On or After") — the activity's normal
      // logic can still push it later than this; it just can't start earlier.
      if (!(await confirmWithDontAsk(
        'scheduling.set-start-constraint',
        'Setting a start date applies a "Start On or After" constraint — this activity ' +
        'will never start earlier than it, though its normal logic/dependencies can still push it later. Continue?'
      ))) { setEditingCell(null); return }
      payload = { constraint_type: 'snet', constraint_date: value }
    } else if (field === 'finish') {
      if (!value) { setEditingCell(null); return }
      // Backend translates this into a new duration_hours (Start stays put) — see
      // app/services/scheduling_cpm.py:compute_duration_for_finish.
      payload = { finish: value }
    } else if (field === 'status') {
      // The state machine (which fields a target status implies) now lives
      // entirely server-side (app/services/activity.py:_apply_status_change,
      // since `status` became a real column, 2026-09-03) — this just sends
      // the pick. The "are you sure" warning for a data-discarding
      // transition stays client-side (a UX concern, not a data-integrity
      // one), checked against the real underlying fields directly rather
      // than re-deriving a status label from them.
      const activity = activities.find(a => a.id === id)
      if (!activity) { setEditingCell(null); return }
      const target = ACTIVITY_STATUS_VALUES[value as ActivityStatus]
      if (target === activity.status) { setEditingCell(null); return }
      const hasRecordedProgress = (activity.pct_complete !== null && Number(activity.pct_complete) > 0)
        || activity.suspend_date !== null || activity.actual_start !== null || activity.actual_finish !== null
      if ((target === 'planned' || activity.status === 'completed') && hasRecordedProgress && !(await confirmWithDontAsk(
        'scheduling.reset-activity-status',
        `"${activity.task_name}" is currently ${activityStatus(activity)}, with recorded progress (% Complete, ` +
        `actuals, and/or a suspend date). Changing it to ${value} clears all of that back to a fresh, un-started ` +
        'state. Continue?'
      ))) { setEditingCell(null); return }
      payload = { status: target }
    } else if (field === 'animation_profile_id') {
      // '' from the "Default" option means no override, not the literal
      // string '' (which would fail the backend's UUID validation) — same
      // null-means-inherit convention ElementLinkFields.tsx's own per-link
      // picker already uses.
      payload = { animation_profile_id: value || null }
    } else {
      payload = { [field]: value }
    }

    try {
      await api.patch(`/api/v1/activities/${id}`, payload)
      setEditingCell(null)
      await refresh()
    } catch (err) {
      const message = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
      window.alert(message ?? 'Could not save that change.')
    }
  }

  const handleCopyRow = (a: Activity) => {
    setRowClipboard(a)
  }

  const depthOf = (a: Activity) => (a.wbs_path ? a.wbs_path.split('.').length - 1 : 0)
  const expandedActivity = activities.find(a => a.id === expandedId) ?? null

  // Row shade signifies type (2026-07-03, per Maro — replaces an earlier
  // bold/uppercase idea): an enabled Highlight takes priority over type
  // (2026-07-06, per Maro — replaces the old always-on automatic critical
  // tint; see highlightedActivityIds above and SchedulingHighlightsWidget),
  // then WBS summary (shaded progressively lighter per nesting level — see
  // wbsRowBackground), then milestone, else the flat "normal activity" tint
  // (white by default, i.e. invisible, until a Layout changes it). isCritical
  // is always passed false here — it still exists in activityRowBackground
  // for ActivityPicker's own, separate use.
  const rowBackground = (a: Activity): string | undefined => activityRowBackground(ganttStyle, {
    isArchived: a.is_archived || a.is_archive_container,
    isCritical: false,
    isHighlighted: highlightedActivityIds.has(a.id),
    activityType: a.activity_type,
    depth: depthOf(a),
  })

  // True siblings (same parent_id), not the filtered/searched visibleActivities —
  // move up/down talks to the backend's real sibling group regardless of what a
  // search/filter is currently hiding, so the button's disabled state must match.
  const sortedSiblingsOf = (a: Activity) =>
    activities
      .filter(x => x.parent_id === a.parent_id)
      .sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
  const isFirstSibling = (a: Activity) => sortedSiblingsOf(a)[0]?.id === a.id
  const isLastSibling = (a: Activity) => {
    const siblings = sortedSiblingsOf(a)
    return siblings[siblings.length - 1]?.id === a.id
  }

  // Bulk toolbar (checkbox column + the icons next to Print) — replaces the old
  // per-row copy/paste/move/indent/outdent/delete column. Copy/Move still only
  // apply with exactly one row checked (soleSelected); indent/outdent below
  // work on the whole selection at once.
  const selectedActivities = activities.filter(a => selectedIds.has(a.id))
  const soleSelected = selectedActivities.length === 1 ? selectedActivities[0] : null

  const toggleSelectAll = () => {
    setSelectedIds(prev =>
      prev.size === visibleActivities.length && visibleActivities.length > 0
        ? new Set()
        : new Set(visibleActivities.map(a => a.id))
    )
  }

  const handleBulkCopy = () => { if (soleSelected) handleCopyRow(soleSelected) }
  const handleBulkMoveUp = async () => { if (soleSelected) await handleMoveUp(soleSelected) }
  const handleBulkMoveDown = async () => { if (soleSelected) await handleMoveDown(soleSelected) }

  // Indent/outdent work on the whole selection at once (2026-07-04, per Maro
  // — previously single-row only). Outdent has no ordering dependency between
  // selected rows, so each just moves to its own parent's parent independently.
  const handleBulkOutdent = async () => {
    const targets = selectedActivities.filter(a => a.parent_id)
    if (targets.length === 0) return
    for (const a of targets) {
      const parent = activities.find(x => x.id === a.parent_id)
      await api.patch(`/api/v1/activities/${a.id}`, { parent_id: parent?.parent_id ?? null })
    }
    await refresh()
  }

  // Indent needs one shared target: whichever row sits immediately above the
  // topmost selected row (skipping past any other selected rows there) —
  // every selected activity becomes a sibling child of that one row, rather
  // than nesting inside each other one at a time (which is what re-applying
  // "the row above me" per activity, in sequence, would otherwise produce
  // for a contiguous selection).
  const bulkIndentTarget = (): Activity | null => {
    if (selectedActivities.length === 0) return null
    const sorted = [...selectedActivities].sort(
      (a, b) => visibleActivities.findIndex(x => x.id === a.id) - visibleActivities.findIndex(x => x.id === b.id)
    )
    let cursor = visibleActivities.findIndex(a => a.id === sorted[0].id) - 1
    while (cursor >= 0 && selectedIds.has(visibleActivities[cursor].id)) cursor--
    return cursor >= 0 ? visibleActivities[cursor] : null
  }
  const handleBulkIndent = async () => {
    const target = bulkIndentTarget()
    if (!target) return
    const sorted = [...selectedActivities].sort(
      (a, b) => visibleActivities.findIndex(x => x.id === a.id) - visibleActivities.findIndex(x => x.id === b.id)
    )
    for (const a of sorted) {
      await api.patch(`/api/v1/activities/${a.id}`, { parent_id: target.id })
    }
    await refresh()
  }

  const handleBulkPaste = () => {
    if (!rowClipboard || selectedActivities.length === 0) return
    setPasteWidgetOpen(true)
  }

  const handleBulkDuplicate = async () => {
    if (selectedActivities.length === 0 || !period) return
    if (!(await confirmWithDontAsk(
      'scheduling.bulk-duplicate',
      `Duplicate ${selectedActivities.length} selected activit${selectedActivities.length === 1 ? 'y' : 'ies'}? Each copy is added immediately below its original. Relationships and resource assignments are not copied.`
    ))) return
    for (const a of selectedActivities) {
      await api.post('/api/v1/activities/', {
        project_id: selectedProject.id,
        schedule_period_id: period.id,
        parent_id: a.parent_id,
        // Lands right after the source, not appended at the end of the group
        // (2026-07-04, per Maro — that "end" could otherwise be past the
        // reserved Archive container, or past unrelated later siblings).
        insert_after_id: a.id,
        task_name: `${a.task_name} (copy)`,
        activity_type: a.activity_type,
        duration_hours: a.duration_hours,
        pct_complete: a.pct_complete,
        constraint_type: a.constraint_type,
        constraint_date: a.constraint_date,
        calendar_id: a.calendar_id,
        commentary: a.commentary,
      })
    }
    setSelectedIds(new Set())
    await refresh()
  }

  // Only top-level checked activities get their own cascade-delete call — a
  // checked descendant of another checked activity would otherwise 404 once its
  // ancestor's cascade already removed it.
  const isDescendantOfSelected = (a: Activity): boolean => {
    let current = a
    while (current.parent_id) {
      const parent = activities.find(x => x.id === current.parent_id)
      if (!parent) return false
      if (selectedIds.has(parent.id)) return true
      current = parent
    }
    return false
  }

  const handleBulkDelete = async () => {
    // Single selection keeps the richer per-activity confirm (option to move its
    // children up a level instead of cascading) — only true multi-select falls
    // back to the simpler always-cascade bulk confirm below.
    if (soleSelected) {
      if (await handleDelete(soleSelected)) setSelectedIds(new Set())
      return
    }
    // is_archive_container excluded, not just left to the backend's own 422
    // (2026-07-27 — "Select All" sweeps up the Archived container along with
    // everything else, and the button used to just disable itself entirely
    // whenever it was among the selection, with no explanation, blocking a
    // legitimate bulk-delete of everything else). Silently skipped rather
    // than attempted-and-erroring, since it's never a deliberate target of
    // a broad multi-select the way a real activity is.
    const topLevel = selectedActivities.filter(a => !isDescendantOfSelected(a) && !a.is_archive_container)
    if (topLevel.length === 0) return
    const withChildren = topLevel.filter(a => activities.some(x => x.parent_id === a.id))
    const message = withChildren.length > 0
      ? `Delete ${topLevel.length} selected activit${topLevel.length === 1 ? 'y' : 'ies'}? ${withChildren.length} of them ${withChildren.length === 1 ? 'has' : 'have'} sub-activities — those will be deleted too. This cannot be undone.`
      : `Delete ${topLevel.length} selected activit${topLevel.length === 1 ? 'y' : 'ies'}? This cannot be undone.`
    if (!(await confirmWithDontAsk('scheduling.bulk-delete', message))) return
    // One request, one server-side hierarchy+CPM recompute for the whole
    // batch (2026-09-03, per Maro: "takes a long time to delete all
    // activities" — the old per-activity DELETE loop paid that recompute
    // once per selected activity, the dominant cost for a large multi-select
    // like a freshly P6-imported schedule).
    const { data } = await api.post<{ deleted_count: number; archived_count: number }>(
      '/api/v1/activities/bulk-delete', { activity_ids: topLevel.map(a => a.id) },
    )
    const archivedCount = data.archived_count
    setSelectedIds(new Set())
    await refresh()
    if (archivedCount > 0) {
      window.alert(
        `${archivedCount} of ${topLevel.length} selected activit${topLevel.length === 1 ? 'y is' : 'ies were'} part of a ` +
        `saved baseline, so ${archivedCount === 1 ? 'it was' : 'they were'} archived instead of deleted — actualised to 100% ` +
        `complete and moved under the Archived WBS, to keep that baseline's audit trail intact.`
      )
    }
  }

  const handleBulkArchive = async () => {
    if (soleSelected) {
      if (await handleArchive(soleSelected)) setSelectedIds(new Set())
      return
    }
    const topLevel = selectedActivities.filter(a => !isDescendantOfSelected(a) && !a.is_archive_container)
    if (topLevel.length === 0) return
    if (!(await confirmWithDontAsk(
      'scheduling.bulk-archive',
      `Archive ${topLevel.length} selected activit${topLevel.length === 1 ? 'y' : 'ies'} (and any sub-activities)? ` +
      `Each is actualised to 100% complete, its relationships are removed, and it moves under the Archived WBS.`
    ))) return
    for (const a of topLevel) {
      await api.post(`/api/v1/activities/${a.id}/archive`, null, { params: { cascade: true } })
    }
    setSelectedIds(new Set())
    await refresh()
  }

  if (loading || periodLoading) {
    return <div className="p-8 text-sm text-gray-400 dark:text-prosota-muted">Loading schedule…</div>
  }

  return (
    <>
    <div className="p-8 no-print">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-prosota-paper">Scheduling &amp; Resourcing</h1>
      </div>

      {(error || periodError) && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md text-red-700 dark:text-red-400 text-sm">{error ?? periodError}</div>
      )}

      <div className="mb-5 flex items-center gap-1 border-b border-gray-200 dark:border-prosota-line no-print">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`text-sm px-4 py-2 font-medium border-b-2 -mb-px ${
            activeTab === 'schedule' ? 'border-gray-900 text-gray-900 dark:text-prosota-paper' : 'border-transparent text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper'
          }`}
        >
          Activities
        </button>
        <button
          onClick={() => setActiveTab('resources')}
          className={`text-sm px-4 py-2 font-medium border-b-2 -mb-px ${
            activeTab === 'resources' ? 'border-gray-900 text-gray-900 dark:text-prosota-paper' : 'border-transparent text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper'
          }`}
        >
          Resources
        </button>
      </div>

      {activeTab === 'resources' && (
        <>
          {/* One shared toolbar above all three tables (2026-07-08, per Maro:
              "I want all the toolbars in the same area... looking neat") —
              Pool/Tracking/Profile keep only their own table-specific Columns
              menu, everything else lives here. */}
          <div className="mb-3 flex items-center gap-1 flex-wrap no-print">
            <button
              onClick={handleCollapseAllResources}
              title="Collapse every resource's activity list"
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan px-1.5"
            ><CollapseIcon expanded={false} /> Collapse All</button>
            <button
              onClick={handleExpandAllResources}
              title="Expand every resource's activity list"
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan px-1.5"
            ><CollapseIcon expanded /> Expand All</button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <label className="text-xs text-gray-500 dark:text-prosota-muted flex items-center gap-1">
              From
              <input
                type="date"
                value={toDatetimeLocalValue(resourcesTabData.rangeStart.toISOString()).slice(0, 10)}
                onChange={e => setResourcesRangeStartOverride(e.target.value ? new Date(e.target.value) : null)}
                className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1 text-xs"
              />
            </label>
            <label className="text-xs text-gray-500 dark:text-prosota-muted flex items-center gap-1">
              To
              <input
                type="date"
                value={toDatetimeLocalValue(resourcesTabData.rangeEnd.toISOString()).slice(0, 10)}
                onChange={e => setResourcesRangeEndOverride(e.target.value ? new Date(e.target.value) : null)}
                className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1 text-xs"
              />
            </label>
            {(resourcesRangeStartOverride || resourcesRangeEndOverride) && (
              <button
                onClick={() => { setResourcesRangeStartOverride(null); setResourcesRangeEndOverride(null) }}
                className="text-[10px] text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper"
              >Reset</button>
            )}
            <select
              value={resourcesZoom}
              onChange={e => setResourcesZoom(e.target.value as GanttZoom)}
              className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1"
            >
              {ZOOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="flex items-center border border-gray-300 dark:border-prosota-line rounded overflow-hidden text-xs">
              <button
                onClick={() => setResourcesUnit('hours')}
                className={`px-2 py-1 ${resourcesUnit === 'hours' ? 'bg-gray-900 text-white' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2'}`}
              >Hours</button>
              <button
                onClick={() => setResourcesUnit('days')}
                className={`px-2 py-1 ${resourcesUnit === 'days' ? 'bg-gray-900 text-white' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2'}`}
              >Days</button>
              <button
                onClick={() => setResourcesUnit('cost')}
                title="Shows £ — resource.rate/max_hours_per_day, so make sure rates are populated in Resource Pool"
                className={`px-2 py-1 ${resourcesUnit === 'cost' ? 'bg-gray-900 text-white' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2'}`}
              >Cost</button>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {resourceGenMessage && (
                <div className="text-[11px] text-gray-500 dark:text-prosota-muted max-w-xs truncate" title={resourceGenMessage}>{resourceGenMessage}</div>
              )}
              <button
                onClick={handleGenerateResources}
                disabled={resourceGenBusy !== null}
                title="Populates the Resource Pool below from every IFC-generated activity's own crew/equipment recipe — no assignments yet, review/edit the pool first"
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-40 disabled:cursor-not-allowed"
              >{resourceGenBusy === 'generate' ? 'Generating…' : 'Generate Resources'}</button>
              <button
                onClick={handleAutoAssignResources}
                disabled={resourceGenBusy !== null}
                title="Links the Resource Pool below to every IFC-generated activity — run after Generate Resources, once the pool looks right"
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-40 disabled:cursor-not-allowed"
              >{resourceGenBusy === 'assign' ? 'Assigning…' : 'Auto Assign Resources'}</button>
              <div className="w-px h-4 bg-gray-200 mx-1" />
              <div className="relative">
                <button
                  onClick={() => setLevelPanelOpen(o => !o)}
                  className={`text-xs px-2 py-1 rounded border ${levelPanelOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'}`}
                >Level Resources</button>
                {levelPanelOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded shadow-lg p-3 z-30 text-xs w-80 space-y-2.5">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox" checked={levelAllAtOnce}
                        onChange={e => { setLevelAllAtOnce(e.target.checked); resetLevelSearch() }}
                      />
                      Level all resources at once
                    </label>
                    {!levelAllAtOnce && (
                      <div className="text-[10px] text-gray-400 dark:text-prosota-muted -mt-1">
                        Uses whatever's checked in Resource Pool, Tracking, or Profile below.
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span>Find by</span>
                      <div className="flex items-center border border-gray-300 dark:border-prosota-line rounded overflow-hidden">
                        <button
                          onClick={() => { setLevelGranularity('resource'); resetLevelSearch() }}
                          className={`px-2 py-1 ${levelGranularity === 'resource' ? 'bg-gray-900 text-white' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2'}`}
                        >Resource</button>
                        <button
                          onClick={() => { setLevelGranularity('activity'); resetLevelSearch() }}
                          className={`px-2 py-1 ${levelGranularity === 'activity' ? 'bg-gray-900 text-white' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2'}`}
                        >Activity</button>
                      </div>
                    </div>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox" checked={levelMode === 'smooth'}
                        onChange={e => { setLevelMode(e.target.checked ? 'smooth' : 'level'); resetLevelSearch() }}
                      />
                      Apply resource smoothing
                    </label>
                    <div className="text-[10px] text-gray-400 dark:text-prosota-muted leading-snug border-t border-gray-100 dark:border-prosota-line pt-2">
                      {levelMode === 'smooth'
                        ? 'Smoothing redistributes work within each activity\'s own float — the project end date and critical path stay fixed. Overallocation may not fully resolve if float runs out.'
                        : 'Leveling delays overallocated activities to resolve the conflict — it can push out the project end date and change the critical path.'}
                    </div>
                    <div className="border-t border-gray-100 dark:border-prosota-line pt-2 space-y-1.5">
                      <button
                        onClick={handleFindNextOverallocated}
                        disabled={levelSearching || levelExhausted}
                        className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-40 disabled:cursor-not-allowed"
                      >{levelExhausted ? 'No more overallocation in scope' : levelSearching ? 'Searching…' : 'Find Next Overallocated'}</button>
                      {levelFoundTarget && (
                        <div className="text-[11px] text-gray-600 dark:text-prosota-muted bg-gray-50 dark:bg-prosota-panel2 border border-gray-200 dark:border-prosota-line rounded px-2 py-1">
                          Found: {levelFoundTarget.label}
                        </div>
                      )}
                      <button
                        onClick={handleLevelFoundTarget}
                        disabled={!levelFoundTarget || leveling}
                        className="w-full text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-40 disabled:cursor-not-allowed"
                      >{leveling ? 'Applying…' : levelMode === 'smooth' ? 'Smooth' : 'Level'}</button>
                      {levelResultMessage && <div className="text-[11px] text-gray-500 dark:text-prosota-muted">{levelResultMessage}</div>}
                    </div>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setResourcesLayoutOpen(o => !o)}
                  className={`text-xs px-2 py-1 rounded border ${resourcesLayoutOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'}`}
                >Layout</button>
                {resourcesLayoutOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded shadow-lg p-3 z-30 text-xs w-56 space-y-2">
                    <div className="text-[10px] text-gray-400 dark:text-prosota-muted">Applies to Resource Pool, Tracking, and Usage Profile on screen.</div>
                    <label className="flex items-center justify-between gap-2">
                      Font
                      <select
                        value={resourcesLayoutPrefs.fontFamily}
                        onChange={e => saveResourcesLayoutPrefs({ ...resourcesLayoutPrefs, fontFamily: e.target.value as GanttFontFamily })}
                        className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
                      >
                        <option value="sans">Sans-serif</option>
                        <option value="serif">Serif</option>
                        <option value="mono">Monospace</option>
                      </select>
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      Font size
                      <input
                        type="number" min={9} max={16} value={resourcesLayoutPrefs.fontSize}
                        onChange={e => saveResourcesLayoutPrefs({ ...resourcesLayoutPrefs, fontSize: Number(e.target.value) || DEFAULT_RESOURCES_LAYOUT.fontSize })}
                        className="w-14 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      Header colour
                      <input
                        type="color" value={resourcesLayoutPrefs.headerColor}
                        onChange={e => saveResourcesLayoutPrefs({ ...resourcesLayoutPrefs, headerColor: e.target.value })}
                        className="w-10 h-6 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded"
                      />
                    </label>
                    <button onClick={() => saveResourcesLayoutPrefs(DEFAULT_RESOURCES_LAYOUT)} className="text-[10px] text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">
                      Reset to defaults
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => setResourcesPageSetupOpen(o => !o)}
                title="Shared logo/header/footer, print font, and which table(s) to include when printing/exporting"
                className={`text-xs px-2 py-1 rounded border ${resourcesPageSetupOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'}`}
              >Page Setup</button>
              <div className="relative">
                <button
                  onClick={() => setResourcesExportOpen(o => !o)}
                  title="Choose which tables to include, then download"
                  className={`text-xs px-2 py-1 rounded border ${
                    resourcesExportOpen ? 'bg-gray-900 text-white border-gray-900'
                    : resourcesPrintTables.size !== ALL_RESOURCES_PRINT_TABLES.length ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                    : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
                  }`}
                >
                  ⇩ Export{resourcesPrintTables.size !== ALL_RESOURCES_PRINT_TABLES.length ? ` (${resourcesPrintTables.size}/${ALL_RESOURCES_PRINT_TABLES.length})` : ''}
                </button>
                {resourcesExportOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded shadow-lg p-3 z-30 text-xs w-64 space-y-2">
                    <div className="text-[10px] text-gray-400 dark:text-prosota-muted">Which tables to include in the downloaded .xlsx (also used by Print).</div>
                    <div className="flex flex-col gap-1.5">
                      {ALL_RESOURCES_PRINT_TABLES.map(table => (
                        <label key={table} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted">
                          <input type="checkbox" checked={resourcesPrintTables.has(table)} onChange={() => toggleResourcesPrintTable(table)} />
                          {RESOURCES_PRINT_TABLE_LABELS[table]}
                        </label>
                      ))}
                    </div>
                    {resourcesPrintTables.size !== ALL_RESOURCES_PRINT_TABLES.length && (
                      <button
                        onClick={() => {
                          const all = new Set(ALL_RESOURCES_PRINT_TABLES)
                          setResourcesPrintTablesState(all)
                          saveResourcesPrintTables(all)
                        }}
                        className="text-[11px] text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan"
                      >
                        Select all
                      </button>
                    )}
                    <button
                      onClick={() => { handleResourcesExport(); setResourcesExportOpen(false) }}
                      className="w-full text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80"
                    >
                      ⇩ Download .xlsx
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {resourcesPageSetupOpen && letterhead && (
            <div className="no-print mb-3 space-y-3">
              <LetterheadEditorWidget
                letterhead={letterhead}
                previewTokens={{
                  project: selectedProject.name, module: 'Resources',
                  count: `${printScopedTrackedResources.length} resource${printScopedTrackedResources.length === 1 ? '' : 's'}`,
                  printed_at: new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
                }}
                onSave={saveLetterhead}
                onClose={() => setResourcesPageSetupOpen(false)}
                onPrint={() => setResourcesPrintTrigger(t => t + 1)}
              />
              <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide mb-2">Print Options</div>
                <div className="text-[11px] text-gray-500 dark:text-prosota-muted mb-3">
                  {selectedResourceIds.size === 0 && selectedActivityIds.size === 0
                    ? 'No resources/activities checked — printing/exporting all resources.'
                    : selectedActivityIds.size > 0
                      ? `Scoped to ${selectedActivityIds.size} checked activit${selectedActivityIds.size === 1 ? 'y' : 'ies'} (and its resource${printScopedResources.length === 1 ? '' : 's'}).`
                      : `Scoped to ${selectedResourceIds.size} checked resource${selectedResourceIds.size === 1 ? '' : 's'}.`}
                </div>
                {/* Which tables to include lives in the Export ▾ dropdown
                    above now, not here (2026-07-15, per Maro: "that was
                    meant for print not export") — Page Setup stays about
                    genuinely print-specific things (letterhead, print
                    font); Print reads the exact same shared selection, just
                    summarized read-only here instead of a second editable
                    copy of the same checkboxes. */}
                <div className="text-[11px] text-gray-500 dark:text-prosota-muted mb-3">
                  Tables: {ALL_RESOURCES_PRINT_TABLES.filter(t => resourcesPrintTables.has(t)).map(t => RESOURCES_PRINT_TABLE_LABELS[t]).join(', ') || 'none checked'}
                  {' '}— change via the <span className="font-medium text-gray-600 dark:text-prosota-muted">Export ▾</span> button above.
                </div>
                {resourcesPrintTables.has('profile') && (
                  <div className="flex items-center gap-3 flex-wrap mb-3 text-[11px] text-gray-500 dark:text-prosota-muted">
                    <span className="text-gray-400 dark:text-prosota-muted">Usage Profile legend:</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RESOURCE_USAGE_COLORS.budgeted }} />Budgeted</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RESOURCE_USAGE_COLORS.actual }} />Has Actuals</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RESOURCE_USAGE_COLORS.overallocated }} />Overallocated</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ backgroundColor: RESOURCE_USAGE_COLORS.limit }} />Limit</span>
                  </div>
                )}
                <div className="flex items-center gap-4 flex-wrap mb-3">
                  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                    Print font
                    <select
                      value={resourcesPrintFonts.fontFamily}
                      onChange={e => saveResourcesPrintFontsPrefs({ ...resourcesPrintFonts, fontFamily: e.target.value as GanttFontFamily })}
                      className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
                    >
                      <option value="sans">Sans-serif</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Monospace</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                    Print font size
                    <input
                      type="number" min={6} max={14} value={resourcesPrintFonts.fontSize}
                      onChange={e => saveResourcesPrintFontsPrefs({ ...resourcesPrintFonts, fontSize: Number(e.target.value) || DEFAULT_RESOURCES_PRINT_FONTS.fontSize })}
                      className="w-14 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
                    />
                  </label>
                  <button onClick={() => saveResourcesPrintFontsPrefs(DEFAULT_RESOURCES_PRINT_FONTS)} className="text-[10px] text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">
                    Reset to defaults
                  </button>
                </div>
                <button
                  onClick={() => setResourcesPrintTrigger(t => t + 1)}
                  className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80"
                >
                  🖨️ Print selected table(s)
                </button>
              </div>
            </div>
          )}

          <ResourcePoolWidget
            projectId={selectedProject.id}
            resources={resources}
            calendars={calendars}
            onChange={refresh}
            selectedIds={selectedResourceIds}
            onToggleSelected={toggleResourceSelected}
            layoutPrefs={resourcesLayoutPrefs}
          />
          <ResourceTrackingWidget
            calendars={calendars}
            trackedResources={resourcesTabData.trackedResources}
            assignmentsByResource={resourcesTabData.assignmentsByResource}
            buckets={resourcesTabData.buckets}
            spreadByResource={resourcesTabData.spreadByResource}
            loading={resourcesTabData.loading}
            spreadFetchError={resourcesTabData.spreadFetchError}
            onRefetchResource={resourcesTabData.refetchResource}
            unit={resourcesUnit}
            layoutPrefs={resourcesLayoutPrefs}
            selectedResourceIds={selectedResourceIds}
            onToggleResourceSelected={toggleResourceSelected}
            selectedActivityIds={selectedActivityIds}
            onToggleActivitySelected={toggleActivitySelected}
            collapsedIds={collapsedResourceIds}
            onToggleCollapsed={toggleResourceCollapsed}
            onLeftPaneWidthChange={setResourcesLeftPaneWidth}
          />
          <ResourceUsageProfileWidget
            calendars={calendars}
            trackedResources={resourcesTabData.trackedResources}
            assignmentsByResource={resourcesTabData.assignmentsByResource}
            buckets={resourcesTabData.buckets}
            spreadByResource={resourcesTabData.spreadByResource}
            loading={resourcesTabData.loading}
            layoutPrefs={resourcesLayoutPrefs}
            unit={resourcesUnit}
            selectedResourceIds={selectedResourceIds}
            onToggleResourceSelected={toggleResourceSelected}
            selectedActivityIds={selectedActivityIds}
            leftPaneWidth={resourcesLeftPaneWidth}
          />
        </>
      )}

      {activeTab === 'schedule' && (
      <>
      {calendarWidgetOpen && (
        <div className="no-print">
          <CalendarWidget
            projectId={selectedProject.id}
            calendars={calendars}
            onChange={refresh}
            onClose={() => setCalendarWidgetOpen(false)}
          />
        </div>
      )}

      {baselineWidgetOpen && period && (
        <div className="no-print">
          <BaselineWidget
            periodId={period.id}
            otherVariants={scheduleVariants.filter(v => v.id !== activeVariant?.id)}
            onChange={refresh}
            onPromote={promoteBaselineToVariant}
            onClose={() => setBaselineWidgetOpen(false)}
          />
        </div>
      )}

      {scheduleVariantWidgetOpen && (
        <div className="no-print">
          <ScheduleVariantWidget
            variants={scheduleVariants}
            activeVariantId={activeVariant?.id}
            onSelect={selectVariant}
            onCreate={createVariant}
            onRename={renameVariant}
            onDelete={deleteVariant}
            onPromote={promoteVariant}
            onClose={() => setScheduleVariantWidgetOpen(false)}
          />
        </div>
      )}

      {udfWidgetOpen && (
        <div className="no-print">
          <UserDefinedFieldsWidget
            entityType="activity"
            availableEntityTypes={['activity']}
            onEntityTypeChange={() => {}}
            definitions={udfDefinitions}
            loading={udfDefinitionsLoading}
            onCreate={createUdfDefinition}
            onUpdate={updateUdfDefinition}
            onDelete={removeUdfDefinition}
            onClose={() => setUdfWidgetOpen(false)}
          />
        </div>
      )}

      {subProjectsWidgetOpen && (
        <div className="no-print">
          <SubProjectsWidget
            activities={activities}
            subprojects={subprojects}
            onCreate={handleCreateSubproject}
            onUpdate={handleUpdateSubproject}
            onDelete={handleDeleteSubproject}
            onClose={() => setSubProjectsWidgetOpen(false)}
          />
        </div>
      )}

      {qualityWidgetOpen && period && (
        <div className="no-print">
          <SchedulingQualityWidget
            projectId={selectedProject.id}
            periodId={period.id}
            subprojects={subprojects}
            onClose={() => setQualityWidgetOpen(false)}
            onReportForPrint={(report, runName) => { setQualityPrintReport(report); setQualityPrintRunName(runName) }}
            onPrint={printQuality}
          />
        </div>
      )}

      {rescheduleWidgetOpen && period && (
        <div className="no-print">
          <RescheduleWidget
            period={period}
            onApplied={async () => { await Promise.all([refresh(), refetchPeriod()]) }}
            onClose={() => setRescheduleWidgetOpen(false)}
          />
        </div>
      )}

      <div className="mb-4 flex items-center gap-3 no-print">
          <button onClick={handleQuickAdd} className="text-sm text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">
            + Add Activity
          </button>
          <button
            onClick={() => setScheduleVariantWidgetOpen(o => !o)}
            title={
              activeVariant && !activeVariant.is_master
                ? `"${activeVariant.name}" is NOT the master schedule — Risk/Cost/ICD and Cost Plan data are linked to the master instead, so BAC/PV/EV/AC etc. will show blank here. Click to switch.`
                : 'More than one schedule per project — Working Schedule, Recovery Schedule, scenarios, ...'
            }
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              scheduleVariantWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            🗂️ {activeVariant ? activeVariant.name : 'Schedules'}
            {activeVariant && !activeVariant.is_master && (
              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 rounded px-1 py-0.5">
                Not Master
              </span>
            )}
          </button>
          <button
            onClick={() => setCalendarWidgetOpen(o => !o)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              calendarWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            📆 Calendar
          </button>
          <button
            onClick={() => setUdfWidgetOpen(o => !o)}
            title="Define custom fields, then add them as columns from the Columns menu"
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              udfWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            🏷️ Custom Fields
          </button>
          <button
            onClick={() => setSubProjectsWidgetOpen(o => !o)}
            disabled={activities.length === 0}
            title="Give a WBS branch its own scoped critical path, independent of the master schedule"
            className={`text-xs px-3 py-1.5 rounded-md font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${
              subProjectsWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            🏗️ Sub-Projects
          </button>
          <button
            onClick={() => setBaselineWidgetOpen(o => !o)}
            disabled={activities.length === 0}
            title="Capture a named, dated baseline snapshot, or assign a previously saved one"
            className={`text-xs px-3 py-1.5 rounded-md font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${
              baselineWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            🎯 Baseline
          </button>
          <button
            onClick={() => setQualityWidgetOpen(o => !o)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              qualityWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            🔬 Quality Check
          </button>
          <button
            onClick={() => setHideArchived(!hideArchived)}
            title="Archived activities are visible by default in the table, Gantt, export, and print — toggle to hide them"
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              hideArchived ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            🗄 {hideArchived ? 'Show Archived' : 'Hide Archived'}
          </button>
          <button
            onClick={() => setRescheduleWidgetOpen(o => !o)}
            disabled={activities.length === 0}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${
              rescheduleWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            🔄 Reschedule
          </button>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap no-print">
        <div className="relative max-w-xs w-full">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-prosota-muted text-xs">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search activities…"
            className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setFiltersOpen(o => !o)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            filtersOpen || filterCritical || filterDelayed || filterAtRisk || Object.keys(customFilterModes).length > 0
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          ⚙ Filters{[filterCritical, filterDelayed, filterAtRisk].filter(Boolean).length + Object.keys(customFilterModes).length > 0
            ? ` (${[filterCritical, filterDelayed, filterAtRisk].filter(Boolean).length + Object.keys(customFilterModes).length})` : ''}
        </button>
        <button
          onClick={() => setHighlightsWidgetOpen(o => !o)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            highlightsWidgetOpen || highlightCritical || enabledHighlightIds.size > 0
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          🖍 Highlight{(highlightCritical ? 1 : 0) + enabledHighlightIds.size > 0
            ? ` (${(highlightCritical ? 1 : 0) + enabledHighlightIds.size})` : ''}
        </button>
        <div className="relative">
          <button
            onClick={() => setColumnsMenuOpen(o => !o)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
              columnsMenuOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
            }`}
          >
            ☰ Columns
          </button>
          {columnsMenuOpen && (
            <div className="absolute z-10 top-full mt-1 left-0 bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg shadow-lg p-3 w-52">
              {ALL_COLUMNS.map(col => (
                <label key={col.key} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted py-1" title={col.title}>
                  <input type="checkbox" checked={isColumnVisible(col.key)} onChange={() => toggleColumn(col.key)} />
                  {col.label}
                </label>
              ))}
              {udfDefinitions.length > 0 && (
                <>
                  <div className="border-t border-gray-100 dark:border-prosota-line my-1.5 pt-1.5 text-[10px] uppercase tracking-wide text-gray-400 dark:text-prosota-muted">Custom Fields</div>
                  {udfDefinitions.map(d => (
                    <label key={d.id} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted py-1">
                      <input type="checkbox" checked={isUdfColumnVisible(d.id)} onChange={() => toggleUdfColumn(d.id)} />
                      {d.name} (UDF)
                    </label>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => downloadActivitiesCsv(visibleActivities, selectedProject.name)}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
          title="Exports the activities currently shown (respecting search/filters) as a CSV file, opens directly in Excel."
        >
          ⇩ Export ({visibleActivities.length})
        </button>
        <button
          onClick={handleP6Export}
          disabled={p6Exporting}
          title="Download this schedule as a Primavera P6-importable PMXML file"
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 disabled:opacity-50"
        >
          {p6Exporting ? 'Generating…' : '⇩ Export to P6'}
        </button>
        <button
          onClick={() => setP6ImportOpen(true)}
          title="Import a Primavera P6 PMXML (.xml) export into a brand new Schedule Variant"
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
        >
          ⇧ Import from P6
        </button>
        <button
          onClick={() => setPrintPreviewOpen(true)}
          className="text-xs px-3 py-1.5 rounded-md font-medium border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2"
          title="Review column widths/layout before printing the activity list (respecting search/filters)."
        >
          🖨️ Print
        </button>
        <button
          onClick={() => setLetterheadWidgetOpen(o => !o)}
          title="Edit the shared logo/header/footer and print timescale used for this project's printed reports"
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            letterheadWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          📄 Page Setup
        </button>
        <button
          onClick={() => setLayoutWidgetOpen(o => !o)}
          title="Save/apply named colour + font themes for the Gantt and activity table"
          className={`text-xs px-3 py-1.5 rounded-md font-medium border ${
            layoutWidgetOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
          }`}
        >
          🖼️ Layout
        </button>

        {/* Bulk actions — act on whichever rows are checked in the leftmost column.
            Replaces the old per-row copy/paste/move/indent/outdent/delete icons. */}
        <div className="flex items-center gap-0.5 border-l border-gray-200 dark:border-prosota-line pl-2 ml-1">
          <span className="text-xs text-gray-400 dark:text-prosota-muted mr-1">
            {selectedActivities.length > 0 ? `${selectedActivities.length} selected` : 'Select rows for bulk actions'}
          </span>
          <button
            onClick={handleBulkCopy} disabled={selectedActivities.length !== 1}
            title="Copy row settings (select exactly one)"
            className="text-sm text-gray-400 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 px-1"
          >⧉</button>
          <button
            onClick={handleBulkPaste} disabled={!rowClipboard || selectedActivities.length === 0}
            title="Paste copied settings onto all selected"
            className="text-sm text-gray-400 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 px-1"
          >📋</button>
          <button
            onClick={handleBulkMoveUp} disabled={!soleSelected || isFirstSibling(soleSelected)}
            title="Move up (select exactly one)"
            className="text-sm text-gray-400 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 px-1"
          >▲</button>
          <button
            onClick={handleBulkMoveDown} disabled={!soleSelected || isLastSibling(soleSelected)}
            title="Move down (select exactly one)"
            className="text-sm text-gray-400 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 px-1"
          >▼</button>
          <button
            onClick={handleBulkOutdent} disabled={!selectedActivities.some(a => a.parent_id)}
            title="Outdent all selected"
            className="text-sm text-gray-400 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 px-1"
          >⇤</button>
          <button
            onClick={handleBulkIndent} disabled={!bulkIndentTarget()}
            title="Indent all selected (they become siblings under whichever row sits above the topmost one)"
            className="text-sm text-gray-400 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 px-1"
          >⇥</button>
          <button
            onClick={handleBulkDuplicate} disabled={selectedActivities.length === 0}
            title="Duplicate all selected"
            className="text-xs text-gray-400 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 px-1.5"
          >Duplicate</button>
          <div className="relative">
            <button
              onClick={() => setBulkAssignMenuOpen(o => !o)}
              disabled={selectedActivities.length === 0}
              title="Assign a common predecessor/successor/calendar/resource to all selected, or move them to a new parent"
              className="text-xs text-gray-400 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 px-1.5"
            >
              🔗 Assign ▾
            </button>
            {bulkAssignMenuOpen && (
              <div className="absolute z-10 top-full mt-1 left-0 bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg shadow-lg py-1 w-40">
                {([
                  ['predecessor', 'Predecessor…'], ['successor', 'Successor…'],
                  ['calendar', 'Calendar…'], ['resource', 'Resource…'],
                  ['unassign-resource', 'Unassign Resource…'],
                  ['move', 'Move to…'],
                ] as [BulkAssignMode, string][]).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => { setBulkAssignMode(m); setBulkAssignMenuOpen(false) }}
                    className="block w-full text-left text-xs text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 px-3 py-1.5"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleBulkArchive} disabled={selectedActivities.length === 0 || selectedActivities.every(a => a.is_archive_container)}
            title="Archive all selected — actualise to 100% complete and move under the Archived WBS, instead of deleting"
            className="text-xs text-gray-400 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 px-1.5"
          >Archive</button>
          <button
            onClick={handleBulkDelete} disabled={selectedActivities.length === 0 || selectedActivities.every(a => a.is_archive_container)}
            title="Delete all selected"
            className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-20 disabled:hover:text-gray-400 px-1.5"
          >Delete</button>
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <button
            onClick={handleCollapseAll}
            title="Collapse every Work Package"
            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan px-1.5"
          ><CollapseIcon expanded={false} /> Collapse All</button>
          <button
            onClick={handleExpandAll}
            title="Expand every Work Package"
            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan px-1.5"
          ><CollapseIcon expanded /> Expand All</button>
          <select
            value={groupBy}
            onChange={e => { setGroupBy(e.target.value as GroupByField); setCollapsedGroups(new Set()) }}
            title="Group activities into a flat list by this field, instead of the WBS tree — hides the Gantt while grouped"
            className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1 ml-1"
          >
            {groupOptions.map(o => <option key={o.value} value={o.value}>↕ Group: {o.label}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-gray-400 dark:text-prosota-muted mr-1">Zoom</span>
          {ZOOM_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleZoomChange(opt.value)}
              title={`Show the Gantt timescale by ${opt.label.toLowerCase()}`}
              className={`text-xs px-2 py-1 rounded-md font-medium border ${
                ganttZoom === opt.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted border-gray-300 dark:border-prosota-line hover:bg-gray-50 dark:hover:bg-prosota-panel2'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {bulkAssignMode && (
        <div className="no-print">
          <BulkAssignWidget
            mode={bulkAssignMode}
            selectedActivities={selectedActivities}
            allActivities={activities}
            calendars={calendars}
            resources={resources}
            resourceAssignments={resourceAssignments}
            onApplied={refresh}
            onClose={() => setBulkAssignMode(null)}
            ganttStyle={ganttStyle}
          />
        </div>
      )}

      {pasteWidgetOpen && rowClipboard && (
        <div className="no-print">
          <PasteFieldsWidget
            source={rowClipboard}
            targets={selectedActivities}
            options={PASTE_FIELD_OPTIONS}
            onApplied={refresh}
            onClose={() => setPasteWidgetOpen(false)}
          />
        </div>
      )}

      {p6ImportOpen && (
        <P6ImportDialog
          projectId={selectedProject.id}
          onClose={() => setP6ImportOpen(false)}
          onImported={async v => {
            // "Switch to Imported Schedule" used to only change which variant
            // the UI was *looking at* (selectVariant) — never actually
            // promoted it, so it silently stayed a non-master review copy
            // forever and its resource assignments never got real Cost Plan
            // lines (sync_cost_element_from_resources only ever runs for the
            // master variant) — every BAC/PV/EV/AC column showing blank was
            // the correct, by-design behaviour for a non-master variant, not
            // a bug in the numbers themselves (2026-09-04, per Maro: "the
            // evm fields are completely blank... something is very wrong").
            // Promoting here is what the button's own label always implied.
            if (!(await confirmWithDontAsk(
              'scheduling.p6-import-promote',
              `Make "${v.name}" the master schedule? Risk/Cost/ICD linked to activities in the current master will be re-linked onto this import's matching activity codes — anything with no matching code will be unlinked and reported.`,
            ))) {
              await refetchVariants()
              await selectVariant(v)
              setP6ImportOpen(false)
              return
            }
            await promoteVariant(v.id)
            setP6ImportOpen(false)
          }}
        />
      )}

      {letterheadWidgetOpen && letterhead && (
        <div className="no-print">
          <LetterheadEditorWidget
            letterhead={letterhead}
            previewTokens={{
              project: selectedProject.name, module: 'Activities',
              count: `${visibleActivities.length} activit${visibleActivities.length === 1 ? 'y' : 'ies'}`,
              printed_at: new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
            }}
            onSave={saveLetterhead}
            onClose={() => setLetterheadWidgetOpen(false)}
            showGanttOptions
            onPrint={printSchedule}
            schedulePreview={{
              activities: visibleActivities, relationships, resourceAssignments, calendars,
              visibleColumns, udfDefinitions: visibleUdfDefinitions, getUdfValue,
              ganttStyle, ganttZoom, onGanttZoomChange: handleZoomChange, dataDate: period?.start_date ?? null,
            }}
          />
        </div>
      )}

      {layoutWidgetOpen && (
        <div className="no-print">
          <LayoutWidget
            layouts={layouts}
            activeStyle={ganttStyle}
            onCreate={createLayout}
            onUpdate={handleUpdateLayout}
            onApply={handleApplyLayout}
            onDelete={handleDeleteLayout}
            onReset={handleResetLayout}
            onClose={() => setLayoutWidgetOpen(false)}
          />
        </div>
      )}

      {filtersOpen && (
        <div className="no-print">
          <SchedulingFiltersWidget
            filters={customFilters}
            onCreate={createSchedulingFilter}
            onUpdate={updateSchedulingFilter}
            onDelete={removeSchedulingFilter}
            onClose={() => setFiltersOpen(false)}
            filterCritical={filterCritical} onFilterCriticalChange={setFilterCritical}
            filterDelayed={filterDelayed} onFilterDelayedChange={setFilterDelayed}
            filterAtRisk={filterAtRisk} onFilterAtRiskChange={setFilterAtRisk}
            customFilterModes={customFilterModes} onCustomFilterModeChange={setCustomFilterMode}
            matchMode={filterMatchMode} onMatchModeChange={handleFilterMatchModeChange}
            onClearAll={handleClearAllFilters}
          />
        </div>
      )}

      {highlightsWidgetOpen && (
        <div className="no-print">
          <SchedulingHighlightsWidget
            highlights={customHighlights}
            onCreate={createSchedulingHighlight}
            onUpdate={updateSchedulingHighlight}
            onDelete={removeSchedulingHighlight}
            onClose={() => setHighlightsWidgetOpen(false)}
            highlightCritical={highlightCritical} onHighlightCriticalChange={handleHighlightCriticalChange}
            enabledHighlightIds={enabledHighlightIds} onToggleHighlight={handleToggleHighlight}
            onClearAll={handleClearAllHighlights}
          />
        </div>
      )}

      {groupBy === 'none' && (
      <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg overflow-hidden flex">
        <div
          ref={leftPaneRef}
          onScroll={e => handleGridScroll(e.currentTarget.scrollTop)}
          // overflow-x-auto, not -hidden (2026-07-12 fix — see
          // leftPaneWidth's own header) — extra columns beyond this pane's
          // own width scroll within it instead of being silently clipped
          // or forcing the pane itself to grow and squeeze the Gantt pane.
          className="overflow-y-auto overflow-x-auto shrink-0"
          // A fixed height (not max-height) on purpose: the Gantt pane beside it
          // has no scrollbar of its own, so it can't "shrink to fit" a shorter
          // list the way this pane's overflow-y:auto naturally would — both
          // sides need the same, unconditional number to stay comparable.
          // width is always a real pixel value now, never undefined — see
          // leftPaneWidth's own header on why that mattered.
          style={{ height: topPaneHeight, width: leftPaneWidth }}
        >
          <table
            className="scheduling-grid text-sm border-collapse table-fixed"
            style={{ color: ganttStyle.table_font_color, fontFamily: FONT_FAMILY_CSS[ganttStyle.table_font_family], fontSize: ganttStyle.table_font_size }}
          >
            <colgroup>
              <col style={{ width: 32 }} />
              {isColumnVisible('code') && <col style={{ width: columnWidths.code }} />}
              {isColumnVisible('wbs') && <col style={{ width: columnWidths.wbs }} />}
              <col style={{ width: columnWidths.activity }} />
              {isColumnVisible('type') && <col style={{ width: columnWidths.type }} />}
              {isColumnVisible('duration') && <col style={{ width: columnWidths.duration }} />}
              {isColumnVisible('status') && <col style={{ width: columnWidths.status }} />}
              {isColumnVisible('start') && <col style={{ width: columnWidths.start }} />}
              {isColumnVisible('bl_start') && <col style={{ width: columnWidths.bl_start }} />}
              {isColumnVisible('finish') && <col style={{ width: columnWidths.finish }} />}
              {isColumnVisible('bl_finish') && <col style={{ width: columnWidths.bl_finish }} />}
              {isColumnVisible('variance') && <col style={{ width: columnWidths.variance }} />}
              {isColumnVisible('float') && <col style={{ width: columnWidths.float }} />}
              {isColumnVisible('critical') && <col style={{ width: columnWidths.critical }} />}
              {isColumnVisible('free_float') && <col style={{ width: columnWidths.free_float }} />}
              {isColumnVisible('sub_float') && <col style={{ width: columnWidths.sub_float }} />}
              {isColumnVisible('sub_critical') && <col style={{ width: columnWidths.sub_critical }} />}
              {isColumnVisible('pct_complete') && <col style={{ width: columnWidths.pct_complete }} />}
              {isColumnVisible('resources') && <col style={{ width: columnWidths.resources }} />}
              {isColumnVisible('element_count') && <col style={{ width: columnWidths.element_count }} />}
              {isColumnVisible('elements') && <col style={{ width: columnWidths.elements }} />}
              {isColumnVisible('animation_profile') && <col style={{ width: columnWidths.animation_profile }} />}
              {isColumnVisible('bac') && <col style={{ width: columnWidths.bac }} />}
              {isColumnVisible('pv') && <col style={{ width: columnWidths.pv }} />}
              {isColumnVisible('ev') && <col style={{ width: columnWidths.ev }} />}
              {isColumnVisible('ac') && <col style={{ width: columnWidths.ac }} />}
              {isColumnVisible('cv') && <col style={{ width: columnWidths.cv }} />}
              {isColumnVisible('sv') && <col style={{ width: columnWidths.sv }} />}
              {isColumnVisible('cpi') && <col style={{ width: columnWidths.cpi }} />}
              {isColumnVisible('spi') && <col style={{ width: columnWidths.spi }} />}
              {isColumnVisible('eac') && <col style={{ width: columnWidths.eac }} />}
              {isColumnVisible('etc') && <col style={{ width: columnWidths.etc }} />}
              {visibleUdfDefinitions.map(d => <col key={d.id} style={{ width: '9rem' }} />)}
            </colgroup>
            <thead>
              <tr
                style={{ height: 36, fontSize: ganttStyle.header_font_size, fontFamily: FONT_FAMILY_CSS[ganttStyle.header_font_family] }}
                className="bg-gray-50 dark:bg-prosota-panel2 border-b border-gray-200 dark:border-prosota-line text-left text-gray-500 dark:text-prosota-muted font-medium uppercase tracking-wide sticky top-0"
              >
                <th className="px-2 py-2.5 no-print">
                  <input
                    type="checkbox"
                    checked={visibleActivities.length > 0 && selectedIds.size === visibleActivities.length}
                    ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < visibleActivities.length }}
                    onChange={toggleSelectAll}
                    title="Select all shown"
                  />
                </th>
                {isColumnVisible('code') && <ResizableTh width={columnWidths.code} onResizeStart={startColumnResize('code')} {...sortHeader('code')}>Code</ResizableTh>}
                {isColumnVisible('wbs') && <ResizableTh width={columnWidths.wbs} onResizeStart={startColumnResize('wbs')} {...sortHeader('wbs')}>WBS</ResizableTh>}
                <ResizableTh width={columnWidths.activity} onResizeStart={startColumnResize('activity')} {...sortHeader('activity')}>Activity</ResizableTh>
                {isColumnVisible('type') && <ResizableTh width={columnWidths.type} onResizeStart={startColumnResize('type')} {...sortHeader('type')}>Type</ResizableTh>}
                {isColumnVisible('duration') && <ResizableTh width={columnWidths.duration} onResizeStart={startColumnResize('duration')} {...sortHeader('duration')}>Dur (d)</ResizableTh>}
                {isColumnVisible('status') && <ResizableTh width={columnWidths.status} onResizeStart={startColumnResize('status')} {...sortHeader('status')} title="Double-click a row to set Planned/In Progress/Suspended/Completed — drives % Complete, Actual Start/Finish, and Suspend/Resume Date">Status</ResizableTh>}
                {isColumnVisible('start') && <ResizableTh width={columnWidths.start} onResizeStart={startColumnResize('start')} {...sortHeader('start')}>Start</ResizableTh>}
                {isColumnVisible('bl_start') && <ResizableTh width={columnWidths.bl_start} onResizeStart={startColumnResize('bl_start')} {...sortHeader('bl_start')} title="Baseline start — assigned via the Baseline widget">BL Start</ResizableTh>}
                {isColumnVisible('finish') && <ResizableTh width={columnWidths.finish} onResizeStart={startColumnResize('finish')} {...sortHeader('finish')}>Finish</ResizableTh>}
                {isColumnVisible('bl_finish') && <ResizableTh width={columnWidths.bl_finish} onResizeStart={startColumnResize('bl_finish')} {...sortHeader('bl_finish')} title="Baseline finish — assigned via the Baseline widget">BL Finish</ResizableTh>}
                {isColumnVisible('variance') && (
                  <ResizableTh
                    width={columnWidths.variance} onResizeStart={startColumnResize('variance')} {...sortHeader('variance')}
                    title="Current Finish vs Baseline Finish, in days. Positive = later than the baseline plan."
                  >
                    Fin. Var (d)
                  </ResizableTh>
                )}
                {isColumnVisible('float') && <ResizableTh width={columnWidths.float} onResizeStart={startColumnResize('float')} {...sortHeader('float')} title="Slip this activity can absorb without delaying the whole project — stored in hours, shown in whole days">Total Float (d)</ResizableTh>}
                {isColumnVisible('critical') && <ResizableTh width={columnWidths.critical} onResizeStart={startColumnResize('critical')} {...sortHeader('critical')} title="On the master critical path — zero (or negative) Total Float">Critical</ResizableTh>}
                {isColumnVisible('free_float') && <ResizableTh width={columnWidths.free_float} onResizeStart={startColumnResize('free_float')} {...sortHeader('free_float')} title="Slip this activity can absorb without delaying its own successors — stored in hours, shown in whole days">Free Float (d)</ResizableTh>}
                {isColumnVisible('sub_float') && <ResizableTh width={columnWidths.sub_float} onResizeStart={startColumnResize('sub_float')} {...sortHeader('sub_float')} title="Total Float within its own tagged sub-project's branch, calculated in isolation — blank outside any tagged sub-project">Sub Total Float (d)</ResizableTh>}
                {isColumnVisible('sub_critical') && <ResizableTh width={columnWidths.sub_critical} onResizeStart={startColumnResize('sub_critical')} {...sortHeader('sub_critical')} title="Critical within its own tagged sub-project's branch, even if not critical on the master schedule — blank outside any tagged sub-project">Sub Critical</ResizableTh>}
                {isColumnVisible('pct_complete') && <ResizableTh width={columnWidths.pct_complete} onResizeStart={startColumnResize('pct_complete')} {...sortHeader('pct_complete')}>% Comp</ResizableTh>}
                {isColumnVisible('resources') && <ResizableTh width={columnWidths.resources} onResizeStart={startColumnResize('resources')} {...sortHeader('resources')}>Resources</ResizableTh>}
                {isColumnVisible('element_count') && <ResizableTh width={columnWidths.element_count} onResizeStart={startColumnResize('element_count')} {...sortHeader('element_count')} title="How many 3D model elements are linked to this activity">3D Elements</ResizableTh>}
                {isColumnVisible('elements') && <ResizableTh width={columnWidths.elements} onResizeStart={startColumnResize('elements')} {...sortHeader('elements')} title="Click to browse the individual 3D elements linked to this activity">Browse Elements</ResizableTh>}
                {isColumnVisible('animation_profile') && <ResizableTh width={columnWidths.animation_profile} onResizeStart={startColumnResize('animation_profile')} {...sortHeader('animation_profile')} title="Animation profile every 3D element linked to this activity uses, unless one has its own override">3D Profile</ResizableTh>}
                {isColumnVisible('bac') && <ResizableTh width={columnWidths.bac} onResizeStart={startColumnResize('bac')} {...sortHeader('bac')} title="Budget At Completion — this activity's resourced budget (from Cost Plan)">BAC</ResizableTh>}
                {isColumnVisible('pv') && <ResizableTh width={columnWidths.pv} onResizeStart={startColumnResize('pv')} {...sortHeader('pv')} title="Planned Value — how much of BAC should be earned by today, based on this activity's own current duration">PV</ResizableTh>}
                {isColumnVisible('ev') && <ResizableTh width={columnWidths.ev} onResizeStart={startColumnResize('ev')} {...sortHeader('ev')} title="Earned Value — BAC × physical % complete, as assessed on the linked Cost Plan line">EV</ResizableTh>}
                {isColumnVisible('ac') && <ResizableTh width={columnWidths.ac} onResizeStart={startColumnResize('ac')} {...sortHeader('ac')} title="Actual Cost — actuals recorded against this activity's linked Cost Plan line">AC</ResizableTh>}
                {isColumnVisible('cv') && <ResizableTh width={columnWidths.cv} onResizeStart={startColumnResize('cv')} {...sortHeader('cv')} title="Cost Variance — EV minus AC">CV</ResizableTh>}
                {isColumnVisible('sv') && <ResizableTh width={columnWidths.sv} onResizeStart={startColumnResize('sv')} {...sortHeader('sv')} title="Schedule Variance — EV minus PV">SV</ResizableTh>}
                {isColumnVisible('cpi') && <ResizableTh width={columnWidths.cpi} onResizeStart={startColumnResize('cpi')} {...sortHeader('cpi')} title="Cost Performance Index — EV ÷ AC">CPI</ResizableTh>}
                {isColumnVisible('spi') && <ResizableTh width={columnWidths.spi} onResizeStart={startColumnResize('spi')} {...sortHeader('spi')} title="Schedule Performance Index — EV ÷ PV">SPI</ResizableTh>}
                {isColumnVisible('eac') && <ResizableTh width={columnWidths.eac} onResizeStart={startColumnResize('eac')} {...sortHeader('eac')} title="Estimate At Completion — BAC ÷ CPI">EAC</ResizableTh>}
                {isColumnVisible('etc') && <ResizableTh width={columnWidths.etc} onResizeStart={startColumnResize('etc')} {...sortHeader('etc')} title="Estimate To Complete — EAC minus AC">ETC</ResizableTh>}
                {visibleUdfDefinitions.map(d => (
                  <th key={d.id} className="px-3 py-2.5 whitespace-nowrap" title={`Custom field (${d.data_type})`}>{d.name} (UDF)</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leadingGridRowSpacerHeight > 0 && (
                <tr><td colSpan={visibleColumns.size + visibleUdfDefinitions.length + 2} style={{ height: leadingGridRowSpacerHeight, padding: 0, border: 'none' }} /></tr>
              )}
              {visibleGridRowIndices.map(rowIndex => {
                const a = visibleActivities[rowIndex]
                const editingField = editingCell?.id === a.id ? editingCell.field : null
                return (
                <tr
                  key={a.id}
                  style={{
                    height: GANTT_ROW_HEIGHT, backgroundColor: expandedId === a.id ? undefined : rowBackground(a),
                    // box-shadow, not a real border-bottom — SchedulingPrintView.tsx
                    // already found and documented this exact failure mode: a real
                    // per-row border can add a hair of sub-pixel height in some
                    // browsers' border-collapse handling, which silently accumulates
                    // over hundreds of rows into the table drifting taller than the
                    // Gantt pane's analytic `i * GANTT_ROW_HEIGHT` math assumes —
                    // print switched to box-shadow for exactly this reason, but this
                    // on-screen grid never got the same fix (2026-07-14, per Maro:
                    // "the gantt and activity table in the onscreen are misaligning
                    // again" — worse the deeper into a long schedule you scroll,
                    // matching accumulated drift rather than a one-off offset).
                    boxShadow: rowIndex === visibleActivities.length - 1 ? undefined : 'inset 0 -1px 0 #f3f4f6',
                  }}
                  className={`hover:bg-gray-50 dark:hover:bg-prosota-panel2 ${expandedId === a.id ? 'bg-blue-50/50 dark:bg-prosota-azure/10' : ''}`}
                >
                  <td className="px-2 py-1 no-print">
                    <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelected(a.id)} />
                  </td>
                  {isColumnVisible('code') && (
                    <td className="px-3 py-1 text-gray-500 dark:text-prosota-muted whitespace-nowrap" onDoubleClick={() => startEdit(a, 'code')}>
                      {editingField === 'code' ? (
                        <input
                          autoFocus
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={() => commitEdit()}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="w-20 border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
                        />
                      ) : a.code}
                    </td>
                  )}
                  {isColumnVisible('wbs') && <td className="px-3 py-1 text-gray-400 dark:text-prosota-muted whitespace-nowrap">{a.wbs_path ?? '—'}</td>}
                  <td className="px-3 py-1" style={{ paddingLeft: 12 + depthOf(a) * 16 }}>
                    {editingField === 'task_name' ? (
                      <input
                        autoFocus
                        value={editingValue}
                        onChange={e => setEditingValue(e.target.value)}
                        onBlur={() => commitEdit()}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                        className="w-full border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-sm"
                      />
                    ) : (
                      <div className="flex items-center gap-1 min-w-0">
                        {a.activity_type === 'wbs_summary' && (
                          <button
                            onClick={e => { e.stopPropagation(); toggleCollapsed(a.id) }}
                            title={collapsedIds.has(a.id) ? 'Expand' : 'Collapse'}
                            className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan shrink-0 w-3"
                          >
                            <CollapseIcon expanded={!collapsedIds.has(a.id)} />
                          </button>
                        )}
                        <button
                          onClick={() => handleNameClick(a)}
                          onDoubleClick={() => handleNameDoubleClick(a)}
                          className="text-left font-medium text-gray-900 dark:text-prosota-paper hover:text-blue-600 truncate block min-w-0"
                          title="Click to open, double-click to rename in place"
                        >
                          {a.task_name}
                        </button>
                        {(a.is_archived || a.is_archive_container) && (
                          <span
                            className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-prosota-muted bg-gray-200 rounded px-1 py-0.5"
                            title={a.is_archive_container
                              ? 'Reserved container for archived activities — audit/reference only'
                              : 'Archived — actualised to 100% complete, no longer part of the live schedule'}
                          >
                            Archived
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  {isColumnVisible('type') && (
                    <td
                      className="px-3 py-1 text-gray-600 dark:text-prosota-muted whitespace-nowrap overflow-hidden text-ellipsis"
                      onDoubleClick={() => startEdit(a, 'activity_type')}
                      title={a.activity_type === 'wbs_summary' ? 'Computed automatically from its children — remove/outdent them to change this' : undefined}
                    >
                      {editingField === 'activity_type' ? (
                        <select
                          autoFocus
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={() => commitEdit()}
                          onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
                          className="border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
                        >
                          {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').toUpperCase()}</option>)}
                        </select>
                      ) : a.activity_type.replace('_', ' ').toUpperCase()}
                    </td>
                  )}
                  {isColumnVisible('duration') && (
                    <td
                      className="px-3 py-1 text-gray-600 dark:text-prosota-muted"
                      onDoubleClick={() => startEdit(a, 'duration_hours')}
                      title={a.activity_type === 'wbs_summary'
                        ? 'Computed from its children — remove or outdent them to edit directly'
                        : (a.duration_days !== null ? `${a.duration_days}d` : undefined)}
                    >
                      {editingField === 'duration_hours' ? (
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          step={0.5}
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={() => commitEdit()}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="w-16 border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-sm"
                        />
                      ) : formatDuration(a.duration_days)}
                    </td>
                  )}
                  {isColumnVisible('status') && (
                    <td
                      className={`px-3 py-1 whitespace-nowrap ${ACTIVITY_STATUS_CLASSES[activityStatus(a)]}`}
                      onDoubleClick={() => startEdit(a, 'status')}
                      title={a.activity_type === 'wbs_summary' ? 'Computed (rolled up from its children) — not directly editable' : 'Double-click to change'}
                    >
                      {editingField === 'status' ? (
                        <select
                          autoFocus
                          value={editingValue}
                          // onChange-only commit, no onBlur — same race-condition
                          // fix as the animation_profile_id <select> above (a
                          // native <select>'s change+blur can fire back-to-back
                          // before editingValue's re-render lands).
                          onChange={e => { setEditingValue(e.target.value); commitEdit(e.target.value) }}
                          onBlur={cancelEdit}
                          onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
                          className="border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
                        >
                          {(a.activity_type === 'start_milestone' || a.activity_type === 'finish_milestone'
                            ? (['Planned', 'Completed'] as const)
                            : (['Planned', 'In Progress', 'Suspended', 'Completed'] as const)
                          ).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : activityStatus(a)}
                    </td>
                  )}
                  {isColumnVisible('start') && (
                    <td
                      className="px-3 py-1 whitespace-nowrap text-gray-600 dark:text-prosota-muted"
                      onDoubleClick={() => startEdit(a, 'start')}
                      title={a.activity_type === 'wbs_summary'
                        ? 'Computed from its children — remove or outdent them to edit directly'
                        : a.activity_type === 'finish_milestone'
                        ? 'Not a meaningful date for a Finish Milestone — see its Finish instead'
                        : (a.constraint_type === 'snet' ? 'Start On or After constraint applied' : 'Double-click to set a Start On or After constraint')}
                    >
                      {editingField === 'start' ? (
                        <input
                          autoFocus
                          type="datetime-local"
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={() => commitEdit()}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
                        />
                      ) : a.activity_type === 'finish_milestone' ? '—' : formatDateTime(a.start, ganttStyle.show_time_of_day)}
                    </td>
                  )}
                  {isColumnVisible('bl_start') && <td className="px-3 py-1 text-gray-400 dark:text-prosota-muted whitespace-nowrap">{formatDateTime(a.bl_start, ganttStyle.show_time_of_day)}</td>}
                  {isColumnVisible('finish') && (
                    <td
                      className="px-3 py-1 whitespace-nowrap text-gray-600 dark:text-prosota-muted"
                      onDoubleClick={() => startEdit(a, 'finish')}
                      title={a.activity_type === 'wbs_summary'
                        ? 'Computed from its children — remove or outdent them to edit directly'
                        : a.activity_type === 'start_milestone'
                        ? 'Not a meaningful date for a Start Milestone — see its Start instead'
                        : 'Double-click to change duration by setting a new finish'}
                    >
                      {editingField === 'finish' ? (
                        <input
                          autoFocus
                          type="datetime-local"
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={() => commitEdit()}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
                        />
                      ) : a.activity_type === 'start_milestone' ? '—' : formatDateTime(a.finish, ganttStyle.show_time_of_day)}
                    </td>
                  )}
                  {isColumnVisible('bl_finish') && <td className="px-3 py-1 text-gray-400 dark:text-prosota-muted whitespace-nowrap">{formatDateTime(a.bl_finish, ganttStyle.show_time_of_day)}</td>}
                  {isColumnVisible('variance') && (
                    <td className={`px-3 py-1 ${(a.variance_days ?? 0) > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-prosota-muted'}`}>
                      {a.variance_days ?? '—'}
                    </td>
                  )}
                  {isColumnVisible('float') && (
                    <td className={`px-3 py-1 ${a.is_critical ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-prosota-muted'}`}>
                      {formatFloatDays(a.total_float_hours, a, calendarLookup)}
                    </td>
                  )}
                  {isColumnVisible('critical') && (
                    <td className={`px-3 py-1 ${a.is_critical ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-prosota-muted'}`}>
                      {a.is_critical === null ? '—' : a.is_critical ? 'Yes' : 'No'}
                    </td>
                  )}
                  {isColumnVisible('free_float') && (
                    <td className="px-3 py-1 text-gray-600 dark:text-prosota-muted">
                      {formatFloatDays(a.free_float_hours, a, calendarLookup)}
                    </td>
                  )}
                  {isColumnVisible('sub_float') && (
                    <td className={`px-3 py-1 ${a.sub_is_critical ? 'text-orange-600 font-semibold' : 'text-gray-600 dark:text-prosota-muted'}`}>
                      {formatFloatDays(a.sub_total_float_hours, a, calendarLookup)}
                    </td>
                  )}
                  {isColumnVisible('sub_critical') && (
                    <td className={`px-3 py-1 ${a.sub_is_critical ? 'text-orange-600 font-semibold' : 'text-gray-600 dark:text-prosota-muted'}`}>
                      {a.sub_is_critical === null ? '—' : a.sub_is_critical ? 'Yes' : 'No'}
                    </td>
                  )}
                  {isColumnVisible('pct_complete') && (
                    <td
                      className="px-3 py-1 text-gray-600 dark:text-prosota-muted"
                      onDoubleClick={() => startEdit(a, 'pct_complete')}
                      title={a.activity_type === 'wbs_summary' ? 'Computed (duration-weighted average of its children) — not directly editable' : undefined}
                    >
                      {editingField === 'pct_complete' ? (
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          max={100}
                          value={editingValue}
                          onChange={e => setEditingValue(e.target.value)}
                          onBlur={() => commitEdit()}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                          className="w-16 border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-sm"
                        />
                      ) : `${a.pct_complete ?? 0}%`}
                    </td>
                  )}
                  {isColumnVisible('resources') && (() => {
                    const assigned = assignmentsByActivityId.get(a.id) ?? []
                    const names = assigned.map(ra => ra.resource_name).join(', ')
                    return (
                      <td
                        className="px-3 py-1 text-gray-600 dark:text-prosota-muted cursor-pointer"
                        onClick={() => setExpandedId(id => id === a.id ? null : a.id)}
                        title={assigned.length > 0 ? `${names} — click to view/edit` : 'Click to assign resources'}
                      >
                        {assigned.length === 0 ? <span className="text-gray-300 dark:text-prosota-line">—</span> : (
                          <span className="truncate block max-w-[8rem]">{names}</span>
                        )}
                      </td>
                    )
                  })()}
                  {isColumnVisible('element_count') && (() => {
                    const count = elementLinksByActivityId.get(a.id)?.length ?? 0
                    return (
                      <td className="px-3 py-1 text-gray-600 dark:text-prosota-muted text-right tabular-nums">
                        {count === 0 ? <span className="text-gray-300 dark:text-prosota-line">—</span> : count.toLocaleString()}
                      </td>
                    )
                  })()}
                  {isColumnVisible('elements') && (() => {
                    const links = elementLinksByActivityId.get(a.id) ?? []
                    return (
                      <td className="px-3 py-1 text-gray-600 dark:text-prosota-muted">
                        <button
                          onClick={e => {
                            if (elementsBrowse?.activityId === a.id) { setElementsBrowse(null); return }
                            const rect = e.currentTarget.getBoundingClientRect()
                            setElementsBrowse({ activityId: a.id, x: rect.left, y: rect.bottom })
                          }}
                          disabled={links.length === 0}
                          className="text-left w-full truncate disabled:text-gray-300 disabled:cursor-default hover:text-blue-600 disabled:hover:text-gray-300"
                          title={links.length > 0 ? 'Browse linked 3D elements' : 'No 3D elements linked to this activity'}
                        >
                          {links.length === 0 ? '—' : `Browse (${links.length}) ▾`}
                        </button>
                      </td>
                    )
                  })()}
                  {isColumnVisible('animation_profile') && (
                    <td
                      className="px-3 py-1 text-gray-600 dark:text-prosota-muted whitespace-nowrap overflow-hidden text-ellipsis"
                      onDoubleClick={() => startEdit(a, 'animation_profile_id')}
                      title="Double-click to change which animation profile every 3D element linked to this activity uses"
                    >
                      {editingField === 'animation_profile_id' ? (
                        <select
                          autoFocus
                          value={editingValue}
                          // Commits straight from the change event's own
                          // value, not editingValue state — see commitEdit's
                          // own overrideValue header for why. Deliberately no
                          // onBlur commit here (unlike every text/date field
                          // above): selecting an option in a native <select>
                          // can fire change and blur back-to-back in the same
                          // pass, and a second onBlur-triggered commitEdit()
                          // reading the not-yet-re-rendered editingValue was
                          // racing this one — sometimes landing *after* it
                          // and silently reverting the correct save back to
                          // null (confirmed live: two PATCH 200s per
                          // selection, final state always the stale one).
                          // onChange alone is already the complete "user
                          // finished" signal for a dropdown; there's nothing
                          // further for a blur to commit.
                          onChange={e => { setEditingValue(e.target.value); commitEdit(e.target.value) }}
                          onBlur={cancelEdit}
                          onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
                          className="border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
                        >
                          <option value="">Default</option>
                          {animationProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : (
                        a.animation_profile_id
                          ? (profileNameById.get(a.animation_profile_id) ?? 'Default')
                          : <span className="text-gray-400 dark:text-prosota-muted">Default</span>
                      )}
                    </td>
                  )}
                  {isColumnVisible('bac') && <td className="px-3 py-1 text-gray-600 dark:text-prosota-muted whitespace-nowrap">{formatMoney(a.bac)}</td>}
                  {isColumnVisible('pv') && <td className="px-3 py-1 text-gray-600 dark:text-prosota-muted whitespace-nowrap">{formatMoney(a.pv)}</td>}
                  {isColumnVisible('ev') && <td className="px-3 py-1 text-gray-600 dark:text-prosota-muted whitespace-nowrap">{formatMoney(a.ev)}</td>}
                  {isColumnVisible('ac') && <td className="px-3 py-1 text-gray-600 dark:text-prosota-muted whitespace-nowrap">{formatMoney(a.ac)}</td>}
                  {isColumnVisible('cv') && <td className={`px-3 py-1 whitespace-nowrap ${a.cv !== null && Number(a.cv) < 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-prosota-muted'}`}>{formatMoney(a.cv)}</td>}
                  {isColumnVisible('sv') && <td className={`px-3 py-1 whitespace-nowrap ${a.sv !== null && Number(a.sv) < 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-prosota-muted'}`}>{formatMoney(a.sv)}</td>}
                  {isColumnVisible('cpi') && <td className={`px-3 py-1 ${a.cpi !== null && Number(a.cpi) < 1 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-prosota-muted'}`}>{formatRatio(a.cpi)}</td>}
                  {isColumnVisible('spi') && <td className={`px-3 py-1 ${a.spi !== null && Number(a.spi) < 1 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-prosota-muted'}`}>{formatRatio(a.spi)}</td>}
                  {isColumnVisible('eac') && <td className="px-3 py-1 text-gray-600 dark:text-prosota-muted whitespace-nowrap">{formatMoney(a.eac)}</td>}
                  {isColumnVisible('etc') && <td className="px-3 py-1 text-gray-600 dark:text-prosota-muted whitespace-nowrap">{formatMoney(a.etc)}</td>}
                  {visibleUdfDefinitions.map(d => (
                    <UdfCell
                      key={d.id}
                      definition={d}
                      value={getUdfValue(d.id, a.id)}
                      onSave={payload => setUdfValue(d.id, a.id, payload)}
                    />
                  ))}
                </tr>
                )
              })}
              {trailingGridRowSpacerHeight > 0 && (
                <tr><td colSpan={visibleColumns.size + visibleUdfDefinitions.length + 2} style={{ height: trailingGridRowSpacerHeight, padding: 0, border: 'none' }} /></tr>
              )}
              {visibleActivities.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleColumns.size + visibleUdfDefinitions.length + 2}
                    className="px-4 py-10 text-center text-gray-400 dark:text-prosota-muted text-sm"
                    // Overrides .scheduling-grid tbody td's row-height cap (index.css)
                    // — that's sized for a real activity row, not this placeholder message.
                    style={{ height: 'auto', overflow: 'visible' }}
                  >
                    {activities.length === 0
                      ? 'No activities yet for this period. Add the first one above.'
                      : 'No activities match your search/filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div
          onMouseDown={startPaneResize}
          title="Drag to resize"
          className="w-1.5 shrink-0 cursor-col-resize bg-gray-100 dark:bg-prosota-panel2 hover:bg-blue-300 dark:hover:bg-prosota-azure/40 active:bg-blue-400 dark:active:bg-prosota-azure/60 no-print"
        />
        <div
          // No vertical scroll here at all (overflow-y hidden, not auto) — the
          // grid pane's own scroll (above) is the single source of truth;
          // this pane just clips to the same fixed height and lets
          // GanttChart's internal transform reveal the right slice of rows.
          // Horizontal scroll (panning the wide timeline) stays independent.
          className="flex-1 overflow-x-auto overflow-y-hidden no-print"
          style={{ height: topPaneHeight }}
        >
          <GanttChart
            ref={ganttRef}
            activities={visibleActivities} relationships={relationships} resourceAssignments={resourceAssignments} style={ganttStyle}
            zoom={ganttZoom} onZoomChange={handleZoomChange}
            viewportHeight={topPaneHeight - HEADER_HEIGHT}
          />
        </div>
      </div>
      )}

      {/* Flat grouped view (2026-07-10, per Maro) — replaces the WBS tree
          table with a flat, grouped one while a grouping is active;
          read-only cells (no inline editing here, click the name to open
          the same detail panel the tree view uses for that). "No grouping"
          restores the block above, untouched. The Gantt pane alongside it
          (2026-08-28, per Maro: "when using grouping the gantt chart
          doesnt show anymore") reuses the same ganttRef/topPaneHeight/
          leftPaneWidth split-pane machinery as the ungrouped view above —
          see groupGanttActivities' own header for how row alignment works
          without GanttChart needing to know grouping exists. */}
      {groupBy !== 'none' && (
        <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg overflow-hidden flex">
          <div
            ref={groupScrollRef}
            onScroll={e => handleGroupScroll(e.currentTarget.scrollTop)}
            className="rt-hide-scrollbar overflow-y-auto overflow-x-auto shrink-0"
            style={{ height: topPaneHeight, width: leftPaneWidth }}
          >
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-prosota-panel2 text-left text-gray-500 dark:text-prosota-muted border-b border-gray-200 dark:border-prosota-line">
                <th className="px-2 py-1.5 w-8" style={{ position: 'sticky', top: 0, zIndex: 2, background: stickyHeaderBg }}></th>
                <th className="px-3 py-1.5" style={{ position: 'sticky', top: 0, zIndex: 2, background: stickyHeaderBg }}>Code</th>
                <th className="px-3 py-1.5" style={{ position: 'sticky', top: 0, zIndex: 2, background: stickyHeaderBg }}>Activity</th>
                <th className="px-3 py-1.5" style={{ position: 'sticky', top: 0, zIndex: 2, background: stickyHeaderBg }}>Type</th>
                <th className="px-3 py-1.5" style={{ position: 'sticky', top: 0, zIndex: 2, background: stickyHeaderBg }}>Start</th>
                <th className="px-3 py-1.5" style={{ position: 'sticky', top: 0, zIndex: 2, background: stickyHeaderBg }}>Finish</th>
                <th className="px-3 py-1.5 text-right" style={{ position: 'sticky', top: 0, zIndex: 2, background: stickyHeaderBg }}>Dur (d)</th>
                <th className="px-3 py-1.5" style={{ position: 'sticky', top: 0, zIndex: 2, background: stickyHeaderBg }}>Resources</th>
                <th className="px-3 py-1.5" style={{ position: 'sticky', top: 0, zIndex: 2, background: stickyHeaderBg }}>Critical</th>
              </tr>
            </thead>
            <tbody>
              {leadingGroupRowSpacerHeight > 0 && (
                <tr><td colSpan={9} style={{ height: leadingGroupRowSpacerHeight, padding: 0, border: 'none' }} /></tr>
              )}
              {visibleGroupRowIndices.map(idx => {
                const flat = flatGroupRows[idx]
                if (flat.type === 'header') {
                  const collapsed = collapsedGroups.has(flat.key)
                  return (
                    <tr key={flat.key || '(none)'} style={{ height: GANTT_ROW_HEIGHT }} className="bg-gray-100 dark:bg-prosota-panel2 border-b border-gray-200 dark:border-prosota-line cursor-pointer" onClick={() => toggleGroupCollapsed(flat.key)}>
                      <td className="px-2 py-1.5" colSpan={9}>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-gray-700 dark:text-prosota-muted text-xs">
                          <CollapseIcon expanded={!collapsed} /> {flat.key || '(none)'}
                          <span className="text-gray-400 dark:text-prosota-muted font-normal">({flat.count})</span>
                        </span>
                      </td>
                    </tr>
                  )
                }
                const a = flat.activity
                return (
                  <tr
                    key={a.id}
                    style={{ height: GANTT_ROW_HEIGHT, backgroundColor: rowBackground(a) }}
                    className="border-b border-gray-100 dark:border-prosota-line last:border-0 hover:bg-gray-50 dark:hover:bg-prosota-panel2"
                  >
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelected(a.id)} />
                    </td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-prosota-muted font-mono text-xs">{a.code}</td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                        className="text-left font-medium text-gray-900 dark:text-prosota-paper hover:text-blue-600"
                      >
                        {a.task_name}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-prosota-muted">{GROUP_TYPE_LABELS[a.activity_type] ?? a.activity_type}</td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-prosota-muted">{a.start ? formatDateTime(a.start, false) : '—'}</td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-prosota-muted">{a.finish ? formatDateTime(a.finish, false) : '—'}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500 dark:text-prosota-muted">{formatDuration(a.duration_days)}</td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-prosota-muted">{resourceLabelForActivity(a.id, assignmentsByActivityId)}</td>
                    <td className="px-3 py-1.5">
                      {a.is_critical === true && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">Critical</span>}
                      {a.is_critical === false && <span className="text-gray-300 dark:text-prosota-line text-xs">—</span>}
                      {a.is_critical === null && <span className="text-gray-300 dark:text-prosota-line text-xs">—</span>}
                    </td>
                  </tr>
                )
              })}
              {trailingGroupRowSpacerHeight > 0 && (
                <tr><td colSpan={9} style={{ height: trailingGroupRowSpacerHeight, padding: 0, border: 'none' }} /></tr>
              )}
              {groupedActivities.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400 dark:text-prosota-muted">No activities match the current filters</td></tr>
              )}
            </tbody>
          </table>
          </div>
          <div
            onMouseDown={startPaneResize}
            title="Drag to resize"
            className="w-1.5 shrink-0 cursor-col-resize bg-gray-100 dark:bg-prosota-panel2 hover:bg-blue-300 dark:hover:bg-prosota-azure/40 active:bg-blue-400 dark:active:bg-prosota-azure/60 no-print"
          />
          <div className="flex-1 overflow-x-auto overflow-y-hidden no-print" style={{ height: topPaneHeight }}>
            <GanttChart
              ref={ganttRef}
              activities={groupGanttActivities} relationships={relationships} resourceAssignments={resourceAssignments} style={ganttStyle}
              zoom={ganttZoom} onZoomChange={handleZoomChange}
              viewportHeight={topPaneHeight - HEADER_HEIGHT}
            />
          </div>
        </div>
      )}

      {(expandedActivity || panelPinned) && (
        <div
          onMouseDown={startTopPaneResize}
          title="Drag to resize"
          className="h-1.5 shrink-0 cursor-row-resize bg-gray-100 dark:bg-prosota-panel2 hover:bg-blue-300 dark:hover:bg-prosota-azure/40 active:bg-blue-400 dark:active:bg-prosota-azure/60 rounded-full my-1 no-print"
        />
      )}

      {(expandedActivity || panelPinned) && (
        <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg overflow-hidden no-print">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-prosota-panel2 border-b border-gray-200 dark:border-prosota-line">
            <div className="text-sm font-semibold text-gray-700 dark:text-prosota-muted">
              {expandedActivity ? `${expandedActivity.code}: ${expandedActivity.task_name}` : 'No activity selected'}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={togglePanelPinned}
                title={panelPinned ? 'Unpin — panel will hide again when nothing is selected' : 'Pin — keep this panel visible permanently'}
                className={`text-sm ${panelPinned ? 'text-blue-600 dark:text-prosota-azure' : 'text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper'}`}
              >
                📌
              </button>
              {expandedActivity && <button onClick={() => setExpandedId(null)} className="text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper text-sm">✕</button>}
            </div>
          </div>
          {expandedActivity ? (
            <div className="grid grid-cols-5 divide-x divide-gray-100">
              <div className="col-span-3">
                <ActivityForm
                  key={expandedActivity.id}
                  activity={expandedActivity} calendars={calendars} embedded
                  onCancel={() => setExpandedId(null)}
                  onSubmit={(values, note) => handleUpdate(expandedActivity, values, note)}
                />
              </div>
              <div className="col-span-2 divide-y divide-gray-100 overflow-y-auto" style={{ maxHeight: 420 }}>
                <ActivityLogic
                  activity={expandedActivity} activities={activities} relationships={relationships} calendars={calendars}
                  onChange={refresh} onFocusActivity={handleFocusActivity} ganttStyle={ganttStyle}
                />
                <ResourceAssignments activity={expandedActivity} resources={resources} onChange={refresh} />
                <ReassessmentLog
                  recordType="activity"
                  recordId={expandedActivity.id}
                  refreshKey={reassessmentRefreshKey}
                  onLogged={() => refresh()}
                />
                <ActivityStepsWidget activityId={expandedActivity.id} />
                <CodeHistory activityId={expandedActivity.id} code={expandedActivity.code} />
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-gray-400 dark:text-prosota-muted">Click an activity's name in the table to view/edit its details here.</div>
          )}
        </div>
      )}
      </>
      )}
    </div>
    {/* Top-level siblings of the "no-print" content div above, not nested
        inside it (2026-07-09 fix, per Maro: "print is printing an empty
        page") — .no-print's display:none hides all descendants regardless
        of their own class, so these three must sit outside it, same as
        SchedulingPrintView/SchedulingQualityPrintView already do. */}
    {activeTab === 'resources' && (
      <ResourcesPrintView
        tables={resourcesPrintTables} projectName={selectedProject.name} letterhead={letterhead} printFonts={resourcesPrintFonts}
        resources={printScopedResources} calendars={calendars} printGroups={resourcesPrintGroups} bucketLabels={resourcesTabData.buckets.map(b => b.label)}
        trackedResources={printScopedTrackedResources} assignmentsByResource={resourcesTabData.assignmentsByResource}
        buckets={resourcesTabData.buckets} spreadByResource={resourcesTabData.spreadByResource} selectedActivityIds={selectedActivityIds}
        unit={resourcesUnit}
      />
    )}
    {printTarget === 'schedule' && activeTab === 'schedule' && (
      <SchedulingPrintView
        activities={visibleActivities}
        relationships={relationships}
        resourceAssignments={resourceAssignments}
        calendars={calendars}
        visibleColumns={visibleColumns}
        columnWidths={printColumnWidths}
        udfDefinitions={visibleUdfDefinitions}
        getUdfValue={getUdfValue}
        udfColumnWidth={printUdfColumnWidth}
        projectName={selectedProject.name}
        letterhead={letterhead}
        ganttStyle={ganttStyle}
        ganttZoom={ganttZoom}
        highlightedActivityIds={highlightedActivityIds}
        dataDate={period?.start_date ?? null}
      />
    )}
    {printTarget === 'quality' && qualityPrintReport && (
      <SchedulingQualityPrintView
        report={qualityPrintReport}
        projectName={selectedProject.name}
        letterhead={letterhead}
        runName={qualityPrintRunName}
      />
    )}
    {printPreviewOpen && (
      <div
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 no-print"
        onClick={() => setPrintPreviewOpen(false)}
      >
        <div
          className="bg-gray-100 dark:bg-prosota-ink rounded-lg shadow-2xl w-full h-full max-w-[96vw] max-h-[94vh] flex overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="w-60 shrink-0 bg-white dark:bg-prosota-panel border-r border-gray-200 dark:border-prosota-line flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-prosota-line font-bold text-sm">Print Preview</div>
            <div className="flex-1 overflow-y-auto p-3 text-xs text-gray-500 dark:text-prosota-muted">
              This is exactly what will print, at the column widths currently set in Page Setup. Not quite right? Adjust them there — this preview updates the moment you save.
            </div>
            <div className="p-3 border-t border-gray-200 dark:border-prosota-line flex flex-col gap-2">
              <button
                onClick={() => { setPrintPreviewOpen(false); setLetterheadWidgetOpen(true) }}
                className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium text-left"
              >
                ⚙ Edit column widths in Page Setup
              </button>
              <button
                onClick={() => { setPrintPreviewOpen(false); printSchedule() }}
                className="text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 font-medium"
              >
                🖨️ Print
              </button>
              <button onClick={() => setPrintPreviewOpen(false)} className="text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">
                Close
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-6">
            <SchedulingPrintView
              preview
              activities={visibleActivities}
              relationships={relationships}
              resourceAssignments={resourceAssignments}
              calendars={calendars}
              visibleColumns={visibleColumns}
              columnWidths={printColumnWidths}
              udfDefinitions={visibleUdfDefinitions}
              getUdfValue={getUdfValue}
              udfColumnWidth={printUdfColumnWidth}
              projectName={selectedProject.name}
              letterhead={letterhead}
              ganttStyle={ganttStyle}
              ganttZoom={ganttZoom}
              highlightedActivityIds={highlightedActivityIds}
              dataDate={period?.start_date ?? null}
            />
          </div>
        </div>
      </div>
    )}
    {elementsBrowse && (() => {
      const links = elementLinksByActivityId.get(elementsBrowse.activityId) ?? []
      if (links.length === 0) return null
      // Portal straight onto document.body (2026-07-22) — see
      // elementsBrowse's own state header above for why: every grid cell
      // has its own overflow:hidden, which clips a same-subtree popover no
      // matter how it's positioned. Fixed (viewport-relative) coordinates,
      // not absolute — x/y were already read as getBoundingClientRect
      // values at click time.
      return createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setElementsBrowse(null)} />
          <div
            className="fixed z-50 w-64 max-h-64 overflow-y-auto bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-md shadow-lg py-1"
            style={{ left: elementsBrowse.x, top: elementsBrowse.y + 4 }}
          >
            {links.map(link => (
              <div
                key={link.id}
                className="px-2.5 py-1 text-xs text-gray-700 dark:text-prosota-muted truncate border-b border-gray-50 last:border-b-0"
                title={`${link.element_label} (${link.element_ref})`}
              >
                {link.element_label}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )
    })()}
    </>
  )
}
