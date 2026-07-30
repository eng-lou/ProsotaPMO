import { useState } from 'react'
import type { Zone, ZoneAnimationMode, ZoneBorderStyle } from './zones'
import { formatTimelineValue, type TimeDisplayMode } from './timelinePlayback'

type ZoneStylePatch = Partial<Pick<Zone,
  'elevation' | 'fill_color' | 'fill_opacity' | 'border_color' | 'border_width' | 'border_style' | 'border_dash_size' | 'border_gap_size' |
  'animate' | 'animation_loop' | 'animation_mode'
>>

// Threaded down for the Start/End fields' own frames/seconds/date display
// (2026-07-30) — see PathsPanel.tsx's own matching DisplayFormat header.
interface DisplayFormat {
  scheduleStart: Date
  timeDisplayMode: TimeDisplayMode
  speedDaysPerSecond: number
  fps: number
}

interface Props {
  zones: Zone[]
  error: string | null
  addingPointsForZoneId: string | null
  // Resolved anim_start/anim_end per zone (2026-07-30, ElementKeyframe-
  // based — see zones.ts's own header) plus the shared display format —
  // see PathsPanel.tsx's own matching props for the full rationale.
  animWindows: Map<string, { start: Date | null; end: Date | null }>
  format: DisplayFormat | null
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onToggleVisible: (id: string) => void
  onDelete: (id: string) => void
  onToggleAddPoints: (id: string) => void
  onRemoveLastPoint: (id: string) => void
  onUpdateStyle: (id: string, patch: ZoneStylePatch) => void
  onKeyAnimStart: (id: string) => void
  onKeyAnimEnd: (id: string) => void
}

// Same compact color-swatch row AnnotationsPanel.tsx's own ColorField uses.
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
      <span className="w-16 shrink-0">{label}</span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-6 h-6 border border-gray-300 rounded shrink-0" />
    </label>
  )
}

