import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export {computeExportLayout,drawGanttStrip,composeExportFrame,drawActivityTableStrip} from './src/modules/fourD/exportOverlays';export * from './src/modules/fourD/renderGanttRows';export {loadRenderCaptureSettings,saveRenderCaptureSettings} from './src/modules/fourD/renderCaptureSettings'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'})
const {computeExportLayout,drawGanttStrip,composeExportFrame,drawActivityTableStrip,buildGanttOutline,filterGanttRows,availableGanttDetail,ganttWindow,peakGanttOverlap,loadRenderCaptureSettings,saveRenderCaptureSettings}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
function context(){
 const fills=[],texts=[],bars=[]
 const ctx=new Proxy({fills,texts,bars,roundRect(...r){bars.push({r,color:this.fillStyle})},measureText(t){return {width:t.length*7}},fillRect(...r){fills.push({r,color:this.fillStyle})},fillText(t,...p){texts.push({t,p,font:this.font})}}, {get(o,k){return k in o?o[k]:()=>{}}})
 return ctx
}
test('render bands preserve 65% model height at every export resolution',()=>{
 for(const h of [720,1080,2160]){
  const l=computeExportLayout(h*16/9,h,h/1080,{includeGanttChart:true,includeActivityTable:false,comparisonPaneCount:0,includeCostProfile:true,exportTitle:'',exportNarrative:''})
  assert(Math.abs(l.mainViewRect.height/h-.65)<.002)
  assert.equal(l.mainViewRect.y,l.ganttRect.height)
  assert.equal(l.costRect.y+l.costRect.height,h)
 }
})
test('Gantt keeps bars out of activity labels and enlarges short work within long projects',()=>{
 const ctx=context()
 drawGanttStrip(ctx,{x:0,y:0,width:1920,height:216},buildGanttOutline([{id:'a',activity_type:'task',task_name:'Clear vegetation',start:'2026-12-01',finish:'2026-12-20'}]).rows,new Date('2026-11-01'),new Date('2031-06-01'),new Date('2026-12-10'),1)
 const bars=ctx.bars.filter(f=>f.color==='#1683ef')
 assert.equal(bars.length,1);assert(bars[0].r[0]>=480);assert(bars[0].r[2]>100)
 assert.equal(bars[0].r[4],4)
 assert(ctx.texts.some(t=>t.t==='Clear vegetation' && t.font.includes('19px')))
})
const wbs = (id, parent_id, sort_order) => ({id, task_name:id, activity_type:'wbs_summary', parent_id, sort_order})
const job = (id, parent_id, start, finish) => ({id,task_name:id,activity_type:'task',parent_id,start,finish})
const fortTower = [
 wbs('Fort Tower',null,0), wbs('Core','Fort Tower',2), wbs('Core walls','Core',1),
 job('Pour core','Core walls','2027-02-02','2027-02-08'), wbs('Foundation','Fort Tower',1),
 job('Install pile','Foundation','2026-12-03','2026-12-10'),
 job('Undated','Core walls',null,null), wbs('Empty group','Core',2),
]

test('WBS levels start below the project, use outline order and roll up scenario dates',()=>{
 const outline=buildGanttOutline(fortTower)
 const names=detail=>filterGanttRows(outline,detail).map(r=>[r.activity.task_name,r.depth])
 assert.deepEqual(outline.levels,[1,2])
 assert.deepEqual(names([1]),[['Foundation',0],['Core',0]])
 assert.deepEqual(names([2]),[['Core walls',0]])
 assert.deepEqual(names([1,2]),[['Foundation',0],['Core',0],['Core walls',1]])
 assert.deepEqual(names(['activities']),[['Install pile',0],['Pour core',0]])
 assert.deepEqual(names([1,2,'activities']),[['Foundation',0],['Install pile',1],['Core',0],['Core walls',1],['Pour core',2]])
 const rows=buildGanttOutline(fortTower.map(a=>a.id==='Pour core'?{...a,finish:'2027-03-15'}:a)).rows
 for(const id of ['Core','Core walls']) assert.equal(rows.find(r=>r.activity.id===id).finish,Date.parse('2027-03-15'))
 const ctx=context()
 drawGanttStrip(ctx,{x:0,y:0,width:1920,height:216},filterGanttRows(outline,[1,2]),new Date('2026-12-03'),new Date('2027-02-08'),new Date('2026-12-03'),1)
 assert.equal(ctx.bars.filter(b=>b.color==='#26496a').length,3)
 assert(ctx.texts.find(t=>t.t==='Core walls').p[0]>ctx.texts.find(t=>t.t==='Core').p[0])
})

