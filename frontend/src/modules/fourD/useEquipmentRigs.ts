import { useUndoRefresh } from '@/lib/useUndoRefresh'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { EquipmentRig } from './equipmentRig'

export function useEquipmentRigs(projectId?: string) {
  const undoRevision = useUndoRefresh()
  const [rigs, setRigs] = useState<EquipmentRig[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scope = useRef(projectId); scope.current = projectId
  const message = (e: any) => typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : e.message || 'Equipment operation failed'
  useEffect(() => {
    let cancelled = false
    setRigs([]); setError(null)
    if (projectId) api.get<EquipmentRig[]>('/api/v1/equipment-rigs/', { params: { project_id: projectId } })
      .then(r => { if (!cancelled) setRigs(r.data) }).catch(e => { if (!cancelled) setError(message(e)) })
    return () => { cancelled = true }
  }, [projectId, undoRevision])
  const save = async (rig: EquipmentRig) => {
    if (!projectId || busy) return false
    setBusy(true); setError(null)
    try {
      const { data } = rig.id ? await api.put<EquipmentRig>(`/api/v1/equipment-rigs/${rig.id}`, { name: rig.name, version: rig.version, definition: rig.definition })
        : await api.post<EquipmentRig>('/api/v1/equipment-rigs/', { project_id: projectId, model_ref: rig.model_ref, name: rig.name, definition: rig.definition })
      if (scope.current === projectId) setRigs(rows => [...rows.filter(r => r.model_ref !== data.model_ref), data])
      return true
    } catch (e) { setError(message(e)); return false } finally { setBusy(false) }
  }
  const remove = async (rig: EquipmentRig) => {
    setBusy(true); setError(null)
    try {
      await api.delete(`/api/v1/equipment-rigs/${rig.id}`)
      if (scope.current === projectId) setRigs(rows => rows.filter(r => r.id !== rig.id))
    } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  return { rigs, error, busy, save, remove }
}
