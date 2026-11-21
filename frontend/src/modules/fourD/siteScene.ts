import type { SiteSectionBox } from './sectionBoxes'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { undoHistory } from '@/lib/undoHistory'
import type { PathPoint } from './paths'
import type { GeographicContext } from './geographicContext'
import type { GroundFinish } from './realisticMaterials'

export interface SiteObjectState {
  content_position: PathPoint; content_rotation: PathPoint; content_scale: PathPoint
  pivot: PathPoint|null; pivot_rotation: PathPoint|null; base_position: PathPoint|null; base_rotation: PathPoint|null
  base_content_position: PathPoint|null; base_content_rotation: PathPoint|null
}
export interface SitePathKey { date: string; progress: number; interpolation: 'linear' | 'smooth' | 'hold' }
export interface PathMotion { activity_id?: string | null; bind_origin?: PathPoint | null; path_id: string; start: string; speed: number; loop: boolean; orient: boolean; heading: number; animation_reference_speed: number; progress_keys?: SitePathKey[] }
export type FenceStyle = 'plain' | 'edge' | 'mesh' | 'hoarding'
export interface FenceOpening {
  kind: 'gap' | 'vehicle' | 'pedestrian' | 'turnstile'
  start: number; width: number; angle: number; board: string; lights: boolean
  pose?: number | null; pose_keys?: {date: string; value: number}[]
}
export interface Enclosure {
  style: FenceStyle; openings: FenceOpening[]; levels: number[]; perimeter_lights: boolean
}
export interface TowerCover {
  style: 'netted' | 'sheeted'; width: number; depth: number; height: number
  offset: { x: number; y: number; z: number }
}
export interface SiteItem {
  enclosure?: Enclosure | null
  tower_cover?: TowerCover | null
  work_sequence?: import("./workSequence").WorkSequence | null
  climbing_formwork?: import("./climbingFormwork").ClimbingFormwork | null
  load_handling?: import("./loadHandling").LoadHandling | null
  section_boxes?: SiteSectionBox[]
  illumination?: SiteIllumination | null
  motion_actions?: import('./workerActions').WorkerAction[]
  attachment?: import('./workerActions').SiteAttachment | null
  asset_part?: import('./assetParts').AssetPart | null
  assembly_id?: string | null
  assembly_name?: string | null
  rig_disabled?: boolean
  instance_overrides?: Record<number,import('./geographicContext').FeatureReplacement>
  geographic?: GeographicContext | null
  operation_inputs?: string[]
  path_motion?: PathMotion | null
  object_state?: SiteObjectState|null
  animation_playing?: boolean; animation_clip?: number; animation_speed?: number
  id: string; name: string; kind: 'fence' | 'context' | 'cabin' | 'tree' | 'person' | 'arrow' | 'asset' | 'shape' | 'array' | 'scatter' | 'geographic' | 'light'
  asset_id?: string | null
  generator_version: 1; up_axis: 'y' | 'z'; units: 'm'; position: PathPoint
  yaw: number; width: number; depth: number; height: number; color: string; locked: boolean
  rotation?: PathPoint; scale?: PathPoint
  activity_id: string | null; path_id: string | null; points: PathPoint[]; closed: boolean
  module_length: number; gate_start: number; gate_width: number
  zone_id?: string | null; curve_mode?: 'straight'|'curved'; panel_fit?: 'fit'|'trim'|'strict'
  tag?: string; finish?: 'default'|'water'|GroundFinish; spacing?: number; count?: number; seed?: number
  placement_kind?: 'tree'|'person'|'context'|'cabin'|'arrow'|'asset'; align_to_path?: boolean; random_rotation?: boolean
  layout?: { openings?: (FenceOpening & { a: PathPoint; b: PathPoint; level: number })[]; footprint?: PathPoint[]; placements?: {position:PathPoint;yaw:number}[]; count?: number; panels?: { id: string; a: PathPoint; b: PathPoint }[]; length?: number; panel_count?: number; gate_width?: number } | null
}
interface SavedEdit { id: string; label: string }
export interface SiteScene { revision: number; items: SiteItem[]; history?: {past: SavedEdit[]; future: SavedEdit[]} }
type Effects = { redo(): void; undo(): void }
export interface SiteIllumination {
  type: 'point' | 'sun' | 'spot' | 'area'
  intensity: number
  range: number
  beam_angle: number
  tilt: number
}

