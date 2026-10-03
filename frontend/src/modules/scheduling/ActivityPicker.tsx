import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualRows } from '@/lib/useVirtualRows'
import { activityRowBackground, type GanttStyle } from '@/lib/ganttLayout'
import { formatDateTime } from './dateTime'
import type { Activity } from './types'

function depthOf(a: Activity): number {
  return a.wbs_path ? a.wbs_path.split('.').length - 1 : 0
}

// Finds the nearest *pickable* activity to an anchor, in outline order —
// used to scroll a picker to roughly the right neighbourhood instead of the
// very top of a 100+ row project (2026-07-06, per Maro). Walks outward from
// the anchor's own position, alternating forward/backward, skipping any id
// in `excludedIds` (the anchor itself, plus — for a bulk picker — every
// other currently-checked activity, which can't be its own candidate
// either) rather than assuming the immediate neighbour is always valid.
export function nearestOtherActivityId(
  orderedActivities: Activity[], anchorId: string | undefined, excludedIds: Set<string>
): string | undefined {
  if (!anchorId) return undefined
  const anchorIndex = orderedActivities.findIndex(a => a.id === anchorId)
  if (anchorIndex === -1) return undefined
  for (let offset = 1; offset < orderedActivities.length; offset++) {
    const after = orderedActivities[anchorIndex + offset]
    if (after && !excludedIds.has(after.id)) return after.id
    const before = orderedActivities[anchorIndex - offset]
    if (before && !excludedIds.has(before.id)) return before.id
  }
  return undefined
}

// A searchable replacement for a plain <select> of activities — with a real
// 140+ activity project, scrolling a long native dropdown by eye to find one
// specific predecessor/successor was the actual complaint (2026-07-05, per
// Maro). Type to filter by code or name; click a result to select it. Same
// value/onChange shape as a native <select> so it drops in wherever one did.
export function ActivityPicker({
  activities, value, onChange, placeholder = 'Select activity…', className = '', scrollToId, showDates = false, ganttStyle,
}: {
  activities: Activity[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  // Id of an activity to bring into view the moment the list opens with
  // nothing typed yet — on a real project (100+ activities) a predecessor/
  // successor is usually near the current activity in the WBS outline, not
  // at the very top of the whole list (2026-07-06, per Maro). Falls back to
  // `value` itself (the already-selected candidate, if any) when not given.
  scrollToId?: string
  // Shows each candidate's computed Start/Finish under its code/name —
  // useful when picking a predecessor/successor (2026-07-06, per Maro) but
  // just noise for a plain lookup like SubProjectsWidget's root-WBS picker,
  // so it's opt-in rather than always on.
  showDates?: boolean
  // Same per-type row tint the main activity table uses — critical/WBS-
  // summary-by-level/milestone/archived (2026-07-06, per Maro: "adopt the
  // layout coloring... so i have enough visual cues" to tell a real
  // predecessor/successor candidate apart from a WBS/Project summary row,
  // which can't actually be linked either way). Omitted entirely (plain
  // list, current behaviour) where no style is in scope, e.g.
  // SubProjectsWidget's root-WBS picker.
  ganttStyle?: GanttStyle
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rowHeight = showDates ? 48 : 32
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => q
    ? activities.filter(a => a.code.toLowerCase().includes(q) || a.task_name.toLowerCase().includes(q))
    : activities, [activities, q])

  useLayoutEffect(() => {
    if (!open || !listRef.current) return
    const index = q ? 0 : Math.max(0, activities.findIndex(a => a.id === (scrollToId ?? value)))
    setActiveIndex(index)
    listRef.current.scrollTop = Math.max(0, index * rowHeight - (256 - rowHeight) / 2)
    // A search resets to its first result; reopening centres the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, rowHeight])
  const { start, end } = useVirtualRows(listRef, filtered.length, rowHeight, 0, open)

  const selected = activities.find(a => a.id === value) ?? null

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    // Deferred by a tick, not attached immediately — an immediately-attached
    // listener can catch the very click that opened this dropdown (the same
    // bug fixed in ColorPickerPopover's outside-click handling).
    const timer = setTimeout(() => document.addEventListener('click', onDocClick), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', onDocClick)
    }
  }, [open])

  const handleSelect = (a: Activity) => {
    onChange(a.id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-label={placeholder}
        aria-activedescendant={open && activeIndex >= start && activeIndex < end ? `${listId}-${activeIndex}` : undefined}
        value={open ? query : (selected ? `${selected.code}: ${selected.task_name}` : '')}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { setOpen(true); setQuery('') }}
        onKeyDown={e => {
          if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); return }
          if (e.key === 'Enter' && open) {
            e.preventDefault()
            if (filtered[activeIndex]) handleSelect(filtered[activeIndex])
          }
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          e.preventDefault()
          if (!open) { setOpen(true); return }
          const index = Math.max(0, Math.min(filtered.length - 1, activeIndex + (e.key === 'ArrowDown' ? 1 : -1)))
          setActiveIndex(index)
          const list = listRef.current
          if (list) {
            const top = index * rowHeight
            if (top < list.scrollTop) list.scrollTop = top
            else if (top + rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + rowHeight - list.clientHeight
          }
        }}
        placeholder={placeholder}
        className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1"
      />
      {open && (
        <div ref={listRef} id={listId} role="listbox" aria-label={placeholder} className="absolute z-50 top-full left-0 mt-1 w-full max-h-64 overflow-y-auto bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg shadow-lg">
          {filtered.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-gray-400 dark:text-prosota-muted">No matches</div>
          )}
          {start > 0 && <div aria-hidden="true" style={{ height: start * rowHeight }} />}
          {filtered.slice(start, end).map((a, offset) => (
            <button
              key={a.id}
              type="button"
              id={`${listId}-${start + offset}`}
              role="option"
              aria-selected={a.id === value}
              aria-posinset={start + offset + 1}
              aria-setsize={filtered.length}
              tabIndex={-1}
              title={`${a.code}: ${a.task_name}`}
              onClick={() => handleSelect(a)}
              // The selected row keeps its own bg-blue-50 highlight (inline
              // style always wins over a class, so it's left undefined here
              // rather than fighting the type/critical/WBS tint below) — same
              // "expanded row" precedent the main activity table already
              // uses for the same reason (Scheduling.tsx).
              style={{ height: rowHeight,
                backgroundColor: a.id === value || !ganttStyle ? undefined : activityRowBackground(ganttStyle, {
                  isArchived: a.is_archived || a.is_archive_container,
                  isCritical: a.is_critical ?? false,
                  activityType: a.activity_type,
                  depth: depthOf(a),
                }),
              }}
              className={`block w-full text-left px-2 py-1.5 text-xs dark:text-prosota-paper hover:bg-blue-50 dark:hover:bg-prosota-azure/10 ${a.id === value ? 'bg-blue-50 dark:bg-prosota-azure/15 font-medium' : ''} ${start + offset === activeIndex ? 'outline outline-1 -outline-offset-1 outline-blue-400' : ''}`}
            >
              <div className="truncate">
                <span className="font-mono text-gray-400 dark:text-prosota-muted mr-1">{a.code}:</span>{a.task_name}
              </div>
              {showDates && (
                <div className="truncate text-[10px] text-gray-400 dark:text-prosota-muted">
                  {formatDateTime(a.start, false)} → {formatDateTime(a.finish, false)}
                </div>
              )}
            </button>
          ))}
          {end < filtered.length && <div aria-hidden="true" style={{ height: (filtered.length - end) * rowHeight }} />}
        </div>
      )}
    </div>
  )
}
