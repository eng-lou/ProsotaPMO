import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { undoHistory } from '@/lib/undoHistory'
import type { PathPoint } from './paths'

export interface SiteObjectState {
  content_position: PathPoint; content_rotation: PathPoint; content_scale: PathPoint
  pivot: PathPoint|null; pivot_rotation: PathPoint|null; base_position: PathPoint|null; base_rotation: PathPoint|null
  base_content_position: PathPoint|null; base_content_rotation: PathPoint|null
}
export interface PathMotion { bind_origin?: PathPoint | null; path_id: string; start: string; speed: number; loop: boolean; orient: boolean; heading: number; animation_reference_speed: number }
export interface SiteItem {
  operation_inputs?: string[]
  path_motion?: PathMotion | null
  object_state?: SiteObjectState|null
  animation_playing?: boolean; animation_clip?: number; animation_speed?: number
  id: string; name: string; kind: 'fence' | 'context' | 'cabin' | 'tree' | 'person' | 'arrow' | 'asset' | 'shape' | 'array' | 'scatter'
  asset_id?: string | null
  generator_version: 1; up_axis: 'y' | 'z'; units: 'm'; position: PathPoint
  yaw: number; width: number; depth: number; height: number; color: string; locked: boolean
  rotation?: PathPoint; scale?: PathPoint
  activity_id: string | null; path_id: string | null; points: PathPoint[]; closed: boolean
  module_length: number; gate_start: number; gate_width: number
  zone_id?: string | null; curve_mode?: 'straight'|'curved'; panel_fit?: 'fit'|'trim'|'strict'
  tag?: string; finish?: 'default'|'water'; spacing?: number; count?: number; seed?: number
  placement_kind?: 'tree'|'person'|'context'|'cabin'|'arrow'|'asset'; align_to_path?: boolean; random_rotation?: boolean
  layout?: { footprint?: PathPoint[]; placements?: {position:PathPoint;yaw:number}[]; count?: number; panels?: { id: string; a: PathPoint; b: PathPoint }[]; length?: number; panel_count?: number; gate_width?: number } | null
}
export interface SiteScene { revision: number; items: SiteItem[] }
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
  const [placing, setPlacing] = useState(false)
  const [placement, setPlacement] = useState<{ point: PathPoint; serial: number } | null>(null)
  const transforms = useRef(new Map<string, Pick<SiteItem, 'position' | 'rotation' | 'scale' | 'object_state'>>())
  const [transformVersion, setTransformVersion] = useState(0)
  const current = useRef(scene), project = useRef(projectId), pending = useRef(false)
  project.current = projectId
  function accept(value: SiteScene) {
    // Freeze legacy bindings before any transform edits, then persist on the next save.
    value = {...value, items: value.items.map(item => item.path_motion && !item.path_motion.bind_origin
      ? {...item, path_motion: {...item.path_motion, bind_origin: {...item.position}}} : item)}
    current.current = value; setScene(value)
  }
  async function reload() {
    const id = projectId
    if (!id) return
    setReady(false)
    try {
      const { data } = await api.get<SiteScene>(`/api/v1/site-scenes/${id}`)
      if (project.current === id) { accept(data); setError(''); setReady(true) }
    } catch (error) { if (project.current === id) setError(siteError(error)) }
  }
  useEffect(() => { accept({ revision: 0, items: [] }); setDraft(null); setSelected(null); setPlacing(false); setPlacement(null); setError(''); setReady(false); void reload() }, [projectId])
  async function save(items: SiteItem[], label: string, effects?: { redo(): void; undo(): void }) {
    if (!projectId || pending.current || !ready) return
    const id = projectId, before = current.current.items.map(recipe)
    let after = items.map(recipe)
    const apply = async (expected: SiteItem[], next: SiteItem[], effect?: () => void) => {
      if (project.current !== id) throw new Error('Switch back to the original project')
      if (stableRecipe(current.current.items.map(recipe)) !== stableRecipe(expected)) throw new Error('Site scene changed. Reload before undoing this operation.')
      const { data } = await api.put<SiteScene>(`/api/v1/site-scenes/${id}`, {
        command_id: crypto.randomUUID(), expected_revision: current.current.revision, items: next,
      })
      if (project.current === id) { accept(data); setDraft(null); effect?.() }
    }
    pending.current = true; setBusy(true); setError('')
    try {
      await apply(before, after, effects?.redo)
      after = current.current.items.map(recipe)
      if (project.current === id) undoHistory.record({ label, undo: () => apply(after, before, effects?.undo), redo: () => apply(before, after, effects?.redo) })
    } catch (error) { if (project.current === id) setError(siteError(error)); throw error }
    finally { pending.current = false; setBusy(false) }
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
  const updateTransforms = (changes: Map<string, Pick<SiteItem, 'position' | 'rotation' | 'scale' | 'object_state'>>) => {
    for (const [id, transform] of changes) transforms.current.set(id, transform)
    setTransformVersion(v => v + 1)
  }
  return { scene, error, setError, ready, busy, draft, setDraft, selected, setSelected, save, reload,
    updateTransforms,
    placing, setPlacing, placement, place: (point: PathPoint) => { setPlacement({ point, serial: Date.now() }); setPlacing(false) } }
}
