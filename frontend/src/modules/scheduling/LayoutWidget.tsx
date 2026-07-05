import { useEffect, useState } from 'react'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { GanttFontFamily, GanttLayout, GanttStyle } from '@/lib/ganttLayout'

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
    <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
      {label}
      <span className="relative flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPickerOpen(o => !o)}
          className="w-7 h-6 border border-gray-300 rounded shrink-0 cursor-pointer"
          style={{ backgroundColor: HEX_COLOR_RE.test(hexText) ? hexText : value }}
          title={value}
        />
        <input
          value={hexText}
          onChange={e => setHexText(e.target.value)}
          onBlur={commitHex}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          spellCheck={false}
          className="font-mono text-[10px] text-gray-600 w-16 border border-gray-200 rounded px-1 py-0.5"
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
    } catch {
      setError(`Could not ${editingId ? 'update' : 'save'} the layout — check your connection and try again.`)
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

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🖼️</span>
        <div className="font-bold text-sm">Layout</div>
        <div className="text-xs text-gray-400">Gantt colours, activity table shading/font, and letterhead — saved and applied together</div>
        <button
          onClick={handleReset} disabled={resetting}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40 mr-2"
        >
          {resetting ? 'Resetting…' : '↺ Reset to defaults'}
        </button>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-2 py-1.5 border border-gray-200">Name</th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
          </tr>
        </thead>
        <tbody>
          {layouts.map(l => (
            <tr key={l.id} className={l.is_active ? 'bg-blue-50/50' : undefined}>
              <td className="px-2 py-1.5 border border-gray-200 font-medium">{l.name}</td>
              <td className="px-2 py-1.5 border border-gray-200 whitespace-nowrap">
                {l.is_active ? (
                  <span className="text-blue-600 font-medium">✓ Applied</span>
                ) : (
                  <button onClick={() => handleApply(l)} disabled={busyId === l.id} className="text-blue-600 hover:text-blue-700 disabled:opacity-40">
                    Apply
                  </button>
                )}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 whitespace-nowrap">
                <button onClick={() => startEditing(l)} disabled={busyId === l.id} className="text-gray-500 hover:text-blue-600 disabled:opacity-40">
                  Edit
                </button>
              </td>
              <td className="px-2 py-1.5 border border-gray-200 text-right">
                <button onClick={() => handleDelete(l)} disabled={busyId === l.id} className="text-gray-400 hover:text-red-600 disabled:opacity-40">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {layouts.length === 0 && !creating && (
            <tr><td colSpan={4} className="px-2 py-3 text-center text-gray-400 border border-gray-200">No layouts saved yet — the built-in defaults are active</td></tr>
          )}
        </tbody>
      </table>

      {creating ? (
        <div className="border border-gray-200 rounded-lg p-3">
          <label className="text-xs text-gray-600 block mb-3">
            Name
            <input
              value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Client Brand Colours" autoFocus
              className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-64"
            />
          </label>

          <div className="grid grid-cols-3 gap-6">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Gantt colours</div>
              <div className="space-y-1.5">
                <ColorField label="Critical activity" value={draft.critical_color} onChange={setField('critical_color')} />
                <ColorField label="Non-critical activity" value={draft.non_critical_color} onChange={setField('non_critical_color')} />
                <ColorField label="Critical milestone" value={draft.milestone_critical_color} onChange={setField('milestone_critical_color')} />
                <ColorField label="Non-critical milestone" value={draft.milestone_noncritical_color} onChange={setField('milestone_noncritical_color')} />
                <ColorField label="Baseline" value={draft.baseline_color} onChange={setField('baseline_color')} />
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
                  Baseline thickness
                  <input
                    type="number" min={2} max={20} value={draft.baseline_thickness}
                    onChange={e => setField('baseline_thickness')(Number(e.target.value) || draft.baseline_thickness)}
                    className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  />
                </label>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                WBS levels <span className="normal-case text-gray-400">(Gantt line + table row shade)</span>
              </div>
              <div className="space-y-1.5">
                {draft.wbs_level_colors.map((color, i) => (
                  <ColorField key={i} label={`Level ${i + 1}`} value={color} onChange={setWbsLevel(i)} />
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Activity table</div>
              <div className="space-y-1.5">
                <ColorField label="Activity row shade" value={draft.activity_row_color} onChange={setField('activity_row_color')} />
                <ColorField label="Milestone row shade" value={draft.milestone_row_color} onChange={setField('milestone_row_color')} />
                <ColorField label="Font colour" value={draft.table_font_color} onChange={setField('table_font_color')} />
                <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
                  Font
                  <select
                    value={draft.table_font_family}
                    onChange={e => setField('table_font_family')(e.target.value as GanttFontFamily)}
                    className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value="sans">Sans-serif</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Monospace</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button onClick={handleSave} disabled={saving || !name.trim()} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
              {saving ? 'Saving…' : editingId ? 'Update Layout' : 'Save Layout'}
            </button>
            <button onClick={closeForm} className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1.5">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={startCreating} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Save current as new layout</button>
      )}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
