import { useState } from 'react'
import type { EquipmentRig } from './equipmentRig'

export function EquipmentTracks({ rigs, start, end, onSeek, onSave, disabled }: {
  rigs: EquipmentRig[]; start: Date | null; end: Date | null; onSeek: (d: Date) => void
  onSave: (r: EquipmentRig) => Promise<boolean>; disabled: boolean
}) {
  const [selected, setSelected] = useState<{ rig: string; control: string; date: string } | null>(null)
  const [drag, setDrag] = useState<{ rig: string; control: string; date: string; time: number } | null>(null)
  if (!start || !end || !rigs.length) return null
  const duration = Math.max(1, end.getTime() - start.getTime())
  return <div className="text-xs border-t border-gray-200 dark:border-prosota-line pt-2 space-y-1">
    <div className="flex items-center gap-2"><strong>Equipment control tracks</strong><span className="text-gray-500">Click to seek · drag keys to retime</span>
      <button disabled={disabled || !selected} onClick={() => {
        const rig = rigs.find(r => r.id === selected?.rig); if (!rig || !selected) return
        const next = structuredClone(rig); const control = next.definition.controls.find(c => c.id === selected.control)!
        control.keys = control.keys.filter(k => k.date !== selected.date)
        void onSave(next).then(ok => { if (ok) setSelected(null) })
      }}>Delete selected key</button>
    </div>
    {disabled && <p>Save or discard equipment setup edits before editing timeline tracks.</p>}
    {rigs.map(rig => <div key={rig.id || rig.model_ref}><strong>{rig.name}</strong>{rig.definition.controls.map(c => <div key={c.id} className="flex items-center min-h-7 border-b border-gray-100 dark:border-prosota-line">
      <span className="w-36 shrink-0 truncate" title={c.name}>{c.name}</span>
      <div className="relative flex-1 h-7 mx-2 bg-gray-100 dark:bg-prosota-panel2">
        {c.keys.map(k => <button key={k.date} disabled={disabled} aria-label={`${c.name}: ${k.value} at ${k.date}`} title={`${k.date} · ${k.value} · ${k.interpolation}`} className={`absolute top-1 -translate-x-1/2 touch-none select-none ${selected?.rig === rig.id && selected.control === c.id && selected.date === k.date ? 'text-amber-500' : 'text-blue-500'}`} style={{ left: `${Math.max(0, Math.min(100, ((drag?.rig === rig.id && drag.control === c.id && drag.date === k.date ? drag.time : Date.parse(k.date)) - start.getTime()) / duration * 100))}%` }}
          onClick={e => { if (e.detail === 0) { setSelected({ rig: rig.id, control: c.id, date: k.date }); onSeek(new Date(k.date)) } }}
          draggable={false} onDragStart={e => e.preventDefault()}
          onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.dragStart = String(e.clientX); setSelected({ rig: rig.id, control: c.id, date: k.date }); onSeek(new Date(k.date)) }}
          onPointerMove={e => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
            const rect = e.currentTarget.parentElement!.getBoundingClientRect()
            const time = start.getTime() + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration
            setDrag({ rig: rig.id, control: c.id, date: k.date, time }); onSeek(new Date(time))
          }}
          onPointerCancel={() => setDrag(null)}
          onPointerUp={e => {
            setDrag(null)
            const moved = e.clientX - Number(e.currentTarget.dataset.dragStart ?? e.clientX)
            if (Math.abs(moved) < 4) return
            const rect = e.currentTarget.parentElement!.getBoundingClientRect()
            const date = new Date(start.getTime() + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration).toISOString()
            const next = structuredClone(rig); const control = next.definition.controls.find(x => x.id === c.id)!
            // Moving onto an existing exact instant replaces that key deliberately.
            control.keys = [...control.keys.filter(x => x.date !== k.date && x.date !== date), { ...k, date }]
            void onSave(next).then(ok => { if (ok) { setSelected({ rig: rig.id, control: c.id, date }); onSeek(new Date(date)) } })
          }}>◆</button>)}
      </div>
    </div>)}</div>)}
  </div>
}
