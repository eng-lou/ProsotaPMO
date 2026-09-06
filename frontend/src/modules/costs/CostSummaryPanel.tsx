import type { CostElement } from './types'

interface CostSummaryPanelProps {
  elements: CostElement[]
  gfaM2: string | null
  spaceCount: number | null
}

function formatCurrency(value: number) {
  return value < 0 ? `-£${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `£${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function effectiveBudget(el: CostElement): number {
  const raw = el.element_type === 'percentage' ? el.computed_budget : el.budget
  return raw !== null ? Number(raw) : 0
}

function effectiveForecast(el: CostElement): number {
  const raw = el.element_type === 'percentage' ? el.computed_forecast : el.forecast
  return raw !== null ? Number(raw) : 0
}

function effectiveActuals(el: CostElement): number {
  const raw = el.element_type === 'percentage' ? el.computed_actuals : el.actuals
  return raw !== null ? Number(raw) : 0
}

// Pure client-side aggregation over the already-loaded elements list — same
// complexity as Risk/ICD's KPI strips, no new endpoints. £/m² and £/Space only
// render when the project has GFA/space count set (both optional).
export function CostSummaryPanel({ elements, gfaM2, spaceCount }: CostSummaryPanelProps) {
  const totalBudget = elements.reduce((sum, el) => sum + effectiveBudget(el), 0)

  const byGroup = new Map<string, number>()
  for (const el of elements) {
    const key = el.element_group ?? '(ungrouped)'
    byGroup.set(key, (byGroup.get(key) ?? 0) + effectiveBudget(el))
  }
  const groupRows = [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))

  // Budget vs Forecast (EAC): Budget here is the live, continuously-revised
  // estimate total (2026-09-03, per Maro: "the budget field... is a forecast");
  // Forecast (EAC) is the performance-projected figure, computed off whichever
  // Cost Baseline is assigned (see app/services/cost_element.py's bac/EAC
  // resolution) and updates live as soon as % complete/actuals are entered.
  const totalForecast = elements.reduce((sum, el) => sum + effectiveForecast(el), 0)
  const forecastVariance = totalForecast - totalBudget
  const forecastVariancePct = totalBudget !== 0 ? (forecastVariance / totalBudget) * 100 : null

  const topVarianceDrivers = elements
    .filter(el => el.variance !== null)
    .map(el => ({ el, variance: Number(el.variance) }))
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, 5)

  // Cost Performance (CPI) — rolled up from summed AC/EV, never averaged
  // per-element cpi values directly (same rule as SPI above and
  // rollup_evm_from_totals's own backend docstring: a $100 line at CPI 0.5
  // next to a $1M line at CPI 1.0 rolls up to ~1.0, the real cost-driver,
  // not a misleading (0.5+1.0)/2). ev is reconstructed as cv+ac rather
  // than read from el.ev directly, since that field is schedule-side-only
  // (null for a manual fixed/percentage element with no linked activity)
  // — cv (=ev-ac) is populated for every element with real progress,
  // schedule-linked or not, so it already carries the same ev cv itself
  // was computed from server-side.
  const costEvmElements = elements.filter(el => el.cv !== null)
  const totalAc = costEvmElements.reduce((sum, el) => sum + effectiveActuals(el), 0)
  const totalEvCost = costEvmElements.reduce((sum, el) => sum + (Number(el.cv) + effectiveActuals(el)), 0)
  const projectCpi = totalAc !== 0 ? totalEvCost / totalAc : null
  const projectCv = totalEvCost - totalAc

  const gfa = gfaM2 !== null ? Number(gfaM2) : null

  // Schedule Performance (SPI) — only elements with a real time-phased PV exist
  // (schedule-linked, scheduled — i.e. their linked activity has live
  // start/finish) contribute; summed the same way Budget vs Forecast is, not a
  // separate endpoint. See app/services/cost_element.py's _schedule_evm
  // (Resources module, Phase 3).
  const scheduleLinked = elements.filter(el => el.pv !== null && el.ev !== null)
  const totalPv = scheduleLinked.reduce((sum, el) => sum + Number(el.pv), 0)
  const totalEv = scheduleLinked.reduce((sum, el) => sum + Number(el.ev), 0)
  const projectSpi = totalPv !== 0 ? totalEv / totalPv : null
  const projectSv = totalEv - totalPv

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-4 sticky top-0">
      <div className="font-semibold text-sm mb-3 pb-2 border-b border-gray-100 dark:border-prosota-line">Cost Summary</div>

      {(gfa || spaceCount) && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {gfa && (
            <div className="bg-gray-50 dark:bg-prosota-panel2 rounded-md p-2.5 text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-prosota-paper">{formatCurrency(totalBudget / gfa)}</div>
              <div className="text-xs text-gray-400 dark:text-prosota-muted">per m² GFA</div>
            </div>
          )}
          {spaceCount && (
            <div className="bg-gray-50 dark:bg-prosota-panel2 rounded-md p-2.5 text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-prosota-paper">{formatCurrency(totalBudget / spaceCount)}</div>
              <div className="text-xs text-gray-400 dark:text-prosota-muted">per Space</div>
            </div>
          )}
        </div>
      )}

      <div className="text-xs mb-3">
        {groupRows.map(([group, sum]) => (
          <div key={group} className="flex justify-between py-1 border-b border-gray-50">
            <span className="text-gray-500 dark:text-prosota-muted">{group}</span>
            <span className="font-medium">{formatCurrency(sum)}</span>
          </div>
        ))}
        <div className="flex justify-between py-1.5 border-t-2 border-gray-200 dark:border-prosota-line mt-1 font-semibold">
          <span>Total Budget</span>
          <span>{formatCurrency(totalBudget)}</span>
        </div>
      </div>

      <div className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide mb-2 pt-2 border-t border-gray-100 dark:border-prosota-line">Budget vs Forecast</div>
      <div className={`rounded-md p-2.5 text-xs mb-3 ${forecastVariance > 0 ? 'bg-orange-50 border border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30' : forecastVariance < 0 ? 'bg-green-50 border border-green-200 dark:bg-green-500/10 dark:border-green-500/30' : 'bg-gray-50 dark:bg-prosota-panel2 border border-gray-200 dark:border-prosota-line'}`}>
        <div className="flex justify-between mb-1">
          <span>Budget</span>
          <span className="font-medium">{formatCurrency(totalBudget)}</span>
        </div>
        <div className="flex justify-between mb-1">
          <span>Forecast (EAC)</span>
          <span className="font-medium">{formatCurrency(totalForecast)}</span>
        </div>
        <div className="flex justify-between pt-1 border-t border-gray-200 dark:border-prosota-line font-semibold">
          <span>{forecastVariance > 0 ? 'Forecast Overrun' : forecastVariance < 0 ? 'Forecast Saving' : 'On Track'}</span>
          <span>{formatCurrency(forecastVariance)}{forecastVariancePct !== null ? ` (${forecastVariance >= 0 ? '+' : ''}${forecastVariancePct.toFixed(1)}%)` : ''}</span>
        </div>
      </div>

      {costEvmElements.length > 0 && (
        <>
          <div
            className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide mb-2 pt-2 border-t border-gray-100 dark:border-prosota-line"
            title="Only elements with real progress (% Complete and Actuals entered) contribute."
          >
            Cost Performance (CPI)
          </div>
          <div className={`rounded-md p-2.5 text-xs mb-3 ${projectCpi !== null && projectCpi < 1 ? 'bg-orange-50 border border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30' : 'bg-green-50 border border-green-200 dark:bg-green-500/10 dark:border-green-500/30'}`}>
            <div className="flex justify-between mb-1">
              <span>Earned Value (EV)</span>
              <span className="font-medium">{formatCurrency(totalEvCost)}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span>Actual Cost (AC)</span>
              <span className="font-medium">{formatCurrency(totalAc)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-gray-200 dark:border-prosota-line font-semibold">
              <span>CPI {projectCpi !== null && (projectCpi >= 1 ? '(under budget)' : '(over budget)')}</span>
              <span>{projectCpi !== null ? projectCpi.toFixed(2) : '—'} ({projectCv >= 0 ? '+' : ''}{formatCurrency(projectCv)})</span>
            </div>
          </div>
        </>
      )}

      {scheduleLinked.length > 0 && (
        <>
          <div
            className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide mb-2 pt-2 border-t border-gray-100 dark:border-prosota-line"
            title="Only resource-loaded, scheduled activities contribute — see the Resources tab on an activity in Scheduling."
          >
            Schedule Performance (SPI)
          </div>
          <div className={`rounded-md p-2.5 text-xs mb-3 ${projectSpi !== null && projectSpi < 1 ? 'bg-orange-50 border border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30' : 'bg-green-50 border border-green-200 dark:bg-green-500/10 dark:border-green-500/30'}`}>
            <div className="flex justify-between mb-1">
              <span>Planned Value (PV)</span>
              <span className="font-medium">{formatCurrency(totalPv)}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span>Earned Value (EV)</span>
              <span className="font-medium">{formatCurrency(totalEv)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-gray-200 dark:border-prosota-line font-semibold">
              <span>SPI {projectSpi !== null && (projectSpi >= 1 ? '(ahead)' : '(behind)')}</span>
              <span>{projectSpi !== null ? projectSpi.toFixed(2) : '—'} ({projectSv >= 0 ? '+' : ''}{formatCurrency(projectSv)})</span>
            </div>
          </div>
        </>
      )}

      {topVarianceDrivers.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide mb-2">Top Variance Drivers</div>
          <div className="text-xs">
            {topVarianceDrivers.map(({ el, variance }) => (
              <div key={el.id} className="flex justify-between py-1 border-b border-gray-50">
                <span>{el.description}</span>
                <span className={variance >= 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-green-600 font-medium'}>
                  {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
