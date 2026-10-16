import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { ThemeProvider } from '../src/lib/ThemeContext'
import { GanttChart, type GanttChartHandle } from '../src/modules/scheduling/GanttChart'
import { useSchedulePaneWidth } from '../src/modules/scheduling/schedulePaneWidth'
import type { Activity } from '../src/modules/scheduling/types'
const activities=Array.from({length:82},(_,i)=>({id:String(i),task_name:`Task ${i+1}`,activity_type:i%10===0?'wbs_summary':'task',start:'2029-12-13T08:00:00',finish:'2030-01-09T17:00:00',bl_start:'2029-12-10T08:00:00',bl_finish:'2030-01-06T17:00:00',pct_complete:25,wbs_path:'1.1'} as Activity))
function App(){
 const [width,setWidth]=useState(1000),[group,setGroup]=useState(false)
 const {splitPaneRef,tableWidth}=useSchedulePaneWidth(2100)
 const gantt=useRef<GanttChartHandle>(null)
 const old=new URLSearchParams(location.search).has('old')
 return <main className="p-4"><button onClick={()=>setWidth(width===1000?600:1000)}>Resize panel</button><button onClick={()=>setGroup(!group)}>Toggle grouping</button><div ref={splitPaneRef} data-testid="split" className="flex overflow-hidden border" style={{width,maxWidth:'100%'}} key={String(group)}>
  <div data-testid="table" className="shrink-0 overflow-auto" style={{width:old?Math.max(320,Math.min(2100,innerWidth-240)):tableWidth,height:600}} onScroll={e=>gantt.current?.setScrollTop(e.currentTarget.scrollTop)}><div style={{width:900,height:36}}>Activity</div>{activities.map(a=><div key={a.id} style={{height:46}}>{group?'Grouped · ':''}{a.task_name}</div>)}</div>
  <div className="w-1.5 shrink-0 bg-gray-300"/>
  <div data-testid="gantt" className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden" style={{height:600}}><GanttChart ref={gantt} activities={activities} viewportHeight={564}/></div>
 </div></main>
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><App/></ThemeProvider>)
