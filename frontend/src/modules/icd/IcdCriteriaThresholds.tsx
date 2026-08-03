import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { CriterionDimension, IcdCriterion } from './criteriaTypes'

interface IcdCriteriaThresholdsProps {
  projectId: string
}

const DIMENSIONS: { key: CriterionDimension; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'severity', label: 'Severity' },
  { key: 'quality_impact', label: 'Quality impact' },
]

const descInput = 'w-full border border-gray-200 dark:border-prosota-line rounded px-1.5 py-1 text-xs'

// Project-level, editable definitions of what each Priority/Severity/Quality
// Impact level means — all three are ordinal/categorical (unlike Risk's
// numeric probability/cost ranges), so this is just a level + label +
// narrative description per dimension. Standardises ratings across the team,
// mirroring the Risk module's Criteria & Thresholds panel.
export function IcdCriteriaThresholds({ projectId }: IcdCriteriaThresholdsProps) {
  const [open, setOpen] = useState(false)
  const [criteria, setCriteria] = useState<Record<CriterionDimension, IcdCriterion[]>>({
    priority: [], severity: [], quality_impact: [],
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || criteria.priority.length > 0) return
    setLoading(true)
    Promise.all(DIMENSIONS.map(d =>
      api.get<IcdCriterion[]>(`/api/v1/icd-criteria/${d.key}`, { params: { project_id: projectId } })
    ))
      .then(results => {
        setCriteria({
          priority: results[0].data.sort((a, b) => a.level - b.level),
          severity: results[1].data.sort((a, b) => a.level - b.level),
          quality_impact: results[2].data.sort((a, b) => a.level - b.level),
        })
      })
      .catch(() => setError('Failed to load criteria'))
      .finally(() => setLoading(false))
  }, [open, projectId, criteria.priority.length])

  const updateCriterion = async (dimension: CriterionDimension, c: IcdCriterion, description: string) => {
    const { data } = await api.patch<IcdCriterion>(`/api/v1/icd-criteria/criterion/${c.id}`, { description })
    setCriteria(prev => ({ ...prev, [dimension]: prev[dimension].map(x => x.id === c.id ? data : x) }))
  }

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg mb-6">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-prosota-muted"
      >
        Criteria &amp; Thresholds
        <span className="text-gray-400 dark:text-prosota-muted text-xs">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-prosota-line">
          {error && <p className="text-xs text-red-600 dark:text-red-400 mt-3">{error}</p>}
          {loading ? (
            <p className="text-xs text-gray-400 dark:text-prosota-muted mt-3">Loading…</p>
          ) : (
            <div className="grid grid-cols-3 gap-6 mt-3">
              {DIMENSIONS.map(d => (
                <div key={d.key}>
                  <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-2">{d.label}</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 dark:text-prosota-muted">
                        <th className="pb-1 pr-2">Level</th>
                        <th className="pb-1">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {criteria[d.key].map(c => (
                        <tr key={c.id} className="border-t border-gray-50 align-top">
                          <td className="py-1 pr-2 font-medium whitespace-nowrap">{c.label}</td>
                          <td className="py-1">
                            <textarea
                              defaultValue={c.description ?? ''}
                              rows={2}
                              onBlur={e => e.target.value !== (c.description ?? '') && updateCriterion(d.key, c, e.target.value)}
                              className={descInput}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
