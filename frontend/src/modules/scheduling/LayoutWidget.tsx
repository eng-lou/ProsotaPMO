import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { downloadJson, readJsonFile } from '@/lib/exportImport'
import type { GanttFontFamily, GanttLayout, GanttStyle } from '@/lib/ganttLayout'

interface PydanticErrorItem {
  loc?: (string | number)[]
  msg?: string
}

// Unlike the other widgets' own copy of this helper, `detail` here isn't
// always a plain string — a numeric field out of its schema range (e.g.
// print_font_size above 24) fails FastAPI's own request validation *before*
// any endpoint code runs, which shapes `detail` as a list of
// {loc, msg} pydantic error objects instead (2026-07-06, per Maro: a 422 on
// saving a Layout was only ever shown as a generic "check your connection"
// message, since this widget's handleSave didn't call apiErrorDetail at
// all). Falls back to the field name + message per error, semicolon-joined.
function apiErrorDetail(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined
  const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map(item => {
      const { loc, msg } = item as PydanticErrorItem
      const field = loc && loc.length > 0 ? loc[loc.length - 1] : 'value'
      return msg ? `${field}: ${msg}` : JSON.stringify(item)
    }).join('; ')
  }
  return undefined
}

interface Props {
  layouts: GanttLayout[]
  activeStyle: GanttStyle
  onCreate: (name: string, style: GanttStyle) => Promise<void>
  onUpdate: (layoutId: string, name: string, style: GanttStyle) => Promise<void>
  onApply: (layoutId: string) => Promise<void>
  onDelete: (layoutId: string) => Promise<void>
  onReset: () => Promise<void>
  onClose: () => void
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

// A native <input type="number">'s min/max attributes only affect the
// spinner arrows and the browser's own (never actually shown here, since
// this isn't inside a <form>) validation UI — nothing stops typing/pasting a
// value outside them, which then reaches the backend's own ge/le schema
// bound and 422s (2026-07-06, per Maro: saving a Layout after tweaking a
// font-size field failed with a generic "check your connection" error,
// which turned out to be a plain out-of-range value on save, only ever
// caught at the backend, not before).
//
// Deliberately only clamped onBlur, never onChange — clamping every
// keystroke fights a controlled input while typing a multi-digit number: the
// field is these inputs' *only* state (no separate raw-string draft per
// field), so clamping mid-edit rewrites what's displayed on every character
// typed. Concretely, typing "18" over an existing "8" starts by clearing the
// box, which forced-substituted a fallback (say 9); the next keystroke then
// appended to *that* instead of a blank field, quickly producing a number
// above the max, which clamped to 24 — and appending any further digit to
// "24" clamps right back to 24, so the field got stuck there no matter what
// was typed next (2026-07-06, per Maro: "it wont let me choose a number... is
// forcing me to pick 24"). Letting onChange pass the raw typed value through
// unclamped, and only clamping/defaulting once the field is left, fixes this
// while still guaranteeing nothing out-of-range ever reaches Save.
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// No native <input type="color"> here — that OS-level dialog itself was
// hanging the whole browser tab on Windows/Chrome (2026-07-05, per Maro; two
// rounds of trying to work around React's side of it didn't fix it, only
// removing it did). The click-to-drag square+hue picker Maro asked to keep
// is `ColorPickerPopover` (frontend/src/components/) — built from plain
// divs/CSS gradients/pointer events, no OS dialog involved at all. The hex
// text field stays as a direct-entry alternative.
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [hexText, setHexText] = useState(value)
  const [pickerOpen, setPickerOpen] = useState(false)
  useEffect(() => { setHexText(value) }, [value])

  const commitHex = () => {
    if (HEX_COLOR_RE.test(hexText)) onChange(hexText)
    else setHexText(value) // invalid — revert to the last real value
  }

