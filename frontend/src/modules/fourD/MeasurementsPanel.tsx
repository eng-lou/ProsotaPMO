import { useState } from 'react'
import type { IfcUnitDisplay } from './ifcUnitDisplay'
import { formatMeasurementValue } from './measurementGeometry'
import type { Measurement } from './measurements'

// Which click-to-place tool is currently armed (2026-07-19) — a UI-only
// concept, not a persisted Measurement.kind. Area (points) was removed
// 2026-07-19, per Maro ("no longer needed") once Area (face) — automatic
// flood-fill + real boundary/hole tracing — made manually clicking a
// polygon's own corners redundant for every practical case.
export type MeasuringTool = 'length' | 'area_face'

const TOOL_OPTIONS: { value: MeasuringTool; label: string; hint: string }[] = [
  { value: 'length', label: 'Length', hint: 'Click 2 points in the viewport' },
  { value: 'area_face', label: 'Area (face)', hint: 'Click a flat element surface' },
]

function Item({
  measurement, unitPreference, selected, onRename, onToggleVisible, onDelete, onSelect,
}: {
  measurement: Measurement
  unitPreference: IfcUnitDisplay
  selected: boolean
  onRename: (name: string) => void
  onToggleVisible: () => void
  onDelete: () => void
  onSelect: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(measurement.name)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== measurement.name) onRename(trimmed)
    else setDraftName(measurement.name)
  }

  return (
    <div
      onClick={onSelect}
      className={`px-3 py-2 flex items-center gap-1.5 cursor-pointer ${selected ? 'bg-sky-50' : ''}`}
    >
      <input type="checkbox" checked={measurement.visible} onClick={e => e.stopPropagation()} onChange={onToggleVisible} title={measurement.visible ? 'Visible — click to hide' : 'Hidden — click to show'} />
      {editing ? (
        <input
          autoFocus
          value={draftName}
          onClick={e => e.stopPropagation()}
          onChange={e => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') { setDraftName(measurement.name); setEditing(false) }
          }}
          className="flex-1 text-xs border border-gray-300 rounded px-1 py-0.5 min-w-0"
        />
      ) : (
        <span onDoubleClick={e => { e.stopPropagation(); setEditing(true) }} className="flex-1 text-xs text-gray-700 truncate cursor-text" title="Double-click to rename">
          {measurement.name}
        </span>
      )}
      <span className="text-xs text-gray-500 shrink-0">{formatMeasurementValue(measurement.kind, measurement.value, unitPreference)}</span>
      <button onClick={e => { e.stopPropagation(); onDelete() }} title="Delete" className="text-xs text-gray-400 hover:text-red-600 shrink-0">✕</button>
    </div>
  )
}

interface Props {
  measurements: Measurement[]
  error: string | null
  unitPreference: IfcUnitDisplay
  measuringTool: MeasuringTool | null
  measuringPointCount: number
  selectedId: string | null
  onStart: (tool: MeasuringTool) => void
  onRename: (id: string, name: string) => void
  onToggleVisible: (id: string) => void
  onDelete: (id: string) => void
  onSelect: (id: string) => void
}

// "Measurements" dockable panel (2026-07-19, per Maro: "add a measurement
// feature, length and areas" then "maybe i can also click element surfaces
// and it gives me the area") — same shared side-dock treatment as Paths/
// Annotations/Sections. Length auto-finalizes at 2 clicks; Area (face) is a
// single click that auto-detects the clicked surface's own flat extent
// (real boundary + hole tracing, see measurementGeometry.ts). Clicking a
// tool's own button again while armed cancels it, same toggle convention
// as every other click-to-place tool in this module (Paths/Annotations).
export function MeasurementsPanel({
  measurements, error, unitPreference, measuringTool, measuringPointCount, selectedId,
  onStart, onRename, onToggleVisible, onDelete, onSelect,
}: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 sticky top-0 bg-white space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {TOOL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onStart(opt.value)}
              title={opt.hint}
              className={`text-xs px-2 py-1 rounded border font-medium ${
                measuringTool === opt.value ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {measuringTool === 'length' && (
          <p className="text-xs text-gray-500">Click 2 points in the viewport… ({measuringPointCount}/2)</p>
        )}
        {measuringTool === 'area_face' && (
          <p className="text-xs text-gray-500">Click a flat element surface…</p>
        )}
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
      {measurements.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400">Pick a tool above, then click in the viewport to take a measurement.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {measurements.map(m => (
            <Item
              key={m.id}
              measurement={m}
              unitPreference={unitPreference}
              selected={m.id === selectedId}
              onRename={name => onRename(m.id, name)}
              onToggleVisible={() => onToggleVisible(m.id)}
              onDelete={() => onDelete(m.id)}
              onSelect={() => onSelect(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
