import { useEffect, useState } from 'react'
import { api } from './api'
import type { SchedulePeriod, ScheduleVariant } from '@/modules/scheduling/types'

const STORAGE_PREFIX = 'prosota_selected_schedule_variant:'

// Scheduling's own schedule-variant/schedule-period pair — parallel to
// frontend/src/lib/usePeriod.ts's Risk/Cost/ICD Period, but for Activity and
// its schedule-side siblings (docs/SCHEDULE_VARIANTS_PLAN.md, private docs
// repo). A project can have more than one schedule (Working Schedule,
// Recovery Schedule, ...) — this hook tracks the whole list plus whichever
// one is currently active, persisted per-project in sessionStorage (mirrors
// ProjectContext's own STORAGE_KEY pattern), defaulting to the master
// variant whenever nothing was saved yet or the saved one's since been
// deleted.
export function useActiveScheduleVariant(projectId: string | undefined) {
  const [variants, setVariants] = useState<ScheduleVariant[]>([])
  const [variant, setVariant] = useState<ScheduleVariant | null>(null)
  const [period, setPeriod] = useState<SchedulePeriod | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPeriodFor = async (v: ScheduleVariant) => {
    const { data: p } = await api.post<SchedulePeriod>('/api/v1/schedule-periods/bootstrap', null, {
      params: { schedule_variant_id: v.id },
    })
    setPeriod(p)
  }

  const selectVariant = async (v: ScheduleVariant) => {
    // Clears any error left over from an earlier failed bootstrap() — found
    // 2026-07-16 via a real P6 import: bootstrap's own try/catch sets error
    // to a generic "Failed to load schedule" and nothing ever cleared it
    // again, so a *subsequent, successful* selectVariant call (e.g.
    // switching into a schedule a P6 import just created) still left that
    // stale message on screen even though the new variant's own period had
    // loaded correctly.
    setError(null)
    setVariant(v)
    if (projectId) sessionStorage.setItem(STORAGE_PREFIX + projectId, v.id)
    await loadPeriodFor(v)
  }

  const refetchVariants = async (): Promise<ScheduleVariant[]> => {
    if (!projectId) return []
    const { data } = await api.get<ScheduleVariant[]>('/api/v1/schedule-variants/', { params: { project_id: projectId } })
    setVariants(data)
    return data
  }

  const bootstrap = async () => {
    if (!projectId) return
    try {
      setLoading(true)
      setError(null)
      // Lazily seeds the master (same as before this widget existed), then
      // pulls the full list for the picker.
      const { data: master } = await api.post<ScheduleVariant>('/api/v1/schedule-variants/bootstrap', null, {
        params: { project_id: projectId },
      })
      const list = await refetchVariants()

      const storedId = sessionStorage.getItem(STORAGE_PREFIX + projectId)
      const restored = storedId ? list.find(v => v.id === storedId) : undefined
      const active = restored ?? master
      setVariant(active)
      await loadPeriodFor(active)
    } catch {
      setError('Failed to load schedule')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const createVariant = async (name: string, variantType: string | null, duplicateFromVariantId?: string) => {
    const { data } = await api.post<ScheduleVariant>('/api/v1/schedule-variants/', {
      project_id: projectId, name, variant_type: variantType,
      duplicate_from_variant_id: duplicateFromVariantId ?? null,
    })
    await refetchVariants()
    await selectVariant(data)
    return data
  }

  const renameVariant = async (id: string, name: string, variantType: string | null) => {
    const { data } = await api.patch<ScheduleVariant>(`/api/v1/schedule-variants/${id}`, { name, variant_type: variantType })
    await refetchVariants()
    setVariant(prev => (prev?.id === id ? data : prev))
    return data
  }

  const deleteVariant = async (id: string) => {
    await api.delete(`/api/v1/schedule-variants/${id}`)
    const list = await refetchVariants()
    if (variant?.id === id) {
      const fallback = list.find(v => v.is_master) ?? list[0]
      if (fallback) await selectVariant(fallback)
    }
  }

  const promoteVariant = async (id: string) => {
    const { data } = await api.post<{ variant: ScheduleVariant; unmatched_codes: string[] }>(
      `/api/v1/schedule-variants/${id}/promote`
    )
    await refetchVariants()
    await selectVariant(data.variant)
    return data
  }

  // "Open a baseline as a working schedule" (docs/SCHEDULING_GAPS_PLAN.md
  // Phase 6) — forks a brand new, editable variant seeded from a baseline's
  // own captured snapshot, then switches to it, same as creating/promoting
  // any other variant above.
  const promoteBaselineToVariant = async (baselineId: string, name: string) => {
    const { data } = await api.post<{ variant: ScheduleVariant; relationships_from_baseline_snapshot: boolean }>(
      `/api/v1/schedule-baselines/${baselineId}/promote`, { name }
    )
    await refetchVariants()
    await selectVariant(data.variant)
    return data
  }

  return {
    variant, variants, period, loading, error,
    refetch: bootstrap, refetchVariants, selectVariant, createVariant, renameVariant, deleteVariant, promoteVariant,
    promoteBaselineToVariant,
  }
}
