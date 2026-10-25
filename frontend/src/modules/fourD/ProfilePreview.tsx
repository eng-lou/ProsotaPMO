import { useEffect, useId, useState } from 'react'
import type { AnimationProfileConfig } from './animationProfiles'
import { applyEasing } from './timelinePlayback'
import { previewProfile } from './profilePresentation'

// A projected box uses the production evaluator; no WebGL contexts or live scene edits.
export function ProfileDiagram({config, progress=.45, fraction=0}: {config:AnimationProfileConfig;progress?:number;fraction?:number}) {
  const clip = useId().replace(/:/g,'')
  const s = previewProfile(config, progress, fraction)
  const angle = s.rotationOffsetDeg * Math.PI / 180
  const project = (v:number[], posed:boolean) => {
    let [x,y,z] = v
    if(posed) {
      if(s.growProgress != null) {
        const a = config.axis === 'x' ? 0 : config.axis === 'y' ? 1 : 2
        const p=[x,y,z]; p[a] = config.direction === 1 ? -.5+(p[a]+.5)*s.growProgress : .5-(.5-p[a])*s.growProgress
        ;[x,y,z]=p
      }
      const c=Math.cos(angle),sn=Math.sin(angle)
      if(config.axis==='x') [y,z]=[y*c-z*sn,y*sn+z*c]
      else if(config.axis==='y') [x,z]=[x*c+z*sn,-x*sn+z*c]
      else [x,y]=[x*c-y*sn,x*sn+y*c]
      const k=s.scaleMultiplier
      const norm=Math.max(1,Math.abs(config.distance))
      ;[x,y,z]=[x*k+s.positionOffset[0]/norm,y*k+s.positionOffset[1]/norm,z*k+s.positionOffset[2]/norm]
    }
    return `${65+x*25+y*13},${48-z*25+y*9}`
  }
  const vertices=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]
  const faces=[[4,5,6,7],[0,1,5,4],[1,2,6,5]]
  return <svg viewBox="0 0 130 90" className="w-full h-20" role="img" aria-label={`${config.transform_kind}, ${config.axis.toUpperCase()} axis; ${Math.round(progress*100)} percent`}>
    <defs><clipPath id={clip}><rect width="130" height="90"/></clipPath></defs>
    <g clipPath={`url(#${clip})`}>
      {faces.map((f,i)=><polygon key={`g${i}`} points={f.map(v=>project(vertices[v],false)).join(' ')} fill="none" stroke="#94a3b8" strokeDasharray="3 3" opacity=".45"/>)}
      {faces.map((f,i)=><polygon key={i} points={f.map(v=>project(vertices[v],true)).join(' ')} fill={s.color || '#60a5fa'} fillOpacity={Math.max(0,Math.min(1,s.opacity))*(1-i*.17)} stroke="#93c5fd" strokeOpacity={Math.max(0,Math.min(1,s.opacity))}/>) }
    </g>
    <text x="6" y="83" fill="#94a3b8" fontSize="9">{config.axis.toUpperCase()} {config.direction===1?'+':'−'}</text>
    <path d="M100 75h17m-17 0v-17m0 17l-9 7" fill="none" stroke="#94a3b8"/>
    <text x="119" y="78" fill="#94a3b8" fontSize="8">X</text><text x="97" y="55" fill="#94a3b8" fontSize="8">Z</text><text x="84" y="87" fill="#94a3b8" fontSize="8">Y</text>
  </svg>
}
export function ProfilePreview({config}:{config:AnimationProfileConfig}) {
  const [progress,setProgress]=useState(.5), [playing,setPlaying]=useState(false)
  useEffect(()=>{
    if(!playing)return
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)')
    if(reduced.matches){setPlaying(false);return}
    let frame=0, start=performance.now()
    const tick=(now:number)=>{ const p=Math.min(1,(now-start)/4000);setProgress(p);if(p<1)frame=requestAnimationFrame(tick);else setPlaying(false) }
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame)
  },[playing])
  const stagger=config.stagger ?? 0
  return <div className="rounded border border-gray-300 dark:border-prosota-line p-2 space-y-2">
    <div className="text-xs font-semibold">Recipe preview · sample activity</div>
    <ProfileDiagram config={config} progress={progress}/>
    <input aria-label="Profile preview progress" type="range" min="0" max="1" step=".005" value={progress} className="w-full" onChange={e=>{setPlaying(false);setProgress(Number(e.target.value))}}/>
    <div className="flex justify-between text-[10px] text-gray-500 dark:text-prosota-muted"><span>Start</span><span>During</span><span>Finish</span></div>
    <button type="button" className="text-xs border rounded px-2 py-1" onClick={()=>setPlaying(p=>!p)}>{playing?'Pause':'Play preview'}</button>
    <p className="text-[10px] text-gray-500 dark:text-prosota-muted">Dashed box: original position. Movement is fitted to this diagram; no project objects are changed.</p>
    <svg viewBox="0 0 120 30" className="w-full h-8" aria-label="Easing curve" role="img"><path d={Array.from({length:41},(_,i)=>`${i?'L':'M'}${i*3},${28-applyEasing(i/40,config.interpolation)*25}`).join(' ')} stroke="#60a5fa" fill="none"/></svg>
    {stagger>0&&<><div className="flex">{[0,.33,.67,1].map((f,i)=><div className="w-1/4" key={i}><ProfileDiagram config={config} progress={progress} fraction={config.stagger_reverse?1-f:f}/></div>)}</div><p className="text-[10px]">Element order · {config.stagger_order?.replace(/_/g,' ')}{config.stagger_reverse?' · reversed':''}. Example order only.</p></>}
  </div>
}

