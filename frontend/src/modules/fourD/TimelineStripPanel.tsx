import type { Activity, UserDefinedFieldDefinition, UserDefinedFieldValue } from '@/modules/scheduling/types'
import type { TimelineStrip } from './timelineStrips'
import { ScopeFilterFields } from './ScopeFilterFields'
import type { ScopeFilter } from './scheduleScope'

type TimelineStripPatch = Partial<Pick<TimelineStrip,
  'visible' | 'width_px' | 'height_px' | 'background_color' | 'band_border_color' | 'text_color' | 'playhead_color' | 'font_size'
>>

interface Props {
  strip: TimelineStrip
  error: string | null
  udfDefinitions: UserDefinedFieldDefinition[]
  activities: Activity[]
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined
  onUpdate: (patch: TimelineStripPatch) => void
  onUpdateScope: (scope: ScopeFilter) => void
}

// Same compact color-swatch row every other panel in this module already
// duplicates locally (ZonesPanel.tsx/RadialChartsPanel.tsx's own ColorField).
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
      <span className="w-20 shrink-0">{label}</span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-6 h-6 border border-gray-300 rounded shrink-0" />
    </label>
  )
}

// "Timeline Strip" dockable panel (2026-08-03, per Maro's own Synchro-style
// reference screenshot — bracketed year labels over single-letter month
// ticks). Unlike ZonesPanel.tsx/RadialChartsPanel.tsx, this is NOT a list —
// timeline_strip.py's own docstring explains why: a project only ever has
// one timeline, so this is a single settings form (closer in shape to
// RenderCaptureSettingsPopover.tsx) with no create/delete/rename at all.
export function TimelineStripPanel({ strip, error, udfDefinitions, activities, getUdfValue, onUpdate, onUpdateScope }: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 sticky top-0 bg-white">
        <span className="text-xs text-gray-500">Timeline Strip</span>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
      <div className="px-3 py-2 space-y-1.5">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <input type="checkbox" checked={strip.visible} onChange={e => onUpdate({ visible: e.target.checked })} />
          Visible
        </label>
        <p className="text-[11px] text-gray-400">Drag the strip itself in the 3D viewport to reposition it.</p>
        <div className="bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
          <ScopeFilterFields
            scope={strip}
            activities={activities}
            udfDefinitions={udfDefinitions}
            getUdfValue={getUdfValue}
            onChange={onUpdateScope}
          />
        </div>
        <div className="space-y-1 bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-20 shrink-0">Width</span>
            <input
              type="number" min={100} step={20}
              value={strip.width_px}
              onChange={e => onUpdate({ width_px: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-20 shrink-0">Height</span>
            <input
              type="number" min={20} step={4}
              value={strip.height_px}
              onChange={e => onUpdate({ height_px: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="w-20 shrink-0">Font size</span>
            <input
              type="number" min={6} step={1}
              value={strip.font_size}
              onChange={e => onUpdate({ font_size: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 rounded px-1.5 py-0.5"
            />
          </label>
          <ColorField label="Background" value={strip.background_color} onChange={v => onUpdate({ background_color: v })} />
          <ColorField label="Bands/Border" value={strip.band_border_color} onChange={v => onUpdate({ band_border_color: v })} />
          <ColorField label="Text" value={strip.text_color} onChange={v => onUpdate({ text_color: v })} />
          <ColorField label="Playhead" value={strip.playhead_color} onChange={v => onUpdate({ playhead_color: v })} />
        </div>
      </div>
    </div>
  )
}
