import { useEffect, useState } from 'react'
import { ColorPickerPopover } from '@/components/ColorPickerPopover'
import type { AnimationProfileConfig, Axis, Direction, Interpolation, Trigger, TransformKind } from './animationProfiles'

interface Props {
  name: string
  config: AnimationProfileConfig
  onSave: (name: string, config: AnimationProfileConfig) => void
  onCancel: () => void
  saveLabel: string
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-gray-600 dark:text-prosota-muted">{label}</span>
      {children}
    </div>
  )
}

function ColorField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-1 relative">
      {value ? (
        <>
          <button
            onClick={() => setOpen(v => !v)}
            title={value}
            className="w-5 h-5 rounded border border-gray-300 dark:border-prosota-line"
            style={{ backgroundColor: value }}
          />
          <button onClick={() => onChange(null)} title="Don't touch colour" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 text-xs">✕</button>
        </>
      ) : (
        <button onClick={() => onChange('#ef4444')} className="text-xs text-gray-400 dark:text-prosota-muted border border-dashed border-gray-300 dark:border-prosota-line rounded px-1.5 py-0.5">
          None
        </button>
      )}
      {open && value && (
        <div className="absolute z-50 top-full left-0 mt-1">
          <ColorPickerPopover value={value} onChange={onChange} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

const NEEDS_AXIS: TransformKind[] = ['translate', 'scale', 'rotate', 'pop', 'spiral', 'fall']
const NEEDS_BOUNCE: TransformKind[] = ['rotate', 'pop']
const NEEDS_TWIST: TransformKind[] = ['pop', 'spiral']

// The form behind AnimationProfilePanel.tsx's "+ New" / "✎ Edit" — every
// named preset ("Pop Up Y", "Fall Down Z", ...) reduces to these same
// fields (2026-07-11, per Maro, referencing a Blender add-on's own preset
// UI: axis + direction/distance + bounce/twist, plus Bonsai's colour-while-
// ongoing idea folded in as an optional colour transition here). No live
// preview — this only edits the saved recipe; seeing it play out is the
// timeline playback engine's job once that exists.
export function AnimationProfileEditor({ name: initialName, config: initialConfig, onSave, onCancel, saveLabel }: Props) {
  const [name, setName] = useState(initialName)
  const [config, setConfig] = useState(initialConfig)
  useEffect(() => { setName(initialName); setConfig(initialConfig) }, [initialName, initialConfig])

  const set = <K extends keyof AnimationProfileConfig>(key: K, value: AnimationProfileConfig[K]) =>
    setConfig(prev => ({ ...prev, [key]: value }))

  const showAxis = NEEDS_AXIS.includes(config.transform_kind)
  const showBounce = NEEDS_BOUNCE.includes(config.transform_kind)
  const showTwist = NEEDS_TWIST.includes(config.transform_kind)

  return (
    <div className="space-y-1 px-1 py-1.5 border border-gray-200 dark:border-prosota-line rounded bg-gray-50 dark:bg-prosota-panel2">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Profile name…"
        className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1 font-medium"
      />

      <Row label="Trigger">
        <select value={config.trigger} onChange={e => set('trigger', e.target.value as Trigger)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5">
          <option value="over_duration">Over duration</option>
          <option value="on_start">On start</option>
          <option value="on_finish">On finish</option>
        </select>
      </Row>

      <Row label="Transform">
        <select value={config.transform_kind} onChange={e => set('transform_kind', e.target.value as TransformKind)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5">
          <option value="none">None</option>
          <option value="translate">Translate</option>
          <option value="scale">Scale</option>
          <option value="rotate">Rotate</option>
          <option value="pop">Pop</option>
          <option value="spiral">Spiral</option>
          <option value="fall">Fall</option>
        </select>
      </Row>

      {showAxis && (
        <>
          <Row label="Axis">
            <select value={config.axis} onChange={e => set('axis', e.target.value as Axis)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5">
              <option value="x">X</option>
              <option value="y">Y</option>
              <option value="z">Z</option>
            </select>
          </Row>
          <Row label="Direction">
            <select value={config.direction} onChange={e => set('direction', Number(e.target.value) as Direction)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5">
              <option value={1}>Positive</option>
              <option value={-1}>Negative</option>
            </select>
          </Row>
          <Row label="Distance">
            <input
              type="number" step={0.1} value={config.distance}
              onChange={e => set('distance', Number(e.target.value) || 0)}
              className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
            />
          </Row>
        </>
      )}
      {showBounce && (
        <Row label="Bounce">
          <input type="checkbox" checked={config.bounce} onChange={e => set('bounce', e.target.checked)} />
        </Row>
      )}
      {showTwist && (
        <Row label="Twist">
          <input type="checkbox" checked={config.twist} onChange={e => set('twist', e.target.checked)} />
        </Row>
      )}

      <Row label="Opacity from">
        <input type="number" min={0} max={1} step={0.1} value={config.opacity_from} onChange={e => set('opacity_from', Number(e.target.value) || 0)} className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right" />
      </Row>
      <Row label="Opacity to">
        <input type="number" min={0} max={1} step={0.1} value={config.opacity_to} onChange={e => set('opacity_to', Number(e.target.value) || 0)} className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right" />
      </Row>
      <Row label="Colour from">
        <ColorField value={config.color_from} onChange={v => set('color_from', v)} />
      </Row>
      <Row label="Colour to">
        <ColorField value={config.color_to} onChange={v => set('color_to', v)} />
      </Row>

      <Row label="Interpolation">
        <select value={config.interpolation} onChange={e => set('interpolation', e.target.value as Interpolation)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5">
          <option value="linear">Linear</option>
          <option value="ease_in">Ease in</option>
          <option value="ease_out">Ease out</option>
          <option value="ease_in_out">Ease in/out</option>
          <option value="bounce">Bounce</option>
        </select>
      </Row>
      <Row label="Duration (frames)">
        <input
          type="number" min={1} value={config.duration_frames ?? ''} placeholder="Auto"
          onChange={e => set('duration_frames', e.target.value === '' ? null : Number(e.target.value))}
          className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
        />
      </Row>

      <div className="flex items-center gap-1.5 pt-1">
        <button
          onClick={() => onSave(name, config)}
          disabled={!name.trim()}
          className="flex-1 text-xs px-2 py-1 rounded border border-gray-900 bg-gray-900 text-white disabled:opacity-50"
        >
          {saveLabel}
        </button>
        <button onClick={onCancel} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
          Cancel
        </button>
      </div>
    </div>
  )
}
