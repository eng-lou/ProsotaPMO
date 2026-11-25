import { Box3, Material, Vector3 } from 'three'
import type { HostSource } from './constructionLayout'
import type { GroundCut, GroundOptions, GroundPiece } from './groundFromObjects'
import { arraySourceSnapshot, disposeArraySnapshot } from './arraySourceSnapshot'
import { packGroundMeshes, unpackGroundMeshes, type GroundRequest, type GroundMessage } from './groundPreviewData'

export async function previewGround(cuts:GroundCut[],base:HostSource|null,axis:'y'|'z',options:GroundOptions,
  phased:boolean,space:number,blind:number,signal:AbortSignal,progress:(message:string)=>void) {
  const materials:Material[]=[], transfer:ArrayBuffer[]=[]
  const check=()=>{if(signal.aborted)throw new DOMException('Ground preview cancelled','AbortError')}
  let grade=options.top??Infinity
  function capture(source:HostSource,isBase:boolean){
    const group=arraySourceSnapshot(source.object,axis,source.name,false)
    try{
      if(isBase)grade=new Box3().setFromObject(group).max.y
      return packGroundMeshes(group,transfer,isBase&&!phased?materials:undefined,phased)
    }finally{disposeArraySnapshot(group)}
  }
  try{
    check()
    const request:GroundRequest={base:base?capture(base,true):null,cuts:[],options,phased,space,blind,wasmPath:new URL('/wasm-ifc/',location.href).href}
    let sliceStart=performance.now()
    for(const c of cuts){
      if(performance.now()-sliceStart>8){
        await new Promise(r=>setTimeout(r,0))
        check();sliceStart=performance.now()
      }
      request.cuts.push({id:c.id,name:c.name,rings:c.rings.map(r=>r.map(p=>p.toArray())),top:c.top,bottom:c.bottom,
        meshes:phased&&c.bottom-blind<=grade+1e-4?capture(c.source,false):[]})
    }
    check()
    const worker=new Worker(new URL('./groundPreview.worker.ts',import.meta.url),{type:'module'})
    let cancel:()=>void=()=>{}
    try{
      const result=await new Promise<Extract<GroundMessage,{pieces:unknown}>>((resolve,reject)=>{
        cancel=()=>reject(new DOMException('Ground preview cancelled','AbortError'))
        signal.addEventListener('abort',cancel,{once:true})
        worker.onmessage=({data}: MessageEvent<GroundMessage>)=>{
          if('progress' in data)progress(data.progress)
          else if('error' in data)reject(Error(data.error))
          else resolve(data)
        }
        worker.onerror=e=>reject(Error(e.message||'The ground preview worker stopped. Try again.'))
        worker.onmessageerror=()=>reject(Error('The ground preview could not be read. Try again.'))
        worker.postMessage(request,[...new Set(transfer)])
      })
      check()
      const pieces:GroundPiece[]=result.pieces.map(({phase,sourceId,scene,anchor,...meta})=>({
        phase,sourceId,preview:{...meta,parts:1,scene:unpackGroundMeshes(scene,materials),
          anchor:new Vector3().fromArray(anchor).applyAxisAngle(new Vector3(1,0,0),axis==='z'?Math.PI/2:0)}
      }))
      return {pieces,skipped:result.skipped}
    }finally{signal.removeEventListener('abort',cancel);worker.terminate()}
  }finally{materials.forEach(m=>m.dispose())}
}
