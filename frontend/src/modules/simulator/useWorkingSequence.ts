import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { Scenario } from './types'

export type WorkingSequence={revision:number;scenario:Scenario;status:'current'|'stale';updated_at:string}
export function useWorkingSequence(projectId?:string,periodId?:string){
 const scope=projectId&&periodId?projectId+':'+periodId:''
 const scopeRef=useRef(scope);scopeRef.current=scope
 const generation=useRef(0)
 const [saved,setSaved]=useState<{scope:string;value:WorkingSequence|null}>({scope:'',value:null})
 const [mode,setModeState]=useState<{scope:string;detailed:boolean}>({scope:'',detailed:true})
 const [error,setError]=useState('')
 const value=saved.scope===scope?saved.value:null
 const detailed=mode.scope===scope?mode.detailed:localStorage.getItem('prosota-sequence:'+scope)!=='simple'
 const setDetailed=(enabled:boolean)=>{setModeState({scope,detailed:enabled});localStorage.setItem('prosota-sequence:'+scope,enabled?'detailed':'simple')}
 const refresh=useCallback(async()=>{
  if(!projectId||!periodId)return
  const request=++generation.current
  try{const {data}=await api.get<WorkingSequence|null>('/api/v1/simulations/working',{params:{project_id:projectId,schedule_period_id:periodId}})
   if(scopeRef.current===scope&&request===generation.current){setSaved(old=>old.scope===scope&&old.value?.revision===data?.revision&&old.value?.status===data?.status&&old.value?.updated_at===data?.updated_at?old:{scope,value:data});setError('')}
  }catch{if(scopeRef.current===scope&&request===generation.current){setSaved({scope,value:null});setError('Could not check the working sequence. Retry before detailed playback.')}}
 },[projectId,periodId,scope])
 useEffect(()=>{setError('');void refresh();window.addEventListener('focus',refresh);return()=>{generation.current++;window.removeEventListener('focus',refresh)}},[refresh])
 const install=(data:WorkingSequence)=>{generation.current++;setSaved({scope,value:data});setDetailed(true);setError('')}
 return {value,detailed,setDetailed,refresh,install,error,scenario:value?.status==='current'&&detailed?value.scenario:null}
}
