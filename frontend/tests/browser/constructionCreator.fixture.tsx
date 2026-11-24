import '../../src/index.css'
import React from 'react'
import {addAfterEffect} from '@react-three/fiber'
import {createRoot} from 'react-dom/client'
import {Box3, BoxGeometry, Group, Mesh, Raycaster, Vector3} from 'three'
import {openRevealSlab} from '../pourSlab.fixture'
import {readConstructionHost} from '../../src/modules/fourD/constructionHost'
import type {Path} from '../../src/modules/fourD/paths'
import {parseAsset} from '../../src/modules/fourD/siteAssets'
import {extractAssetPart, siteAssetPlacement} from '../../src/modules/fourD/assetParts'
import {api} from '../../src/lib/api'
import {SiteToolsPanel} from '../../src/modules/fourD/SiteToolsPanel'
import {SiteScheduleWizard} from '../../src/modules/fourD/SiteScheduleWizard'
import type {IfcModelHandle} from '../../src/modules/fourD/ifcModel'
import type {ConstructionTemplate} from '../../src/modules/fourD/constructionActivities'
import type {Activity} from '../../src/modules/scheduling/types'
import type {SiteItem, useSiteScene} from '../../src/modules/fourD/siteScene'

export async function run() {
  const host=document.createElement('div')
  host.style.width='286px'
  document.body.appendChild(host)
  const root=createRoot(host)
  const previousAdapter=api.defaults.adapter, originalXHR=window.XMLHttpRequest
  const now=new Date('2026-11-01'), noop=()=>{}
  const slab=new Mesh(new BoxGeometry(5,.24,4))
  const column=new Mesh(new BoxGeometry(.6,3,.4))
  const wall=new Mesh(new BoxGeometry(3,2.8,.24))
  for(const mesh of [slab,column,wall])mesh.position.set(11,8,18)
  const bearingSlab=new Mesh(new BoxGeometry(4.4,.3,3.6))
  bearingSlab.position.set(11.2,8-.12-2.7-.15,18.1)
  const slabModel=new Group()
  slabModel.add(slab,bearingSlab)
  slabModel.userData.expressIdMeshIndex=new Map([[1,[slab]],[2,[bearingSlab]]])
  const slabLookup={expressID:1,handle:{object:slabModel,ifcModelID:0,
    api:{GetLineIDsWithType:()=>({size:()=>2,get:(i:number)=>i+1})}} as unknown as IfcModelHandle}
  const pourSlab=openRevealSlab()
  pourSlab.position.set(11,8,18)
  const pourPath={id:'break',name:'Pour break',closed:false,points:[{x:11,y:8,z:10},{x:11,y:8,z:26}]} as Path
  const pourFiles=new Map<string,File>()
  let source:Mesh=slab, items:SiteItem[]=[], uploads=0
  wall.rotation.y=.43
  const secondWall=wall.clone()
  secondWall.position.x+=8
  secondWall.rotation.y=-.68
  // A square core like the four IFC walls selected in the creator.
  const cageWalls = [[10.45,.45,0,-5],[.45,10,5,0],[10,.45,0,5],[.45,9.55,-5,0]].map(([w,d,x,z]) => {
    const mesh = new Mesh(new BoxGeometry(w,3,d))
    mesh.position.set(11+x,8,18+z)
    return mesh
  })
  let cageSelection=false
  let multipleWalls=false, uploadedFile:File|undefined
  let assetId='', schedulePayload:any, finished=false
  const tasks=[{id:'floor',code:'W-35',schedule_period_id:'live',task_name:'Level 35',activity_type:'wbs_summary'},
    {id:'existing',parent_id:'floor',schedule_period_id:'live',task_name:'Climb core formwork and placing boom',activity_type:'task',start:'2026-11-01T08:00:00Z'}] as Activity[]
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
      if(body.name.includes('Pour '))pourFiles.set(assetId,body)
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
  const state={scene:{items:[]},ready:true,draft:null,setDraft:(item:SiteItem|null)=>{state.draft=item},setSelected:noop,setError:noop,setPlacing:noop,
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
    root.render(<SiteToolsPanel state={state} projectId="creator-test" activities={tasks} paths={[pourPath]} zones={[]} sceneSources={[]}
      timelineFormat={{scheduleStart:now,timeDisplayMode:'date',speedDaysPerSecond:1,fps:30}} upAxis="y"
      selectedObjectIds={new Set()} onPickItems={noop} links={[]} profiles={[]} onSeek={noop} onLink={noop} onUnlink={noop}
      onAssignProfile={noop} linkError={null} selectedShapeSources={()=>cageSelection
        ?cageWalls.map((object,i)=>({id:'cage-wall-'+i,name:'Core wall '+i,ifcType:'IfcWall',object}))
        :multipleWalls
        ?[wall,secondWall].map((object,i)=>({id:'wall-'+i,name:'W'+i,ifcType:'IfcWallStandardCase',object}))
        :[{id:'selected-host',name:'Selected host',object:source,slabLookup:source===slab?slabLookup:undefined}]}
      hideShapeSources={()=>noop} readPileBounds={()=>{throw Error('Unused')}} onGenerateSchedule={plan} openPaths={noop}
      focusSite={noop} sceneLightsEnabled enableSceneLights={noop}/>)
  }
  try{
    draw()
    ;(await button('Layout tools')).click()
    for(const [kind,mode,element] of [
      ['Formwork','deck',slab],['Formwork','slabEdge',slab],['Formwork','groundBeam',wall],['Formwork','beam',wall],['Formwork','shutter',column],['Formwork','wallForm',wall],['Formwork','screen',slab],
      ['Reinforcement','mat',slab],['Reinforcement','column',column],['Reinforcement','wall',wall],
    ] as const){
      source=element;multipleWalls=mode==='wallForm';cageSelection=mode==='wall'
      ;(await button('+ '+kind+' creator')).click()
      const select=await waitFor(()=>host.querySelector<HTMLSelectElement>('section[aria-label$=" creator"] select')||undefined,'mode')
      select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}))
      await new Promise(r=>setTimeout(r,30))
      if(mode==='beam'){
        const previous=source
        source=bearingSlab
        ;(await button('Use selected bearing slab(s)')).click()
        source=previous
      }
      ;(await button('Preview from selection')).click()
      const create=await button(multipleWalls||cageSelection?'Create at selected elements':'Create at selected element')
      if(mode==='deck' && !host.textContent?.includes('Measured bearing slab / 2.700 m below soffit')) throw Error('Missing measured support height')
      if(cageSelection){
        if(!host.textContent?.includes('4 selected hosts') || !host.textContent?.includes('8 construction parts')) throw Error('Missing wall cage selection')
        const getInline=()=>host.querySelector<HTMLCanvasElement>('[aria-label="Wall reinforcement cage preview"] canvas')
        const inline=await waitFor(()=>{const c=getInline();return c && c.clientHeight>=240 && c},'fitted inline cage')
        let visibleFraction=0
        const unsubscribe=addAfterEffect(()=>{
          const sample=document.createElement('canvas')
          sample.width=inline.width;sample.height=inline.height
          const ctx=sample.getContext('2d')!
          ctx.drawImage(inline,0,0)
          const {data}=ctx.getImageData(0,0,sample.width,sample.height)
          let ink=0
          for(let p=0;p<data.length;p+=4) if(data[p+3]>245 && data[p]<180 && data[p+1]<180 && data[p+2]<180) ink++
          visibleFraction=Math.max(visibleFraction,ink/(sample.width*sample.height))
        })
        try {
          ;(await button('Fit view')).click()
          await waitFor(()=>visibleFraction>.015,'visible reinforcement strokes on the light background')
        } finally {unsubscribe()}
        ;(await button('Expand preview')).click()
        const dialog=await waitFor(()=>host.querySelector<HTMLDialogElement>('dialog[open]')||undefined,'expanded cage')
        await waitFor(()=>{const c=dialog.querySelector('canvas');return c && c.clientHeight>inline.height},'larger canvas')
        dialog.querySelector('button')!.click()
        ;(await button('Close preview')).click()
        await waitFor(()=>!dialog.open,'return to inline preview')
      }
      const before=items.length
      if(mode==='wall'||multipleWalls)(await button('Create and plan activities…')).click()
      else create.click()
      await waitFor(()=>items.length>before,'saved '+mode)
      const added=items.slice(before)
      if(added.length<2||added.some(p=>!p.asset_part||p.assembly_id!==added[0].assembly_id||
        !Number.isFinite(p.position.x)||Math.abs(p.position.x-11)>(multipleWalls||cageSelection?11:5)||Math.abs(p.position.z-18)>(cageSelection?11:5)||Math.abs(p.position.y-8)>9))
        throw Error('Incorrect saved parts or placement in '+mode)
      if(mode==='deck'){
        const {object}=await parseAsset(await uploadedFile!.arrayBuffer())
        const saved=added.find(item=>item.name.endsWith('Props'))!
        const group=extractAssetPart(object,saved.asset_part!)
        group.applyMatrix4(siteAssetPlacement(saved))
        const bearing=new Box3().setFromObject(bearingSlab,true), props=new Box3().setFromObject(group,true)
        if(Math.abs(props.min.y-bearing.max.y)>.0001 || props.min.x<bearing.min.x || props.max.x>bearing.max.x ||
          props.min.z<bearing.min.z || props.max.z>bearing.max.z) throw Error('Saved props drifted off the bearing slab')
      }
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
    cageSelection=true
    const plain=await waitFor(()=>host.querySelector<HTMLSelectElement>('select:has(option[value="plain"])')||undefined,'climbing variants')
    plain.closest('details')!.open=true
    plain.value='plain';plain.dispatchEvent(new Event('change',{bubbles:true}))
    const anchor=host.querySelector<HTMLSelectElement>('select:has(option[value="existing"])')!
    anchor.value='existing';anchor.dispatchEvent(new Event('change',{bubbles:true}))
    ;(await button('Preview on selected core')).click()
    const save=await button('Save')
    if(!state.draft?.climbing_formwork||state.draft.climbing_formwork.reference_sources?.length!==4 ||
      state.draft.climbing_formwork.reference_elevation!==9.5 || state.draft.climbing_formwork.lifts[0]?.height!==0)
      throw Error('Core placement did not use the first selected lift')
    save.click()
    await waitFor(()=>items.some(i=>i.climbing_formwork?.lifts[0]?.activity_id==='existing'),'saved core lift')
    cageSelection=false;source=column
    const addCuts=await button('Add selected exclusions');addCuts.closest('details')!.open=true;addCuts.click()
    ;(await button('Preview ground cuts')).click()
    ;(await button('Create ground')).click()
    await waitFor(()=>items.some(i=>i.name==='Ground · remaining soil')&&items.some(i=>i.name.startsWith('Excavation ·')),'saved ground and cuts')
    source=pourSlab
    const previewPour=await button('Preview selected slab')
    previewPour.closest('details')!.open=true
    const breakSelect=host.querySelector<HTMLSelectElement>('select[aria-label="Pour break"]')!
    breakSelect.value='break'
    breakSelect.dispatchEvent(new Event('change',{bubbles:true}))
    await new Promise(r=>setTimeout(r,30))
    previewPour.click()
    const zoneB=await waitFor(()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.endsWith('Pour B')),'second pour preview')
    zoneB.click()
    const assignment=host.querySelector<HTMLSelectElement>('select[aria-label$="Pour B activity"]')!
    assignment.value='existing';assignment.dispatchEvent(new Event('change',{bubbles:true}))
    ;(await button('Create both pour zones')).click()
    const pours=await waitFor(()=>items.filter(i=>i.asset_id&&pourFiles.has(i.asset_id)).length===2&&items.filter(i=>i.asset_id&&pourFiles.has(i.asset_id)),'both pour assets')
    if(pours.some(i=>i.operation_inputs?.[0]!=='selected-host')||pours[1].stage_window?.from_activity_id!=='existing')throw Error('Lost pour source or activity')
    const ray=new Raycaster()
    for(const item of pours){
      const {object}=await parseAsset(await pourFiles.get(item.asset_id!)!.arrayBuffer())
      const placement=new Group().add(object)
      placement.applyMatrix4(siteAssetPlacement(item));placement.updateMatrixWorld(true)
      const ref=readConstructionHost(item.name,placement,'y','slabTop')
      if(Math.abs(ref.origin.y-7.7)>.001||Math.abs(ref.height-.3)>.001)throw Error('Reloaded pour moved')
      ray.set(new Vector3(11.5,9,18),new Vector3(0,-1,0))
      if(ray.intersectObject(placement).length)throw Error('Reloaded pour filled the opening')
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
    if(uploads!==15)throw Error('Wrong number of generated assets')
    return {passed:true,creators:2,modes:10,core:true,ground:true,pours:pours.length,uploads,scheduledParts:items.length,activities:4}
  }finally{root.unmount();host.remove();api.defaults.adapter=previousAdapter;window.XMLHttpRequest=originalXHR}
}
