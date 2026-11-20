import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { loadRealisticMapping, saveRealisticMapping, type RealisticMaterialMap } from './realisticMaterials'
import { materialChanges, rebaseMaterials, type MaterialValues } from './materialSync'

// Keep the original browser cache as a recovery copy. Sync metadata stores the last
// acknowledged mapping, so offline changes (including deletions) survive reloads.
export function useProjectMaterials(projectId: string | undefined) {
  const [mapping, setMapping] = useState<RealisticMaterialMap>({})
  const [status, setStatus] = useState('Loading saved finishes...')
  const session = useRef<{ id: string; edit(next: RealisticMaterialMap): void; sync(): void } | null>(null)
  useEffect(() => {
    if (!projectId) { session.current = null; setMapping({}); setStatus(''); return }
    const id = projectId, key = 'prosota_material_sync_' + id
    let current: MaterialValues = loadRealisticMapping(id)
    const initial = { ...current }
    let base: MaterialValues | null = null, stopped = false, running = false, again = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try { const stored = localStorage.getItem(key); if (stored) base = JSON.parse(stored) } catch { /* legacy cache */ }
    const update = (value: MaterialValues) => { current = value; saveRealisticMapping(id, value as RealisticMaterialMap); if (!stopped) setMapping(value as RealisticMaterialMap) }
    const show = (text: string) => { if (!stopped) setStatus(text) }
    setMapping(current as RealisticMaterialMap)
    function remember() { localStorage.setItem(key, JSON.stringify(base)) }
    async function sync() {
      if (running) { again = true; return }
      running = true
      show('Saving finishes to project...')
      try {
        if (base === null) {
          const legacy = initial
          const { data } = await api.get<{mapping: MaterialValues | null}>(`/api/v1/projects/${id}/materials`)
          if (stopped) return
          let remote = data.mapping
          if (remote === null && Object.keys(legacy).length) {
            // The server only accepts a seed when no browser has migrated yet.
            const seeded = await api.patch<{mapping: MaterialValues}>(`/api/v1/projects/${id}/materials`, { seed: legacy })
            if (stopped) return
            remote = seeded.data.mapping
          }
          if (Object.keys(legacy).length) localStorage.setItem('prosota_material_backup_' + id, JSON.stringify(legacy))
          base = remote ?? {}
          update(rebaseMaterials(base, legacy, current))
          remember()
        }
        const sent = { ...current }, changes = materialChanges(base, sent)
        const response = Object.keys(changes).length
          ? await api.patch<{mapping: MaterialValues}>(`/api/v1/projects/${id}/materials`, { changes })
          : await api.get<{mapping: MaterialValues | null}>(`/api/v1/projects/${id}/materials`)
        if (stopped) return
        base = response.data.mapping ?? {}
        update(rebaseMaterials(base, sent, current))
        remember()
        again = Object.keys(materialChanges(base, current)).length > 0
        show(again ? 'Saving finishes to project...' : 'Finishes saved to project')
      } catch (error: any) {
        show(error?.response?.status === 409
          ? 'Finishes changed in another browser. This browser copy is retained; resolve the conflict before continuing.'
          : 'Finishes have not synced. This browser copy is retained. Retry when connected.')
        again = false
      } finally {
        running = false
        if (again && !stopped) { again = false; void sync() }
      }
    }
    const active = { id, sync: () => { void sync() }, edit(next: RealisticMaterialMap) {
      update(next); show('Saving finishes to project...')
      clearTimeout(timer); timer = setTimeout(() => { void sync() }, 400)
    } }
    session.current = active
    const refresh = () => { void sync() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    void sync()
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); if (session.current === active) session.current = null }
  }, [projectId])
  return { mapping, status, retry: () => session.current?.sync(), setMapping: (next: RealisticMaterialMap) => {
    const active = session.current; if (active && active.id === projectId) active.edit(next)
  } }
}