export function sitePlacementPoint(item: SiteItem | null, hit: PathPoint): PathPoint {
  return item?.kind === 'light' ? { ...hit, [item.up_axis]: hit[item.up_axis] + 3 } : hit
}
export type SiteTransformPatch = Partial<Pick<SiteItem, 'position' | 'rotation' | 'scale' | 'object_state' | 'attachment'>>
export const recipe = ({ layout: _layout, ...item }: SiteItem): SiteItem => ({ ...item, operation_inputs: item.operation_inputs ?? [], asset_id: item.asset_id ?? null,
  rotation: item.rotation ?? { x: 0, y: 0, z: 0 }, scale: item.scale ?? { x: 1, y: 1, z: 1 } })
function stableRecipe(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
}
export function siteError(error: any) {
  const detail = error?.response?.data?.detail
  return typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(x => x.msg).join('; ') : error?.message || 'Could not update the site scene'
}

export function useSiteScene(projectId: string | undefined) {
  const [scene, setScene] = useState<SiteScene>({ revision: 0, items: [] })
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<SiteItem | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detailSelection,setDetailSelection]=useState<{itemId:string;featureId?:string;surface?:string;instanceIndex?:number}|null>(null)
  const [placing, setPlacing] = useState(false)
  const [placement, setPlacement] = useState<{ point: PathPoint; serial: number } | null>(null)
  const transforms = useRef(new Map<string, SiteTransformPatch>())
  const [transformVersion, setTransformVersion] = useState(0)
  const current = useRef(scene), project = useRef(projectId), pending = useRef(false)
  project.current = projectId
  function accept(value: SiteScene) {
    // Freeze legacy bindings before any transform edits, then persist on the next save.
    value = {...value, items: value.items.map(item => item.path_motion && !item.path_motion.bind_origin
      ? {...item, path_motion: {...item.path_motion, bind_origin: {...item.position}}} : item)}
    current.current = value; setScene(value)
  }
  const owner = useRef({})
  const generation = useRef(0)
  const inProject = (id: string, version: number) => generation.current === version && project.current === id
  function savedAction(id: string, entry: SavedEdit, effects?: Effects) {
    const version = generation.current
    let retry: { direction: 'undo' | 'redo'; revision: number; command: string } | undefined
    async function travel(direction: 'undo' | 'redo') {
      if (!inProject(id, version) || pending.current) throw new Error('Wait for the current site operation to finish.')
      if (!retry || retry.direction !== direction || retry.revision !== current.current.revision) {
        retry = { direction, revision: current.current.revision, command: crypto.randomUUID() }
      }
      pending.current = true; setBusy(true)
      try {
        const {data} = await api.post<SiteScene>(`/api/v1/site-scenes/${id}/history/${direction}`, {
          command_id: retry.command, expected_revision: retry.revision, action_id: entry.id,
        })
        if (inProject(id, version)) { accept(data); setDraft(null); effects?.[direction]() }
        retry = undefined
      } finally { if (inProject(id, version)) { pending.current = false; setBusy(false) } }
    }
    return { owner: owner.current, savedId: entry.id, label: entry.label, undo: () => travel('undo'), redo: () => travel('redo') }
  }
  async function reload() {
    const id = projectId, version = generation.current
    if (!id || pending.current) return
    setReady(false)
    try {
      const { data } = await api.get<SiteScene>(`/api/v1/site-scenes/${id}`)
      if (inProject(id, version)) {
        setReady(true)
        if (data.revision < current.current.revision) return
        accept(data); setError('')
        if (data.history) undoHistory.restore(owner.current, data.history.past.map(e => savedAction(id,e)), data.history.future.map(e => savedAction(id,e)))
      }
    } catch (error) { if (inProject(id, version)) setError(siteError(error)) }
  }
  useEffect(() => {
    pending.current = false; setBusy(false)
    accept({ revision: 0, items: [] }); setDraft(null); setSelected(null); setPlacing(false); setPlacement(null); setError(''); setReady(false)
    void reload()
    return () => { generation.current++; undoHistory.remove(owner.current) }
  }, [projectId])
  async function save(items: SiteItem[] | ((currentItems: SiteItem[]) => SiteItem[]), label: string, effects?: Effects) {
    if (!projectId || pending.current || undoHistory.busy || !ready) return false
    const id = projectId, version = generation.current, before = current.current.items.map(recipe), command = crypto.randomUUID()
    const after = (typeof items === 'function' ? items(current.current.items) : items).map(recipe)
    async function put(next: SiteItem[], command_id: string, editLabel?: string) {
      const { data } = await api.put<SiteScene>(`/api/v1/site-scenes/${id}`, {
        command_id, expected_revision: current.current.revision, items: next,
        ...(editLabel && current.current.history ? {label: editLabel.slice(0,512)} : {}),
      })
      if (inProject(id, version)) { accept(data); setDraft(null) }
      return data
    }
    pending.current = true; setBusy(true); setError('')
    undoHistory.pending++; undoHistory.emit()
    try {
      const data = await put(after, command, label)
      if (!inProject(id, version)) return false
      effects?.redo()
      const saved = data.history?.past.find(entry => entry.id === command)
      if (saved) undoHistory.record(savedAction(id, saved, effects))
      if (!data.history) {
        // Allow a rolling deployment where the API still uses the older contract.
        const stored = data.items.map(recipe)
        const apply = async (expected: SiteItem[], next: SiteItem[], effect?: () => void) => {
          if (!inProject(id, version) || stableRecipe(current.current.items.map(recipe)) !== stableRecipe(expected)) throw new Error('Site scene changed. Reload before undoing this operation.')
          await put(next, crypto.randomUUID())
          if (inProject(id, version)) effect?.()
        }
        undoHistory.record({owner: owner.current, label, undo: () => apply(stored, before, effects?.undo), redo: () => apply(before, stored, effects?.redo)})
      }
      return true
    } catch (error) { if (inProject(id, version)) setError(siteError(error)); throw error }
    finally {
      undoHistory.pending--; undoHistory.emit()
      if (inProject(id, version)) { pending.current = false; setBusy(false) }
    }
  }
  useEffect(() => { transforms.current.clear() }, [projectId])
  useEffect(() => {
    if (!ready || busy || transforms.current.size === 0) return
    const timer = window.setTimeout(() => {
      if (pending.current) { setTransformVersion(v => v + 1); return }
      const changes = new Map(transforms.current)
      transforms.current.clear()
      void save(current.current.items.map(item => item.locked ? item : { ...item, ...changes.get(item.id) }), 'Transform objects').catch(() => {})
    }, 350)
    return () => window.clearTimeout(timer)
  }, [transformVersion, busy, ready, projectId])
  const updateTransforms = (changes: Map<string, SiteTransformPatch>) => {
    for (const [id, transform] of changes) transforms.current.set(id, transform)
    setTransformVersion(v => v + 1)
  }
  useEffect(()=>{setDetailSelection(old=>old?.itemId===selected?old:null)},[projectId,selected])
  return { scene, error, setError, ready, busy, draft, setDraft, selected, setSelected, save, reload, detailSelection,setDetailSelection,
    updateTransforms,
    placing, setPlacing, placement, place: (point: PathPoint) => { setPlacement({ point, serial: Date.now() }); setPlacing(false) } }
}
