import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { buildCalendarLookup } from './durationDisplay'
import { FONT_FAMILY_CSS } from '@/lib/ganttLayout'
import { useUserDefinedFieldDefinitions, useUserDefinedFieldValues } from '@/lib/userDefinedFields'
import type { ResourcesLayoutPrefs } from './resourcesLayout'
import { UdfCell } from './UdfCell'
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS, type Calendar, type Resource, type ResourceType } from './types'

interface Props {
  projectId: string
  resources: Resource[]
  calendars: Calendar[]
  onChange: () => Promise<void>
  // Optional (docs/SCHEDULING_GAPS_PLAN.md Phase 7) — undefined when rendered
  // as the full-page Resources tab in Scheduling.tsx, which has nothing to
  // "close" back to; still used when embedded elsewhere as a dismissible panel.
  onClose?: () => void
  // Checking one or more resources here scopes Resource Tracking/Profile
  // below to just those (2026-07-07, per Maro) — owned by Scheduling.tsx,
  // not local state, since two sibling widgets need to read it too.
  selectedIds: Set<string>
  onToggleSelected: (id: string) => void
  layoutPrefs: ResourcesLayoutPrefs
}

interface ResourceFormValues {
  resource_type: ResourceType
  name: string
  // Optional default/primary role (e.g. "Trades", "Foreman") — distinct from
  // a specific assignment's own role override (ResourceAssignments.tsx),
  // see app/models/resource.py.
  role: string
  unit: string
  rate: string
  max_hours_per_day: string
  // '' = no calendar of its own (2026-07-07, per Maro) — optional, storage/
  // display only for now, see app/models/resource.py.
  calendar_id: string
  // Classification fields (2026-07-08, per Maro) — see app/models/resource.py.
  discipline: string
  company: string
  skill_level: string
  category: string
  cost_type: string
  members: string
}

const BLANK: ResourceFormValues = {
  resource_type: 'labour', name: '', role: '', unit: 'day', rate: '', max_hours_per_day: '8', calendar_id: '',
  discipline: '', company: '', skill_level: '', category: '', cost_type: '', members: '',
}

// labour/equipment/crew are always costed as a day rate; subcontractor/cost are
// always a flat lump sum. Only material has a genuinely free-choice unit (e.g.
// "m3", "nr") — see backend app/models/resource.py.
function fixedUnitFor(type: ResourceType): string | null {
  if (type === 'labour' || type === 'equipment' || type === 'crew') return 'day'
  if (type === 'subcontractor' || type === 'cost') return 'lump sum'
  return null
}

function rateLabelFor(type: ResourceType): string {
  if (type === 'subcontractor' || type === 'cost') return 'Rate (£, lump sum)'
  if (type === 'material') return 'Rate (£ / unit)'
  return 'Rate (£ / day)'
}

function isTimeBasedType(type: ResourceType): boolean {
  return type === 'labour' || type === 'equipment' || type === 'crew'
}

