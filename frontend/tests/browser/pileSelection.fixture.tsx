import React from 'react'
import {createRoot} from 'react-dom/client'
import {BoxGeometry, Group, Matrix4, Mesh} from 'three'
import {api} from '../../src/lib/api'
import {SiteToolsPanel} from '../../src/modules/fourD/SiteToolsPanel'
import {selectedPileBounds} from '../../src/modules/fourD/pileSelection'
import type {SiteItem, useSiteScene} from '../../src/modules/fourD/siteScene'
import type {Activity} from '../../src/modules/scheduling/types'

export async function checkPileSelection() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const previousAdapter = api.defaults.adapter
  api.defaults.adapter = async config => ({config, data:[], status:200, statusText:'OK', headers:{}})
  const noop = () => {}
  const wait = () => new Promise(resolve => setTimeout(resolve, 60))
  const tick = async (selector: string, label: string) => {
    const element = [...host.querySelectorAll<HTMLElement>(selector)].find(e => e.textContent?.includes(label))
    if (!element) throw Error('Missing ' + label)
    element.click()
    await wait()
  }
  const field = (label: string) => [...host.querySelectorAll('label')].find(l=>l.firstChild?.textContent===label)?.querySelector('input')
  const activity = {id:'task', code:'P-01',task_name:'Install P01',start:'2026-11-01',finish:'2026-11-02'} as Activity
  const rig = {id:'drill',name:'Rotary drill',kind:'asset',up_axis:'z',position:{x:0,y:0,z:0}} as SiteItem
  const marker = {...rig,id:'marker',name:'Pile marker'}
  let items = [rig,marker]
  const ifc = new Group()
  ifc.position.set(10,20,30)
  ifc.userData.batch = {byExpressId:new Map([[21,[{geometryId:1,matrix:new Matrix4().makeTranslation(2,-3,-4)}]]]),
    geometryById:new Map([[1,new BoxGeometry(1,1,8)]])}
  const shape = new Mesh(new BoxGeometry(1,1,2))
  shape.position.set(-4,3,1)
  const objects = [{id:'ifc-a',kind:'ifc',object:ifc},{id:'site:marker',kind:'mesh',object:shape}]
  let ids = new Set(['site:drill']), picks = new Map<string, Set<number>>()
  function draw() {
    const state = {scene:{items},ready:true, setDraft:noop,setPlacing:noop,
      save:async (apply:(value:SiteItem[])=>SiteItem[])=>{items=apply(items);draw()}} as unknown as ReturnType<typeof useSiteScene>
    root.render(<SiteToolsPanel state={state} projectId="fixture" activities={[activity]} paths={[]} zones={[]} sceneSources={[]}
      timelineFormat={{scheduleStart:new Date(activity.start!),timeDisplayMode:'date',speedDaysPerSecond:1,fps:30}}
      onSeek={noop} upAxis="z" selectedObjectIds={ids} onPickItems={noop} links={[]} profiles={[]} onLink={noop}
      onUnlink={noop} onAssignProfile={noop} linkError={null} selectedShapeSources={()=>[]} hideShapeSources={()=>noop}
      readPileBounds={id=>selectedPileBounds(id,ids,picks,objects)} onGenerateSchedule={noop} openPaths={noop} focusSite={noop}
      sceneLightsEnabled enableSceneLights={noop}/>)
  }
  try {
    draw(); await wait()
    await tick('summary','TBM & piling sequence')
    await tick('button','Set up piling')
    await tick('summary','Add activities')
    await tick('label','P-01')
    await tick('button','Add selected in date order')
    await tick('summary','1. Install P01')
    const depth = field('Pile depth (m)')
    if (!depth) throw Error('Missing pile step')
    ids = new Set(['site:drill','ifc-a']); picks.set('ifc-a',new Set([21]))
    draw(); await wait()
    if (depth !== field('Pile depth (m)')) throw Error('Mixed selection discarded the open rig editor or its draft')
    await tick('button','Read selected pile')
    if (field('Pile X (m)')?.value!=='12' || field('Pile Y (m)')?.value!=='17' ||
        field('Pile Z (m)')?.value!=='30' || depth.value!=='8') throw Error('Wrong IFC pile geometry')
    picks.set('ifc-a',new Set([21,22]))
    await tick('button','Read selected pile')
    if (!host.textContent?.includes('Choose exactly one IFC pile') || depth.value!=='8') throw Error('Ambiguous capture changed the draft')
    ids = new Set(['site:drill','site:marker']); picks.clear(); draw(); await wait()
    await tick('button','Read selected pile')
    if (field('Pile X (m)')?.value!=='-4' || field('Pile depth (m)')?.value!=='2') throw Error('Site marker capture failed')
    await tick('button','Save sequence')
    if (items[0].work_sequence?.steps[0].position.x!==-4 || items[1]!==marker) throw Error('Saved to the wrong placement')
    ids = new Set(['ifc-a']); draw(); await wait()
    if (host.querySelector('summary') && [...host.querySelectorAll('summary')].some(s => s.textContent?.includes('TBM & piling sequence'))) {
      throw Error('Deselected rig still editable')
    }
    ids = new Set(['site:drill','ifc-a']); picks.set('ifc-a',new Set([21])); draw(); await wait()
    await tick('summary','1. Install P01')
    if (field('Pile X (m)')?.value!=='-4') throw Error('Existing piling setup missing from mixed selection')
  } finally {
    root.unmount(); host.remove(); api.defaults.adapter=previousAdapter
  }
}
