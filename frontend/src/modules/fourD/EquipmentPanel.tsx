import { undoHistory } from '@/lib/undoHistory'
import { EquipmentSetup } from './EquipmentSetup'
import type { EquipmentVisualState } from './EquipmentVisualEditor'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { controlValue, emptyEquipment, equipmentNodes, validateEquipment, type EquipmentDefinition, type EquipmentRig, type Vec3 } from './equipmentRig'

const input = 'w-full min-w-0 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel2 px-1 py-1'
const button = 'rounded border border-gray-300 dark:border-prosota-line px-2 py-1 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-prosota-panel2'
const uid = () => crypto.randomUUID()
const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23)
function VectorInput({ label, value, change }: { label: string; value: Vec3; change: (v: Vec3) => void }) {
  return <label className="block">{label}<div className="flex gap-1">{value.map((v, i) => <input aria-label={`${label} ${'XYZ'[i]}`} key={i} className={input} type="number" step="any" value={v} onChange={e => { const next = [...value] as Vec3; next[i] = Number(e.target.value); change(next) }} />)}</div></label>
}

export function EquipmentPanel({ projectId, objects, rigs, busy, error, runtimeError, dateRef, onSave, onRemove, onDraft, onPreview, onEditing, onSeek, onAssemble, onVisual }: {
  onVisual?: (state: EquipmentVisualState | null) => void
  onAssemble?: (names: string[], name: string) => Promise<string>
  projectId: string; objects: { name: string; kind: string; object: THREE.Object3D }[]; rigs: EquipmentRig[]
  busy: boolean; error: string | null; runtimeError: string | null; dateRef: React.MutableRefObject<Date | null>
  onSave: (r: EquipmentRig) => Promise<boolean>; onRemove: (r: EquipmentRig) => Promise<void>
  onEditing: (editing: boolean) => void
  onDraft: (r: EquipmentRig | null) => void
  onPreview: (p: { model: string; values: Record<string, number>; time: number | null } | null) => void
  onSeek: (d: Date) => void
}) {
  const owner = useRef({})
  const gesture = useRef<object | undefined>()
  const fieldGesture = useRef<object | undefined>()
  const [restoreRevision, setRestoreRevision] = useState(0)
  const [tab, setTab] = useState<'setup' | 'animate'>('setup')
  const [assemblyParts, setAssemblyParts] = useState<string[]>([])
  const [assemblyName, setAssemblyName] = useState('Equipment')
  const [assembling, setAssembling] = useState(false)
  const [model, setModel] = useState('')
  const [draft, setDraft] = useState<EquipmentRig | null>(null)
  const draftRef = useRef(draft); draftRef.current = draft
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [time, setTime] = useState(dateRef.current?.getTime() ?? Date.now())
  const [preview, setPreview] = useState<Record<string, number>>({})
  const [jointIndex, setJointIndex] = useState(0)
  const [followerIndex, setFollowerIndex] = useState(0)
  useEffect(() => () => onVisual?.(null), [onVisual])
  const object = objects.find(o => o.name === model && o.kind === 'mesh')
  const nodes = useMemo(() => object ? equipmentNodes(object.object) : new Map<string, THREE.Object3D>(), [object?.object])
  const saved = rigs.find(r => r.model_ref === model)
  useEffect(() => {
    if (!dirty) setDraft(saved ? structuredClone(saved) : null)
  }, [saved, model, dirty])
  useEffect(() => {
    const timer = window.setInterval(() => setTime(dateRef.current?.getTime() ?? Date.now()), 100)
    return () => clearInterval(timer)
  }, [dateRef])
  useEffect(() => { setPreview({}); onPreview(null) }, [time, onPreview])
  useEffect(() => { onEditing(dirty) }, [dirty, onEditing])
  useEffect(() => () => { onDraft(null); onPreview(null); onEditing(false) }, [onDraft, onPreview, onEditing])
  const restoreRef = useRef<(value: EquipmentRig | null) => void>(() => {})
  restoreRef.current = next => {
    setDraft(next); draftRef.current = next; setDirty(JSON.stringify(next) !== JSON.stringify(saved ?? null)); setPreview({}); onPreview(null)
    setRestoreRevision(n => n + 1)
    try { if (next) validateEquipment(next.definition, nodes); onDraft(next); setNotice(null) }
    catch (e) { onDraft(null); setNotice(`Finish setup: ${(e as Error).message}`) }
  }
  useEffect(() => {
    const start = () => { gesture.current = {} }
    const end = () => { gesture.current = undefined }
    const focus = () => { fieldGesture.current = {} }
    window.addEventListener('pointerdown', start, true)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('focusin', focus)
    return () => {
      window.removeEventListener('pointerdown', start, true); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('focusin', focus)
      undoHistory.remove(owner.current)
    }
  }, [])
  useEffect(() => { undoHistory.remove(owner.current) }, [model])
  const change = (next: EquipmentRig) => {
    const before = structuredClone(draftRef.current), after = structuredClone(next)
    const field = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
    if (JSON.stringify(before) !== JSON.stringify(after)) undoHistory.record({
      label: 'equipment rig edit', owner: owner.current, group: gesture.current ?? (field ? fieldGesture.current : undefined),
      undo: () => restoreRef.current(before), redo: () => restoreRef.current(after),
    })
    draftRef.current = next
    setDraft(next); setDirty(true); setNotice(null)
    try { validateEquipment(next.definition, nodes); onDraft(next) }
    catch (e) { setNotice(`Finish setup: ${(e as Error).message}`) }
  }
  const edit = (fn: (d: EquipmentDefinition) => void) => {
    if (!draft) return
    const next = structuredClone(draft); fn(next.definition); change(next)
  }
  const validate = () => {
    if (!draft || !object) throw new Error('Load and select the equipment model first')
    if (objects.filter(o => o.kind === 'mesh' && o.name === model).length !== 1) throw new Error('Model filenames must be unique')
    if (object.object.animations.length) throw new Error('Use a rigid model without embedded animation for equipment controls')
    validateEquipment(draft.definition, nodes)
  }
  const save = async () => {
    try {
      validate()
      if (await onSave(draft!)) { undoHistory.remove(owner.current); setDirty(false); onDraft(null); setNotice('Equipment saved'); onPreview(null) }
    } catch (e) { setNotice((e as Error).message) }
  }
  const nodePicker = (value: string, changeNode: (v: string) => void, allowRoot = false) => <select aria-label="Model part" className={input} value={value} onChange={e => changeNode(e.target.value)}>
    <option value="">{allowRoot ? 'Equipment root' : 'Choose part…'}</option>
    {Array.from(nodes).filter(([key]) => key).map(([key, node]) => <option key={key} value={key}>{`${'· '.repeat(key.split('/').length - 2)}${node.name || node.type} (${key.split('/').slice(-1)[0]?.split(':')[0]})`}</option>)}
    {value && !nodes.has(value) && <option value={value}>Missing: {value}</option>}
  </select>
  const joint = draft?.definition.joints[jointIndex]
  const follower = draft?.definition.followers[followerIndex]
  return <fieldset disabled={busy || assembling} className="p-3 space-y-3 text-xs text-gray-700 dark:text-prosota-paper border-b border-gray-200 dark:border-prosota-line">
    <strong>Equipment Controls</strong>
    <p className="text-gray-500 dark:text-prosota-muted">Animate rigid parts inside an imported model. Use its root transform or path to move the whole machine.</p>
    <select aria-label="Equipment model" className={input} disabled={dirty || busy} value={model} onChange={e => { setModel(e.target.value); onDraft(null); onPreview(null); setNotice(null) }}>
      <option value="">Select equipment model…</option>
      {objects.filter(o => o.kind === 'mesh').map((o, i) => <option key={i} value={o.name}>{o.name}</option>)}
    </select>
    {onAssemble && <details><summary>Assemble separate imports</summary>
      <p>Select the parts of one machine. Saves an assembled copy at the current pose; originals remain as hidden backups. Existing links and animations stay with the originals.</p>
      <input aria-label="Assembly name" className={input} value={assemblyName} onChange={e => setAssemblyName(e.target.value)} />
      <button className={button} disabled={dirty} onClick={() => setAssemblyParts(objects.filter(o => o.kind === 'mesh').map(o => o.name))}>Select all imports</button>
      <button className={button} onClick={() => setAssemblyParts([])}>Clear</button>
      <div className="max-h-48 overflow-y-auto">{objects.filter(o => o.kind === 'mesh').map((o, i) => <label key={i} className="flex gap-2"><input type="checkbox" checked={assemblyParts.includes(o.name)} onChange={e => setAssemblyParts(p => e.target.checked ? [...p, o.name] : p.filter(n => n !== o.name))} />{o.name}</label>)}</div>
      <button className={button} disabled={dirty || assemblyParts.length < 2 || !assemblyName.trim()} onClick={async () => {
        setAssembling(true); setNotice('Saving assembled equipment…')
        try { const name = await onAssemble(assemblyParts, assemblyName); setModel(name); onDraft(null); onPreview(null); setNotice('Assembly saved. Click Create equipment rig to configure its controls.'); setAssemblyParts([]) }
        catch (e) { setNotice((e as Error).message) }
        finally { setAssembling(false) }
      }}>{assembling ? 'Assembling…' : `Assemble ${assemblyParts.length} imports`}</button>
    </details>}
    {(error || runtimeError || notice) && <p role="status" className="text-amber-700 dark:text-amber-300 break-words">{error || runtimeError || notice}</p>}
    {model && !draft && <button className={button} onClick={() => change({ id: '', project_id: projectId, model_ref: model, name: model, version: 1, definition: emptyEquipment() })}>Create equipment rig</button>}
    {draft && <>
      <label className="block">Equipment name<input className={input} value={draft.name} onChange={e => change({ ...draft, name: e.target.value })} /></label>
      <div className="flex flex-wrap gap-1">
        <button className={button} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save rig & keys'}</button>
        <button className={button} disabled={busy || !dirty} onClick={() => { undoHistory.remove(owner.current); setDirty(false); setDraft(saved ? structuredClone(saved) : null); onDraft(null); onPreview(null) }}>Discard edits</button>
        {saved && <button className={button} disabled={busy || dirty} onClick={() => { if (window.confirm('Remove this equipment rig and its control keyframes? Imported geometry will remain.')) void onRemove(saved) }}>Remove rig</button>}
      </div>
      {dirty && <p>Unsaved changes — save before closing this panel.</p>}
      <div className="flex gap-2"><button className={button} aria-pressed={tab==='setup'} onClick={()=>setTab('setup')}>Setup</button><button className={button} aria-pressed={tab==='animate'} onClick={()=>setTab('animate')}>Animate</button></div>
      {tab==='setup' && onVisual && <EquipmentSetup disabled={busy || assembling} key={`${model}:${restoreRevision}`} rig={draft} object={object?.object} onChange={change} onState={onVisual} />}
      {tab==='animate' && <>
      <label className="block">Playhead (local time)<input aria-label="Equipment playhead" className={input} type="datetime-local" step="0.001" value={localTime(new Date(time))} onInput={e => { const d = new Date(e.currentTarget.value); if (Number.isFinite(d.getTime())) { dateRef.current = d; setTime(d.getTime()); onSeek(d) } }} /></label>
      {draft.definition.controls.map(c => {
        const value = preview[c.id] ?? controlValue(c, time)
        return <div key={c.id} className="border rounded border-gray-200 dark:border-prosota-line p-2 space-y-1">
          {!draft.definition.joints.some(j=>j.control===c.id) && <p className="text-amber-700 dark:text-amber-300">Unconfigured — assign a group in Setup.</p>}
          <input aria-label="Control name" className={input} value={c.name} onChange={e => edit(d => { d.controls.find(x => x.id === c.id)!.name = e.target.value })} />
          <div className="flex items-center gap-1"><input aria-label={c.name} className="min-w-0 flex-1" type="range" min="0" max="1" step="0.001" value={value} onChange={e => { const v = Number(e.target.value); const values = { ...preview, [c.id]: v }; setPreview(values); onPreview({ model, values, time }); edit(d => { d.controls.find(x => x.id === c.id)!.value = values[c.id] }) }} />
            <input aria-label={`${c.name} value`} className={`${input} !w-16`} type="number" min="0" max="1" step="0.001" value={Number(value.toFixed(3))} onChange={e => { const v = Math.max(0, Math.min(1, Number(e.target.value))); const values = { ...preview, [c.id]: v }; setPreview(values); onPreview({ model, values, time }); edit(d => { d.controls.find(x => x.id === c.id)!.value = values[c.id] }) }} />
          </div>
          <div className="flex flex-wrap gap-1">
            <button className={button} onClick={() => edit(d => { const control = d.controls.find(x => x.id === c.id)!; const keyTime = dateRef.current?.getTime() ?? time; control.keys = [...control.keys.filter(k => Date.parse(k.date) !== keyTime), { date: new Date(keyTime).toISOString(), value, interpolation: 'linear' }] })}>◆ Key</button>
            <button className={button} onClick={() => edit(d => { d.controls.find(x => x.id === c.id)!.value = value })}>Set unkeyed value</button>
            <button className={button} onClick={() => { const values = { ...preview, [c.id]: c.rest }; setPreview(values); onPreview({ model, values, time }); edit(d => { d.controls.find(x => x.id === c.id)!.value = values[c.id] }) }}>Rest pose</button>
          </div>
          <details><summary>Control setup & keyframes ({c.keys.length})</summary>
            <label>Model's rest value<input className={input} type="number" min="0" max="1" step="0.01" value={c.rest} onChange={e => edit(d => { d.controls.find(x => x.id === c.id)!.rest = Number(e.target.value) })} /></label>
            <p>0–1 input corresponding to the imported pose. Changing this recalibrates the rig.</p>
            {[...c.keys].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).map(k => <div key={k.date} className="space-y-1 border-t py-1">
              <input aria-label="Keyframe time" className={input} type="datetime-local" step="0.001" value={localTime(new Date(k.date))} onChange={e => { const date = new Date(e.target.value); if (Number.isFinite(date.getTime())) edit(d => { d.controls.find(x => x.id === c.id)!.keys.find(x => x.date === k.date)!.date = date.toISOString() }) }} />
              <div className="flex gap-1"><input aria-label="Keyframe value" className={input} type="number" min="0" max="1" step="0.001" value={k.value} onChange={e => edit(d => { d.controls.find(x => x.id === c.id)!.keys.find(x => x.date === k.date)!.value = Number(e.target.value) })} />
                <select aria-label="Keyframe interpolation" className={input} value={k.interpolation} onChange={e => edit(d => { d.controls.find(x => x.id === c.id)!.keys.find(x => x.date === k.date)!.interpolation = e.target.value as typeof k.interpolation })}><option value="linear">Linear</option><option value="smooth">Smooth</option><option value="hold">Hold</option></select>
                <button className={button} onClick={() => onSeek(new Date(k.date))}>Go</button><button aria-label="Delete keyframe" className={button} onClick={() => edit(d => { const x = d.controls.find(x => x.id === c.id)!; x.keys = x.keys.filter(x => x.date !== k.date) })}>×</button>
              </div>
            </div>)}
            <button className={button} disabled={draft.definition.joints.some(j => j.control === c.id)} onClick={() => edit(d => { d.controls = d.controls.filter(x => x.id !== c.id) })}>Remove unused control</button>
          </details>
        </div>
      })}
      </>}
      {tab==='setup' && <details><summary className="font-semibold">Advanced joints, controls & cylinders</summary>
      <div className="flex flex-wrap gap-1"><button className={button} onClick={() => edit(d => { d.controls.push({ id: uid(), name: 'New control', value: 0, rest: 0, keys: [] }) })}>+ Control</button>
        <button className={button} onClick={() => edit(d => { for (const name of ['Left stabiliser', 'Right stabiliser', 'Boom lift', 'Dipper extension', 'Bucket curl', 'Rear swing', 'Loader lift', 'Front bucket tilt']) if (!d.controls.some(c => c.name === name)) d.controls.push({ id: uid(), name, value: name === 'Rear swing' ? .5 : 0, rest: name === 'Rear swing' ? .5 : 0, keys: [] }) })}>Backhoe control names</button></div>
      <details className="space-y-2"><summary className="font-semibold">Joint setup ({draft.definition.joints.length})</summary>
        <p>Pivots and axes use the imported model's root coordinates. Slide distances use model units; hinge limits use degrees. Parts retain their imported pose at the control's rest value.</p>
        <select aria-label="Joint" className={input} value={jointIndex} onChange={e => setJointIndex(Number(e.target.value))}>{draft.definition.joints.map((j, i) => <option key={j.id} value={i}>{j.name}</option>)}</select>
        {joint && <div className="space-y-2">
          <label>Name<input className={input} value={joint.name} onChange={e => edit(d => { d.joints[jointIndex].name = e.target.value })} /></label>
          <label>Part{nodePicker(joint.node, v => edit(d => { d.joints[jointIndex].node = v }))}</label>
          <label>Parent joint<select className={input} value={joint.parent ?? ''} onChange={e => edit(d => { d.joints[jointIndex].parent = e.target.value || null })}><option value="">Equipment root</option>{draft.definition.joints.filter(j => j.id !== joint.id).map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
          <label>Control (shared controls link joints)<select className={input} value={joint.control} onChange={e => edit(d => { d.joints[jointIndex].control = e.target.value })}><option value="">Choose control…</option>{draft.definition.controls.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Motion<select className={input} value={joint.kind} onChange={e => edit(d => { d.joints[jointIndex].kind = e.target.value as 'hinge' | 'slide' })}><option value="hinge">Hinge rotation</option><option value="slide">Linear slide</option></select></label>
          <VectorInput label="Pivot X / Y / Z" value={joint.pivot} change={v => edit(d => { d.joints[jointIndex].pivot = v })} />
          <VectorInput label="Axis X / Y / Z" value={joint.axis} change={v => edit(d => { d.joints[jointIndex].axis = v; d.joints[jointIndex].pivot_rotation = undefined })} />
          <div className="flex gap-1"><label>At 0<input className={input} type="number" value={joint.minimum} onChange={e => edit(d => { d.joints[jointIndex].minimum = Number(e.target.value) })} /></label><label>At 1<input className={input} type="number" value={joint.maximum} onChange={e => edit(d => { d.joints[jointIndex].maximum = Number(e.target.value) })} /></label></div>
          <label>Response curve (input:output pairs)<input className={input} defaultValue={joint.response.map(p => p.join(':')).join(', ')} key={joint.id} onBlur={e => { const points = e.target.value.split(',').map(s => s.trim().split(':').map(Number) as [number, number]); edit(d => { d.joints[jointIndex].response = points }) }} /></label>
          <button className={button} disabled={draft.definition.joints.some(j => j.parent === joint.id)} onClick={() => { edit(d => { d.joints.splice(jointIndex, 1) }); setJointIndex(0) }}>Remove joint</button>
        </div>}
        <button className={button} disabled={!draft.definition.controls.length} onClick={() => { setJointIndex(draft.definition.joints.length); edit(d => { d.joints.push({ id: uid(), name: 'New joint', node: '', parent: null, control: d.controls[0].id, kind: 'hinge', pivot: [0, 0, 0], axis: [0, 0, 1], minimum: 0, maximum: 90, response: [[0, 0], [1, 1]] }) }) }}>+ Joint</button>
      </details>
      <details className="space-y-2"><summary className="font-semibold">Hydraulic cylinders ({draft.definition.followers.length})</summary>
        <p>Choose barrel and piston parts. Attachment coordinates are local to the selected attachment parts. Cylinders aim and slide automatically; no scaling or additional keys.</p>
        <select aria-label="Cylinder" className={input} value={followerIndex} onChange={e => setFollowerIndex(Number(e.target.value))}>{draft.definition.followers.map((f, i) => <option key={f.id} value={i}>{f.name}</option>)}</select>
        {follower && <div className="space-y-2">
          <input aria-label="Cylinder name" className={input} value={follower.name} onChange={e => edit(d => { d.followers[followerIndex].name = e.target.value })} />
          <label>Barrel{nodePicker(follower.barrel, v => edit(d => { d.followers[followerIndex].barrel = v }))}</label>
          <label>Piston{nodePicker(follower.piston, v => edit(d => { d.followers[followerIndex].piston = v }))}</label>
          <label>Base attachment part{nodePicker(follower.base_node, v => edit(d => { d.followers[followerIndex].base_node = v }), true)}</label>
          <VectorInput label="Base attachment" value={follower.base_point} change={v => edit(d => { d.followers[followerIndex].base_point = v })} />
          <label>Tip attachment part{nodePicker(follower.tip_node, v => edit(d => { d.followers[followerIndex].tip_node = v }), true)}</label>
          <VectorInput label="Tip attachment" value={follower.tip_point} change={v => edit(d => { d.followers[followerIndex].tip_point = v })} />
          <button className={button} onClick={() => { edit(d => { d.followers.splice(followerIndex, 1) }); setFollowerIndex(0) }}>Remove cylinder</button>
        </div>}
        <button className={button} onClick={() => { setFollowerIndex(draft.definition.followers.length); edit(d => { d.followers.push({ id: uid(), name: 'Cylinder', barrel: '', piston: '', base_node: '', tip_node: '', base_point: [0, 0, 0], tip_point: [0, 0, 1] }) }) }}>+ Cylinder</button>
      </details>
      </details>}
      <div className="space-y-1"><button className={button} onClick={() => {
        try {
          validate(); const def = structuredClone(draft.definition); def.controls.forEach(c => { c.keys = []; c.value = c.rest })
          const url = URL.createObjectURL(new Blob([JSON.stringify({ name: draft.name, definition: def }, null, 2)], { type: 'application/json' }))
          const a = document.createElement('a'); a.href = url; a.download = `${draft.name.replace(/[^\w-]/g, '_')}-equipment.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch (e) { setNotice((e as Error).message) }
      }}>Export reusable preset</button>
        <label className="block">Import preset onto this model<input type="file" accept=".json" className="w-full" onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return
          try {
            if (file.size > 2000000) throw new Error('Preset exceeds 2 MB')
            const data = JSON.parse(await file.text()); validateEquipment(data.definition)
            data.definition.controls.forEach((c: EquipmentDefinition['controls'][number]) => { c.keys = []; c.value = c.rest })
            change({ ...draft, name: typeof data.name === 'string' ? data.name : draft.name, definition: data.definition }); setNotice('Preset imported. Match any missing parts in joint/cylinder setup, then save.')
          } catch (err) { setNotice((err as Error).message) }
          e.target.value = ''
        }} /></label>
      </div>
    </>}
  </fieldset>
}
