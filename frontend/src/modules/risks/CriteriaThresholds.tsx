import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { RiskImpactCriterion, RiskProbabilityCriterion } from './criteriaTypes'

interface CriteriaThresholdsProps {
  projectId: string
}

const cellInput = 'w-20 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-1 text-xs'

// Project-level, editable definitions of what each probability/impact level means
// (e.g. "Medium probability = 25-50%"). Standardises risk ratings across the team —
// per PMBOK7/Rita Mulcahy's risk management plan concept. Matches the prototype's
// Criteria & Thresholds tab, but scoped to the whole project rather than per-risk.
export function CriteriaThresholds({ projectId }: CriteriaThresholdsProps) {
  const [open, setOpen] = useState(false)
  const [probability, setProbability] = useState<RiskProbabilityCriterion[]>([])
  const [impact, setImpact] = useState<RiskImpactCriterion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || probability.length > 0) return
    setLoading(true)
    Promise.all([
      api.get<RiskProbabilityCriterion[]>('/api/v1/risk-criteria/probability', { params: { project_id: projectId } }),
      api.get<RiskImpactCriterion[]>('/api/v1/risk-criteria/impact', { params: { project_id: projectId } }),
    ])
      .then(([p, i]) => {
        setProbability(p.data.sort((a, b) => a.level - b.level))
        setImpact(i.data.sort((a, b) => a.level - b.level))
      })
      .catch(() => setError('Failed to load criteria'))
      .finally(() => setLoading(false))
  }, [open, projectId, probability.length])

  const updateProbability = async (c: RiskProbabilityCriterion, patch: Partial<RiskProbabilityCriterion>) => {
    const { data } = await api.patch<RiskProbabilityCriterion>(`/api/v1/risk-criteria/probability/${c.id}`, patch)
    setProbability(prev => prev.map(p => p.id === c.id ? data : p))
  }

  const updateImpact = async (c: RiskImpactCriterion, patch: Partial<RiskImpactCriterion>) => {
    const { data } = await api.patch<RiskImpactCriterion>(`/api/v1/risk-criteria/impact/${c.id}`, patch)
    setImpact(prev => prev.map(i => i.id === c.id ? data : i))
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
            <div className="grid grid-cols-2 gap-6 mt-3">
              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-2">Probability criteria</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 dark:text-prosota-muted">
                      <th className="pb-1">Level</th>
                      <th className="pb-1">Min</th>
                      <th className="pb-1">Max</th>
                      <th className="pb-1">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {probability.map(c => (
                      <tr key={c.id} className="border-t border-gray-50">
                        <td className="py-1 font-medium">{c.label}</td>
                        <td className="py-1">
                          <input
                            type="number" min={0} max={1} step={0.01}
                            defaultValue={c.min_probability}
                            onBlur={e => e.target.value !== c.min_probability && updateProbability(c, { min_probability: e.target.value })}
                            className={cellInput}
                          />
                        </td>
                        <td className="py-1">
                          <input
                            type="number" min={0} max={1} step={0.01}
                            defaultValue={c.max_probability}
                            onBlur={e => e.target.value !== c.max_probability && updateProbability(c, { max_probability: e.target.value })}
                            className={cellInput}
                          />
                        </td>
                        <td className="py-1 text-gray-500 dark:text-prosota-muted">{c.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-2">Impact criteria</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 dark:text-prosota-muted">
                      <th className="pb-1">Level</th>
                      <th className="pb-1">Cost £</th>
                      <th className="pb-1">Schedule (days)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impact.map(c => (
                      <tr key={c.id} className="border-t border-gray-50">
                        <td className="py-1 font-medium">{c.label}</td>
                        <td className="py-1 whitespace-nowrap">
                          <input
                            type="number"
                            defaultValue={c.min_cost ?? ''}
                            onBlur={e => e.target.value !== (c.min_cost ?? '') && updateImpact(c, { min_cost: e.target.value === '' ? null : e.target.value })}
                            className={cellInput}
                          />
                          {' – '}
                          <input
                            type="number"
                            defaultValue={c.max_cost ?? ''}
                            onBlur={e => e.target.value !== (c.max_cost ?? '') && updateImpact(c, { max_cost: e.target.value === '' ? null : e.target.value })}
                            className={cellInput}
                          />
                        </td>
                        <td className="py-1 whitespace-nowrap">
                          <input
                            type="number"
                            defaultValue={c.min_schedule_days ?? ''}
                            onBlur={e => e.target.value !== String(c.min_schedule_days ?? '') && updateImpact(c, { min_schedule_days: e.target.value === '' ? null : Number(e.target.value) })}
                            className={cellInput}
                          />
                          {' – '}
                          <input
                            type="number"
                            defaultValue={c.max_schedule_days ?? ''}
                            onBlur={e => e.target.value !== String(c.max_schedule_days ?? '') && updateImpact(c, { max_schedule_days: e.target.value === '' ? null : Number(e.target.value) })}
                            className={cellInput}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
