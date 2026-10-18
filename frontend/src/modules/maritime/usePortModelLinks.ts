import { useEffect, useMemo, useState } from 'react'
import { useModelScene } from '../fourD/modelSceneBridge'
import { resolveElementRefsToTargets, type ResolvedIsolationTarget } from '../fourD/linkedElements'
import type { WorkspaceDefinition } from './workspaceData'

export function usePortModelLinks(projectId:string,plan:WorkspaceDefinition){
  const bridge=useModelScene(),snapshot=bridge?.snapshot?.projectId===projectId?bridge.snapshot:null
  const refsKey=JSON.stringify(plan.assets.map(a=>[a.id,a.elements]))
  const [resolved,setResolved]=useState<{snapshot:typeof snapshot;key:string;targets:Map<string,ResolvedIsolationTarget>;error:string}|null>(null)
  useEffect(()=>{
    if(!snapshot)return
    let cancelled=false
    void (async()=>{
      try{
        const targets=new Map<string,ResolvedIsolationTarget>()
        for(const asset of plan.assets){
          if(cancelled)return
          if(asset.elements.length)targets.set(asset.id,await resolveElementRefsToTargets(asset.elements,snapshot.models,snapshot.ifcHandles))
        }
        if(!cancelled)setResolved({snapshot,key:refsKey,targets,error:''})
      }catch(e){if(!cancelled)setResolved({snapshot,key:refsKey,targets:new Map(),error:e instanceof Error?e.message:'Unable to load linked models.'})}
    })()
    return()=>{cancelled=true}
  },[snapshot,refsKey])
  const current=resolved?.snapshot===snapshot&&resolved?.key===refsKey?resolved:null
  return useMemo(()=>({snapshot,targets:current?.targets??null,error:current?.error??'',loading:!snapshot?.ready||!current}),[snapshot,current])
}
