import { ToolVisualGuide } from './ToolVisualGuide'
import { TimelinePointInput, type TimelineFormat } from './TimelinePointInput'
import { useEffect, useState } from 'react'
import type { Camera, CameraPose } from './cameras'
import type { CameraView } from './cameraViews'
import { autoFrame, DEFAULT_MOTION, MOTION_LIBRARY, motionDuration, type CameraMotion, type MotionSettings, type MotionShot, type Vec3 } from './cameraMotion'
import type { CameraMotionController } from './useCameraMotion'

type Props = {
  format?: TimelineFormat | null
  embedded?: boolean
  savedCamera?: Camera | null; onOpenCamera?: (id: string) => void
  controller: CameraMotionController; shot: MotionShot | null; onChange: (shot: MotionShot) => void
  targets: { id: string; name: string }[]; resolveTarget: (id: string) => Promise<{ target: Vec3; radius: number; tracking?: MotionShot['tracking'] }>
  upAxis: 'y' | 'z'; aspect: number; date: Date; views: CameraView[]; cameras: Camera[]
  onSave?: (name: string, motion: CameraMotion) => Promise<void>; onPick: () => void; picking: boolean
  onClose: () => void; exporting: boolean
}
const button = 'rounded border border-gray-300 dark:border-prosota-line px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-prosota-panel2 disabled:opacity-40'
const input = 'w-full rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel px-2 py-1 text-sm'
const PRESETS_KEY = 'prosota-camera-motion-presets-v1'
function readPresets(): { name: string; settings: MotionSettings }[] { try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]') } catch { return [] } }
function AngleInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return <input className={input} aria-label="Camera angle (degrees)" type="number" min="-360" max="360" step="15" value={draft}
    onChange={e => { const raw = e.target.value; setDraft(raw); if (raw !== '' && Number.isFinite(Number(raw))) onChange(Math.max(-360, Math.min(360, Number(raw)))) }}
    onBlur={() => setDraft(String(value))} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
}
function Thumbnail({ kind }: { kind: string }) {
  const path = kind === 'orbit' ? 'M 12 22 A 28 12 0 1 1 68 22 A 28 12 0 1 1 12 22' : kind === 'crane' || kind === 'tilt' ? 'M 16 36 L 16 8' : kind === 'dolly' ? 'M 8 35 L 34 22' : kind === 'hold' ? 'M 15 25 L 15 25' : 'M 8 30 Q 40 4 72 30'
  return <svg viewBox="0 0 80 44" className="h-10 w-full" aria-hidden><rect x="33" y="17" width="14" height="19" rx="2" fill="#64748b"/><path d={path} fill="none" stroke="#38bdf8" strokeWidth="1"/><circle r="3" fill="#f59e0b"><animateMotion dur="3s" repeatCount="indefinite" path={path}/></circle></svg>
}
export function CameraPresetsPanel(p: Props) {
  const { controller: c, shot } = p
  const timeFactor = p.format?.timeDisplayMode === 'frames' ? p.format.fps : 1
  const durationUnit = p.format?.timeDisplayMode === 'frames' ? 'frames' : 'seconds'
  const displayDuration = (seconds: number) => durationUnit === 'frames' ? Math.round(seconds * timeFactor) : +seconds.toFixed(2)
  const [framing, setFraming] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(!p.savedCamera)
  const [search, setSearch] = useState(''), [targetId, setTargetId] = useState(p.shot?.tracking?.objectId || p.savedCamera?.motion?.shots[0]?.tracking?.objectId || 'all')
  const [sequence, setSequence] = useState<MotionShot[]>(() => structuredClone(p.savedCamera?.motion?.shots || [])), [name, setName] = useState(p.savedCamera?.name || 'Camera sequence')
  const [presets, setPresets] = useState(readPresets), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'shot' | 'sequence'>(p.savedCamera ? 'sequence' : 'shot')
  useEffect(() => { if (c.active && c.state.current.shots.length > 1 && !sequence.length) { setSequence(structuredClone(c.state.current.shots)); setMode('sequence'); setLibraryOpen(false) } }, [c.active])
  useEffect(() => { if (c.active && mode === 'sequence' && sequence.length) { const time = c.state.current.seconds; c.activate(sequence); c.seek(time) } }, [sequence])
  function change(next: MotionShot) {
    p.onChange(next)
    if (c.active && mode === 'shot') { const time = c.state.current.seconds; const playing = c.state.current.playing; c.activate([next]); c.seek(time); if (playing) c.play() }
  }
  async function create(settings: MotionSettings = DEFAULT_MOTION) {
    try {
      c.restore()
      const pose = c.readPose(); if (!pose) throw new Error('The camera is not ready.')
      const target = await p.resolveTarget(targetId)
      const date = p.date.toISOString()
      change({ id: crypto.randomUUID(), name: MOTION_LIBRARY.find(x => x.kind === settings.kind)?.name || 'Shot', settings: { ...settings }, ...target, upAxis: p.upAxis,
        start: settings.startView === 'auto' ? autoFrame(pose, target.target, target.radius, p.aspect, settings.shotSize) : pose,
        followMode: target.tracking ? shot?.followMode || 'fixed' : 'fixed', actorClock: shot?.actorClock || 'presentation', end: null, startOffset: [0, 0, 0], endOffset: [0, 0, 0], stage: 'fixed', dateStart: date, dateEnd: date, blend: 0 })
      setMode('shot'); setLibraryOpen(false); setError('')
    } catch (e) { setError(String(e instanceof Error ? e.message : e)) }
  }
  function settings(patch: Partial<MotionSettings>) {
    if (!shot) return
    const s = { ...shot.settings, ...patch }
    const start = (patch.shotSize || patch.startView === 'auto') && s.startView === 'auto' ? autoFrame(shot.start, shot.target, shot.radius, p.aspect, s.shotSize) : patch.startView === 'current' ? c.readPose() || shot.start : shot.start
    change({ ...shot, settings: s, start })
  }
  function preview(shots: MotionShot[], nextMode: 'shot' | 'sequence') { if (!shots.length) return; c.activate(shots); setMode(nextMode); c.play() }
  async function save(shots: MotionShot[], label: string) {
    if (!p.onSave || !shots.length) return
    setBusy(true); setError('')
    try { await p.onSave(label, { version: 1, shots }); setError('Saved in this project’s Cameras.') } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(false) }
  }
  function viewPose(id: string): CameraPose | null {
    const view = p.views.find(v => v.id === id); if (!view || !shot) return null
    return { ...shot.start, base_position_x: view.position_x, base_position_y: view.position_y, base_position_z: view.position_z, base_target_x: view.target_x, base_target_y: view.target_y, base_target_z: view.target_z }
  }
  return <section aria-label="Camera Presets" className={`${p.embedded ? 'w-full' : 'absolute right-2 top-20 z-30 w-80 max-h-[80%] overflow-y-auto rounded-lg border border-gray-300 dark:border-prosota-line shadow-xl'} bg-white dark:bg-prosota-panel p-3 text-gray-800 dark:text-prosota-paper`} onPointerDown={e => e.stopPropagation()}>
    <div className="flex justify-between"><strong>Camera Presets</strong><button className={button} onClick={p.onClose}>Close</button></div>
    <fieldset disabled={p.exporting} className="space-y-3 mt-3">
      {c.active && <div className="rounded border border-gray-300 dark:border-prosota-line p-2 space-y-2"><strong className="text-xs">{mode === 'shot' ? 'Shot' : 'Sequence'} preview / export · {c.state.current.shots.map(s => s.name).join(' → ')}</strong><div className="flex gap-1">{c.playing ? <button className={button} onClick={c.pause}>Pause</button> : <button className={button} onClick={() => c.play()}>Play</button>}<button className={button} onClick={() => c.play(true)}>Reverse</button><button className={button} onClick={() => { c.pause(); c.seek(0) }}>Reset</button><button className={button} onClick={c.restore}>Restore</button></div><input aria-label="Camera preview time" className="w-full" type="range" min="0" step={durationUnit === 'frames' ? 1 : 0.01} max={displayDuration(motionDuration(c.state.current.shots))} value={displayDuration(c.seconds)} onChange={e => { c.pause(); c.seek(+e.target.value / timeFactor) }}/><div className="text-xs">{displayDuration(c.seconds)} / {displayDuration(motionDuration(c.state.current.shots))} {durationUnit} · Export Video uses this preview.</div></div>}
      <label className="block text-xs">Target<select className={input} value={targetId} onChange={async e => { setTargetId(e.target.value); c.restore(); if (shot) { try { const t = await p.resolveTarget(e.target.value); change({ ...shot, ...t, start: shot.settings.startView === 'auto' ? autoFrame(shot.start, t.target, t.radius, p.aspect, shot.settings.shotSize) : shot.start }) } catch (e) { setError(String(e)) } } }}>
        {p.targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
      <button className={button} onClick={() => setLibraryOpen(v => !v)}>{libraryOpen ? 'Hide movement library' : 'Choose another movement'}</button>
      {libraryOpen && <><input className={input} placeholder="Search camera movements…" aria-label="Search camera movements" value={search} onChange={e => setSearch(e.target.value)}/>
      <div className="grid grid-cols-2 gap-1">{MOTION_LIBRARY.filter(x => `${x.name} ${x.group}`.toLowerCase().includes(search.toLowerCase())).map(x => <button key={x.kind} title={x.description} className={`${button} text-left ${shot?.settings.kind === x.kind ? 'bg-blue-100 dark:bg-blue-900 border-blue-500' : ''}`} onClick={() => create({ ...(shot?.settings || DEFAULT_MOTION), kind: x.kind })}><span className="text-[10px] opacity-60">{x.group}</span><Thumbnail kind={x.kind}/>{x.name}</button>)}</div></>}
      {shot && <>
        <div className="flex gap-1">
          {framing ? <><button className={button} onClick={() => { const pose = c.readPose(); if (pose) change({ ...shot, start: pose, startOffset: [0,0,0], endOffset: [0,0,0], settings: { ...shot.settings, startView: 'current', lookAt: false, alignment: 'center' } }); setFraming(false) }}>Use this framing</button><button className={button} onClick={() => { setFraming(false); c.activate([shot]) }}>Cancel framing</button></> : <button className={button} onClick={() => { c.beginFraming(shot); setFraming(true) }}>Adjust framing</button>}
        </div>
        {framing && <p className="text-xs">Zoom, pan or orbit in the viewport, then choose Use this framing.</p>}
        <label className="block text-xs">Camera follows<select className={input} value={shot.followMode || 'fixed'} onChange={e => change({ ...shot, followMode: e.target.value as MotionShot['followMode'] })}>
          <option value="fixed">Fixed framing</option>
          <option value="aim" disabled={!shot.tracking}>Look at moving target</option>
          <option value="translate" disabled={!shot.tracking}>Move with target</option>
          <option value="aligned" disabled={!shot.tracking}>Move with target and follow turns</option>
        </select></label>
        <ToolVisualGuide topic="camera" mode={shot.followMode || "fixed"}/>
        {!shot.tracking && <p className="text-xs">Choose a single object as the target to enable tracking.</p>}
        <label className="block text-xs">Actor animation<select className={input} value={shot.actorClock || 'presentation'} onChange={e => change({ ...shot, actorClock: e.target.value as MotionShot['actorClock'] })}>
          <option value="presentation">Play with preview time</option><option value="construction">Follow construction time</option>
        </select></label>
        <input className={input} aria-label="Shot name" value={shot.name} maxLength={100} onChange={e => change({ ...shot, name: e.target.value })}/>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">Starting view<select className={input} value={shot.settings.startView} onChange={e => settings({ startView: e.target.value as MotionSettings['startView'] })}><option value="auto">Auto frame</option><option value="current">Current view</option></select></label>
          <label className="text-xs">Shot size<select className={input} value={shot.settings.shotSize} onChange={e => settings({ shotSize: e.target.value as MotionSettings['shotSize'] })}>{['wide', 'medium', 'close'].map(x => <option key={x}>{x}</option>)}</select></label>
          <label className="text-xs">Duration ({p.format?.timeDisplayMode === 'frames' ? 'frames' : 'seconds'})<input className={input} type="number" min={p.format?.timeDisplayMode === 'frames' ? p.format.fps : 1} max={300 * (p.format?.timeDisplayMode === 'frames' ? p.format.fps : 1)} value={p.format?.timeDisplayMode === 'frames' ? Math.round(shot.settings.duration * p.format.fps) : shot.settings.duration} onChange={e => settings({ duration: Math.max(1, Math.min(300, +e.target.value / (p.format?.timeDisplayMode === 'frames' ? p.format.fps : 1))) })}/></label>
          <label className="text-xs">Motion style<select className={input} value={shot.settings.easing} onChange={e => settings({ easing: e.target.value as MotionSettings['easing'] })}><option value="smooth">Smooth</option><option value="linear">Constant speed</option></select></label>
          <label className="text-xs">Alignment<select className={input} value={shot.settings.alignment} onChange={e => settings({ alignment: e.target.value as MotionSettings['alignment'] })}>{['center', 'left', 'right'].map(x => <option key={x}>{x}</option>)}</select></label>
          {['orbit', 'pan', 'tilt'].includes(shot.settings.kind) && <label className="text-xs">Angle (degrees)<AngleInput value={shot.settings.angle} onChange={angle => settings({ angle })}/></label>}
          {['dolly', 'slide', 'crane', 'flyover'].includes(shot.settings.kind) && <label className="text-xs">Travel (metres)<input className={input} type="number" min="0" max={shot.radius * 100} step="0.5" value={+(shot.settings.amount * shot.radius).toFixed(2)} onChange={e => settings({ amount: Math.max(0, Math.min(100, +e.target.value / shot.radius)) })}/></label>}
        </div>
        {['crane','flyover'].includes(shot.settings.kind) && <label className="block text-xs">{shot.settings.kind === 'flyover' ? 'Height offset (metres)' : 'Forward offset (metres)'}<input className={input} type="number" value={shot.settings.offset || 0} onChange={e => settings({ offset: Math.max(-100000, Math.min(100000, +e.target.value)) })}/></label>}
        {shot.settings.kind === 'orbit' && <div className="flex gap-1">{[-90,90,180,360].map(a => <button key={a} className={button} onClick={() => settings({ angle: a })}>{a}°</button>)}</div>}
        <label className="block text-xs"><input type="checkbox" checked={shot.settings.reverse} onChange={e => settings({ reverse: e.target.checked })}/> Reverse playback direction</label>
        {!['pan', 'tilt', 'transition'].includes(shot.settings.kind) && <label className="block text-xs"><input type="checkbox" checked={shot.settings.lookAt} onChange={e => settings({ lookAt: e.target.checked })}/> Look at target</label>}
        {shot.settings.kind === 'transition' && <div className="grid gap-1">{(['start','end'] as const).map(key => <label key={key} className="text-xs">{key} viewpoint<select className={input} defaultValue="" onChange={e => { const pose = viewPose(e.target.value); if (pose) change({ ...shot, [key]: pose }) }}><option value="" disabled>Choose saved viewpoint</option>{p.views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>)}{!shot.end && <p className="text-xs">Choose an end viewpoint before previewing.</p>}</div>}
        <div className="flex gap-1"><button className={button} onClick={() => { c.restore(); p.onPick() }}>{p.picking ? 'Cancel point picking' : 'Pick target point'}</button><button className={button} onClick={() => c.restore()}>Edit path / original view</button></div>
        <p className="text-xs text-gray-500 dark:text-prosota-muted">Drag Start, End or Target in the scene. Fixed framing keeps the authored target point. Tracking follows the selected object.</p>
        <label className="block text-xs">Construction<select className={input} value={shot.stage} onChange={e => change({ ...shot, stage: e.target.value as MotionShot['stage'] })}><option value="fixed">Hold at date</option><option value="progress">Advance between dates</option></select></label>
        {(['dateStart', ...(shot.stage === 'progress' ? ['dateEnd'] : [])] as ('dateStart'|'dateEnd')[]).map(key => <label key={key} className="block text-xs">{key === 'dateStart' ? 'From / held time' : 'To time'}{p.format ? <TimelinePointInput format={p.format} value={new Date(shot[key])} placeholder={key === 'dateStart' ? 'From' : 'To'} dayEdge={key === 'dateStart' ? 'start' : 'end'} onChange={value => { if (value) change({ ...shot, [key]: value.toISOString() }) }}/> : <input className={input} type="date" value={shot[key].slice(0,10)} onChange={e => { if (e.target.value) change({ ...shot, [key]: new Date(e.target.value + 'T12:00:00').toISOString() }) }}/>}</label>)}
        <div className="flex gap-1 flex-wrap"><button className={button} disabled={shot.settings.kind === 'transition' && !shot.end} onClick={() => preview([shot], 'shot')}>Preview shot</button><button className={button} disabled={sequence.length >= 100 || !shot.name.trim() || (shot.settings.kind === 'transition' && !shot.end)} onClick={() => setSequence(prev => [...prev, structuredClone({ ...shot, id: crypto.randomUUID() })])}>Add to sequence</button><button className={button} disabled={busy || !shot.name.trim() || (shot.settings.kind === 'transition' && !shot.end)} onClick={() => void save([shot], shot.name)}>Save Shot</button><button className={button} onClick={() => { try { const next = [...presets.filter(x => x.name !== shot.name), { name: shot.name, settings: shot.settings }]; localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); setPresets(next); setError('Reusable preset saved on this device, across projects.') } catch { setError('Could not save preset on this device.') } }}>Save Preset</button></div>
      </>}

      <div className="border-t border-gray-300 dark:border-prosota-line pt-2 space-y-2"><strong className="text-sm">Sequence ({sequence.length})</strong><input className={input} aria-label="Sequence name" value={name} maxLength={100} onChange={e => setName(e.target.value)}/>{sequence.map((s, i) => <div key={s.id} className="border border-gray-300 dark:border-prosota-line rounded p-2 text-xs space-y-1"><div>{i+1}. {s.name}</div><div className="flex gap-1"><button className={button} onClick={() => { c.restore(); p.onChange(structuredClone(s)); setMode('shot') }}>Edit</button><button className={button} disabled={!shot} onClick={() => setSequence(sequence.map((x,j) => j === i && shot ? { ...structuredClone(shot), id: s.id } : x))}>Replace</button><button className={button} disabled={!i} onClick={() => { const next = [...sequence]; [next[i-1], next[i]] = [next[i], next[i-1]]; setSequence(next) }}>↑</button><button className={button} disabled={i === sequence.length-1} onClick={() => { const next = [...sequence]; [next[i+1], next[i]] = [next[i], next[i+1]]; setSequence(next) }}>↓</button><button className={button} onClick={() => setSequence(sequence.filter((_,j) => j!==i))}>×</button></div><label>Duration ({durationUnit}) <input className={input} type="number" min={timeFactor} max={300*timeFactor} value={displayDuration(s.settings.duration)} onChange={e => setSequence(sequence.map((x,j) => j===i ? { ...x, settings: { ...x.settings, duration: Math.max(1, Math.min(300, +e.target.value / timeFactor)) } } : x))}/></label>{i>0 && <label>Transition {durationUnit} (0 = cut)<input className={input} type="number" min="0" max={30*timeFactor} value={displayDuration(s.blend)} onChange={e => setSequence(sequence.map((x,j) => j===i ? { ...x, blend: Math.max(0, Math.min(30,+e.target.value / timeFactor)) } : x))}/></label>}</div>)}<div className="flex gap-1"><button className={button} disabled={!sequence.length || sequence.some(x => x.settings.kind === 'transition' && !x.end)} onClick={() => preview(sequence, 'sequence')}>Preview sequence</button><button className={button} disabled={busy || !sequence.length || !name.trim()} onClick={() => void save(sequence, name)}>Save sequence</button></div></div>
      <select className={input} value="" aria-label="Load saved camera motion" onChange={e => { const cam = p.cameras.find(x => x.id === e.target.value); if (cam?.motion) { if (p.onOpenCamera) { p.onOpenCamera(cam.id); return } c.restore(); c.activate(cam.motion.shots); setSequence(structuredClone(cam.motion.shots)); p.onChange(structuredClone(cam.motion.shots[0])); setName(cam.name); setMode('sequence'); setLibraryOpen(false) } }}><option value="">Load project shot / sequence…</option>{p.cameras.filter(x => x.motion).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select className={input} value="" aria-label="Load reusable camera preset" onChange={e => { const preset = presets[+e.target.value]; if (preset) create(preset.settings) }}><option value="">Reusable presets (this device)…</option>{presets.map((x,i) => <option key={i} value={i}>{x.name}</option>)}</select>
      {error && <p role="status" className="text-xs">{error}</p>}
    </fieldset>
  </section>
}
