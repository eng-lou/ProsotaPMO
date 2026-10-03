import { useState } from 'react'
import type { Activity, UserDefinedFieldDefinition, UserDefinedFieldValue } from '@/modules/scheduling/types'
import type { TimelineStrip, TimelineStripPatch } from './timelineStrips'
import { HudViewportSelect } from './HudViewportSelect'
import { ScopeFilterFields } from './ScopeFilterFields'
import type { ScopeFilter } from './scheduleScope'

interface Props {
  strips: TimelineStrip[]
  error: string | null
  openViewCount: number
  udfDefinitions: UserDefinedFieldDefinition[]
  activities: Activity[]
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined
  onCreate: () => void
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: TimelineStripPatch) => void
  onUpdateScope: (id: string, scope: ScopeFilter) => void
}

// Same compact color-swatch row every other panel in this module already
// duplicates locally (ZonesPanel.tsx/RadialChartsPanel.tsx's own ColorField).
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
      <span className="w-20 shrink-0">{label}</span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-6 h-6 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded shrink-0" />
    </label>
  )
}

function NumberField({ label, value, min, step, onChange }: { label: string; value: number; min: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="number" min={min} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
      />
    </label>
  )
}

function Item({ strip, openViewCount, activities, udfDefinitions, getUdfValue, onDelete, onUpdate, onUpdateScope }: {
  strip: TimelineStrip
  openViewCount: number
  activities: Activity[]
  udfDefinitions: UserDefinedFieldDefinition[]
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined
  onDelete: () => void
  onUpdate: (patch: TimelineStripPatch) => void
  onUpdateScope: (scope: ScopeFilter) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(strip.title)
  const [styleOpen, setStyleOpen] = useState(false)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftTitle.trim()
    if (trimmed && trimmed !== strip.title) onUpdate({ title: trimmed })
    else setDraftTitle(strip.title)
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input type="checkbox" checked={strip.visible} onChange={e => onUpdate({ visible: e.target.checked })} title={strip.visible ? 'Visible — click to hide' : 'Hidden — click to show'} />
        {editing ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftTitle(strip.title); setEditing(false) }
            }}
            className="flex-1 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 min-w-0"
          />
        ) : (
          <span onDoubleClick={() => setEditing(true)} className="flex-1 text-xs text-gray-700 dark:text-prosota-muted truncate cursor-text" title="Double-click to rename (panel label only, not drawn on the strip)">
            {strip.title}
          </span>
        )}
        <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-prosota-muted">Drag the strip itself in its viewport to reposition it.</p>
      <HudViewportSelect value={strip.viewport_slot} openViewCount={openViewCount} onChange={slot => onUpdate({ viewport_slot: slot })} />
      <div className="bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
        <ScopeFilterFields
          scope={strip}
          activities={activities}
          udfDefinitions={udfDefinitions}
          getUdfValue={getUdfValue}
          onChange={onUpdateScope}
        />
      </div>
      <button onClick={() => setStyleOpen(v => !v)} className="text-[11px] text-sky-600 hover:text-sky-800">
        {styleOpen ? '▾' : '▸'} Style
      </button>
      {styleOpen && (
        <div className="space-y-1 bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
          <NumberField label="Width" value={strip.width_px} min={100} step={20} onChange={v => onUpdate({ width_px: v })} />
          <NumberField label="Height" value={strip.height_px} min={20} step={4} onChange={v => onUpdate({ height_px: v })} />
          <NumberField label="Font size" value={strip.font_size} min={6} step={1} onChange={v => onUpdate({ font_size: v })} />
          <ColorField label="Background" value={strip.background_color} onChange={v => onUpdate({ background_color: v })} />
          <ColorField label="Bands/Border" value={strip.band_border_color} onChange={v => onUpdate({ band_border_color: v })} />
          <ColorField label="Text" value={strip.text_color} onChange={v => onUpdate({ text_color: v })} />
          <ColorField label="Playhead" value={strip.playhead_color} onChange={v => onUpdate({ playhead_color: v })} />
        </div>
      )}
    </div>
  )
}

// "Timeline Strips" dockable panel (2026-08-03, per Maro's own Synchro-style
// reference screenshot — bracketed year labels over single-letter month
// ticks). A list since 2026-10-03 (was one project-wide strip): each strip
// picks the viewport it sits in (main or a comparison view) and its own
// scope, so e.g. a Footing view can carry a strip spanning only the footing
// dates. Same list-of-styled-items shape as RadialChartsPanel.tsx.
export function TimelineStripPanel({ strips, error, openViewCount, udfDefinitions, activities, getUdfValue, onCreate, onDelete, onUpdate, onUpdateScope }: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line flex items-center justify-between sticky top-0 bg-white dark:bg-prosota-panel gap-1.5 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-prosota-muted shrink-0">Timeline Strips</span>
        <button onClick={onCreate} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
          + Timeline Strip
        </button>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {strips.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400 dark:text-prosota-muted">
          "+ Timeline Strip" adds a year/month strip near the bottom of the main view. Pick which view it shows in, drag it into place, then set which Activities its date range covers.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {strips.map(strip => (
            <Item
              key={strip.id}
              strip={strip}
              openViewCount={openViewCount}
              activities={activities}
              udfDefinitions={udfDefinitions}
              getUdfValue={getUdfValue}
              onDelete={() => onDelete(strip.id)}
              onUpdate={patch => onUpdate(strip.id, patch)}
              onUpdateScope={scope => onUpdateScope(strip.id, scope)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
