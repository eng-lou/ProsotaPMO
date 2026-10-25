import { ProfilePreview } from './ProfilePreview'
import { durationDays, durationValue } from './profilePresentation'
import { useEffect, useRef, useState } from 'react'
import { ColorPickerPopover, normalizeHex } from '@/components/ColorPickerPopover'
import type { AnimationProfileConfig, Axis, Direction, Interpolation, StaggerOrder, Trigger, TransformKind } from './animationProfiles'

interface Props {
  speedDaysPerSecond?: number
  fps?: number
  name: string
  config: AnimationProfileConfig
  onSave: (name: string, config: AnimationProfileConfig) => void
  onCancel: () => void
  saveLabel: string
  // Colours already used by this project's saved profiles, most recent
  // first (AnimationProfilePanel.tsx) — offered as swatches in the picker.
  recentColors?: string[]
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-gray-600 dark:text-prosota-muted">{label}</span>
      {children}
    </div>
  )
}

// Swatch + hex box + picker (2026-10-02, per Maro: "allow me to add a
// hexcode for the colour from/to. expand to fit so can use the color picker
// well ... see the recent colors used on project"). The picker is anchored
// to the swatch and rendered at page level (ColorPickerPopover's `anchor`),
// so the narrow, scrolling profiles panel can no longer clip it.
function ColorField({ value, onChange, recentColors }: { value: string | null; onChange: (v: string | null) => void; recentColors?: string[] }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const swatchRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { setDraft(value ?? '') }, [value])
  const commitDraft = () => {
    if (draft.trim() === '') return
    const hex = normalizeHex(draft)
    if (hex) onChange(hex)
    else setDraft(value ?? '')
  }
  return (
    <div className="flex items-center gap-1">
      {value ? (
        <>
          <button
            ref={swatchRef}
            onClick={() => setOpen(v => !v)}
            title="Pick colour"
            className="w-5 h-5 rounded border border-gray-300 dark:border-prosota-line shrink-0"
            style={{ backgroundColor: value }}
          />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDraft() } }}
            spellCheck={false}
            aria-label="Hex colour"
            className="w-[4.75rem] text-xs font-mono border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5"
          />
          <button onClick={() => { onChange(null); setOpen(false) }} title="Don't touch colour" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 text-xs">✕</button>
        </>
      ) : (
        <button
          ref={swatchRef}
          onClick={() => { onChange(recentColors?.[0] ?? '#ef4444'); setOpen(true) }}
          className="text-xs text-gray-400 dark:text-prosota-muted border border-dashed border-gray-300 dark:border-prosota-line rounded px-1.5 py-0.5"
        >
          None
        </button>
      )}
      {open && value && (
        <ColorPickerPopover
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          anchor={swatchRef.current}
          recentColors={recentColors}
        />
      )}
    </div>
  )
}

const NEEDS_AXIS: TransformKind[] = ['translate', 'rotate', 'pop', 'spiral', 'fall', 'grow']

