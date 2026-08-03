import { useState } from 'react'
import type { Activity, UserDefinedFieldDefinition, UserDefinedFieldValue } from '@/modules/scheduling/types'
import type { RadialChart, RadialChartCenterMode } from './radialCharts'
import { ScopeFilterFields } from './ScopeFilterFields'
import type { ScopeFilter } from './scheduleScope'

type RadialChartStylePatch = Partial<Pick<RadialChart,
  'radius_px' | 'thickness_px' | 'border_color' | 'track_color' | 'progress_color' | 'fill_color' | 'text_color' | 'font_size' | 'center_mode'
>>

interface Props {
  charts: RadialChart[]
  error: string | null
  udfDefinitions: UserDefinedFieldDefinition[]
  activities: Activity[]
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onToggleVisible: (id: string) => void
  onDelete: (id: string) => void
  onUpdateStyle: (id: string, patch: RadialChartStylePatch) => void
  onUpdateScope: (id: string, scope: ScopeFilter) => void
  onUploadIcon: (id: string, file: File) => void
}

// Same compact color-swatch row ZonesPanel.tsx/AnnotationsPanel.tsx's own
// ColorField uses.
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
      <span className="w-16 shrink-0">{label}</span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-6 h-6 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded shrink-0" />
    </label>
  )
}

function Item({
  chart, activities, udfDefinitions, getUdfValue, onRename, onToggleVisible, onDelete, onUpdateStyle, onUpdateScope, onUploadIcon,
}: {
  chart: RadialChart
  activities: Activity[]
  udfDefinitions: UserDefinedFieldDefinition[]
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined
  onRename: (title: string) => void
  onToggleVisible: () => void
  onDelete: () => void
  onUpdateStyle: (patch: RadialChartStylePatch) => void
  onUpdateScope: (scope: ScopeFilter) => void
  onUploadIcon: (file: File) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(chart.title)
  const [styleOpen, setStyleOpen] = useState(false)

  const commitRename = () => {
    setEditing(false)
    const trimmed = draftTitle.trim()
    if (trimmed && trimmed !== chart.title) onRename(trimmed)
    else setDraftTitle(chart.title)
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input type="checkbox" checked={chart.visible} onChange={onToggleVisible} title={chart.visible ? 'Visible — click to hide' : 'Hidden — click to show'} />
        {editing ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftTitle(chart.title); setEditing(false) }
            }}
            className="flex-1 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 min-w-0"
          />
        ) : (
          <span onDoubleClick={() => setEditing(true)} className="flex-1 text-xs text-gray-700 dark:text-prosota-muted truncate cursor-text" title="Double-click to rename — also the label shown above the ring">
            {chart.title}
          </span>
        )}
        <button onClick={onDelete} title="Delete" className="text-xs text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-prosota-muted">Drag the ring itself in the 3D viewport to reposition it.</p>
      <div className="bg-gray-50 dark:bg-prosota-panel2 border border-gray-100 dark:border-prosota-line rounded px-2 py-1.5">
        <ScopeFilterFields
          scope={chart}
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
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-16 shrink-0">Radius</span>
            <input
              type="number" min={8} step={2}
              value={chart.radius_px}
              onChange={e => onUpdateStyle({ radius_px: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-16 shrink-0">Thickness</span>
            <input
              type="number" min={1} step={1}
              value={chart.thickness_px}
              onChange={e => onUpdateStyle({ thickness_px: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <ColorField label="Border" value={chart.border_color} onChange={v => onUpdateStyle({ border_color: v })} />
          <ColorField label="Track" value={chart.track_color} onChange={v => onUpdateStyle({ track_color: v })} />
          <ColorField label="Progress" value={chart.progress_color} onChange={v => onUpdateStyle({ progress_color: v })} />
          <ColorField label="Fill" value={chart.fill_color} onChange={v => onUpdateStyle({ fill_color: v })} />
          <ColorField label="Text" value={chart.text_color} onChange={v => onUpdateStyle({ text_color: v })} />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-16 shrink-0">Font size</span>
            <input
              type="number" min={6} step={1}
              value={chart.font_size}
              onChange={e => onUpdateStyle({ font_size: Number(e.target.value) })}
              className="flex-1 w-0 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
            <span className="w-16 shrink-0">Center</span>
            <select
              value={chart.center_mode}
              onChange={e => onUpdateStyle({ center_mode: e.target.value as RadialChartCenterMode })}
              className="flex-1 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5"
            >
              <option value="percentage">Live %</option>
              <option value="icon">Icon</option>
            </select>
          </label>
          {chart.center_mode === 'icon' && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-prosota-muted">
              <span className="w-16 shrink-0">Icon</span>
              <input
                type="file" accept="image/png"
                onChange={e => { const f = e.target.files?.[0]; if (f) onUploadIcon(f) }}
                className="flex-1 text-[11px]"
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}

// "Radial Charts" dockable panel (2026-07-31, per Maro's own Synchro-style
// reference screenshot — a black-labeled progress ring per discipline,
// e.g. "CONCRETE STRUCTURE"). Same list-of-styled-items shape as
// ZonesPanel.tsx, with "create now, style after" the one real structural
// difference being no click-to-place step at all — a chart has no 3D
// position, it starts life at radial_chart.py's own default corner and is
// repositioned by dragging the live ring itself in the viewport (see
// RadialChartHud.tsx), not by anything in this panel.
export function RadialChartsPanel({
  charts, error, udfDefinitions, activities, getUdfValue,
  onCreate, onRename, onToggleVisible, onDelete, onUpdateStyle, onUpdateScope, onUploadIcon,
}: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 dark:border-prosota-line flex items-center justify-between sticky top-0 bg-white dark:bg-prosota-panel gap-1.5 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-prosota-muted shrink-0">Radial Charts</span>
        <button onClick={onCreate} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
          + Radial Chart
        </button>
      </div>
      {error && <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {charts.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400 dark:text-prosota-muted">
          "+ Radial Chart" creates a progress ring in the viewport's bottom-left corner — drag it wherever you like, then set which Activities it tracks below.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {charts.map(chart => (
            <Item
              key={chart.id}
              chart={chart}
              activities={activities}
              udfDefinitions={udfDefinitions}
              getUdfValue={getUdfValue}
              onRename={title => onRename(chart.id, title)}
              onToggleVisible={() => onToggleVisible(chart.id)}
              onDelete={() => onDelete(chart.id)}
              onUpdateStyle={patch => onUpdateStyle(chart.id, patch)}
              onUpdateScope={scope => onUpdateScope(chart.id, scope)}
              onUploadIcon={file => onUploadIcon(chart.id, file)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