test('mixed rows follow the active branch when scrubbing in either direction',()=>{
 const rows=filterGanttRows(buildGanttOutline(fortTower),[1,2,'activities'])
 for(const [date,id] of [['2027-02-06','Pour core'],['2026-12-05','Install pile'],['2027-02-06','Pour core']]){
   assert(ganttWindow(rows,new Date(date),3).rows.some(row=>row.activity.id===id))
 }
})

test('ongoing WBS rows survive new starts, including nonadjacent floors and exact finishes',()=>{
 const active = (name, start, finish) => ({activity:{id:name,task_name:name,activity_type:'wbs_summary'},level:1,depth:0,start,finish})
 const rows = [active('Core',1,90),active('Completed',2,5),active('Level 01',10,80),
   active('Future',96,100),...Array.from({length:10},(_,i)=>active('Floor '+i,20+i,70+i))]
 const expected = rows.filter(r=>r.start<=60 && r.finish>=60)
 const ids = list=>list.map(r=>r.activity.id)
 assert.deepEqual(ids(ganttWindow(rows,new Date(60),12).rows),ids(expected))
 assert(ids(ganttWindow(rows,new Date(80),5).rows).includes('Level 01'))
 const firstFinishes = rows.map(row => row.activity.id === 'Core' ? {...row,finish:50} : row)
 assert(ids(ganttWindow(firstFinishes,new Date(50),5).rows).includes('Core'))
 assert.deepEqual(ids(ganttWindow(firstFinishes,new Date(51),5).rows),['Level 01','Floor 0','Floor 1','Floor 2','Floor 3'])
 for (const time of [40,60,35]) {
   const window=ganttWindow(rows,new Date(time),5)
   assert.deepEqual(ids(window.rows),['Core','Level 01','Floor 0','Floor 1','Floor 2'])
   assert.equal(window.hiddenActive,7)
 }
 assert.equal(peakGanttOverlap(rows,new Date(60),new Date(60)),12)
 assert.equal(peakGanttOverlap(rows,new Date(5),new Date(99)),12)
 assert.equal(peakGanttOverlap(rows,new Date(15),new Date(19)),2)
 assert.equal(peakGanttOverlap([active('Ends',0,10),active('Starts',10,20),active('Milestone',10,10)],new Date(0),new Date(20)),3)
})

test('busy exports draw overlapping WBS bars using a stable layout and report overflow',()=>{
 const rows=Array.from({length:40},(_,i)=>({activity:{id:String(i),task_name:'Floor '+i,activity_type:'wbs_summary'},level:1,depth:0,start:Date.UTC(2027,0,i+1),finish:Date.UTC(2027,11,31)}))
 const from=new Date('2027-01-01'), to=new Date('2027-12-31')
 for (const scale of [2/3,1,2]) for (const count of [6,12,40]) {
   const candidates=rows.slice(0,count)
   const layout=computeExportLayout(1920*scale,1080*scale,scale,{includeGanttChart:true,includeActivityTable:false,comparisonPaneCount:0,includeCostProfile:true,exportTitle:'',exportNarrative:'',ganttPeakRows:peakGanttOverlap(candidates,from,to)})
   assert(layout.mainViewRect.height>400*scale)
   for (const date of [new Date('2027-01-02'),to,new Date('2027-01-02')]) {
     const ctx=context()
     drawGanttStrip(ctx,layout.ganttRect,candidates,from,to,date,scale,layout.ganttColumns)
     const drawn=ctx.texts.filter(t=>t.t.startsWith('Floor '))
     assert(drawn.some(t=>t.t==='Floor 0'))
     for(const label of drawn) assert(label.p[1]<layout.ganttRect.height)
     if (+date===+to) {
       if(count<=12) assert.equal(drawn.length,count)
       else assert(ctx.texts.some(t=>t.t.includes('+'+(count-drawn.length)+' ongoing')))
     }
   }
 }
})

test('capture settings remember checked levels and fall back for legacy or shallower schedules',()=>{
 let stored='{}'
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>stored,setItem:(_,s)=>{stored=s}}})
 try {
   assert.deepEqual(loadRenderCaptureSettings().ganttDetail,['activities'])
   saveRenderCaptureSettings({...loadRenderCaptureSettings(),ganttDetail:[1,2]})
   assert.deepEqual(loadRenderCaptureSettings().ganttDetail,[1,2])
   assert.deepEqual(availableGanttDetail([1,2],[1]),[1])
   assert.deepEqual(availableGanttDetail([2],[]),['activities'])
   stored=JSON.stringify({ganttDetail:[0,-1,'wrong',1,1]})
   assert.deepEqual(loadRenderCaptureSettings().ganttDetail,[1])
 } finally {
   if(original) Object.defineProperty(globalThis,'localStorage',original)
   else delete globalThis.localStorage
 }
})

