import { Vector2 } from 'three'
import { IfcAPI } from 'web-ifc'
import { makeGround } from './groundFromObjects'
import { phasedFoundations } from './phasedFoundations'
import { packGroundMeshes, unpackGroundMeshes, type GroundRequest, type GroundMessage } from './groundPreviewData'

const scope=self as unknown as {onmessage:((e:MessageEvent<GroundRequest>)=>void)|null;postMessage(message:GroundMessage,transfer?:ArrayBuffer[]):void}
scope.onmessage=async ({data})=>{
  try{
    const base=data.base ? {id:'base',name:'Ground base',object:unpackGroundMeshes(data.base)} : null
    const cuts=data.cuts.map(c=>({...c,source:{id:c.id,name:c.name,object:unpackGroundMeshes(c.meshes)},rings:c.rings.map(r=>r.map(p=>new Vector2(p[0],p[1])))}))
    const progress=(progress:string)=>scope.postMessage({progress})
    let result:ReturnType<typeof makeGround>
    if(data.phased){
      progress('Preparing foundation solids…')
      const api=new IfcAPI()
      api.SetWasmPath(data.wasmPath,true)
      await api.Init(undefined,true)
      result=phasedFoundations(cuts,base,'y',data.options,data.space,data.blind,api,progress)
    }else{
      progress('Cutting ground…')
      result=makeGround(cuts,base,'y',data.options)
    }
    const transfer:ArrayBuffer[]=[]
    const pieces=result.pieces.map(({preview,phase,sourceId})=>({phase,sourceId,label:preview.label,hosts:preview.hosts,
      sourceRefs:preview.sourceRefs,anchor:preview.anchor.toArray(),scene:packGroundMeshes(preview.scene,transfer)}))
    scope.postMessage({pieces,skipped:result.skipped},[...new Set(transfer)])
  }catch(e){scope.postMessage({error:e instanceof Error?e.message:String(e)})}
}
