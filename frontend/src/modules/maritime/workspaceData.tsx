import axios from 'axios'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { undoHistory } from '@/lib/undoHistory'
import { useProject } from '@/lib/ProjectContext'

export type AssetKind = 'berth' | 'crane' | 'truck' | 'yard' | 'gate' | 'vessel' | 'infrastructure'
export interface ElementRef { source_kind: 'ifc' | 'mesh' | 'ifc_split'; element_ref: string; element_label: string }
export interface Asset { id: string; name: string; kind: AssetKind; rate: number; capacity: number; initial_stock: number; hourly_cost: number; elements: ElementRef[]; resource_id: string | null; activity_id: string | null; notes: string }
export interface VesselCall { id: string; name: string; vessel_id: string; berth_id: string; crane_ids: string[]; arrival_hour: number; cargo_moves: number }
export interface Scenario { id: string; name: string; downtime: {asset_id: string; start_hour: number; duration_hours: number}[] }
export interface WorkOrder { id: string; name: string; asset_id: string; start_hour: number; duration_hours: number; cost: number; status: 'draft' | 'scheduled' | 'complete'; notes: string }
export interface Exercise { id: string; name: string; asset_id: string; hazard: string; required_actions: string[]; response_limit_seconds: number }
export interface WorkspaceDefinition { currency: string; source: 'synthetic' | 'user_entered'; start_at: string; horizon_hours: number; assets: Asset[]; calls: VesselCall[]; scenarios: Scenario[]; work_orders: WorkOrder[]; exercises: Exercise[] }
export interface RunSummary { id: string; version: number; kind: 'operations' | 'safety'; name: string; created_at: string }
export interface Sample { hour: number; handled: number; yard_moves: number; gate_cleared: number; waiting_vessels: number; operating_cost: number }
export interface FlowResult { status: string; vessel_completion_hour: number | null; terminal_completion_hour: number | null; cargo_moves: number; handled_moves: number; yard_moves: number; gate_cleared: number; total_cost: number; currency: string; elapsed_hours: number; assumptions: string[]; samples: Sample[]; calls: { id: string; name: string; arrival_hour: number; start_hour: number | null; finish_hour: number | null; remaining_moves: number }[]; equipment: {id: string; name: string; kind: string; productive_hours: number; moves: number; utilisation_elapsed_percent: number}[] }
export interface OperationRun extends RunSummary { kind: 'operations'; inputs: { plan: WorkspaceDefinition; scenario_id: string | null }; results: { baseline: FlowResult; scenario: FlowResult; completion_delay_hours: number | null; cost_change: number } }
export interface SafetyRun extends RunSummary { kind: 'safety'; inputs: { exercise: Exercise; asset: Asset }; results: { criteria: {action: string; completed: boolean; seconds: number | null; within_limit: boolean}[]; actions: {action: string; seconds: number}[]; required: number; completed: number; missed: string[]; in_order: boolean; first_response_seconds: number | null; timing_basis: string } }
export type SavedRun = OperationRun | SafetyRun
export interface ActiveAttempt { exercise: Exercise; asset: Asset; version: number; startedAt: number; actions: {action: string; seconds: number}[] }
export const maritimeRoot = '/maritime/workspace'
export const newAsset = (kind: AssetKind = 'crane'): Asset => ({id: crypto.randomUUID(), name: `New ${kind}`, kind, rate: 30, capacity: 1000, initial_stock: 0, hourly_cost: 0, elements: [], resource_id: null, activity_id: null, notes: ''})
export function starterPlan(): WorkspaceDefinition {
  const berth = {...newAsset('berth'), name: 'Berth 02'}, vessel = {...newAsset('vessel'), name: 'MV Horizon'}
  const a = {...newAsset(), name: 'QC-01', hourly_cost: 120}, b = {...newAsset(), name: 'QC-02', hourly_cost: 120}
  const truck = {...newAsset('truck'), name: 'Terminal truck fleet', rate: 90, hourly_cost: 60}
  const yard = {...newAsset('yard'), name: 'Yard A', capacity: 1500}
  const gate = {...newAsset('gate'), name: 'Outbound gates', rate: 90, hourly_cost: 30}
  return {currency: 'GBP', source: 'synthetic', start_at: '2026-10-19T08:00:00Z', horizon_hours: 72,
    assets: [berth, vessel, a, b, truck, yard, gate],
    calls: [{id: crypto.randomUUID(), name: 'Horizon discharge', vessel_id: vessel.id, berth_id: berth.id, crane_ids: [a.id,b.id], arrival_hour: 2, cargo_moves: 1200}],
    scenarios: [{id: crypto.randomUUID(), name: 'QC-02 outage', downtime: [{asset_id: b.id, start_hour: 8, duration_hours: 6}]}], work_orders: [],
    exercises: [{id: crypto.randomUUID(), name: 'Quayside lifting exercise', asset_id: b.id, hazard: 'Person enters lifting exclusion zone', required_actions: ['Identify hazard','Stop lift','Secure zone','Notify supervisor'], response_limit_seconds: 60}]}
}
export function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return detail.map(d => `${d.loc?.slice(1).join('.')}: ${d.msg}`).join('; ')
  }
  return error instanceof Error ? error.message : 'Request failed. Please retry.'
}