function Item({
  zone, addingPoints, onRename, onToggleVisible, onDelete, onToggleAddPoints, onRemoveLastPoint, onUpdateStyle, animWindow, format, onKeyAnimStart, onKeyAnimEnd,
}: {
  zone: Zone
  addingPoints: boolean
  onRename: (name: string) => void
  onToggleVisible: () => void
  onDelete: () => void
  onToggleAddPoints: () => void
  onRemoveLastPoint: () => void
  onUpdateStyle: (patch: ZoneStylePatch) => void
  animWindow: { start: Date | null; end: Date | null } | undefined
  format: DisplayFormat | null
  onKeyAnimStart: () => void
  onKeyAnimEnd: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(zone.name)
  const [styleOpen, setStyleOpen] = useState(false)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== zone.name) onRename(trimmed)
    else setDraftName(zone.name)
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input type="checkbox" checked={zone.visible} onChange={onToggleVisible} title={zone.visible ? 'Visible — click to hide' : 'Hidden — click to show'} />
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftName(zone.name); setEditing(false) }
            }}
            className="flex-1 text-xs border border-gray-300 rounded px-1 py-0.5 min-w-0"
          />
        ) : (
          <span onDoubleClick={() => setEditing(true)} className="flex-1 text-xs text-gray-700 truncate cursor-text" title="Double-click to rename — also the in-3D label text">
            {zone.name}
          </span>
        )}
        <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 hover:text-red-600 shrink-0">✕</button>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={onToggleAddPoints}
          className={`text-xs px-2 py-0.5 rounded border font-medium ${
            addingPoints ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
          title={addingPoints ? 'Click in the viewport to add corners — click again to stop' : 'Click points in the viewport to trace this area'}
        >
          {addingPoints ? 'Adding… (click viewport)' : '+ Point'}
        </button>
        <button
          onClick={onRemoveLastPoint}
          disabled={zone.points.length === 0}
          className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-50 disabled:hover:bg-transparent"
        >
          Undo last point
        </button>
        <span className="text-xs text-gray-400">{zone.points.length} pt{zone.points.length === 1 ? '' : 's'}</span>
      </div>
      <button onClick={() => setStyleOpen(v => !v)} className="text-[11px] text-sky-600 hover:text-sky-800">
        {styleOpen ? '▾' : '▸'} Style
      </button>
      {styleOpen && (
        <div className="space-y-1 bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
          <ColorField label="Fill" value={zone.fill_color} onChange={v => onUpdateStyle({ fill_color: v })} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-16 shrink-0">Opacity</span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={zone.fill_opacity}
              onChange={e => onUpdateStyle({ fill_opacity: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="w-8 text-right shrink-0">{Math.round(zone.fill_opacity * 100)}%</span>
          </label>
          <ColorField label="Border" value={zone.border_color} onChange={v => onUpdateStyle({ border_color: v })} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-16 shrink-0">Border width</span>
            <input
              type="number" min={1} max={20} step={1}
              value={zone.border_width}
              onChange={e => onUpdateStyle({ border_width: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-16 shrink-0">Border style</span>
            <select
              value={zone.border_style}
              onChange={e => onUpdateStyle({ border_style: e.target.value as ZoneBorderStyle })}
              className="flex-1 border border-gray-200 rounded px-1.5 py-0.5"
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
            </select>
          </label>
          {zone.border_style === 'dashed' && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-16 shrink-0">Dash size</span>
                <input
                  type="number" min={0.05} step={0.05}
                  value={zone.border_dash_size}
                  onChange={e => onUpdateStyle({ border_dash_size: Number(e.target.value) })}
                  className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-16 shrink-0">Gap size</span>
                <input
                  type="number" min={0.05} step={0.05}
                  value={zone.border_gap_size}
                  onChange={e => onUpdateStyle({ border_gap_size: Number(e.target.value) })}
                  className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
                />
              </label>
            </>
          )}
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-16 shrink-0">Elevation</span>
            <input
              type="number" step={0.1}
              value={zone.elevation}
              onChange={e => onUpdateStyle({ elevation: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <label
            className="flex items-center gap-1.5 text-[11px] text-gray-500"
            title="'Draw' traces the border in over the first half of the Start/End window below, then fades the fill in over the second half. 'Flash' keeps the border fixed and pulses the fill's opacity instead."
          >
            <input type="checkbox" checked={zone.animate} onChange={e => onUpdateStyle({ animate: e.target.checked })} />
            Animate
          </label>
          {zone.animate && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-16 shrink-0">Mode</span>
                <select
                  value={zone.animation_mode}
                  onChange={e => onUpdateStyle({ animation_mode: e.target.value as ZoneAnimationMode })}
                  className="flex-1 border border-gray-200 rounded px-1.5 py-0.5"
                >
                  <option value="draw">Draw (border, then fill)</option>
                  <option value="flash">Flash (fill pulses)</option>
                </select>
              </label>
              {/* Frames/Seconds/Date + Key button, not a raw datetime-local
                  field (2026-07-30) — see PathsPanel.tsx's own matching
                  Start/End fields for the full rationale; identical here. */}
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-16 shrink-0">Start</span>
                <span className="flex-1 truncate" title={animWindow?.start ? animWindow.start.toLocaleString() : 'Not keyed yet'}>
                  {animWindow?.start && format ? formatTimelineValue(animWindow.start, format.scheduleStart, format.timeDisplayMode, format.speedDaysPerSecond, format.fps) : 'Not keyed'}
                </span>
                <button
                  onClick={onKeyAnimStart}
                  title="Key the current playhead as this zone's reveal Start"
                  className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 shrink-0"
                >
                  Key
                </button>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-16 shrink-0">End</span>
                <span className="flex-1 truncate" title={animWindow?.end ? animWindow.end.toLocaleString() : 'Not keyed yet'}>
                  {animWindow?.end && format ? formatTimelineValue(animWindow.end, format.scheduleStart, format.timeDisplayMode, format.speedDaysPerSecond, format.fps) : 'Not keyed'}
                </span>
                <button
                  onClick={onKeyAnimEnd}
                  title="Key the current playhead as this zone's reveal End"
                  className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 shrink-0"
                >
                  Key
                </button>
              </label>
              <label
                className="flex items-center gap-1.5 text-[11px] text-gray-500"
                title="Repeats every time the playhead passes End, instead of holding at rest (a 'flash' with Loop off plays one fade in/out and stops)"
              >
                <input type="checkbox" checked={zone.animation_loop} onChange={e => onUpdateStyle({ animation_loop: e.target.checked })} />
                Loop
              </label>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// "Zones" dockable panel (2026-07-29, per Maro's site-logistics reference —
// a filled, labeled ground-plane area like "PROJECT SITE"). Same shared-
// side-dock treatment and "+ Point"/click-to-place convention as
// PathsPanel.tsx (its own header explains the click-to-place-not-numeric-
// editing spirit; identical here). Elevation is the one numeric "transform"
// field a zone gets — per Maro, "height can be editable in transform
// options" — everything else about a zone's shape is edited by
// dragging/adding points in the viewport (ZoneGizmo.tsx), not typed in
// here.
export function ZonesPanel({
  zones, error, addingPointsForZoneId, animWindows, format,
  onCreate, onRename, onToggleVisible, onDelete, onToggleAddPoints, onRemoveLastPoint, onUpdateStyle, onKeyAnimStart, onKeyAnimEnd,
}: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
        <span className="text-xs text-gray-500">Zones</span>
        <button onClick={onCreate} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
          + Add
        </button>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
      {zones.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400">
          "+ Add" a zone, then "+ Point" and click in the viewport to trace its boundary.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {zones.map(zone => (
            <Item
              key={zone.id}
              zone={zone}
              addingPoints={addingPointsForZoneId === zone.id}
              onRename={name => onRename(zone.id, name)}
              onToggleVisible={() => onToggleVisible(zone.id)}
              onDelete={() => onDelete(zone.id)}
              onToggleAddPoints={() => onToggleAddPoints(zone.id)}
              onRemoveLastPoint={() => onRemoveLastPoint(zone.id)}
              onUpdateStyle={patch => onUpdateStyle(zone.id, patch)}
              animWindow={animWindows.get(zone.id)}
              format={format}
              onKeyAnimStart={() => onKeyAnimStart(zone.id)}
              onKeyAnimEnd={() => onKeyAnimEnd(zone.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
