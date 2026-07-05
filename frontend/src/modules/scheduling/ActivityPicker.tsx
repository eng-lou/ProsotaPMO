import { useEffect, useRef, useState } from 'react'
import type { Activity } from './types'

// A searchable replacement for a plain <select> of activities — with a real
// 140+ activity project, scrolling a long native dropdown by eye to find one
// specific predecessor/successor was the actual complaint (2026-07-05, per
// Maro). Type to filter by code or name; click a result to select it. Same
// value/onChange shape as a native <select> so it drops in wherever one did.
export function ActivityPicker({
  activities, value, onChange, placeholder = 'Select activity…', className = '',
}: {
  activities: Activity[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

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

  const q = query.trim().toLowerCase()
  const filtered = q
    ? activities.filter(a => a.code.toLowerCase().includes(q) || a.task_name.toLowerCase().includes(q))
    : activities

  const handleSelect = (a: Activity) => {
    onChange(a.id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        value={open ? query : (selected ? `${selected.code}: ${selected.task_name}` : '')}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { setOpen(true); setQuery('') }}
        placeholder={placeholder}
        className="w-full text-xs border border-gray-300 rounded px-2 py-1"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {filtered.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-gray-400">No matches</div>
          )}
          {filtered.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => handleSelect(a)}
              className={`block w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 ${a.id === value ? 'bg-blue-50 font-medium' : ''}`}
            >
              <span className="font-mono text-gray-400 mr-1">{a.code}:</span>{a.task_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
