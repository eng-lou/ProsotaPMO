import React from 'react'
import {createRoot} from 'react-dom/client'
import {Box3, BoxGeometry, Mesh} from 'three'
import {parseAsset} from '../../src/modules/fourD/siteAssets'
import {extractAssetPart, siteAssetPlacement} from '../../src/modules/fourD/assetParts'
import {api} from '../../src/lib/api'
import {SiteToolsPanel} from '../../src/modules/fourD/SiteToolsPanel'
import {SiteScheduleWizard} from '../../src/modules/fourD/SiteScheduleWizard'
import type {ConstructionTemplate} from '../../src/modules/fourD/constructionActivities'
import type {Activity} from '../../src/modules/scheduling/types'
import type {SiteItem, useSiteScene} from '../../src/modules/fourD/siteScene'

export async function run() {
  const host=document.createElement('div')
  document.body.appendChild(host)
  const root=createRoot(host)
  const previousAdapter=api.defaults.adapter, originalXHR=window.XMLHttpRequest
  const now=new Date('2026-11-01'), noop=()=>{}
  const slab=new Mesh(new BoxGeometry(5,.24,4))
  const column=new Mesh(new BoxGeometry(.6,3,.4))
  const wall=new Mesh(new BoxGeometry(3,2.8,.24))
  for(const mesh of [slab,column,wall])mesh.position.set(11,8,18)
  let source=slab, items:SiteItem[]=[], uploads=0
  wall.rotation.y=.43
  const secondWall=wall.clone()
  secondWall.position.x+=8
  secondWall.rotation.y=-.68
  let multipleWalls=false, uploadedFile:File|undefined
  let assetId='', schedulePayload:any, finished=false
  const tasks=[{id:'floor',code:'W-35',schedule_period_id:'live',task_name:'Level 35',activity_type:'wbs_summary'},
    {id:'existing',parent_id:'floor',schedule_period_id:'live',task_name:'Climb core formwork and placing boom',activity_type:'task'}] as Activity[]
  window.XMLHttpRequest=class extends originalXHR {
    fixture=false
    open(method:string,url:string|URL,...rest:any[]){
      this.fixture=String(url)==='/mock-upload'
      super.open(method,url,rest[0]??true)
    }
    send(body?:Document|XMLHttpRequestBodyInit|null){
      if(!this.fixture)return super.send(body)
      if(!(body instanceof File)||body.size<1000)throw Error('Missing generated GLB')
      uploadedFile=body;uploads++
      Object.defineProperty(this,'status',{value:200})
      queueMicrotask(()=>this.dispatchEvent(new ProgressEvent('load')))
    }
  }
  api.defaults.adapter=async config=>{
    let data:unknown=[]
    if(config.url?.includes('schedule-bulk-generate'))schedulePayload=JSON.parse(config.data)
    else if(config.method==='post'&&config.url?.endsWith('/ready'))data={id:assetId,dimensions:JSON.parse(config.data),status:'ready'}
    else if(config.method==='post'){assetId=crypto.randomUUID();data={id:assetId,upload_url:'/mock-upload'}}
    return {config,data,status:200,statusText:'OK',headers:{}}
  }
  const state={scene:{items:[]},ready:true,setDraft:noop,setPlacing:noop,
    save:async (apply:(v:SiteItem[])=>SiteItem[])=>{items=apply(items);return true}} as unknown as ReturnType<typeof useSiteScene>
  async function waitFor<T>(read:()=>T|undefined|false,label:string){
    for(let i=0;i<250;i++){
      const error=host.querySelector('[role=alert]')
      if(error)throw Error(error.textContent||'Creator failed')
      const result=read()
      if(result)return result
      await new Promise(r=>setTimeout(r,40))
    }
    throw Error('Missing '+label+' / '+host.textContent?.slice(0,500))
  }
  const button=(name:string)=>waitFor(()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===name),name)
  function plan(ids:string[],template?:ConstructionTemplate){
    root.render(<SiteScheduleWizard projectId="creator-test" schedulePeriodId="live" activities={tasks} initialTemplate={template}
      items={items.filter(i=>ids.includes(i.id))} profiles={[]} links={[]} upAxis="y" calendars={[]}
      onCancel={draw} onGenerated={()=>{finished=true;draw()}}/>)
  }
  function draw(){
    root.render(<SiteToolsPanel state={state} projectId="creator-test" activities={[]} paths={[]} zones={[]} sceneSources={[]}
      timelineFormat={{scheduleStart:now,timeDisplayMode:'date',speedDaysPerSecond:1,fps:30}} upAxis="y"
      selectedObjectIds={new Set()} onPickItems={noop} links={[]} profiles={[]} onSeek={noop} onLink={noop} onUnlink={noop}
      onAssignProfile={noop} linkError={null} selectedShapeSources={()=>multipleWalls
        ?[wall,secondWall].map((object,i)=>({id:'wall-'+i,name:'W'+i,ifcType:'IfcWallStandardCase',object}))
        :[{id:'selected-host',name:'Selected host',object:source}]}
      hideShapeSources={()=>noop} readPileBounds={()=>{throw Error('Unused')}} onGenerateSchedule={plan} openPaths={noop}
      focusSite={noop} sceneLightsEnabled enableSceneLights={noop}/>)
  }
  try{
    draw()
    ;(await button('Layout tools')).click()
    for(const [kind,mode,element] of [
      ['Formwork','deck',slab],['Formwork','shutter',column],['Formwork','wallForm',wall],['Formwork','screen',slab],
      ['Reinforcement','mat',slab],['Reinforcement','column',column],['Reinforcement','wall',wall],
    ] as const){
      source=element;multipleWalls=mode==='wallForm'
      ;(await button('+ '+kind+' creator')).click()
      const select=await waitFor(()=>host.querySelector<HTMLSelectElement>('section[aria-label$=" creator"] select')||undefined,'mode')
      select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}))
      await new Promise(r=>setTimeout(r,30))
      ;(await button('Preview from selection')).click()
      const create=await button(multipleWalls?'Create at selected elements':'Create at selected element')
      const before=items.length
      if(mode==='wall'||multipleWalls)(await button('Create and plan activities…')).click()
      else create.click()
      await waitFor(()=>items.length>before,'saved '+mode)
      const added=items.slice(before)
      if(added.length<2||added.some(p=>!p.asset_part||p.assembly_id!==added[0].assembly_id||
        !Number.isFinite(p.position.x)||Math.abs(p.position.x-11)>(multipleWalls?11:5)||Math.abs(p.position.z-18)>5||Math.abs(p.position.y-8)>9))
        throw Error('Incorrect saved parts or placement in '+mode)
      if(multipleWalls){
        // Reload the exported bytes and serialized scene items, bypassing the import cache.
        const {object}=await parseAsset(await uploadedFile!.arrayBuffer())
        const saved:SiteItem[]=JSON.parse(JSON.stringify(added))
        const panels=saved.filter(item=>item.name.endsWith('panels'))
        if(panels.length!==4)throw Error('Expected two independent panel gangs per wall')
        for(const [i,element] of [wall,secondWall].entries()){
          const parts=panels.filter(item=>item.name.startsWith('W'+i+' - '))
          const original=new Box3().setFromObject(element)
          const reloaded=new Box3()
          for(const part of parts){
            const group=extractAssetPart(object,part.asset_part!)
            group.applyMatrix4(siteAssetPlacement(part))
            reloaded.union(new Box3().setFromObject(group,true))
          }
          if(parts.length!==2 || Math.abs(original.min.y-reloaded.min.y)>.001 || Math.abs(original.max.y-reloaded.max.y)>.001 ||
            Math.abs(original.min.x-reloaded.min.x)>.2 || Math.abs(original.max.z-reloaded.max.z)>.2)throw Error('Wall formwork moved on reload')
        }
      }
      if(mode==='wall'||multipleWalls){
        const template=await waitFor(()=>host.querySelector<HTMLSelectElement>('label:has(option[value="wall"]) select')||undefined,'wall template')
        if(template.value!==mode)throw Error('Creator opened the wrong planning template')
        ;(await button('Cancel')).click()
        ;(await button('Layout tools')).click()
      }
      await button('+ '+kind+' creator')
    }
    ;(await button('Add simulation activities…')).click()
    const destination=await waitFor(()=>host.querySelector<HTMLSelectElement>('label:has(option[value="floor"]) select')||undefined,'WBS')
    destination.value='floor';destination.dispatchEvent(new Event('change',{bubbles:true}))
    const template=host.querySelector<HTMLSelectElement>('label:has(option[value="core"]) select')!
    template.value='core';template.dispatchEvent(new Event('change',{bubbles:true}))
    const commit=await button('Create 4 activities')
    commit.click()
    await waitFor(()=>finished,'activities saved')
    if(schedulePayload?.parent_wbs_id!=='floor'||schedulePayload?.activities.length!==4||
      schedulePayload.activities.some((a:any)=>a.element_refs?.length || a.parent_temp_id)||
      schedulePayload.relationships.length || !schedulePayload.activities.some((a:any)=>a.phase_key==='pour'))
      throw Error('Activities-only generation wrote unexpected data')
    if(uploads!==7)throw Error('Wrong number of generated assets')
    return {passed:true,creators:2,modes:7,uploads,scheduledParts:items.length,activities:4}
  }finally{root.unmount();host.remove();api.defaults.adapter=previousAdapter;window.XMLHttpRequest=originalXHR}
}
