import { SiteToolSection } from './SiteToolSection'
import { useEffect, useMemo, useRef, useState } from 'react'
import { gateTrack, keyGatePose, restPose } from './gatePose'
import { siteError, type FenceOpening, type SiteItem, type useSiteScene } from './siteScene'
import { TimelinePointInput, type TimelineFormat } from './TimelinePointInput'

const names = {vehicle:'Vehicle gate', pedestrian:'Pedestrian gate', turnstile:'Turnstile', gap:'Gap'}
const button = 'rounded border px-2 py-1 disabled:opacity-40 dark:border-prosota-line'

export function GatePosePanel({item, state, dateRef, format, onSeek}: {
  item: SiteItem; state: ReturnType<typeof useSiteScene>; dateRef?: React.RefObject<Date | null>
  format?: TimelineFormat; onSeek?: (date: Date) => void
}) {
  const gates = item.enclosure!.openings
  const [chosen,setIndex] = useState(0)
  const index = gates[chosen] && gates[chosen].kind !== 'gap' ? chosen : gates.findIndex(g => g.kind !== 'gap')
  const gate = gates[index]
  const [manual,setManual] = useState<number | null>(null)
  const [time,setTime] = useState<Date | null>(null)
  const [clock,setClock] = useState(dateRef?.current?.getTime() ?? null)
  const preview = useRef<SiteItem | null>(null)
  const {setDraft, save, setError} = state
  const sample = useMemo(() => gate && gateTrack(gate),[gate])
  useEffect(() => {
    if (!dateRef) return
    const timer = setInterval(() => setClock(dateRef.current?.getTime() ?? null), 150)
    return () => clearInterval(timer)
  }, [dateRef])
  useEffect(() => {
    setManual(null)
    return () => {
      const old = preview.current
      if (old) setDraft(current => current === old ? null : current)
      preview.current = null
    }
  }, [gate,setDraft])

  if (!gate || gate.kind === 'gap' || !sample) return null
  const keys = gate.pose_keys ?? []
  const value = manual ?? sample(time?.getTime() ?? clock)
  const disabled = state.busy || item.locked || !state.ready
  function replaced(current: SiteItem, nextGate: FenceOpening) {
    return {...current, enclosure:{...current.enclosure!, openings: current.enclosure!.openings.map((entry,i) => i === index ? nextGate : entry)}}
  }
  function pose(next: number) {
    setManual(next)
    const draft = replaced(item,{...gate,pose:next,pose_keys:[]})
    preview.current = draft
    setDraft(draft)
  }
  async function persist(nextGate: FenceOpening, label: string) {
    try {
      await save(items => items.map(current => {
        if (current.id !== item.id) return current
        if (current.locked || current.enclosure?.openings[index] !== gate) throw Error('The gate changed. Select it again before saving.')
        return replaced(current,nextGate)
      }),label + ' · ' + item.name)
    } catch (error) { setError(siteError(error)) }
  }
  function addKey() {
    const when = time ?? dateRef?.current
    if (!when) return
    void persist({...gate, pose_keys:keyGatePose(gate,when,manual ?? sample!(when.getTime()))}, 'Set gate keyframe')
  }
  function discard() { setManual(null); setDraft(null); preview.current=null }
  return <SiteToolSection title="Gate pose" disabled={disabled}>
    <label>Entrance<select className="w-full rounded border bg-white p-1 dark:bg-prosota-panel2" value={index} onChange={e=>{discard(); setIndex(Number(e.target.value))}}>
      {gates.map((entry,i) => entry.kind !== 'gap' && <option key={i} value={i}>{i+1} · {names[entry.kind]} · {entry.start} m</option>)}
    </select></label>
    <label className="block">{gate.kind === 'turnstile' ? 'Rotation' : 'Opening'} · {value.toFixed(2)}
      <input className="w-full" type="range" min="0" max="1" step="0.01" value={value} onChange={e=>pose(Number(e.target.value))}/>
    </label>
    <p>{gate.kind === 'turnstile' ? '0 to 1 rotates the arms by one 120° passage.' : `0 is closed. 1 opens to ${gate.angle || 90}°.`}</p>
    <div className="flex flex-wrap gap-1">
      <button className={button} disabled={manual === null || restPose(gate) === manual} onClick={()=>void persist({...gate,pose:value},'Set gate rest pose')}>Save rest pose</button>
      {manual !== null && <button className={button} onClick={discard}>Cancel pose</button>}
    </div>
    {format && <label className="block">Keyframe time <TimelinePointInput value={time} onChange={setTime} format={format} placeholder="Playhead"/></label>}
    <button className={button} disabled={!(time || clock !== null) || (keys.length >= 128 && !keys.some(k=>Date.parse(k.date)===(time?.getTime() ?? clock)))} onClick={addKey}>
      {time ? 'Key at selected time' : 'Key at playhead'}
    </button>
    {keys.length > 0 && <ul className="space-y-1">{keys.map(key => <li key={key.date} className="flex items-center justify-between gap-1">
      <button className="text-left underline" disabled={!onSeek} onClick={()=>{discard();setTime(null);onSeek?.(new Date(key.date))}}>
        {new Date(key.date).toLocaleString()} · {key.value.toFixed(2)}
      </button>
      <button className={button} onClick={()=>void persist({...gate,pose_keys:keys.filter(k=>k.date !== key.date)},'Remove gate keyframe')}>Remove key</button>
    </li>)}</ul>}
  </SiteToolSection>
}
