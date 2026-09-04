import { useRef, useState, type ReactNode } from 'react'
import type { GanttFontFamily, GanttStyle } from '@/lib/ganttLayout'
import { downloadJson, readJsonFile } from '@/lib/exportImport'
import { defaultLetterhead, EMPTY_ZONE, type LetterheadTokens, type LetterheadZone, type ProjectLetterhead, type TimescaleAnchorMode } from '@/lib/letterhead'
import { ZOOM_OPTIONS, type GanttZoom } from '@/modules/scheduling/ganttZoom'
import { ALL_COLUMNS, PRINT_COLUMN_DEFAULTS, PRINT_UDF_COLUMN_DEFAULT_WIDTH, type ColumnKey, type ResizableColumnKey } from '@/modules/scheduling/Scheduling'
import { SchedulingPrintView } from '@/modules/scheduling/SchedulingPrintView'
import type {
  Activity, ActivityRelationship, Calendar, ResourceAssignment, UserDefinedFieldDefinition, UserDefinedFieldValue,
} from '@/modules/scheduling/types'
import { PrintLetterheadFooter, PrintLetterheadHeader } from './PrintLetterhead'

// A small live sample of the actual Scheduling activity table (2026-07-07,
// per Maro: "would be good to see the preview on the side too... aside from
// the header preview one previously there") — only Scheduling.tsx has this
// data, and only passes it when showGanttOptions is also true. Capped to a
// handful of rows (see the slice at the call site) since this is a widths/
// truncation check, not a full print rehearsal — Print Preview (Scheduling's
// own toolbar) already covers that with the complete activity list.
interface SchedulePreviewData {
  activities: Activity[]
  relationships: ActivityRelationship[]
  resourceAssignments: ResourceAssignment[]
  calendars: Calendar[]
  visibleColumns: Set<ColumnKey>
  udfDefinitions: UserDefinedFieldDefinition[]
  getUdfValue: (fieldDefinitionId: string, recordId: string) => UserDefinedFieldValue | undefined
  ganttStyle: GanttStyle
  ganttZoom: GanttZoom
  onGanttZoomChange: (zoom: GanttZoom) => void
  dataDate: string | null
}