// The form behind AnimationProfilePanel.tsx's "+ New" / "✎ Edit" — every
// named preset ("Pop Up Y", "Fall Down Z", ...) reduces to these same
// fields (2026-07-11, per Maro, referencing a Blender add-on's own preset
// UI: axis + direction/distance, plus Bonsai's colour-while-
// Preview uses the production evaluator on a sample activity without scene edits.
export function AnimationProfileEditor({ name: initialName, config: initialConfig, onSave, onCancel, saveLabel, recentColors, speedDaysPerSecond=7, fps=30 }: Props) {
  const [durationUnit, setDurationUnit] = useState('days')
  const [name, setName] = useState(initialName)
  const [config, setConfig] = useState(initialConfig)
  useEffect(() => { setName(initialName); setConfig(initialConfig) }, [initialName, initialConfig])

  const set = <K extends keyof AnimationProfileConfig>(key: K, value: AnimationProfileConfig[K]) =>
    setConfig(prev => ({ ...prev, [key]: value }))

  const showAxis = NEEDS_AXIS.includes(config.transform_kind)

  return (
    <div className="space-y-1 px-1 py-1.5 border border-gray-200 dark:border-prosota-line rounded bg-gray-50 dark:bg-prosota-panel2">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Profile name…"
        className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1 font-medium"
      />

      <ProfilePreview config={config}/>
      <h3 className="text-xs font-semibold pt-3">Timing</h3>
      <Row label="When to animate">
        <select value={config.trigger} onChange={e => set('trigger', e.target.value as Trigger)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5">
          <option value="over_duration">Across the activity</option>
          <option value="on_start">After activity starts</option>
          <option value="on_finish">Before activity finishes</option>
        </select>
      </Row>

      <p className="text-[11px] text-gray-500 dark:text-prosota-muted">{config.trigger==='over_duration'?'Movement spans the linked activity’s start and finish dates.':config.trigger==='on_start'?'The transition starts at the activity start date.':'The transition ends at the activity finish date.'} Colour transitions span the full activity.</p>
      <h3 className="text-xs font-semibold pt-3">Movement</h3>
      <Row label="Movement">
        <select value={config.transform_kind} onChange={e => set('transform_kind', e.target.value as TransformKind)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5">
          <option value="none">None</option>
          <option value="translate">Translate</option>
          <option value="scale">Scale</option>
          <option value="rotate">Rotate</option>
          <option value="pop">Pop</option>
          <option value="spiral">Spiral</option>
          <option value="fall">Fall</option>
          <option value="grow">Grow / reveal</option>
        </select>
      </Row>

      {config.transform_kind === 'grow' && <>
        <Row label="Geometry action"><select aria-label="Geometry action" value={config.grow_mode ?? 'legacy'} onChange={e=>setConfig(prev=>({...prev,grow_mode:e.target.value==='legacy'?null:e.target.value as 'reveal'|'remove',...(e.target.value==='legacy'?{}:{opacity_from:1,opacity_to:1})}))} className="text-xs border rounded dark:bg-prosota-panel2 px-1 py-1">
          <option value="legacy">Original profile behaviour</option><option value="reveal">Reveal · build up</option><option value="remove">Remove · cut away</option>
        </select></Row>
        <p className="text-[11px] text-gray-500 dark:text-prosota-muted">{config.grow_mode==='remove'?'Starts as a complete solid, then cuts away to nothing.':config.grow_mode==='reveal'?'Starts empty, then reveals the complete solid.':'Original Grow profiles keep their existing timing and opacity behaviour. Choose Reveal or Remove to control geometry explicitly.'} Choosing Reveal/Remove sets both opacity values to 1 so the remaining solid stays opaque. Add a fade separately if wanted.</p>
      </>}
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
          {config.transform_kind !== 'grow' && <Row label={config.transform_kind === 'rotate' ? 'Angle (°)' : 'Distance (model units)'}>
            <input
              type="number" step={0.1} value={config.distance}
              onChange={e => set('distance', Number(e.target.value) || 0)}
              className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right"
            />
          </Row>}
        </>
      )}
      {(config.bounce || config.twist) && <p className="text-[10px] text-amber-600 dark:text-amber-300">Legacy bounce/twist flags are preserved. Current playback uses the easing choice for bounce and the Spiral movement for rotation.</p>}
      <h3 className="text-xs font-semibold pt-3">Appearance</h3>
      <p className="text-[10px] text-gray-500 dark:text-prosota-muted">{config.transform_kind==='grow' && config.grow_mode ? 'Opacity runs from the start to the end of the transition, independently of clipping. Keep both at 1 for a solid cut or reveal.' : 'Opacity values describe the displaced and settled poses. Finish-triggered profiles run these in reverse. Check the preview before assigning.'}</p>
      <Row label={config.transform_kind==='grow' && config.grow_mode ? 'Start opacity' : 'Displaced opacity'}>
        <input type="number" min={0} max={1} step={0.1} value={config.opacity_from} onChange={e => set('opacity_from', Number(e.target.value) || 0)} className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right" />
      </Row>
      <Row label={config.transform_kind==='grow' && config.grow_mode ? 'End opacity' : 'Settled opacity'}>
        <input type="number" min={0} max={1} step={0.1} value={config.opacity_to} onChange={e => set('opacity_to', Number(e.target.value) || 0)} className="w-16 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-right" />
      </Row>
      <Row label="Colour from">
        <ColorField value={config.color_from} onChange={v => set('color_from', v)} recentColors={recentColors} />
      </Row>
      <Row label="Colour to">
        <ColorField value={config.color_to} onChange={v => set('color_to', v)} recentColors={recentColors} />
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
      <h3 className="text-xs font-semibold pt-3">Transition length</h3>
      {config.trigger==='over_duration' ? <p className="text-[11px]">Uses the activity’s full duration. Custom transition length is only used for start/finish triggers.</p> : <>
      <Row label="Display units"><select aria-label="Transition duration units" value={durationUnit} onChange={e=>setDurationUnit(e.target.value)} className="text-xs border rounded dark:bg-prosota-panel2"><option value="days">Calendar days</option><option value="seconds">Playback seconds</option><option value="frames">Playback frames</option></select></Row>
      <Row label="Length"><input aria-label="Transition length" type="number" min="0.000001" step="any" value={config.duration_frames==null?'':Number(durationValue(config.duration_frames,durationUnit,speedDaysPerSecond,fps).toFixed(6))} placeholder="Auto" onChange={e=>{const v=Number(e.target.value);if(e.target.value==='')set('duration_frames',null);else if(Number.isFinite(v)&&v>0)set('duration_frames',durationDays(v,durationUnit,speedDaysPerSecond,fps))}} className="w-24 text-xs border rounded dark:bg-prosota-panel2 px-1 py-1"/></Row>
      <p className="text-[10px] text-gray-500 dark:text-prosota-muted">Auto = 1 calendar day. Seconds/frames use the timeline’s {speedDaysPerSecond} days/sec and {fps} fps. Changing playback speed changes the playback duration, not saved dates.</p>
      </>}
      <h3 className="text-xs font-semibold pt-3">Element order</h3>
      <p className="text-[10px] text-gray-500 dark:text-prosota-muted">0% animates all linked elements together. Higher values delay later elements within the same animation window.</p>

      {/* Domino / offset (2026-10-02, per Maro) — see
          AnimationProfileConfig.stagger for the exact timing. */}
      <Row label="Offset (domino)">
        <div className="flex items-center gap-1.5">
          <input
            type="range" min={0} max={95} step={5}
            value={Math.round((config.stagger ?? 0) * 100)}
            onChange={e => set('stagger', Number(e.target.value) / 100)}
            title="0% = all elements animate together. Higher = elements take turns across the activity, like dominoes."
            className="w-24"
          />
          <span className="text-xs text-gray-500 dark:text-prosota-muted w-8 text-right">{Math.round((config.stagger ?? 0) * 100)}%</span>
        </div>
      </Row>
      {(config.stagger ?? 0) > 0 && (
        <>
          <Row label="Order">
            <select value={config.stagger_order ?? 'along_x'} onChange={e => set('stagger_order', e.target.value as StaggerOrder)} className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5">
              <option value="along_x">Along X</option>
              <option value="along_y">Along Y</option>
              <option value="vertical">Bottom to top</option>
              <option value="random">Random</option>
            </select>
          </Row>
          <Row label="Reverse order">
            <input type="checkbox" checked={config.stagger_reverse ?? false} onChange={e => set('stagger_reverse', e.target.checked)} />
          </Row>
        </>
      )}

      <p className="text-[11px] pt-3">Saving updates the recipe only. Assign it using Activity links &amp; profiles; element overrides take precedence over activity defaults.</p>
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
