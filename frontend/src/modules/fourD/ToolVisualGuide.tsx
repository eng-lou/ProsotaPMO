import { useEffect, useId, useState } from 'react'

type Topic = 'shape' | 'path' | 'placement' | 'rig' | 'materials' | 'camera' | 'links'
type Example = {id:string;name:string;description:string}
export const VISUAL_GUIDES: Record<Topic,{title:string;examples:Example[]}> = {
 shape:{title:'Shape operations',examples:[
  {id:'subtract',name:'Cut',description:'Keep the base outside the cutter. The overlapping part is removed.'},
  {id:'union',name:'Union',description:'Join both solids into one combined result.'},
  {id:'intersect',name:'Intersect',description:'Keep only the volume shared by both solids.'},
  {id:'excavate',name:'Excavate',description:'Create two objects: the remaining base and the removed overlap. Originals are retained.'}]},
 path:{title:'Path binding',examples:[
  {id:'orient',name:'Follow turns',description:'The root follows the route and turns with its tangent. Heading offset corrects which way the asset faces.'},
  {id:'fixed',name:'Keep heading',description:'The root moves along the route while keeping its heading.'},
  {id:'height',name:'Surface height',description:'The path moves the anchor. Use the object’s base/pivot and bound position offset to keep its feet on the surface.'},
  {id:'clip',name:'Parts & travel',description:'Path motion moves the whole asset. Embedded clips animate its parts; match reference speed to its walking or driving pace. Rig keyframes remain separate.'}]},
 placement:{title:'Array & scatter',examples:[
  {id:'array',name:'Path array',description:'Place copies along the path. Spacing determines the gap between placement centres, not object edges.'},
  {id:'scatter',name:'Zone scatter',description:'Distribute copies inside a zone. Count, minimum spacing and seed control the layout; crowded zones may fit fewer copies.'},
  {id:'aligned',name:'Path alignment',description:'Align copies to the path tangent, then use heading offset to correct the source object’s front.'},
  {id:'seed',name:'Random seed',description:'A fixed seed gives repeatable scatter for the same inputs. Change the seed for a different arrangement.'}]},
 rig:{title:'Rig joints',examples:[
  {id:'hinge',name:'Hinge',description:'Rotate selected parts about the pivot and axis. Child groups follow their parent.'},
  {id:'slide',name:'Slider',description:'Translate selected parts along an axis between the two limits.'},
  {id:'wheel',name:'Wheel',description:'A wheel is a hinge at its axle. Its rotation needs a control/keyframes; rig wheels are not automatically driven by path distance.'},
  {id:'hierarchy',name:'Hierarchy',description:'The root moves the whole machine. Parent joints carry children; give each moving part one owner.'}]},
 materials:{title:'Material appearance',examples:[
  {id:'water',name:'Water',description:'Animated ripples break up reflections. Speed changes motion; turbidity changes how clear the water appears.'},
  {id:'grass',name:'Turf',description:'Surface detail and colour variation suggest short fibres without adding grass geometry.'},
  {id:'glass',name:'Glass',description:'Transmission shows refraction through glass. Its appearance depends on lighting, background and thickness.'},
  {id:'concrete',name:'Concrete',description:'A rough, matte surface softens highlights. Lighting still affects the visible colour.'},
  {id:'scale',name:'Texture scale',description:'Pattern scale changes the repeat size. Compare the pattern against an object of known size.'},
  {id:'rotation',name:'Direction',description:'Texture rotation turns the pattern on the surface without rotating the object.'},
  {id:'opacity',name:'Opacity',description:'Opacity controls visibility of the surface; it is different from glass transmission.'}]},
 camera:{title:'Camera tracking',examples:[
  {id:'fixed',name:'Fixed framing',description:'No target-follow offset is added. The chosen shot movement still runs; use Fixed / Hold for a stationary camera.'},
  {id:'aim',name:'Look at target',description:'The camera aims at the moving target while its authored position/movement stays independent.'},
  {id:'translate',name:'Move with target',description:'Add the target’s translation to the shot. Camera offset keeps its world direction as the target turns.'},
  {id:'aligned',name:'Follow heading',description:'Move with the target and rotate the offset with its heading, like a chase camera.'}]},
 links:{title:'Activity & profile links',examples:[
  {id:'default',name:'Activity default',description:'The linked activity supplies dates and its default profile when there is no element override.'},
  {id:'override',name:'Element override',description:'An explicit profile on an element link takes precedence over that activity’s default for this link.'},
  {id:'saved',name:'Save vs assign',description:'Saving creates a reusable recipe. Assign it to an activity or element link to make it drive objects.'}]},
}
const blue='#60a5fa',gold='#fbbf24',muted='#94a3b8',red='#f87171'
function Diagram({topic,mode,t,id,heading=0}:{topic:Topic;mode:string;t:number;id:string;heading?:number}) {
 const x=40+160*t,y=87-140*t*(1-t),angle=Math.atan2(-140+280*t,160)*180/Math.PI
 const marker=<defs><marker id={id} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill={gold}/></marker></defs>
 const box=(x:number,y:number,label:string,colour=blue)=><g><rect x={x} y={y} width="64" height="28" rx="5" fill={colour} fillOpacity=".16" stroke={colour}/><text x={x+32} y={y+18} textAnchor="middle" fontSize="10" fill="currentColor">{label}</text></g>
 let content
 if(topic==='shape') {
  content=<><rect x="25" y="36" width="110" height="65" fill={mode==='intersect'?'none':blue} fillOpacity=".5" stroke={blue}/><rect x="92" y="61" width="110" height="65" fill={mode==='union'?blue:'none'} fillOpacity=".5" stroke={gold} strokeDasharray="4 3"/><rect x="92" y="61" width="43" height="40" fill={mode==='subtract'||mode==='excavate'?'#0f172a':gold}/><text x="30" y="26" fill={blue}>Base</text><text x="148" y="148" fill={gold}>Cutter</text>{mode==='excavate'&&<><path d="M138 65L172 32" stroke={gold} markerEnd={`url(#${id})`}/><rect x="177" y="13" width="43" height="40" fill={red}/><text x="175" y="9" fill={red} fontSize="9">Removed</text></>}</>
 } else if(topic==='path') {
  content=mode==='height'?<><path d="M15 115H225" stroke={muted}/><rect x="85" y="55" width="45" height="60" fill={blue} fillOpacity=".4" stroke={blue}/><circle cx="108" cy="115" r="4" fill={gold}/><path d="M150 114V55" stroke={gold} markerEnd={`url(#${id})`}/><text x="157" y="83" fill={muted}>Height</text><text x="60" y="138" fill={gold}>Base / feet on surface</text></>:<><path d="M40 87Q120 17 200 87" fill="none" stroke={muted} strokeDasharray="4 3"/><g transform={`translate(${x} ${y}) rotate(${(mode==='fixed'?0:angle)+heading})`}><rect x="-17" y="-10" width="34" height="20" rx="3" fill={blue}/><path d="M0 0H30" stroke={gold} markerEnd={`url(#${id})`}/>{mode==='clip'&&[-10,10].map(v=><g key={v} transform={`translate(${v} 12) rotate(${t*720})`}><circle r="5" fill="#334155" stroke={gold}/><path d="M-5 0H5" stroke={gold}/></g>)}</g><text x="12" y="135" fill={gold}>Arrow = front · {heading}° heading offset</text></>
 } else if(topic==='placement') {
  const scatter=mode==='scatter'||mode==='seed'
  const points=scatter?[[35,46],[77,91],[126,43],[170,89],[208,56],[113,113]]:[[30,105],[70,78],[110,58],[150,60],[192,86]]
  content=<>{scatter?<rect x="17" y="25" width="210" height="105" rx="22" fill={blue} fillOpacity=".06" stroke={muted} strokeDasharray="4 3"/>:<path d="M20 115Q110 10 210 105" stroke={muted} fill="none"/>}{points.map(([px,py],i)=><g key={i} transform={`translate(${px+(mode==='seed'?Math.sin(t*6+i)*8:0)} ${py}) rotate(${mode==='aligned'?(i-2)*25:0})`}><rect x="-8" y="-8" width="16" height="16" fill={blue}/><path d="M0 0h15" stroke={gold}/></g>)}<text x="20" y="150" fill={muted}>{scatter?'Zone boundary · centres stay inside':'Centre spacing along the path'}</text></>
 } else if(topic==='rig') {
  content=mode==='hierarchy'?<>{box(18,13,'Root')}<path d="M50 41V66H95M127 80V117H158" fill="none" stroke={gold} markerEnd={`url(#${id})`}/>{box(95,52,'Parent')}{box(158,103,'Child')}<text x="30" y="143" fill={muted}>Root → parent → attached parts</text></>:mode==='slide'?<><path d="M25 95H215" stroke={muted} strokeWidth="5"/><path d="M30 50H210" stroke={gold} markerEnd={`url(#${id})`}/><rect x={30+140*t} y="70" width="40" height="35" fill={blue}/><text x="20" y="127" fill={muted}>Min</text><text x="195" y="127" fill={muted}>Max</text><text x="95" y="42" fill={gold}>Axis</text></>:<><path d="M120 20V135" stroke={muted} strokeDasharray="3 3"/><g transform={`translate(120 82) rotate(${mode==='wheel'?t*360:-60+120*t})`}>{mode==='wheel'?<><circle r="42" fill="none" stroke={blue} strokeWidth="12"/><path d="M-36 0H36M0 -36V36" stroke={blue}/></>:<rect x="0" y="-8" width="75" height="16" rx="4" fill={blue}/>}</g><circle cx="120" cy="82" r="5" fill={gold}/><text x="10" y="147" fill={gold}>Gold = pivot · dashed line = axis</text></>
 } else if(topic==='camera') {
  const radians=angle*Math.PI/180
  const cx=mode==='fixed'||mode==='aim'?40:mode==='aligned'?x-30*Math.cos(radians)-28*Math.sin(radians):x-30
  const cy=mode==='fixed'||mode==='aim'?120:mode==='aligned'?y-30*Math.sin(radians)+28*Math.cos(radians):y+28
  content=<><path d="M40 87Q120 17 200 87" fill="none" stroke={muted} strokeDasharray="4 3"/><rect x={x-10} y={y-10} width="20" height="20" fill={blue}/><path d={`M${cx} ${cy}L${mode==='fixed'?120:x} ${mode==='fixed'?52:y}`} stroke={gold} strokeDasharray="3 3"/><g transform={`translate(${cx} ${cy}) rotate(${mode==='aligned'?angle:0})`}><rect x="-12" y="-8" width="24" height="16" fill={gold}/><path d="M12 -5L21 -10V10L12 5" fill={gold}/></g><text x="15" y="151" fill={muted}>Blue = target · gold = camera</text></>
 } else if(topic==='links') {
  content=<>{box(8,18,'Activity')}{box(164,18,'Object')}<path d="M72 32H162" stroke={gold} markerEnd={`url(#${id})`}/>{box(83,84,mode==='override'?'Override':'Profile',mode==='override'?gold:blue)}<path d={mode==='saved'?'M115 112V136':'M115 84V57H196V48'} fill="none" stroke={gold} strokeDasharray={mode==='saved'?'4 4':undefined}/><text x="120" y="151" textAnchor="middle" fill={muted}>{mode==='saved'?'Saved recipe ≠ assigned recipe':mode==='override'?'Element override wins':'Dates + default recipe drive object'}</text></>
 } else {
  const colour=mode==='water'?'#247f98':mode==='grass'?'#71834b':mode==='glass'?'#a5d7e5':'#94918b'
  content=<><defs><linearGradient id={`${id}surface`} x2="1" y2="1"><stop stopColor={colour}/><stop offset=".5" stopColor={mode==='glass'?'#f0f9ff':colour}/><stop offset="1" stopColor="#334155"/></linearGradient><pattern id={`${id}grid`} width={mode==='scale'?10+20*t:20} height={mode==='scale'?10+20*t:20} patternUnits="userSpaceOnUse" patternTransform={`rotate(${mode==='rotation'?t*90:0})`}><path d="M0 0H20V20" fill="none" stroke={muted}/></pattern></defs><rect x="40" y="28" width="160" height="100" rx="8" fill={`url(#${id}surface)`} opacity={mode==='opacity'?.15+.85*t:mode==='glass'?.6:1}/>{mode==='scale'||mode==='rotation'?<rect x="40" y="28" width="160" height="100" fill={`url(#${id}grid)`}/>:mode==='water'?Array.from({length:6},(_,i)=><path key={i} d={`M50 ${45+i*13}q20 ${-8*Math.sin(t*6+i)} 40 0t40 0t60 0`} fill="none" stroke="#9ed3db" opacity=".5"/>):mode==='grass'||mode==='concrete'?Array.from({length:70},(_,i)=><circle key={i} cx={46+(i*37)%148} cy={34+(i*23)%88} r={mode==='grass'?1.7:.8} fill={i%2?'#d1d5a6':'#334155'} opacity=".3"/>):null}<text x="120" y="149" textAnchor="middle" fill={muted}>Illustration · check your scene lighting</text></>
 }
 return <svg viewBox="0 0 240 165" className="w-full h-36" role="img" aria-label={`${VISUAL_GUIDES[topic].title}: ${mode} schematic`} style={{fontSize:11}}>{marker}{content}</svg>
}
export function ToolVisualGuide({topic,mode,heading=0}:{topic:Topic;mode?:string;heading?:number}) {
 const guide=VISUAL_GUIDES[topic], fallback=guide.examples[0].id
 const [open,setOpen]=useState(false),[example,setExample]=useState(mode||fallback),[progress,setProgress]=useState(.5),[playing,setPlaying]=useState(false)
 const id=useId().replace(/:/g,'')
 useEffect(()=>{setExample(mode||fallback);setPlaying(false)},[mode,fallback])
 useEffect(()=>{
  const stopOther=(event:Event)=>{if((event as CustomEvent).detail!==id)setPlaying(false)}
  window.addEventListener('prosota-guide-play',stopOther)
  return()=>window.removeEventListener('prosota-guide-play',stopOther)
 },[id])
 useEffect(()=>{
  if(!playing||!open)return
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)')
  if(preference.matches){setPlaying(false);return}
  let frame=0;const start=performance.now()
  const stop=()=>setPlaying(false);preference.addEventListener('change',stop)
  const tick=(now:number)=>{const p=Math.min(1,(now-start)/3500);setProgress(p);if(p<1)frame=requestAnimationFrame(tick);else setPlaying(false)}
  frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);preference.removeEventListener('change',stop)}
 },[playing,open])
 const selected=guide.examples.find(e=>e.id===example)||guide.examples[0]
 const animated=(topic==='path'&&selected.id!=='height')||(topic==='rig'&&selected.id!=='hierarchy')||topic==='camera'||(topic==='placement'&&selected.id==='seed')||(topic==='materials'&&['water','scale','rotation','opacity'].includes(selected.id))
 return <details className="min-w-0 rounded border border-gray-300 dark:border-prosota-line p-2 text-xs" onToggle={e=>{setOpen(e.currentTarget.open);setPlaying(false)}}>
  <summary className="cursor-pointer font-semibold">Visual guide · {guide.title}</summary>
  {open&&<div className="space-y-2 pt-2">
   <p className="text-[10px] text-gray-500 dark:text-prosota-muted">Example only. These controls explain the tool; they do not edit your project.</p>
   {topic==='links'?<>
    <svg viewBox="0 0 240 65" className="w-full h-20" role="img" aria-label="An activity supplies dates to its linked object">
     <rect x="4" y="8" width="88" height="42" rx="5" fill="none" stroke={blue}/><text x="48" y="26" textAnchor="middle" fill="currentColor" fontSize="11">Activity</text><text x="48" y="41" textAnchor="middle" fill={muted} fontSize="10">Start → finish</text>
     <path d="M94 29H145L138 24M145 29L138 34" fill="none" stroke={gold}/><rect x="148" y="8" width="88" height="42" rx="5" fill="none" stroke={blue}/><text x="192" y="33" textAnchor="middle" fill="currentColor" fontSize="11">This object</text>
    </svg>
    <p><strong>Activity = when.</strong> Linking an activity gives this object its start and finish dates.</p>
    <p><strong>Profile = how.</strong> Choose how the object appears, moves or disappears during that activity.</p>
    <p>Use the activity’s default profile, or choose a different profile for this object’s link. Saving a profile only adds it to the library; choosing it here assigns it.</p>
   </>:<>
   <div className="grid grid-cols-2 gap-1">{guide.examples.map(e=><button type="button" key={e.id} aria-pressed={selected.id===e.id} className={`rounded border p-1.5 text-left ${selected.id===e.id?'border-blue-400 bg-blue-500/10':'dark:border-prosota-line'}`} onClick={()=>{setExample(e.id);setPlaying(false);setProgress(.5)}}>{e.name}{mode===e.id?<span className="block text-[9px] text-blue-400">Current setting</span>:null}</button>)}</div>
   <Diagram topic={topic} mode={selected.id} t={progress} id={id} heading={heading}/>
   <p>{selected.description}</p>
   {animated&&<><label className="block text-[10px]">Example progress<input aria-label={`${guide.title} example progress`} type="range" min="0" max="1" step=".01" value={progress} onChange={e=>{setPlaying(false);setProgress(Number(e.target.value))}} className="w-full"/></label><button type="button" className="rounded border px-2 py-1 dark:border-prosota-line" onClick={()=>{if(!playing)window.dispatchEvent(new CustomEvent('prosota-guide-play',{detail:id}));setPlaying(p=>!p)}}>{playing?'Pause example':'Play example'}</button></>}
   </>}
  </div>}
 </details>
}