interface Props {
  letterhead: ProjectLetterhead
  previewTokens: LetterheadTokens
  onSave: (data: Omit<ProjectLetterhead, 'id'>) => Promise<ProjectLetterhead>
  onClose: () => void
  // Gates both the Gantt Legend checkbox and the Print Timescale section —
  // neither means anything where there's no Gantt chart (2026-07-06, per
  // Maro: "I dont want that gantt legend in the other modules because gantt
  // doesnt exist in the other modules" — previously the checkbox was always
  // shown everywhere, just described as inert outside Scheduling; now it's
  // not shown at all). Only Scheduling.tsx passes this true.
  showGanttOptions?: boolean
  schedulePreview?: SchedulePreviewData
  // Saves the draft, then hands off to the caller's own print flow
  // (2026-07-07, per Maro: "add a print in here to go directly once changes
  // are fine") — only offered where there's something real to print
  // (Scheduling.tsx).
  onPrint?: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

const TIMESCALE_MODE_LABELS: Record<TimescaleAnchorMode, string> = {
  auto: 'Auto (from the schedule\'s own dates)',
  ps: 'PS — Earliest Project Start',
  pf: 'PF — Latest Project Finish',
  dd: 'DD — Data Date',
  cd: 'CD — Current Date',
  cw: 'CW — Current Week',
  cm: 'CM — Current Month',
  custom: 'Custom Date…',
}
const TIMESCALE_MODES = Object.keys(TIMESCALE_MODE_LABELS) as TimescaleAnchorMode[]

// Max raw file size before base64 inflation (~4/3x) — kept comfortably under
// the backend's 700,000-char data-URL cap (app/schemas/project_letterhead.py).
const MAX_LOGO_BYTES = 480_000

const ALIGN_OPTIONS: { value: LetterheadZone['align']; label: string; title: string }[] = [
  { value: 'left', label: '⯇', title: 'Align left' },
  { value: 'center', label: '≡', title: 'Align center' },
  { value: 'right', label: '⯈', title: 'Align right' },
  { value: 'justify', label: '☰', title: 'Justify' },
]

function ToggleButton({ active, onClick, title, children, className = '' }: {
  active: boolean; onClick: () => void; title: string; children: ReactNode; className?: string
}) {
  return (
    <button
      type="button" onClick={onClick} title={title}
      className={`w-6 h-6 text-xs rounded border ${
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
      } ${className}`}
    >
      {children}
    </button>
  )
}

function ZoneEditor({ label, zone, onChange }: { label: string; zone: LetterheadZone; onChange: (z: LetterheadZone) => void }) {
  return (
    <div className="border border-gray-200 rounded-lg p-2.5">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{label}</div>
      <textarea
        value={zone.text}
        onChange={e => onChange({ ...zone, text: e.target.value })}
        rows={2}
        placeholder="Text — {project} {module} {count} {printed_at} stay live"
        className="w-full text-xs border border-gray-300 rounded px-2 py-1 mb-1.5 resize-none"
      />
      <div className="flex items-center gap-1 flex-wrap">
        <ToggleButton active={zone.bold} onClick={() => onChange({ ...zone, bold: !zone.bold })} title="Bold" className="font-bold">B</ToggleButton>
        <ToggleButton active={zone.italic} onClick={() => onChange({ ...zone, italic: !zone.italic })} title="Italic" className="italic">I</ToggleButton>
        <input
          type="number" min={6} max={32} value={zone.font_size}
          onChange={e => onChange({ ...zone, font_size: Number(e.target.value) || zone.font_size })}
          title="Font size (px)"
          className="w-12 text-xs border border-gray-300 rounded px-1 py-0.5"
        />
        <select
          value={zone.font_family}
          onChange={e => onChange({ ...zone, font_family: e.target.value as GanttFontFamily })}
          title="Font type"
          className="text-xs border border-gray-300 rounded px-1 py-0.5"
        >
          <option value="sans">Sans</option>
          <option value="serif">Serif</option>
          <option value="mono">Mono</option>
        </select>
        <div className="w-px h-4 bg-gray-200 mx-0.5" />
        {ALIGN_OPTIONS.map(opt => (
          <ToggleButton key={opt.value} active={zone.align === opt.value} onClick={() => onChange({ ...zone, align: opt.value })} title={opt.title}>
            {opt.label}
          </ToggleButton>
        ))}
      </div>
    </div>
  )
}

// One Timescale Start/Finish control (2026-07-06, per Maro — modelled on the
// P6 Print dialog screenshot: a mode dropdown with the PS/PF/DD/CD/CW/CM
// shorthand plus "Custom Date…", which only then reveals a real date input).
function TimescaleField({ label, mode, customDate, onModeChange, onCustomDateChange }: {
  label: string
  mode: TimescaleAnchorMode
  customDate: string | null
  onModeChange: (mode: TimescaleAnchorMode) => void
  onCustomDateChange: (date: string | null) => void
}) {
  return (
    <label className="text-xs text-gray-600">
      {label}
      <select
        value={mode} onChange={e => onModeChange(e.target.value as TimescaleAnchorMode)}
        className="block w-full border border-gray-300 rounded px-1.5 py-1 text-xs mt-0.5"
      >
        {TIMESCALE_MODES.map(m => <option key={m} value={m}>{TIMESCALE_MODE_LABELS[m]}</option>)}
      </select>
      {mode === 'custom' && (
        <input
          type="date" value={customDate ?? ''}
          onChange={e => onCustomDateChange(e.target.value || null)}
          className="block w-full border border-gray-300 rounded px-1.5 py-1 text-xs mt-1"
        />
      )}
    </label>
  )
}

// Editor for the shared, per-project print header/footer/page setup (see
// frontend/src/lib/letterhead.ts) — used by every module's toolbar next to
// Print, per Maro (2026-07-03): logo + header/footer text/formatting set here
// shows up on every printed report for this project, not just this module's.
// Renamed from "Letterhead" to "Page Setup" (2026-07-06, per Maro) once the
// Gantt-only options (legend checkbox, Print Timescale section) were added
// alongside it — "letterhead" no longer described everything this edits.
export function LetterheadEditorWidget({ letterhead, previewTokens, onSave, onClose, showGanttOptions = false, schedulePreview, onPrint }: Props) {
  const [draft, setDraft] = useState<ProjectLetterhead>(letterhead)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewMaximized, setPreviewMaximized] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const setZone = (key: keyof Pick<ProjectLetterhead,
    'header_left' | 'header_center' | 'header_right' | 'footer_left' | 'footer_center' | 'footer_right'
  >) => (zone: LetterheadZone) => setDraft(d => ({ ...d, [key]: zone }))

