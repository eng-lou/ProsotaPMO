import {useState} from 'react'
import type {ScaffoldRun} from './enclosureOptions'
import {captureSlabReferences,type ReferenceBay} from './slabReferences'
import type {HostSource} from './constructionLayout'

const button='rounded border px-2 py-1 disabled:opacity-40'
const field='w-full rounded border p-1 dark:bg-prosota-panel2'
const colors={supported:'#087d63',gap:'#767e8b',review:'#db5427',stairs:'#2867d8'}

export function SlabScaffoldSettings({run,axis,selection,change,bays,unmatched}:{run:ScaffoldRun;axis:'y'|'z';
  selection():HostSource[];change(patch:Partial<ScaffoldRun>):void;bays:ReferenceBay[];unmatched:number}){
  const [error,setError]=useState(''),[picked,setPicked]=useState(''),[floor,setFloor]=useState<number>()
  const refs=run.slabs??[]
  function capture(){
    try{
      const added=captureSlabReferences(selection(),axis)
      const slabs=[...new Map([...refs,...added].map(s=>[s.ref,s])).values()]
      change({slabs,side:'right',base_elevation:run.base_elevation??Math.min(...slabs.map(s=>s.elevation))})
      setError('');setPicked('')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  const heights=[...new Set(refs.map(s=>Math.round(s.elevation*1000)/1000))].sort((a,b)=>a-b)
  const top=heights.includes(floor!)?floor!:heights[heights.length-1]
  const refsHere=refs.filter(s=>Math.abs(s.elevation-top)<.00051)
  const here=bays.filter(b=>b.elevation===top),current=here.find(b=>b.key===picked)
  const rings=refsHere.flatMap(s=>s.rings)
  const points=[...rings.flat(),...here.flatMap(b=>[b.a,b.b])]
  const ext=points.reduce((v,p)=>[Math.min(v[0],p[0]),Math.min(v[1],p[1]),Math.max(v[2],p[0]),Math.max(v[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity])
  const scale=Math.max(ext[2]-ext[0],ext[3]-ext[1],.01),pad=scale*.07
  const plan=(p:number[])=>[(p[0]-ext[0])/scale*100,(p[1]-ext[1])/scale*100]
  function bayEdit(value:string){
    if(!current)return
    const edits={...run.bay_edits}
    if(value==='standard')delete edits[current.key]
    else edits[current.key]=value as 'stairs'|'gap'
    change({bay_edits:edits})
  }
  return <section className="space-y-2">
    <button className={button} onClick={capture}>{refs.length?'Add / refresh selected slabs':'Use selected level slabs'}</button>
    {error&&<p role="alert">{error}</p>}
    {!!refs.length&&<>
      <p>{refs.length} slab references · {heights.length} elevations</p>
      <label>Scaffold base elevation (m)<input type="number" step="any" className={field} value={run.base_elevation??''} onChange={e=>change({base_elevation:e.target.value===''?null:e.target.valueAsNumber})}/></label>
      <p>The base represents level ground around the lowest slab. Each upper bay checks the slab and standards immediately below.</p>
      <label>Gap from façade (m)<input type="number" step=".05" min="0" max="3" className={field} value={run.facade_gap??.18} onChange={e=>change({facade_gap:e.target.valueAsNumber})}/></label>
      <label>Review level<select className={field} value={top} onChange={e=>{setFloor(Number(e.target.value));setPicked('')}}>{heights.map(h=><option key={h} value={h}>{h.toFixed(3)} m · {refs.filter(s=>Math.abs(s.elevation-h)<.00051).map(s=>s.name).join(', ')}</option>)}</select></label>
      {points.length>0&&<svg role="group" aria-label="Scaffold bay plan" viewBox={[-7,-7,(ext[2]-ext[0]+pad*2)/scale*100,(ext[3]-ext[1]+pad*2)/scale*100].join(' ')} className="w-full h-44 rounded bg-slate-100">
        {refsHere.map(s=><path key={s.ref} fill="#d9e2e9" stroke="#798795" strokeWidth=".45" fillRule="evenodd" d={s.rings.map(r=>'M'+r.map(p=>plan(p).join(',')).join('L')+'Z').join(' ')}/>)}
        {here.map((b,i)=>{const [x1,y1]=plan(b.a),[x2,y2]=plan(b.b);const props={x1,y1,x2,y2}
          return <g key={b.key} onClick={()=>setPicked(b.key)} className="cursor-pointer"><title>{'Bay '+(i+1)+' · '+(b.reason||b.status)}</title>
            {picked===b.key&&<line {...props} stroke="#111827" strokeWidth="3.3"/>}
            <line {...props} stroke={colors[b.status==='supported'&&b.stairs?'stairs':b.status]} strokeWidth="1.7" strokeDasharray={b.status==='gap'?'1 1':undefined}/>
            <line {...props} stroke="transparent" strokeWidth="4"/></g>})}
      </svg>}
      {here.length>0?<><p>Green · scaffold &nbsp; Blue · stairs &nbsp; Orange · unsupported &nbsp; Grey · opening</p>
      <label>Bay<select className={field} value={current?.key??''} onChange={e=>setPicked(e.target.value)}><option value="">Pick a bay in the plan…</option>{here.map((b,i)=><option key={b.key} value={b.key}>Bay {i+1} · {b.status==='supported'&&b.stairs?'stairs':b.status}</option>)}</select></label>
      {current&&<><label>Bay use<select className={field} value={run.bay_edits?.[current.key]??'standard'} onChange={e=>bayEdit(e.target.value)}><option value="standard">Working platform</option><option value="gap">Opening</option><option value="stairs">Stair access</option></select></label>{current.reason&&<p>{current.reason}</p>}</>}
      </>:<p>{top===run.base_elevation?'Base reference. Choose an upper level to edit bays.':'Preview to fit the bays to this level.'}</p>}
      {bays.some(b=>b.status==='review')&&<p role="status">{bays.filter(b=>b.status==='review').length} unsupported bays excluded across the selected levels.</p>}
      {unmatched>0&&<p>{unmatched} previous bay edits no longer match the outline or spacing.</p>}
      <details><summary>Reference slabs</summary>{refs.map(s=><div key={s.ref} className="flex items-center justify-between"><span>{s.name} · {s.elevation.toFixed(2)} m</span><button className={button} onClick={()=>change({slabs:refs.filter(p=>p.ref!==s.ref)})}>Remove</button></div>)}</details>
    </>}
  </section>
}
