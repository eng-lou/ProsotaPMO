import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export {computeExportLayout,drawGanttStrip,composeExportFrame,drawActivityTableStrip} from './src/modules/fourD/exportOverlays'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'})
const {computeExportLayout,drawGanttStrip,composeExportFrame,drawActivityTableStrip}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
function context(){
 const fills=[],texts=[]
 const ctx=new Proxy({fills,texts,measureText(t){return {width:t.length*7}},fillRect(...r){fills.push({r,color:this.fillStyle})},fillText(t,...p){texts.push({t,p})}}, {get(o,k){return k in o?o[k]:()=>{}}})
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
 drawGanttStrip(ctx,{x:0,y:0,width:1920,height:216},[{id:'a',activity_type:'task',task_name:'Clear vegetation',start:'2026-12-01',finish:'2026-12-20'}],new Date('2026-11-01'),new Date('2031-06-01'),new Date('2026-12-10'),1)
 const bars=ctx.fills.filter(f=>f.color==='#1683ef')
 assert.equal(bars.length,1);assert(bars[0].r[0]>=480);assert(bars[0].r[2]>100)
 assert(ctx.texts.some(t=>t.t==='Clear vegetation'))
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