  const resetHeader = () => {
    const d = defaultLetterhead(draft.project_id)
    setDraft(prev => ({ ...prev, header_left: d.header_left, header_center: d.header_center, header_right: d.header_right }))
  }
  const resetFooter = () => {
    const d = defaultLetterhead(draft.project_id)
    setDraft(prev => ({ ...prev, footer_left: d.footer_left, footer_center: d.footer_center, footer_right: d.footer_right }))
  }

  const handleLogoUpload = (file: File) => {
    setError(null)
    if (file.size > MAX_LOGO_BYTES) {
      setError(`"${file.name}" is too large (${Math.round(file.size / 1024)}KB) — please use an image under ${Math.round(MAX_LOGO_BYTES / 1024)}KB.`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => setDraft(d => ({ ...d, logo_data_url: reader.result as string }))
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      onClose()
    } catch {
      setError('Could not save the page setup.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndPrint = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      onClose()
      onPrint?.()
    } catch {
      setError('Could not save the page setup.')
    } finally {
      setSaving(false)
    }
  }

  const handleExport = () => {
    downloadJson('page-setup.json', {
      logo_data_url: draft.logo_data_url,
      logo_position: draft.logo_position,
      header_left: draft.header_left,
      header_center: draft.header_center,
      header_right: draft.header_right,
      footer_left: draft.footer_left,
      footer_center: draft.footer_center,
      footer_right: draft.footer_right,
      show_gantt_legend: draft.show_gantt_legend,
      timescale_start_mode: draft.timescale_start_mode,
      timescale_finish_mode: draft.timescale_finish_mode,
      timescale_start_custom_date: draft.timescale_start_custom_date,
      timescale_finish_custom_date: draft.timescale_finish_custom_date,
      print_column_widths: draft.print_column_widths,
      print_udf_column_width: draft.print_udf_column_width,
      print_font_size: draft.print_font_size,
      header_print_font_size: draft.header_print_font_size,
      gantt_print_font_size: draft.gantt_print_font_size,
      gantt_legend_font_size: draft.gantt_legend_font_size,
      print_font_family: draft.print_font_family,
      gantt_print_font_family: draft.gantt_print_font_family,
      header_print_font_family: draft.header_print_font_family,
      gantt_legend_font_family: draft.gantt_legend_font_family,
    })
  }

  // Loads the imported file into the draft/preview only — same "stage it,
  // then click Save yourself" pattern this form already uses for an uploaded
  // logo, rather than overwriting the live page setup the instant a file is
  // chosen (client-side only, P6's own Copy/Paste adapted to a file-based
  // workflow — 2026-07-05, per Maro).
  const handleImportFile = async (file: File) => {
    setError(null)
    try {
      const parsed = await readJsonFile(file) as Partial<ProjectLetterhead>
      if (typeof parsed.header_left !== 'object' || parsed.header_left === null) {
        throw new Error(`"${file.name}" isn't a valid exported page setup.`)
      }
      setDraft(d => ({
        ...d,
        logo_data_url: parsed.logo_data_url ?? null,
        logo_position: parsed.logo_position ?? 'left',
        header_left: parsed.header_left as LetterheadZone,
        header_center: (parsed.header_center as LetterheadZone) ?? EMPTY_ZONE,
        header_right: (parsed.header_right as LetterheadZone) ?? EMPTY_ZONE,
        footer_left: (parsed.footer_left as LetterheadZone) ?? EMPTY_ZONE,
        footer_center: (parsed.footer_center as LetterheadZone) ?? EMPTY_ZONE,
        footer_right: (parsed.footer_right as LetterheadZone) ?? EMPTY_ZONE,
        show_gantt_legend: parsed.show_gantt_legend ?? false,
        timescale_start_mode: parsed.timescale_start_mode ?? 'auto',
        timescale_finish_mode: parsed.timescale_finish_mode ?? 'auto',
        timescale_start_custom_date: parsed.timescale_start_custom_date ?? null,
        timescale_finish_custom_date: parsed.timescale_finish_custom_date ?? null,
        print_column_widths: parsed.print_column_widths ?? {},
        print_udf_column_width: parsed.print_udf_column_width ?? null,
        print_font_size: parsed.print_font_size ?? 9,
        header_print_font_size: parsed.header_print_font_size ?? 9,
        gantt_print_font_size: parsed.gantt_print_font_size ?? 8,
        gantt_legend_font_size: parsed.gantt_legend_font_size ?? 9,
        print_font_family: parsed.print_font_family ?? 'sans',
        gantt_print_font_family: parsed.gantt_print_font_family ?? 'sans',
        header_print_font_family: parsed.header_print_font_family ?? 'sans',
        gantt_legend_font_family: parsed.gantt_legend_font_family ?? 'sans',
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import that file.')
    }
  }

  // Shared between the inline preview and the maximized overlay (2026-07-07,
  // per Maro: "add a maximize preview or pop out... to see it on a fully") —
  // same content either way, just a taller/wider box when maximized.
  const renderPreviewContent = (boxHeight: number | string) => (
    showGanttOptions && schedulePreview ? (
      // Replaces the plain header/footer preview below (2026-07-07, per Maro:
      // "replace the top preview with the one at the bottom since the bottom
      // one previews everything the top one does now") — SchedulingPrintView
      // already renders the letterhead header/footer itself, plus the
      // activity table and Gantt/timescale, all driven by `draft` live.
      <>
        <div className="text-[10px] text-gray-400 mb-1">
          {Math.min(schedulePreview.activities.length, 6)} of {schedulePreview.activities.length} activit{schedulePreview.activities.length === 1 ? 'y' : 'ies'} shown — reflects every setting on the left live, header/footer/column widths/fonts/timescale included:
        </div>
        <div className="bg-white rounded border border-gray-100 overflow-auto" style={{ maxHeight: boxHeight }}>
          <SchedulingPrintView
            preview
            activities={schedulePreview.activities.slice(0, 6)}
            relationships={schedulePreview.relationships}
            resourceAssignments={schedulePreview.resourceAssignments}
            calendars={schedulePreview.calendars}
            visibleColumns={schedulePreview.visibleColumns}
            columnWidths={{ ...PRINT_COLUMN_DEFAULTS, ...draft.print_column_widths }}
            udfDefinitions={schedulePreview.udfDefinitions}
            getUdfValue={schedulePreview.getUdfValue}
            udfColumnWidth={draft.print_udf_column_width ?? PRINT_UDF_COLUMN_DEFAULT_WIDTH}
            projectName={previewTokens.project}
            letterhead={draft}
            ganttStyle={schedulePreview.ganttStyle}
            ganttZoom={schedulePreview.ganttZoom}
            dataDate={schedulePreview.dataDate}
          />
        </div>
      </>
    ) : (
      // Risk/ICD/Cost have no schedule to feed the combined preview above,
      // so they keep the simple header/footer-only preview.
      <>
        <div className="bg-white p-3 rounded border border-gray-100">
          <PrintLetterheadHeader letterhead={draft} tokens={previewTokens} />
          <p className="text-xs text-gray-300 italic">Report content…</p>
        </div>
        <div className="text-[10px] text-gray-400 mt-2 mb-1">Footer (repeats on every printed page):</div>
        <div className="bg-white rounded border border-gray-100">
          <PrintLetterheadFooter letterhead={draft} tokens={previewTokens} ganttLegend={showGanttOptions} preview />
        </div>
      </>
    )
  )

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">📄</span>
        <div className="font-bold text-sm">Page Setup</div>
        <div className="text-xs text-gray-400">Shared header/footer for every module's printed reports on this project</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <div className={showGanttOptions ? 'grid grid-cols-5 gap-6' : 'grid grid-cols-2 gap-6'}>
        <div className={showGanttOptions ? 'col-span-2' : undefined}>
          <div className="flex items-center gap-3 mb-3 p-2.5 border border-gray-200 rounded-lg">
            {draft.logo_data_url ? (
              <img src={draft.logo_data_url} alt="Logo" className="h-10 max-w-[8rem] object-contain" />
            ) : (
              <div className="h-10 w-16 flex items-center justify-center text-[10px] text-gray-300 border border-dashed border-gray-300 rounded">No logo</div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-blue-600 hover:text-blue-700 font-medium cursor-pointer">
                {draft.logo_data_url ? 'Replace logo' : 'Upload logo'}
                <input
                  type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f) }}
                />
              </label>
              {draft.logo_data_url && (
                <button onClick={() => setDraft(d => ({ ...d, logo_data_url: null }))} className="text-xs text-gray-400 hover:text-red-600 text-left">
                  Remove logo
                </button>
              )}
              <select
                value={draft.logo_position}
                onChange={e => setDraft(d => ({ ...d, logo_position: e.target.value as ProjectLetterhead['logo_position'] }))}
                className="text-xs border border-gray-300 rounded px-1.5 py-0.5"
              >
                <option value="left">Logo: left zone</option>
                <option value="center">Logo: center zone</option>
                <option value="right">Logo: right zone</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-1.5">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Header</div>
            <button type="button" onClick={resetHeader} className="ml-auto text-[10px] text-gray-400 hover:text-gray-600">
              Reset to defaults
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <ZoneEditor label="Left" zone={draft.header_left} onChange={setZone('header_left')} />
            <ZoneEditor label="Center" zone={draft.header_center} onChange={setZone('header_center')} />
            <ZoneEditor label="Right" zone={draft.header_right} onChange={setZone('header_right')} />
          </div>

          <div className="flex items-center gap-2 mb-1.5">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Footer</div>
            <button type="button" onClick={resetFooter} className="ml-auto text-[10px] text-gray-400 hover:text-gray-600">
              Reset to defaults
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <ZoneEditor label="Left" zone={draft.footer_left} onChange={setZone('footer_left')} />
            <ZoneEditor label="Center" zone={draft.footer_center} onChange={setZone('footer_center')} />
            <ZoneEditor label="Right" zone={draft.footer_right} onChange={setZone('footer_right')} />
          </div>

          {showGanttOptions && (
            <label className="flex items-start gap-2 text-xs text-gray-600 border border-gray-200 rounded-lg p-2.5">
              <input
                type="checkbox" checked={draft.show_gantt_legend}
                onChange={e => setDraft(d => ({ ...d, show_gantt_legend: e.target.checked }))}
                className="mt-0.5"
              />
              <span>
                📊 Include the Gantt legend in the footer (critical/non-critical, progress, milestone, dependency link, Work Package, baseline)
              </span>
            </label>
          )}

          {showGanttOptions && (
            <div className="mt-3 border border-gray-200 rounded-lg p-2.5">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Print Timescale</div>
              <div className="text-[10px] text-gray-400 mb-2">Bounds the printed Gantt's date range and zoom — the same activities print either way, only the timeline window changes.</div>
              <div className={`grid gap-3 ${schedulePreview ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <TimescaleField
                  label="Start" mode={draft.timescale_start_mode} customDate={draft.timescale_start_custom_date}
                  onModeChange={m => setDraft(d => ({ ...d, timescale_start_mode: m }))}
                  onCustomDateChange={v => setDraft(d => ({ ...d, timescale_start_custom_date: v }))}
                />
                <TimescaleField
                  label="Finish" mode={draft.timescale_finish_mode} customDate={draft.timescale_finish_custom_date}
                  onModeChange={m => setDraft(d => ({ ...d, timescale_finish_mode: m }))}
                  onCustomDateChange={v => setDraft(d => ({ ...d, timescale_finish_custom_date: v }))}
                />
                {schedulePreview && (
                  <label className="text-xs text-gray-600">
                    Zoom
                    <select
                      value={schedulePreview.ganttZoom}
                      onChange={e => schedulePreview.onGanttZoomChange(e.target.value as GanttZoom)}
                      className="block w-full border border-gray-300 rounded px-1.5 py-1 text-xs mt-0.5"
                    >
                      {ZOOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
          )}

          {showGanttOptions && (
            <div className="mt-3 border border-gray-200 rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-0.5">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Print Fonts</div>
                <button
                  type="button"
                  onClick={() => setDraft(d => ({
                    ...d,
                    print_font_size: 9, header_print_font_size: 9, gantt_print_font_size: 8, gantt_legend_font_size: 9,
                    print_font_family: 'sans', gantt_print_font_family: 'sans',
                    header_print_font_family: 'sans', gantt_legend_font_family: 'sans',
                  }))}
                  className="ml-auto text-[10px] text-gray-400 hover:text-gray-600"
                >
                  Reset to defaults
                </button>
              </div>
              <div className="text-[10px] text-gray-400 mb-2">Sizes and types used only when printing, independent of Layout's on-screen fonts.</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-20 shrink-0">Table</span>
                  <input
                    type="number" min={6} max={24} value={draft.print_font_size}
                    onChange={e => setDraft(d => ({ ...d, print_font_size: Number(e.target.value) || d.print_font_size }))}
                    onBlur={e => setDraft(d => ({ ...d, print_font_size: clamp(Number(e.target.value) || 9, 6, 24) }))}
                    className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  />
                  <select
                    value={draft.print_font_family}
                    onChange={e => setDraft(d => ({ ...d, print_font_family: e.target.value as GanttFontFamily }))}
                    className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value="sans">Sans</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Mono</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-20 shrink-0">Header</span>
                  <input
                    type="number" min={6} max={24} value={draft.header_print_font_size}
                    onChange={e => setDraft(d => ({ ...d, header_print_font_size: Number(e.target.value) || d.header_print_font_size }))}
                    onBlur={e => setDraft(d => ({ ...d, header_print_font_size: clamp(Number(e.target.value) || 9, 6, 24) }))}
                    className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  />
                  <select
                    value={draft.header_print_font_family}
                    onChange={e => setDraft(d => ({ ...d, header_print_font_family: e.target.value as GanttFontFamily }))}
                    className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value="sans">Sans</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Mono</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-20 shrink-0">Gantt/labels</span>
                  <input
                    type="number" min={6} max={24} value={draft.gantt_print_font_size}
                    onChange={e => setDraft(d => ({ ...d, gantt_print_font_size: Number(e.target.value) || d.gantt_print_font_size }))}
                    onBlur={e => setDraft(d => ({ ...d, gantt_print_font_size: clamp(Number(e.target.value) || 8, 6, 24) }))}
                    className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  />
                  <select
                    value={draft.gantt_print_font_family}
                    onChange={e => setDraft(d => ({ ...d, gantt_print_font_family: e.target.value as GanttFontFamily }))}
                    className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value="sans">Sans</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Mono</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600" title="The Gantt Legend in the footer — print-only, no on-screen equivalent">
                  <span className="w-20 shrink-0">Legend</span>
                  <input
                    type="number" min={6} max={24} value={draft.gantt_legend_font_size}
                    onChange={e => setDraft(d => ({ ...d, gantt_legend_font_size: Number(e.target.value) || d.gantt_legend_font_size }))}
                    onBlur={e => setDraft(d => ({ ...d, gantt_legend_font_size: clamp(Number(e.target.value) || 9, 6, 24) }))}
                    className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  />
                  <select
                    value={draft.gantt_legend_font_family}
                    onChange={e => setDraft(d => ({ ...d, gantt_legend_font_family: e.target.value as GanttFontFamily }))}
                    className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value="sans">Sans</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Mono</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {showGanttOptions && (
            <div className="mt-3 border border-gray-200 rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-0.5">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Print Column Widths</div>
                <button
                  type="button"
                  onClick={() => setDraft(d => ({ ...d, print_column_widths: {}, print_udf_column_width: null }))}
                  className="ml-auto text-[10px] text-gray-400 hover:text-gray-600"
                >
                  Reset to defaults
                </button>
              </div>
              <div className="text-[10px] text-gray-400 mb-2">
                Pixel widths for the printed activity table — independent of each browser's own on-screen resized columns.
              </div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 max-h-48 overflow-y-auto pr-1">
                <label className="flex items-center justify-between gap-1.5 text-[11px] text-gray-600">
                  Activity
                  <input
                    type="number" min={60} step={10}
                    value={draft.print_column_widths.activity ?? PRINT_COLUMN_DEFAULTS.activity}
                    onChange={e => setDraft(d => ({
                      ...d, print_column_widths: { ...d.print_column_widths, activity: Number(e.target.value) || 0 },
                    }))}
                    className="w-14 border border-gray-300 rounded px-1 py-0.5 text-right"
                  />
                </label>
                {ALL_COLUMNS.map(col => (
                  <label key={col.key} className="flex items-center justify-between gap-1.5 text-[11px] text-gray-600">
                    {col.label}
                    <input
                      type="number" min={30} step={5}
                      value={draft.print_column_widths[col.key] ?? PRINT_COLUMN_DEFAULTS[col.key as ResizableColumnKey]}
                      onChange={e => setDraft(d => ({
                        ...d, print_column_widths: { ...d.print_column_widths, [col.key]: Number(e.target.value) || 0 },
                      }))}
                      className="w-14 border border-gray-300 rounded px-1 py-0.5 text-right"
                    />
                  </label>
                ))}
                <label className="flex items-center justify-between gap-1.5 text-[11px] text-gray-600">
                  UDF columns
                  <input
                    type="number" min={40} step={10}
                    value={draft.print_udf_column_width ?? PRINT_UDF_COLUMN_DEFAULT_WIDTH}
                    onChange={e => setDraft(d => ({ ...d, print_udf_column_width: Number(e.target.value) || 0 }))}
                    className="w-14 border border-gray-300 rounded px-1 py-0.5 text-right"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className={showGanttOptions ? 'col-span-3' : undefined}>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Preview</div>
            <button
              type="button"
              onClick={() => setPreviewMaximized(true)}
              title="Maximize preview"
              className="text-gray-400 hover:text-gray-600 text-xs"
            >
              ⛶
            </button>
          </div>
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            {renderPreviewContent(460)}
          </div>
        </div>
      </div>

      {previewMaximized && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6"
          onClick={() => setPreviewMaximized(false)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl w-full h-full max-w-[96vw] max-h-[94vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="font-bold text-sm">Preview</div>
              <button onClick={() => setPreviewMaximized(false)} className="text-gray-400 hover:text-gray-600 text-sm">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-gray-50">
              {renderPreviewContent('100%')}
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={handleSave} disabled={saving}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Page Setup'}
        </button>
        {showGanttOptions && onPrint && (
          <button
            onClick={handleSaveAndPrint} disabled={saving}
            title="Save these changes, then go straight to Print"
            className="text-xs px-3 py-1.5 rounded bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40"
          >
            🖨️ Save &amp; Print
          </button>
        )}
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
        <div className="w-px h-4 bg-gray-200" />
        <button onClick={handleExport} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Export</button>
        <button onClick={() => importInputRef.current?.click()} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
          ⇧ Import
        </button>
        <input
          ref={importInputRef} type="file" accept="application/json,.json" className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleImportFile(file)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
