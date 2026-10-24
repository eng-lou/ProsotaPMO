import { useEffect, useState } from 'react'
import { api } from './api'
import type { ActivityPickerOption } from '@/modules/scheduling/ActivityPicker'

export function useWbsOptions(projectId?: string, schedulePeriodId?: string) {
  const scope = `${projectId ?? ''}:${schedulePeriodId ?? ''}`
  const [result, setResult] = useState<{ scope: string; options: ActivityPickerOption[]; error: boolean } | null>(null)
  const [selection, setSelection] = useState({ scope, id: '' })
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!projectId || !schedulePeriodId) return
    const controller = new AbortController()
    setPending(true)
    setResult(null)
    api.get<ActivityPickerOption[]>('/api/v1/activities/wbs-options', {
      signal: controller.signal,
      params: { project_id: projectId, schedule_period_id: schedulePeriodId },
    }).then(({ data }) => {
      if (controller.signal.aborted) return
      setResult({ scope, options: data, error: false })
      setSelection(previous => previous.scope === scope && previous.id && !data.some(a => a.id === previous.id)
        ? { scope, id: '' } : previous)
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ scope, options: [], error: true })
    }).finally(() => {
      if (!controller.signal.aborted) setPending(false)
    })
    return () => controller.abort()
  }, [projectId, schedulePeriodId, scope, attempt])

  const current = result?.scope === scope ? result : null
  return {
    options: current?.options ?? [],
    loading: !!projectId && !!schedulePeriodId && (pending || !current),
    error: current?.error ?? false,
    retry: () => setAttempt(n => n + 1),
    selectedId: selection.scope === scope ? selection.id : '',
    select: (id: string) => setSelection({ scope, id }),
  }
}
