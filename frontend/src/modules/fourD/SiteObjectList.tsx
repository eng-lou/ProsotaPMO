import { useMemo, useRef, useState } from 'react'
import type { SiteItem } from './siteScene'
import type { SiteSelectionMode } from './siteObjectSelection'
import type { Path } from './paths'
import type { Zone } from './zones'
import type { Activity } from '@/modules/scheduling/types'

type Props = {
  items: SiteItem[]
  selected: ReadonlySet<string>
  active: string | null
  paths: Path[]
  zones: Zone[]
  activities: Activity[]
  ready: boolean
  busy: boolean
  editing: boolean
  reload(): void
  select(ids: string[], mode: SiteSelectionMode): void
  remove(ids: string[]): void
}
const button = 'rounded border px-2 py-1 disabled:opacity-40 dark:border-prosota-line'
const normalise = (value: string) => value.toLowerCase().replace(/[_./-]+/g, ' ')

export function SiteObjectList({items, selected, active, paths, zones, activities, ready, busy, editing, reload, select, remove}: Props) {
  const [query,setQuery] = useState('')
  const anchor = useRef<string | null>(null)
  const rows = useMemo(() => {
    const byPath = new Map(paths.map(p => [p.id,p]))
    const zoneIds = new Set(zones.map(z => z.id))
    const datedActivities = new Set(activities.filter(a => a.start && a.finish).map(a => a.id))
    const nameCounts = new Map<string,number>()
    for (const item of items) nameCounts.set(item.name,(nameCounts.get(item.name) ?? 0)+1)
    return items.map(item => {
      const path = item.path_id ? byPath.get(item.path_id) : undefined
      const changed = ['fence','shape','array','scatter'].includes(item.kind) && (item.zone_id ? !zoneIds.has(item.zone_id)
        : !path || JSON.stringify(path.points) !== JSON.stringify(item.points) || path.closed !== item.closed || (path.curve_mode || 'straight') !== (item.curve_mode || 'straight'))
      const description = [item.assembly_name, item.tag, item.locked ? 'Locked' : ''].filter(Boolean).join(' · ')
      const searchable = normalise([item.name,item.kind,description,item.id].join(' '))
      return {item,description,searchable,changed,duplicate:nameCounts.get(item.name)! > 1, missingActivity:item.activity_id && !datedActivities.has(item.activity_id)}
    })
  },[items,paths,zones,activities])
  const terms = normalise(query).trim().split(/\s+/).filter(Boolean)
  const shown = rows.filter(row => terms.every(term => row.searchable.includes(term)))
  const picked = items.filter(item => selected.has('site:'+item.id))
  const removable = picked.filter(item => !item.locked)
  const locked = picked.length-removable.length
  const outside = picked.length-shown.filter(({item})=>selected.has('site:'+item.id)).length

  function pick(id: string, additive: boolean, range: boolean) {
    if (range) {
      const from = shown.findIndex(row => row.item.id === (anchor.current ?? active?.split(':panel:')[0]))
      const to = shown.findIndex(row => row.item.id === id)
      if (from >= 0 && to >= 0) {
        select(shown.slice(Math.min(from,to),Math.max(from,to)+1).map(row => row.item.id),additive ? 'add' : 'replace')
        return
      }
    }
    anchor.current = id
    select([id],additive ? 'toggle' : 'replace')
  }
  function selectShown() {
    if (!shown.length) return
    anchor.current = shown[0].item.id
    select(shown.map(row => row.item.id),'replace')
  }
  return <section aria-label="Site objects" className="min-w-0 space-y-2">
    <div className="flex items-center justify-between gap-2"><strong>Site objects ({items.length})</strong><button className={button} disabled={busy} onClick={reload}>Reload</button></div>
    <input type="search" aria-label="Search site objects" placeholder="Search name, type, tag or assembly" value={query}
      className="w-full min-w-0 rounded border p-1.5 dark:border-prosota-line dark:bg-prosota-panel2" onChange={e=>setQuery(e.target.value)}/>
    <div className="flex items-center gap-2">
      <button className={button} disabled={!shown.length} onClick={selectShown}>{terms.length ? `Select matches (${shown.length})` : 'Select all listed'}</button>
      <button className={button} disabled={!picked.length} onClick={()=>{anchor.current=null;select(picked.map(item=>item.id),'subtract')}}>Clear selection</button>
    </div>
    <p className="text-gray-600 dark:text-prosota-muted">Ctrl/Cmd-click to toggle. Shift-click to select a range.</p>
    <div className="max-h-64 space-y-1 overflow-y-auto" onKeyDown={e=>{
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='a') {e.preventDefault();e.stopPropagation();selectShown()}
    }}>
      {shown.map(({item,description,duplicate,changed,missingActivity}) => {
        const isSelected = selected.has('site:'+item.id)
        return <div key={item.id} className={`flex min-w-0 items-start gap-2 rounded border px-2 py-1.5 ${isSelected?'border-blue-500 bg-blue-50 dark:bg-slate-800':'dark:border-prosota-line'}`}>
          <input className="mt-1 shrink-0" type="checkbox" aria-label={`Select ${item.name}`} checked={isSelected} readOnly onClick={e=>pick(item.id,true,e.shiftKey)}/>
          <button className="min-w-0 flex-1 break-words text-left [overflow-wrap:anywhere]" aria-pressed={isSelected}
            onClick={e=>pick(item.id,e.ctrlKey||e.metaKey,e.shiftKey)}>{item.name}
            {description && <span className="block text-gray-600 dark:text-prosota-muted">{description}</span>}
            {duplicate && <span className="block text-gray-600 dark:text-prosota-muted">X {item.position.x.toFixed(2)} · Y {item.position.y.toFixed(2)} · Z {item.position.z.toFixed(2)} m</span>}
            {changed && <span className="block text-amber-600">Source changed/missing · saved geometry retained</span>}
            {missingActivity && <span className="block text-amber-600">Activity not in the loaded schedule · hidden in playback</span>}
          </button>
        </div>
      })}
      {!shown.length && <p>{items.length ? 'No matching site objects.' : 'No site objects.'}</p>}
    </div>
    <p className="text-gray-600 dark:text-prosota-muted" aria-live="polite">{picked.length} site {picked.length===1?'object':'objects'} selected{outside>0 && ` · ${outside} outside search`}{locked>0 && ` · ${locked} locked`}</p>
    {picked.length>0 && !editing && <button className={button} disabled={!ready || busy || !removable.length}
      onClick={()=>remove(removable.map(item=>item.id))}>{picked.length===1 ? `Remove ${picked[0].name}` : `Remove ${removable.length} ${locked ? 'unlocked ' : ''}site ${removable.length===1?'object':'objects'}`}</button>}
  </section>
}