  return (
    // A plain <div>, not <label> — the row holds two separate controls (the
    // swatch button and the hex input), not one thing a label describes, and
    // wrapping a <button> in a <label> risks the browser's label-click-
    // forwarding behavior (activating/focusing "the" associated control)
    // intercepting the click before our own onClick runs (2026-07-05, per
    // Maro — clicking the swatch stopped opening the picker at all).
    <div className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
      {label}
      <span className="relative flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPickerOpen(o => !o)}
          className="w-7 h-6 border border-gray-300 dark:border-prosota-line rounded shrink-0 cursor-pointer"
          style={{ backgroundColor: HEX_COLOR_RE.test(hexText) ? hexText : value }}
          title={value}
        />
        <input
          value={hexText}
          onChange={e => setHexText(e.target.value)}
          onBlur={commitHex}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          spellCheck={false}
          className="font-mono text-[10px] text-gray-600 dark:text-prosota-muted w-16 border border-gray-200 dark:border-prosota-line dark:bg-prosota-panel2 rounded px-1 py-0.5"
        />
        {pickerOpen && (
          <ColorPickerPopover
            value={HEX_COLOR_RE.test(hexText) ? hexText : value}
            onChange={hex => { onChange(hex); setHexText(hex) }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </span>
    </div>
  )
}

// Editor for named, saved Gantt/table visual themes (2026-07-03, per Maro) —
// same create/apply/delete shape as BaselineWidget, plus editing an existing
// layout in place and resetting back to the built-in look. A layout bundles
// Gantt colours, table row shading/font, and (server-side, on save) a
// snapshot of the project's current letterhead — "the letterhead settings
// also get saved in the layout" — so Apply is a single action that switches
// a project's whole printed/on-screen look in one go.
export function LayoutWidget({ layouts, activeStyle, onCreate, onUpdate, onApply, onDelete, onReset, onClose }: Props) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<GanttStyle>(activeStyle)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const setField = <K extends keyof GanttStyle>(key: K) => (value: GanttStyle[K]) => setDraft(d => ({ ...d, [key]: value }))
  const setWbsLevel = (index: number) => (color: string) => setDraft(d => {
    const colors = [...d.wbs_level_colors]
    colors[index] = color
    return { ...d, wbs_level_colors: colors }
  })

  const startCreating = () => {
    setEditingId(null)
    setDraft(activeStyle)
    setName('')
    setError(null)
    setCreating(true)
  }

  const startEditing = (layout: GanttLayout) => {
    setEditingId(layout.id)
    setDraft(layout.style)
    setName(layout.name)
    setError(null)
    setCreating(true)
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (editingId) await onUpdate(editingId, name.trim(), draft)
      else await onCreate(name.trim(), draft)
      closeForm()
    } catch (err) {
      setError(apiErrorDetail(err) ?? `Could not ${editingId ? 'update' : 'save'} the layout — check your connection and try again.`)
    } finally {
      setSaving(false)
    }
  }

  // Blur before unmounting the form — a leftover defensive habit from when
  // this form had native <input type="color"> swatches in it (now removed
  // entirely, see ColorField above); harmless to keep for the text inputs
  // that remain.
  const closeForm = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setCreating(false)
    setEditingId(null)
    setName('')
  }