// Classification fields (2026-07-08, per Maro) — discipline/company apply to
// every type; the rest are type-conditional. Shared between the create panel
// and each row's inline edit sub-row so the two forms can't drift apart.
function ClassificationFields({ values, setter }: { values: ResourceFormValues; setter: (fn: (v: ResourceFormValues) => ResourceFormValues) => void }) {
  return (
    <>
      <label className="text-xs text-gray-600">
        Discipline
        <input value={values.discipline} onChange={e => setter(v => ({ ...v, discipline: e.target.value }))} placeholder="e.g. Structural Engineering" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-40" />
      </label>
      <label className="text-xs text-gray-600">
        Company
        <input value={values.company} onChange={e => setter(v => ({ ...v, company: e.target.value }))} placeholder="e.g. ABC Civil Engineering Ltd" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-40" />
      </label>
      {values.resource_type === 'labour' && (
        <label className="text-xs text-gray-600">
          Skill level
          <input value={values.skill_level} onChange={e => setter(v => ({ ...v, skill_level: e.target.value }))} placeholder="e.g. Skilled" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-28" />
        </label>
      )}
      {(values.resource_type === 'material' || values.resource_type === 'equipment') && (
        <label className="text-xs text-gray-600">
          Category
          <input value={values.category} onChange={e => setter(v => ({ ...v, category: e.target.value }))} placeholder="e.g. Concrete" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-28" />
        </label>
      )}
      {values.resource_type === 'cost' && (
        <label className="text-xs text-gray-600">
          Cost type
          <select value={values.cost_type} onChange={e => setter(v => ({ ...v, cost_type: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5">
            <option value="">—</option>
            <option value="fixed">Fixed</option>
            <option value="recurring">Recurring</option>
          </select>
        </label>
      )}
      {values.resource_type === 'crew' && (
        <label className="text-xs text-gray-600">
          Members
          <input value={values.members} onChange={e => setter(v => ({ ...v, members: e.target.value }))} placeholder="e.g. 1x Excavator, 2x Labourers" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-64" />
        </label>
      )}
    </>
  )
}

const COLLAPSED_STORAGE_KEY = 'prosota_resource_pool_collapsed'
// Fixed row heights (2026-07-17, for row virtualization below) — this table
// used to have no explicit row height at all (natural, content-driven,
// scaling with layoutPrefs.fontSize), unlike its two sibling Resources-tab
// tables which already fix row height regardless of font size (e.g.
// ResourceTrackingWidget's own 30/26). Virtualization needs a known height
// to compute which rows are on screen without measuring every one, so this
// aligns Pool with that same existing convention rather than introducing a
// new one.
const RESOURCE_POOL_ROW_HEIGHT = 30
// The in-place edit sub-row (ClassificationFields) — generous enough for its
// two-line (label + input) fields at any of the fixed labour/equipment/
// crew/etc layouts, now that flex-wrap removal (below) makes its content
// height deterministic instead of reflowing to a second line.
const RESOURCE_POOL_EDIT_ROW_HEIGHT = 60

// memo()'d (2026-07-17, per a perf audit — see GanttChart.tsx's own
// 2026-07-15 precedent) — Scheduling.tsx is one large component managing
// dozens of independent widgets/dialogs; without a memo boundary here, any
// unrelated state change there re-renders this whole widget even when none
// of its own props changed. Safe as a pure bail-out.
function ResourcePoolWidgetImpl({ projectId, resources, calendars, onChange, onClose, selectedIds, onToggleSelected, layoutPrefs }: Props) {
  // Collapsible (2026-07-14, per Maro: "make the resource pool collapsible")
  // — this table alone can run to 25+ rows once a schedule's been generated,
  // pushing Resource Tracking/Profile below it well down the page. Persisted
  // like every other collapse-state in this app (e.g. Resource Tracking's
  // own visible-columns Set) so it stays collapsed across reloads instead of
  // needing to be re-collapsed on every visit.
  const calendarLookup = useMemo(() => buildCalendarLookup(calendars), [calendars])
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true')
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next))
      return next
    })
  }
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<ResourceFormValues>(BLANK)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<ResourceFormValues>(BLANK)

  // Row virtualization (2026-07-17 perf fix) — this table used to render
  // every resource as a real <tr> (plus a second in-place edit <tr> for
  // whichever one, if any, is being edited) regardless of scroll position;
  // a schedule with hundreds of generated resources made this table itself
  // real, unbounded cost. Same flattened-row + cumulative-offset shape as
  // ResourceTrackingWidget's own two-level tree — here the "second row type"
  // is the in-place edit sub-row rather than a child assignment, and at most
  // one resource (editingId) ever contributes one.
  const flatPoolRows = useMemo(() => {
    const out: ({ type: 'resource'; resource: Resource } | { type: 'edit'; resource: Resource })[] = []
    for (const r of resources) {
      out.push({ type: 'resource', resource: r })
      if (editingId === r.id) out.push({ type: 'edit', resource: r })
    }
    return out
  }, [resources, editingId])

  const poolRowOffsets = useMemo(() => {
    const offsets: number[] = []
    let cumulative = 0
    for (const r of flatPoolRows) {
      offsets.push(cumulative)
      cumulative += r.type === 'resource' ? RESOURCE_POOL_ROW_HEIGHT : RESOURCE_POOL_EDIT_ROW_HEIGHT
    }
    offsets.push(cumulative)
    return offsets
  }, [flatPoolRows])

  const poolScrollRef = useRef<HTMLDivElement>(null)
  const POOL_ROW_BUFFER_PX = 600
  const [visiblePoolRowRange, setVisiblePoolRowRange] = useState<{ start: number; end: number }>({ start: 0, end: Math.min(flatPoolRows.length, 40) })

  const recomputeVisiblePoolRowRange = () => {
    const el = poolScrollRef.current
    if (!el) return
    const top = el.scrollTop - POOL_ROW_BUFFER_PX
    const bottom = el.scrollTop + el.clientHeight + POOL_ROW_BUFFER_PX
    let start = 0
    while (start < flatPoolRows.length && poolRowOffsets[start + 1] < top) start++
    let end = start
    while (end < flatPoolRows.length && poolRowOffsets[end] < bottom) end++
    setVisiblePoolRowRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end })
  }

  useLayoutEffect(() => {
    recomputeVisiblePoolRowRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatPoolRows, poolRowOffsets])

  const poolScrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlePoolScroll = () => {
    if (poolScrollDebounceRef.current !== null) clearTimeout(poolScrollDebounceRef.current)
    poolScrollDebounceRef.current = setTimeout(() => {
      poolScrollDebounceRef.current = null
      recomputeVisiblePoolRowRange()
    }, 150)
  }

  useEffect(() => {
    window.addEventListener('resize', recomputeVisiblePoolRowRange)
    return () => window.removeEventListener('resize', recomputeVisiblePoolRowRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clamped to flatPoolRows.length for the same reason the other two
  // Resources-tab tables' windows are — a data change (or opening/closing an
  // edit row) can shrink or grow the flattened list before this render's own
  // layout effect has corrected the range.
  const clampedPoolRowEnd = Math.min(visiblePoolRowRange.end, flatPoolRows.length)
  const clampedPoolRowStart = Math.min(visiblePoolRowRange.start, clampedPoolRowEnd)
  const visiblePoolRowIndices = useMemo(
    () => Array.from({ length: Math.max(0, clampedPoolRowEnd - clampedPoolRowStart) }, (_, k) => clampedPoolRowStart + k),
    [clampedPoolRowStart, clampedPoolRowEnd]
  )
  const leadingPoolRowSpacerHeight = poolRowOffsets[clampedPoolRowStart] ?? 0
  const trailingPoolRowSpacerHeight = Math.max(0, (poolRowOffsets[flatPoolRows.length] ?? 0) - (poolRowOffsets[clampedPoolRowEnd] ?? 0))

  const { definitions: udfDefinitions } = useUserDefinedFieldDefinitions(projectId, 'resource')
  const { getValue: getUdfValue, setValue: setUdfValue } = useUserDefinedFieldValues(udfDefinitions, resources.map(r => r.id))

  const setType = (setter: typeof setForm, type: ResourceType) => {
    const fixedUnit = fixedUnitFor(type)
    setter(v => ({ ...v, resource_type: type, unit: fixedUnit ?? (v.unit === 'day' || v.unit === 'lump sum' ? '' : v.unit) }))
  }

  const handleCreate = async () => {
    if (!form.name.trim() || !form.unit.trim() || form.rate === '') return
    await api.post('/api/v1/resources/', {
      project_id: projectId,
      resource_type: form.resource_type,
      name: form.name,
      role: form.role || null,
      unit: form.unit,
      rate: form.rate,
      max_hours_per_day: form.max_hours_per_day || undefined,
      calendar_id: form.calendar_id || null,
      discipline: form.discipline || null,
      company: form.company || null,
      skill_level: form.skill_level || null,
      category: form.category || null,
      cost_type: form.cost_type || null,
      members: form.members || null,
    })
    setCreating(false)
    setForm(BLANK)
    await onChange()
  }

  const startEdit = (r: Resource) => {
    setEditingId(r.id)
    setEditForm({
      resource_type: r.resource_type, name: r.name, role: r.role ?? '', unit: r.unit, rate: r.rate,
      max_hours_per_day: r.max_hours_per_day, calendar_id: r.calendar_id ?? '',
      discipline: r.discipline ?? '', company: r.company ?? '', skill_level: r.skill_level ?? '',
      category: r.category ?? '', cost_type: r.cost_type ?? '', members: r.members ?? '',
    })
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    await api.patch(`/api/v1/resources/${editingId}`, {
      ...editForm, role: editForm.role || null, calendar_id: editForm.calendar_id || null,
      discipline: editForm.discipline || null, company: editForm.company || null,
      skill_level: editForm.skill_level || null, category: editForm.category || null,
      cost_type: editForm.cost_type || null, members: editForm.members || null,
    })
    setEditingId(null)
    await onChange()
  }

  const handleDelete = async (r: Resource) => {
    if (!(await confirmWithDontAsk('scheduling.resource-delete', `Delete resource "${r.name}"? This is only possible if it isn't assigned to any activity.`))) return
    try {
      await api.delete(`/api/v1/resources/${r.id}`)
      await onChange()
    } catch (err) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : undefined
      window.alert(message ?? 'Could not delete this resource.')
    }
  }

  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Bulk delete (2026-07-15, per Maro: "add bulk delete all resources in
  // the resource pool") — no backend bulk-delete endpoint exists (nor is
  // one worth adding just for this: the per-resource DELETE already does
  // the one thing that matters, refusing a resource still assigned to an
  // activity with a 422 — see app/services/resource.py's own
  // delete_resource), so this just loops the same DELETE call this row's
  // own handleDelete already makes, one at a time, and reports whichever
  // ones got skipped instead of failing the whole batch on the first
  // still-assigned resource. Own confirm key, distinct from the per-row
  // one just above — dismissing "don't ask again" on a single delete
  // shouldn't silently skip the warning for wiping the entire pool.
  const handleDeleteAll = async () => {
    if (resources.length === 0) return
    if (!(await confirmWithDontAsk(
      'scheduling.resource-delete-all',
      `Delete all ${resources.length} resource${resources.length === 1 ? '' : 's'} in the pool? Any resource still assigned to an activity will be skipped — remove those assignments first.`,
    ))) return
    setBulkDeleting(true)
    const skipped: string[] = []
    for (const r of resources) {
      try {
        await api.delete(`/api/v1/resources/${r.id}`)
      } catch {
        skipped.push(r.name)
      }
    }
    setBulkDeleting(false)
    await onChange()
    if (skipped.length > 0) {
      window.alert(
        `Deleted ${resources.length - skipped.length} of ${resources.length} resources.\n`
        + `Still assigned to an activity, skipped: ${skipped.join(', ')}`,
      )
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="text-gray-400 hover:text-gray-600 text-xs w-4 flex-shrink-0"
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <div className="font-bold text-sm">Resource Pool</div>
        <div className="text-xs text-gray-400">Labour, equipment, material, subcontractors, cost &amp; crew — define here, assign to activities via Logic</div>
        {!collapsed && resources.length > 0 && (
          <button
            onClick={handleDeleteAll}
            disabled={bulkDeleting}
            title="Delete every resource in the pool (skips any still assigned to an activity)"
            className="ml-auto text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
          >
            {bulkDeleting ? 'Deleting…' : 'Delete All'}
          </button>
        )}
        {onClose && <button onClick={onClose} className={`${!collapsed && resources.length > 0 ? '' : 'ml-auto'} text-gray-400 hover:text-gray-600 text-sm`}>✕</button>}
      </div>

      {!collapsed && (
      <>
      <div ref={poolScrollRef} onScroll={handlePoolScroll} className="rt-hide-scrollbar mb-2" style={{ maxHeight: 500, overflow: 'auto' }}>
      <table className="w-full border-collapse" style={{ fontFamily: FONT_FAMILY_CSS[layoutPrefs.fontFamily], fontSize: layoutPrefs.fontSize }}>
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-2 py-1.5 border border-gray-200" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }}>
              <input
                type="checkbox"
                title="Select all — scopes Resource Tracking/Profile below to just the checked resources"
                checked={resources.length > 0 && resources.every(r => selectedIds.has(r.id))}
                onChange={() => {
                  const allSelected = resources.every(r => selectedIds.has(r.id))
                  for (const r of resources) {
                    if (allSelected === selectedIds.has(r.id)) onToggleSelected(r.id)
                  }
                }}
              />
            </th>
            <th className="px-2 py-1.5 border border-gray-200" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }}>Type</th>
            <th className="px-2 py-1.5 border border-gray-200" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }}>Name</th>
            <th className="px-2 py-1.5 border border-gray-200" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }}>Role</th>
            <th className="px-2 py-1.5 border border-gray-200" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }}>Unit</th>
            <th className="px-2 py-1.5 border border-gray-200 text-right" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }}>Rate (£)</th>
            <th className="px-2 py-1.5 border border-gray-200 text-right" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }}>Max h/day</th>
            <th className="px-2 py-1.5 border border-gray-200" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }} title="Optional own calendar — storage/display only for now, doesn't yet affect scheduling">Calendar</th>
            {udfDefinitions.map(d => (
              <th key={d.id} className="px-2 py-1.5 border border-gray-200" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }} title={`Custom field (${d.data_type})`}>{d.name} (UDF)</th>
            ))}
            <th className="px-2 py-1.5 border border-gray-200" style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }}></th>
          </tr>
        </thead>
        <tbody>
          {leadingPoolRowSpacerHeight > 0 && (
            <tr><td colSpan={9 + udfDefinitions.length} style={{ height: leadingPoolRowSpacerHeight, padding: 0, border: 'none' }} /></tr>
          )}
          {visiblePoolRowIndices.map(idx => {
            const flat = flatPoolRows[idx]
            if (flat.type === 'edit') {
              const r = flat.resource
              return (
                <tr key={`${r.id}-edit`} style={{ height: RESOURCE_POOL_EDIT_ROW_HEIGHT }}>
                  <td colSpan={9 + udfDefinitions.length} className="px-2 py-2 border border-gray-200 bg-gray-50" style={{ height: RESOURCE_POOL_EDIT_ROW_HEIGHT, overflow: 'hidden' }}>
                    <div className="flex items-end gap-2">
                      <ClassificationFields values={editForm} setter={setEditForm} />
                    </div>
                  </td>
                </tr>
              )
            }
            const r = flat.resource
            const isTimeBased = isTimeBasedType(r.resource_type)
            const editFixedUnit = editingId === r.id ? fixedUnitFor(editForm.resource_type) : null
            return (
            <tr key={r.id} style={{ height: RESOURCE_POOL_ROW_HEIGHT }}>
              <td className="px-2 py-1.5 border border-gray-200" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => onToggleSelected(r.id)} />
              </td>
              {editingId === r.id ? (
                <>
                  <td className="px-2 py-1.5 border border-gray-200" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    <select
                      value={editForm.resource_type}
                      onChange={e => setType(setEditForm, e.target.value as ResourceType)}
                      className="border border-gray-300 rounded px-1 py-0.5 text-xs"
                    >
                      {RESOURCE_TYPES.map(t => <option key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    <input value={editForm.name} onChange={e => setEditForm(v => ({ ...v, name: e.target.value }))} className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    <input value={editForm.role} onChange={e => setEditForm(v => ({ ...v, role: e.target.value }))} placeholder="e.g. Trades" className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    {editFixedUnit ? (
                      <span className="text-gray-400">{editFixedUnit}</span>
                    ) : (
                      <input value={editForm.unit} onChange={e => setEditForm(v => ({ ...v, unit: e.target.value }))} placeholder="m3 / nr / each" className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />
                    )}
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    <input type="number" min={0} step={0.01} value={editForm.rate} onChange={e => setEditForm(v => ({ ...v, rate: e.target.value }))} className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs text-right" />
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    {isTimeBasedType(editForm.resource_type) ? (
                      <input type="number" min={0} max={24} step={0.5} value={editForm.max_hours_per_day} onChange={e => setEditForm(v => ({ ...v, max_hours_per_day: e.target.value }))} className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs text-right" />
                    ) : <span className="text-gray-300 block text-right">—</span>}
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    <select
                      value={editForm.calendar_id}
                      onChange={e => setEditForm(v => ({ ...v, calendar_id: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
                    >
                      <option value="">None</option>
                      {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  {udfDefinitions.map(d => (
                    <UdfCell key={d.id} definition={d} value={getUdfValue(d.id, r.id)} onSave={payload => setUdfValue(d.id, r.id, payload)} />
                  ))}
                  <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    <button onClick={handleSaveEdit} className="text-blue-600 hover:text-blue-700 mr-2">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>{RESOURCE_TYPE_LABELS[r.resource_type]}</td>
                  <td className="px-2 py-1.5 border border-gray-200 font-medium" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>{r.name}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>{r.role ?? '—'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>{r.unit}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>{Number(r.rate).toLocaleString()}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right text-gray-500" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>{isTimeBased ? r.max_hours_per_day : '—'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    {r.calendar_id ? (calendarLookup.byId.get(r.calendar_id)?.name ?? '—') : '—'}
                  </td>
                  {udfDefinitions.map(d => (
                    <UdfCell key={d.id} definition={d} value={getUdfValue(d.id, r.id)} onSave={payload => setUdfValue(d.id, r.id, payload)} />
                  ))}
                  <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap" style={{ height: RESOURCE_POOL_ROW_HEIGHT, overflow: 'hidden' }}>
                    <button onClick={() => startEdit(r)} className="text-blue-600 hover:text-blue-700 mr-2">Edit</button>
                    <button onClick={() => handleDelete(r)} className="text-gray-400 hover:text-red-600">Delete</button>
                  </td>
                </>
              )}
            </tr>
            )
          })}
          {trailingPoolRowSpacerHeight > 0 && (
            <tr><td colSpan={9 + udfDefinitions.length} style={{ height: trailingPoolRowSpacerHeight, padding: 0, border: 'none' }} /></tr>
          )}
          {resources.length === 0 && !creating && (
            <tr><td colSpan={9 + udfDefinitions.length} className="px-2 py-3 text-center text-gray-400 border border-gray-200">No resources yet</td></tr>
          )}
        </tbody>
      </table>
      </div>

      {creating ? (
        <div className="border border-gray-200 rounded p-3 flex items-end gap-2 flex-wrap">
          <label className="text-xs text-gray-600">
            Type
            <select value={form.resource_type} onChange={e => setType(setForm, e.target.value as ResourceType)} className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5">
              {RESOURCE_TYPES.map(t => <option key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            Name
            <input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} placeholder="e.g. J. Davies" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5" />
          </label>
          <label className="text-xs text-gray-600" title="Optional default/primary role — a specific assignment can still override this">
            Role
            <input value={form.role} onChange={e => setForm(v => ({ ...v, role: e.target.value }))} placeholder="e.g. Trades" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-24" />
          </label>
          {fixedUnitFor(form.resource_type) ? (
            <div className="text-xs text-gray-500">
              Unit
              <div className="mt-1.5">{fixedUnitFor(form.resource_type)}</div>
            </div>
          ) : (
            <label className="text-xs text-gray-600">
              Unit
              <input value={form.unit} onChange={e => setForm(v => ({ ...v, unit: e.target.value }))} placeholder="m3 / nr / each" className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-24" />
            </label>
          )}
          <label className="text-xs text-gray-600">
            {rateLabelFor(form.resource_type)}
            <input type="number" min={0} step={0.01} value={form.rate} onChange={e => setForm(v => ({ ...v, rate: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-28" />
          </label>
          {isTimeBasedType(form.resource_type) && (
            <label className="text-xs text-gray-600">
              Max hours/day
              <input type="number" min={0} max={24} step={0.5} value={form.max_hours_per_day} onChange={e => setForm(v => ({ ...v, max_hours_per_day: e.target.value }))} className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-20" />
            </label>
          )}
          <label className="text-xs text-gray-600" title="Optional — storage/display only for now, doesn't yet affect scheduling">
            Calendar
            <select
              value={form.calendar_id}
              onChange={e => setForm(v => ({ ...v, calendar_id: e.target.value }))}
              className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5"
            >
              <option value="">None</option>
              {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <ClassificationFields values={form} setter={setForm} />
          <button onClick={handleCreate} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">Add</button>
          <button onClick={() => { setCreating(false); setForm(BLANK) }} className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1.5">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Resource</button>
      )}
      </>
      )}
    </div>
  )
}

export const ResourcePoolWidget = memo(ResourcePoolWidgetImpl)