test('timeline export fits its view regardless of authored pixel width or horizontal offset',()=>{
 for(const width of [640,1920]){
  const ctx=context(),rect={x:100,y:50,width,height:500}
  composeExportFrame(ctx,{totalWidth:width+100,totalHeight:550,mainViewRect:rect,comparisonViewRects:[]},{mainCanvas:{width,height:500},scale:1,mainViewTitle:'',includeTimelineStrip:true,timelineStrips:[{strip:{viewport_slot:null,position_x_pct:80,position_y_pct:20,width_px:3000,height_px:40,background_color:'#123456',band_border_color:'#fff',text_color:'#fff',font_size:12},cells:[],yearGroups:[],playheadIndex:-1}]})
  const strip=ctx.fills.find(f=>f.color==='#123456')
  assert.deepEqual(strip.r,[110,150,width-20,40])
 }
})
test('date card and timeline share a row without overlapping at 720p and 4K',()=>{
 for(const scale of [2/3,2]) for(const position of [0,25]){
  const width=1920*scale,height=700*scale,ctx=context(),rect={x:0,y:80*scale,width,height}
  composeExportFrame(ctx,{totalWidth:width,totalHeight:height+rect.y,mainViewRect:rect,comparisonViewRects:[]},{mainCanvas:{width,height},scale,mainViewTitle:'',includeTimelineStrip:true,includeDateOverlay:true,now:new Date('2028-10-20'),scheduleStart:new Date('2026-11-16'),timelineStrips:[{strip:{id:'timeline',visible:true,viewport_slot:null,position_x_pct:0,position_y_pct:position,width_px:3000,height_px:40,background_color:'#123456',band_border_color:'#fff',text_color:'#fff',font_size:12},cells:[],yearGroups:[],playheadIndex:-1}]})
  const strip=ctx.fills.find(f=>f.color==='#123456')
  const card=ctx.fills.find(f=>Math.abs(f.r[2]-150*scale)<.001)
  assert(card);assert.equal(strip.r[1],card.r[1])
  assert(Math.abs(strip.r[0]-(card.r[0]+card.r[2]+10*scale))<.001)
  assert(Math.abs(strip.r[0]+strip.r[2]-(width-10*scale))<.001)
  if(position===0) assert.equal(strip.r[1],rect.y+10*scale)
 }
})

test('activity table reserves header/footer and readable rows within the existing sidebar',()=>{
 for(const scale of [1,2]){
  const ctx=context(),rect={x:0,y:216*scale,width:420*scale,height:702*scale}
  const activities=Array.from({length:40},(_,i)=>({id:String(i),code:`T-${i}`,task_name:'Install reinforced concrete slab edge protection around perimeter',activity_type:'task',start:'2026-11-01',finish:'2026-12-01',is_critical:i===0}))
  drawActivityTableStrip(ctx,rect,activities,new Date('2026-11-16'),scale)
  for(const label of ['Code','Activity','Finish']) assert(ctx.texts.some(t=>t.t===label))
  assert(ctx.fills.some(f=>f.color==='#1e3048'))
  assert(ctx.fills.some(f=>f.color==='#1683ef'))
  assert(ctx.texts.some(t=>t.t.includes('of 40 activities')))
  const codes=ctx.texts.filter(t=>/^T-/.test(t.t))
  assert.equal(codes.length,13)
  assert(codes.every(t=>t.p[1]>rect.y+40*scale && t.p[1]<rect.y+rect.height-26*scale))
 }
})

test('empty title corner is reclaimed by table without changing model or Gantt space',()=>{
 for(const scale of [2/3,1,2]) for(const gantt of [false,true]){
  const options={includeGanttChart:gantt,includeActivityTable:true,comparisonPaneCount:0,includeCostProfile:true,exportTitle:'  ',exportNarrative:''}
  const empty=computeExportLayout(1920*scale,1080*scale,scale,options)
  assert.equal(empty.tableRect.y,0)
  assert.equal(empty.tableRect.height,empty.costRect.y)
  assert.equal(empty.titleBlockRect,null)
  for(const text of [{exportTitle:'Project'},{exportNarrative:'Narrative'}]){
   const filled=computeExportLayout(1920*scale,1080*scale,scale,{...options,...text})
   assert.equal(filled.tableRect.y,filled.titleBlockRect.height)
   assert.equal(filled.tableRect.y+filled.tableRect.height,filled.costRect.y)
   if(gantt){assert.deepEqual(empty.mainViewRect,filled.mainViewRect);assert.deepEqual(empty.ganttRect,filled.ganttRect)}
  }
 }
})
