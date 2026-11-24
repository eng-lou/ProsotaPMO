import {Group,Mesh,Vector2} from 'three'
import {readIfcClashMeshes} from './clashMeshCapture'
import {contains,constructionTriangles,readConstructionHost} from './constructionHost'
import {extractScheduleElements,type ExtractedElement} from './ifcScheduleExtraction'
import type {IfcModelHandle} from './ifcModel'
import type {Activity} from '../scheduling/types'
import type {ModelElementLink} from './modelElementLinks'

export interface FloorElement extends ExtractedElement {signature:string|null; outline:Vector2[][]|null}
const kind=(e:ExtractedElement)=>e.ifcType.toLowerCase()
const rounded=(n:number)=>Math.round(n*200)
export async function readFloors(handle:IfcModelHandle,axis:'y'|'z'){
  const data=await extractScheduleElements(handle),vertical=axis==='y'?1:2
  const result:FloorElement[]=[]
  for(const e of data){
    const extents=e.boxMinMetres.flatMap((n,i)=>i===vertical?[rounded(e.boxMaxMetres[i]-n)]:[rounded(n),rounded(e.boxMaxMetres[i])])
    let signature:string|null=[kind(e),e.material,...extents].join('|'),outline:Vector2[][]|null=null
    const group=new Group()
    try{
      for(const m of readIfcClashMeshes(handle.object,e.expressID)){
        m.updateWorldMatrix(true,false);const copy=new Mesh(m.geometry,m.material);copy.matrixAutoUpdate=false;copy.matrix.copy(m.matrixWorld);group.add(copy)
      }
      if(kind(e)==='ifcslab'){
        const host=readConstructionHost(e.name,group,axis,'slabTop')
        outline=host.rings.map(r=>r.map(p=>p.clone().rotateAround(new Vector2(),host.angle).add(new Vector2(host.origin.x,host.origin.z))))
        // Keep edge connectivity when two rings happen to use the same vertices.
        signature+='|'+outline.map(r=>r.map((p,i)=>{
          const q=r[(i+1)%r.length]
          return [p,q].map(v=>rounded(v.x)+','+rounded(v.y)).sort().join('>')
        }).sort().join(';')).sort().join('|')
      }else{
        const {triangles,worldBounds}=constructionTriangles(group,axis)
        if(!triangles.length||triangles.length>20000)signature=null
        else{
          const faces=triangles.map(face=>face.map(p=>[rounded(p.x),rounded(p.y-worldBounds.min.y),rounded(p.z)].join(',')).sort().join('/')).sort()
          const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(faces.join(';')))
          signature+='|'+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')
        }
      }
    }catch{signature=null}
    result.push({...e,signature,outline})
    if(result.length%200===0)await new Promise(resolve=>setTimeout(resolve,0))
  }
  return result
}
export function matchFloor(elements:FloorElement[],source:string,target:string){
  const from=elements.filter(e=>e.storeyName===source),to=elements.filter(e=>e.storeyName===target)
  const index=(list:FloorElement[])=>{
    const groups=new Map<string,FloorElement[]>()
    list.forEach(e=>{if(e.signature){const group=groups.get(e.signature)??[];group.push(e);groups.set(e.signature,group)}})
    return groups
  }
  const left=index(from),right=index(to),hosts:Record<string,{ref:string;label:string}>={},used=new Set<string>(),review:string[]=[]
  for(const e of from){
    const candidates=e.signature?right.get(e.signature):undefined
    if(e.signature&&left.get(e.signature)?.length===1&&candidates?.length===1){
      hosts[e.globalId]={ref:candidates[0].globalId,label:candidates[0].name};used.add(candidates[0].globalId)
    }else review.push(e.name+' · missing, changed or ambiguous')
  }
  for(const e of to)if(!used.has(e.globalId))review.push(e.name+' · review target')
  return {name:target,hosts,review}
}
export interface SequenceIssue {message:string;elements:FloorElement[];activities:string[]}
export function sequenceIssues(elements:FloorElement[],activities:Activity[],links:ModelElementLink[],axis:'y'|'z'){
  const byId=new Map(activities.map(a=>[a.id,a])),byRef=new Map<string,Activity[]>()
  for(const link of links){const a=byId.get(link.activity_id);if(!a||link.source_kind!=='ifc')continue
    const rows=byRef.get(link.element_ref)??[];rows.push(a);byRef.set(link.element_ref,rows)}
  const issues:SequenceIssue[]=[],vertical=axis==='y'?1:2
  const floors=elements.filter(e=>kind(e)==='ifcslab')
  for(const e of elements){
    const rows=byRef.get(e.globalId)??[]
    if(!rows.length)continue
    for(const a of rows)if((e.material==='concrete'&&/erect steel|bolt (and|&) align|install metal deck/i.test(a.task_name))||
      (e.material==='steel'&&/pour (column|beam|wall)|strip (column|beam) formwork/i.test(a.task_name))){
      issues.push({message:e.name+' · '+e.material+' linked to “'+a.task_name+'”',elements:[e],activities:[a.id]})
    }
    if(kind(e)!=='ifccolumn')continue
    const y=e.boxMinMetres[vertical],planAxis=vertical===1?2:1
    const p=new Vector2((e.boxMinMetres[0]+e.boxMaxMetres[0])/2,(e.boxMinMetres[planAxis]+e.boxMaxMetres[planAxis])/2*(axis==='z'?-1:1))
    const supports=floors.filter(s=>s.boxMinMetres[vertical]<=y+.02 && s.boxMaxMetres[vertical]>=y-.03 &&
      s.outline && s.outline.filter(r=>contains(r,p)).length%2===1)
    const first=(list:Activity[])=>list.filter(a=>a.start).sort((a,b)=>Date.parse(a.start!)-Date.parse(b.start!))[0]
    const col=first(rows)
    if(!col)continue
    for(const s of supports){const slab=first(byRef.get(s.globalId)??[]);if(!slab?.start||!col.start)continue
      if(Date.parse(slab.start)>Date.parse(col.start))issues.push({message:e.name+' starts before its supporting slab · '+s.name,elements:[e,s],activities:[col.id,slab.id]})
    }
  }
  return issues
}
