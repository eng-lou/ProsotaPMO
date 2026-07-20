import { useCallback, useEffect, useState } from 'react'
import type { IndicatorValue, UdfDataType, UdfEntityType, UserDefinedFieldDefinition, UserDefinedFieldValue } from '@/modules/scheduling/types'
import { api } from './api'

// P6-style User Defined Fields (2026-07-07, per Maro — docs/SCHEDULING_GAPS_PLAN.md
// Phase 9): a project-scoped custom-field definition system (create once per
// project/entity type), plus per-record values, surfaced as an inline-editable
// "(UDF)" column in each entity's own grid. One definitions list per
// (projectId, entityType); values are bulk-fetched separately for whichever
// record ids the host grid currently has on screen.
export function useUserDefinedFieldDefinitions(projectId: string | undefined, entityType: UdfEntityType) {
  const [definitions, setDefinitions] = useState<UserDefinedFieldDefinition[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const { data } = await api.get<UserDefinedFieldDefinition[]>('/api/v1/user-defined-fields/definitions', {
        params: { project_id: projectId, entity_type: entityType },
      })
      setDefinitions(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, entityType])

  const create = async (name: string, dataType: UdfDataType) => {
    await api.post('/api/v1/user-defined-fields/definitions', {
      project_id: projectId, entity_type: entityType, name, data_type: dataType,
    })
    await load()
  }

  const update = async (definitionId: string, changes: { name?: string; data_type?: UdfDataType }) => {
    await api.patch(`/api/v1/user-defined-fields/definitions/${definitionId}`, changes)
    await load()
  }

  const remove = async (definitionId: string) => {
    await api.delete(`/api/v1/user-defined-fields/definitions/${definitionId}`)
    await load()
  }

  return { definitions, loading, create, update, remove, refetch: load }
}

function valueKey(fieldDefinitionId: string, recordId: string): string {
  return `${fieldDefinitionId}:${recordId}`
}

export type UdfValuePayload =
  | { value_text: string }
  | { value_number: string }
  | { value_date: string }
  | { value_indicator: IndicatorValue }
  | { value_text: null; value_number: null; value_date: null; value_indicator: null }

// Bulk-fetches values for a specific set of definitions x records (a grid
// page's own currently-visible rows), keyed for O(1) per-cell lookup —
// call refetch whenever the visible record id set or the definitions
// themselves change.
export function useUserDefinedFieldValues(definitions: UserDefinedFieldDefinition[], recordIds: string[]) {
  const [values, setValues] = useState<Map<string, UserDefinedFieldValue>>(new Map())

  const load = async () => {
    if (definitions.length === 0 || recordIds.length === 0) {
      setValues(new Map())
      return
    }
    const { data } = await api.post<UserDefinedFieldValue[]>('/api/v1/user-defined-fields/values/bulk-fetch', {
      field_definition_ids: definitions.map(d => d.id), record_ids: recordIds,
    })
    setValues(new Map(data.map(v => [valueKey(v.field_definition_id, v.record_id), v])))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitions.map(d => d.id).join(','), recordIds.join(',')])

  // useCallback, keyed on `values` (2026-07-17 perf fix, per a real bug
  // caught wiring Scheduling.tsx's own "group by a UDF" feature) — this
  // used to be a plain closure, a brand-new function reference every
  // render regardless of whether `values` itself had actually changed.
  // Harmless for a plain per-cell read, but Scheduling.tsx's own grouped-
  // view useMemo needs to depend on getValue to recompute when a UDF value
  // actually changes — an unstable reference there would either force that
  // memo to recompute on literally every render (defeating the whole point
  // of memoizing it) or, if the lint warning were suppressed instead,
  // silently go stale whenever `values` changed without some *other*
  // dependency also changing. Keying the callback on `values` gives a
  // stable reference across renders where nothing here actually changed,
  // and a fresh one exactly when it should.
  const getValue = useCallback((fieldDefinitionId: string, recordId: string): UserDefinedFieldValue | undefined =>
    values.get(valueKey(fieldDefinitionId, recordId)), [values])

  const setValue = async (fieldDefinitionId: string, recordId: string, payload: UdfValuePayload) => {
    const { data } = await api.put<UserDefinedFieldValue>(
      `/api/v1/user-defined-fields/values/${fieldDefinitionId}/${recordId}`, payload
    )
    setValues(prev => new Map(prev).set(valueKey(fieldDefinitionId, recordId), data))
  }

  return { getValue, setValue, refetch: load }
}