interface Context {
  plan: WorkspaceDefinition | null; version: number; dirty: boolean; busy: boolean; error: string | null
  setError: (message: string | null) => void; edit: (fn: (plan: WorkspaceDefinition) => WorkspaceDefinition) => void
  save: () => Promise<void>; reload: () => Promise<void>; runs: RunSummary[]; refreshRuns: () => Promise<void>
  run: (scenarioId?: string) => Promise<SavedRun | null>; endpoint: string
  attempt: ActiveAttempt | null; attemptSaving: boolean
  startAttempt: (exercise: Exercise) => void; recordAction: (action: string) => void
  restartAttempt: () => void; discardAttempt: () => void; finishAttempt: () => Promise<SavedRun | null>
  selectedAssetId: string; selectAsset: (id: string) => void
}
const WorkspaceContext = createContext<Context | null>(null)
export function MaritimeDataProvider({children}: {children: ReactNode}) {
  const {selectedProject} = useProject()
  const endpoint = `/api/v1/maritime/projects/${selectedProject!.id}`
  const [plan,setPlan] = useState<WorkspaceDefinition | null>(null), [version,setVersion] = useState(0)
  const planRef = useRef<WorkspaceDefinition | null>(null), undoOwner = useRef({})
  const replacePlan = useCallback((next: WorkspaceDefinition) => {planRef.current=next;setPlan(next)}, [])
  const [dirty,setDirty] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState<string | null>(null)
  const [runs,setRuns] = useState<RunSummary[]>([])
  const [attempt,setAttempt] = useState<ActiveAttempt | null>(null), [attemptSaving,setAttemptSaving] = useState(false)
  const [selectedAssetId,selectAsset] = useState('')
  const interactionState = useRef({busy,attempt})
  interactionState.current={busy,attempt}
  useEffect(()=>()=>undoHistory.remove(undoOwner.current),[])
  const refreshRuns = useCallback(async () => {setRuns((await api.get<RunSummary[]>(`${endpoint}/runs`)).data)}, [endpoint])
  const reload = useCallback(async () => {
    setBusy(true); setError(null)
    try { const r = await api.get<{version: number; definition: WorkspaceDefinition}>(`${endpoint}/workspace`); replacePlan(r.data.definition); undoHistory.remove(undoOwner.current); setVersion(r.data.version); setDirty(false); await refreshRuns() }
    catch(e) {setError(errorMessage(e))} finally {setBusy(false)}
  }, [endpoint,refreshRuns,replacePlan])
  useEffect(() => {void reload()}, [reload])
  useEffect(() => {const guard = (e: BeforeUnloadEvent) => {if(dirty || attempt){e.preventDefault(); e.returnValue = ''}}; window.addEventListener('beforeunload',guard); return () => window.removeEventListener('beforeunload',guard)},[dirty,attempt])
  const edit: Context['edit'] = fn => {
    const before = planRef.current
    if (!before || busy) return
    const after = fn(before)
    const restore = (value: WorkspaceDefinition) => {
      if (interactionState.current.busy || interactionState.current.attempt) throw new Error('Finish the current operation or exercise before undoing plan edits.')
      replacePlan(value); setDirty(true)
    }
    replacePlan(after); setDirty(true)
    // Use the existing ten-step history; immutable records share unchanged data.
    // Repeated typing in one input is a single edit, while button actions stay separate.
    const focused = document.activeElement
    const group = focused?.matches('input, textarea, select') ? focused : undefined
    undoHistory.record({label:'Maritime plan edit',owner:undoOwner.current,group,undo:()=>restore(before),redo:()=>restore(after)})
  }
  const save = async () => {
    if (!plan || busy) return
    if (attempt) {setError('Finish or discard the active exercise before saving plan changes.'); return}
    setBusy(true); setError(null)
    try {const r = await api.put<{version: number; definition: WorkspaceDefinition}>(`${endpoint}/workspace`,{version,definition: plan}); replacePlan(r.data.definition); setVersion(r.data.version); setDirty(false)}
    catch(e){setError(errorMessage(e))} finally {setBusy(false)}
  }
  const run = async (scenarioId?: string) => {
    if(busy) return null
    if(dirty || !version){setError('Save your changes before running a scenario.'); return null}
    setBusy(true); setError(null)
    try {const r = await api.post<SavedRun>(`${endpoint}/runs`,{version,scenario_id:scenarioId ?? null}); setRuns(rows=>[r.data,...rows].slice(0,100)); return r.data}
    catch(e){setError(errorMessage(e)); return null} finally {setBusy(false)}
  }
  const startAttempt = (exercise: Exercise) => {
    const asset = plan?.assets.find(a => a.id === exercise.asset_id)
    if (dirty || !version || busy || attempt || !asset) return
    selectAsset(asset.id)
    setAttempt({exercise: structuredClone(exercise), asset: structuredClone(asset), version, startedAt: Date.now(), actions: []})
  }
  const recordAction = (action: string) => {
    if (attemptSaving) return
    setAttempt(a => !a || !a.exercise.required_actions.includes(action) || a.actions.some(x => x.action === action) ? a : {
      ...a, actions: [...a.actions, {action, seconds: Math.max(0, Math.round((Date.now() - a.startedAt) / 10) / 100)}],
    })
  }
  const restartAttempt = () => {if (!attemptSaving) setAttempt(a => a ? {...a, startedAt: Date.now(), actions: []} : null)}
  const discardAttempt = () => {if (!attemptSaving) setAttempt(null)}
  const finishAttempt = async () => {
    if (!attempt || attemptSaving) return null
    setAttemptSaving(true); setError(null)
    try {
      const r = await api.post<SavedRun>(`${endpoint}/attempts`, {version: attempt.version, exercise_id: attempt.exercise.id, actions: attempt.actions})
      setAttempt(null)
      setRuns(rows=>[r.data,...rows].slice(0,100))
      return r.data
    } catch(e) {setError(errorMessage(e)); return null} finally {setAttemptSaving(false)}
  }
  return <WorkspaceContext.Provider value={{plan,version,dirty,busy,error,setError,edit,save,reload,runs,refreshRuns,run,endpoint,attempt,attemptSaving,startAttempt,recordAction,restartAttempt,discardAttempt,finishAttempt,selectedAssetId,selectAsset}}>{children}</WorkspaceContext.Provider>
}
export function useMaritime(){const c=useContext(WorkspaceContext); if(!c) throw new Error('Maritime provider missing'); return c}