  const handleApply = async (layout: GanttLayout) => {
    if (!(await confirmWithDontAsk(
      'scheduling.layout-apply',
      `Apply layout "${layout.name}"? This changes the Gantt colours, activity table shading/font, and letterhead (logo/header/footer) for everyone viewing or printing this project.`
    ))) return
    setBusyId(layout.id)
    setError(null)
    try {
      await onApply(layout.id)
    } catch {
      setError(`Could not apply "${layout.name}" — check your connection and try again.`)
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (layout: GanttLayout) => {
    if (!(await confirmWithDontAsk('scheduling.layout-delete', `Delete the saved layout "${layout.name}"? This cannot be undone.`))) return
    setBusyId(layout.id)
    setError(null)
    try {
      await onDelete(layout.id)
    } catch {
      setError(`Could not delete "${layout.name}" — check your connection and try again.`)
    } finally {
      setBusyId(null)
    }
  }

  const handleReset = async () => {
    if (!(await confirmWithDontAsk('scheduling.layout-reset', 'Reset to the built-in default colours, fonts, and letterhead? Saved layouts are not deleted — just deactivated.'))) return
    setResetting(true)
    setError(null)
    try {
      await onReset()
    } catch {
      setError('Could not reset — check your connection and try again.')
    } finally {
      setResetting(false)
    }
  }

  const handleExport = (layout: GanttLayout) => {
    downloadJson(`${layout.name}.layout.json`, { name: layout.name, style: layout.style })
  }

  // Client-side only, like every other Export/Import pair in this app
  // (P6's own Copy/Paste, adapted to a file-based workflow — 2026-07-05, per
  // Maro) — reads the file, then feeds it straight into the same onCreate
  // this widget's own "Save Layout" button already calls.
  const handleImportFile = async (file: File) => {
    setError(null)
    try {
      const parsed = await readJsonFile(file) as Partial<GanttLayout>
      if (typeof parsed.name !== 'string' || typeof parsed.style !== 'object' || parsed.style === null) {
        throw new Error(`"${file.name}" isn't a valid exported layout.`)
      }
      await onCreate(parsed.name, parsed.style as GanttStyle)
    } catch (err) {
      setError(apiErrorDetail(err) ?? (err instanceof Error ? err.message : 'Could not import that file.'))
    }
  }

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🖼️</span>
        <div className="font-bold text-sm dark:text-prosota-paper">Layout</div>
        <div className="text-xs text-gray-400 dark:text-prosota-muted">Gantt colours, activity table shading/font, and letterhead — saved and applied together</div>
        <button
          onClick={handleReset} disabled={resetting}
          className="ml-auto text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper disabled:opacity-40 mr-2"
        >
          {resetting ? 'Resetting…' : '↺ Reset to defaults'}
        </button>
        <button onClick={onClose} className="text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="bg-gray-50 dark:bg-prosota-panel2 text-left text-gray-500 dark:text-prosota-muted">
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Name</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
          </tr>
        </thead>
        <tbody>
          {layouts.map(l => (
            <tr key={l.id} className={l.is_active ? 'bg-blue-50/50 dark:bg-prosota-azure/10' : undefined}>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line font-medium">{l.name}</td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line whitespace-nowrap">
                {l.is_active ? (
                  <span className="text-blue-600 dark:text-prosota-azure font-medium">✓ Applied</span>
                ) : (
                  <button onClick={() => handleApply(l)} disabled={busyId === l.id} className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan disabled:opacity-40">
                    Apply
                  </button>
                )}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line whitespace-nowrap">
                <button onClick={() => startEditing(l)} disabled={busyId === l.id} className="text-gray-500 dark:text-prosota-muted hover:text-blue-600 disabled:opacity-40">
                  Edit
                </button>
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line whitespace-nowrap">
                <button onClick={() => handleExport(l)} className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan">
                  Export
                </button>
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right">
                <button onClick={() => handleDelete(l)} disabled={busyId === l.id} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {layouts.length === 0 && !creating && (
            <tr><td colSpan={5} className="px-2 py-3 text-center text-gray-400 dark:text-prosota-muted border border-gray-200 dark:border-prosota-line">No layouts saved yet — the built-in defaults are active</td></tr>
          )}
        </tbody>
      </table>

      {creating ? (
        <div className="border border-gray-200 dark:border-prosota-line rounded-lg p-3">
          <label className="text-xs text-gray-600 dark:text-prosota-muted block mb-3">
            Name
            <input
              value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Client Brand Colours" autoFocus
              className="block border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1 text-xs mt-0.5 w-64"
            />
          </label>

          <div className="grid grid-cols-4 gap-6">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 dark:text-prosota-muted uppercase tracking-wide mb-1.5">Gantt</div>
              <div className="space-y-1.5">
                <ColorField label="Critical activity" value={draft.critical_color} onChange={setField('critical_color')} />
                <ColorField label="Non-critical activity" value={draft.non_critical_color} onChange={setField('non_critical_color')} />
                <ColorField label="Critical milestone" value={draft.milestone_critical_color} onChange={setField('milestone_critical_color')} />
                <ColorField label="Non-critical milestone" value={draft.milestone_noncritical_color} onChange={setField('milestone_noncritical_color')} />
                <ColorField label="Baseline" value={draft.baseline_color} onChange={setField('baseline_color')} />
                <ColorField label="Sub-critical" value={draft.sub_critical_color} onChange={setField('sub_critical_color')} />
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                  Baseline thickness
                  <input
                    type="number" min={2} max={20} value={draft.baseline_thickness}
                    onChange={e => setField('baseline_thickness')(Number(e.target.value))}
                    onBlur={e => setField('baseline_thickness')(clamp(Number(e.target.value) || 7, 2, 20))}
                    className="w-14 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted" title="Timeline header marks + the optional name/resource/finish bar label">
                  Timeline/label font (screen)
                  <input
                    type="number" min={6} max={24} step={1}
                    value={draft.gantt_font_size}
                    onChange={e => setField('gantt_font_size')(Number(e.target.value))}
                    onBlur={e => setField('gantt_font_size')(clamp(Number(e.target.value) || 10, 6, 24))}
                    className="w-14 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted" title="Independent of the Activity table's own font, below">
                  Timeline/label font type
                  <select
                    value={draft.gantt_font_family}
                    onChange={e => setField('gantt_font_family')(e.target.value as GanttFontFamily)}
                    className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value="sans">Sans-serif</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Monospace</option>
                  </select>
                </label>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-gray-400 dark:text-prosota-muted uppercase tracking-wide mb-1.5">
                WBS levels <span className="normal-case text-gray-400 dark:text-prosota-muted">(Gantt line + table row shade)</span>
              </div>
              <div className="space-y-1.5">
                {draft.wbs_level_colors.map((color, i) => (
                  <ColorField key={i} label={`Level ${i + 1}`} value={color} onChange={setWbsLevel(i)} />
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-gray-400 dark:text-prosota-muted uppercase tracking-wide mb-1.5">Activity table</div>
              <div className="space-y-1.5">
                <ColorField label="Activity row shade" value={draft.activity_row_color} onChange={setField('activity_row_color')} />
                <ColorField label="Milestone row shade" value={draft.milestone_row_color} onChange={setField('milestone_row_color')} />
                <ColorField label="Highlight colour" value={draft.highlight_color} onChange={setField('highlight_color')} />
                <ColorField label="Font colour" value={draft.table_font_color} onChange={setField('table_font_color')} />
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                  Font
                  <select
                    value={draft.table_font_family}
                    onChange={e => setField('table_font_family')(e.target.value as GanttFontFamily)}
                    className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value="sans">Sans-serif</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Monospace</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                  Font size (screen)
                  <input
                    type="number" min={10} max={24} step={1}
                    value={draft.table_font_size}
                    onChange={e => setField('table_font_size')(Number(e.target.value))}
                    onBlur={e => setField('table_font_size')(clamp(Number(e.target.value) || 14, 10, 24))}
                    className="w-14 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted" title="The column-label header row (Code/WBS/Type/...), independent of the body text above">
                  Header font size (screen)
                  <input
                    type="number" min={6} max={24} step={1}
                    value={draft.header_font_size}
                    onChange={e => setField('header_font_size')(Number(e.target.value))}
                    onBlur={e => setField('header_font_size')(clamp(Number(e.target.value) || 12, 6, 24))}
                    className="w-14 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted" title="Independent of the body text's own font, above">
                  Header font type
                  <select
                    value={draft.header_font_family}
                    onChange={e => setField('header_font_family')(e.target.value as GanttFontFamily)}
                    className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value="sans">Sans-serif</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Monospace</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                  Show time of day
                  <input
                    type="checkbox" checked={draft.show_time_of_day}
                    onChange={e => setField('show_time_of_day')(e.target.checked)}
                  />
                </label>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-gray-400 dark:text-prosota-muted uppercase tracking-wide mb-1.5">
                Gantt display <span className="normal-case text-gray-400 dark:text-prosota-muted">(on-screen + print)</span>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                  Predecessor/successor lines
                  <input
                    type="checkbox" checked={draft.show_connectors}
                    onChange={e => setField('show_connectors')(e.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted" title="A ring around a bar/milestone that's critical within its own tagged sub-project, even when not on the master critical path">
                  Sub-critical indicator
                  <input
                    type="checkbox" checked={draft.show_sub_critical}
                    onChange={e => setField('show_sub_critical')(e.target.checked)}
                  />
                </label>
                <div className="text-[10px] font-semibold text-gray-400 dark:text-prosota-muted uppercase tracking-wide pt-1">Bar labels</div>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                  Activity name
                  <input
                    type="checkbox" checked={draft.show_label_name}
                    onChange={e => setField('show_label_name')(e.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                  Assigned resources
                  <input
                    type="checkbox" checked={draft.show_label_resource}
                    onChange={e => setField('show_label_resource')(e.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-prosota-muted">
                  Finish date
                  <input
                    type="checkbox" checked={draft.show_label_finish}
                    onChange={e => setField('show_label_finish')(e.target.checked)}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button onClick={handleSave} disabled={saving || !name.trim()} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-40">
              {saving ? 'Saving…' : editingId ? 'Update Layout' : 'Save Layout'}
            </button>
            <button onClick={closeForm} className="text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper px-1 py-1.5">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={startCreating} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">+ Save current as new layout</button>
          <button onClick={() => importInputRef.current?.click()} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">
            ⇧ Import Layout
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
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
    </div>
  )
}
