import { useState } from 'react'
import { api } from '@/lib/api'
import type { CostVarianceCriterion } from './criteriaTypes'

interface CostVarianceThresholdsProps {
  criteria: CostVarianceCriterion[]
  onUpdated: (updated: CostVarianceCriterion) => void
}

const cellInput = 'w-20 border border-gray-200 dark:border-prosota-line rounded px-1.5 py-1 text-xs'
const descInput = 'w-full border border-gray-200 dark:border-prosota-line rounded px-1.5 py-1 text-xs'

// Project-level, editable definitions of what each variance band means (e.g.
// "Over Budget = more than 5% above the Rev A baseline"). Drives the computed
// variance-severity badge shown against each cost element (in CostPlan.tsx) —
// same numeric-range pattern as Risk's Impact Criteria, applied to variance %
// instead. Criteria are lifted up to CostPlan so an edit here immediately
// changes which badge every row shows, rather than being a disconnected
// reference panel.
export function CostVarianceThresholds({ criteria, onUpdated }: CostVarianceThresholdsProps) {
  const [open, setOpen] = useState(false)

  const updateCriterion = async (c: CostVarianceCriterion, patch: Partial<CostVarianceCriterion>) => {
    const { data } = await api.patch<CostVarianceCriterion>(`/api/v1/cost-variance-criteria/${c.id}`, patch)
    onUpdated(data)
  }

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg mb-6">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-prosota-muted"
      >
        Variance Thresholds
        <span className="text-gray-400 dark:text-prosota-muted text-xs">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-prosota-line">
          <table className="w-full text-xs mt-3">
            <thead>
              <tr className="text-left text-gray-400 dark:text-prosota-muted">
                <th className="pb-1">Band</th>
                <th className="pb-1">Min %</th>
                <th className="pb-1">Max %</th>
                <th className="pb-1">Description</th>
              </tr>
            </thead>
            <tbody>
              {criteria.map(c => (
                <tr key={c.id} className="border-t border-gray-50">
                  <td className="py-1 font-medium whitespace-nowrap">{c.label}</td>
                  <td className="py-1">
                    <input
                      type="number" step={0.5}
                      defaultValue={c.min_pct ?? ''}
                      onBlur={e => e.target.value !== (c.min_pct ?? '') && updateCriterion(c, { min_pct: e.target.value === '' ? null : e.target.value })}
                      className={cellInput}
                    />
                  </td>
                  <td className="py-1">
                    <input
                      type="number" step={0.5}
                      defaultValue={c.max_pct ?? ''}
                      onBlur={e => e.target.value !== (c.max_pct ?? '') && updateCriterion(c, { max_pct: e.target.value === '' ? null : e.target.value })}
                      className={cellInput}
                    />
                  </td>
                  <td className="py-1">
                    <textarea
                      rows={2}
                      defaultValue={c.description ?? ''}
                      onBlur={e => e.target.value !== (c.description ?? '') && updateCriterion(c, { description: e.target.value === '' ? null : e.target.value })}
                      className={descInput}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
