import { COST_ELEMENT_STATUS_LABELS, type CostElement } from './types'

function formatCurrency(value: string | null) {
  if (value === null) return '—'
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString()}` : `£${n.toLocaleString()}`
}

interface CostPrintViewProps {
  mode: 'list' | 'detail'
  elements: CostElement[]
  projectName: string
}

// A dedicated printable rendering, shown only via @media print (see index.css
// .print-only). 'list' mirrors the on-screen table; 'detail' is a full-detail
// report per element (scope note, variance commentary, EVM, QS sign-off).
export function CostPrintView({ mode, elements, projectName }: CostPrintViewProps) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="print-only p-8">
      <div className="mb-6 flex items-baseline justify-between border-b border-gray-300 pb-3">
        <div>
          <h1 className="text-xl font-bold">{projectName} — Cost Plan</h1>
          <p className="text-sm text-gray-500">{mode === 'list' ? 'Cost Plan (as shown)' : 'Full detail'} · {elements.length} element{elements.length === 1 ? '' : 's'}</p>
        </div>
        <p className="text-xs text-gray-400">Printed {printedAt}</p>
      </div>

      {mode === 'list' ? (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left border-b-2 border-gray-400">
              <th className="py-1.5 pr-2">Code</th>
              <th className="py-1.5 pr-2">Description</th>
              <th className="py-1.5 pr-2">Group</th>
              <th className="py-1.5 pr-2">Status</th>
              <th className="py-1.5 pr-2">Budget</th>
              <th className="py-1.5 pr-2">Variance</th>
            </tr>
          </thead>
          <tbody>
            {elements.map(el => {
              const isPct = el.element_type === 'percentage'
              const budget = isPct ? el.computed_budget : el.budget
              return (
                <tr key={el.id} className="border-b border-gray-200">
                  <td className="py-1 pr-2 font-mono">{el.code}</td>
                  <td className="py-1 pr-2">{el.description}</td>
                  <td className="py-1 pr-2">{el.element_group ?? '—'}</td>
                  <td className="py-1 pr-2">{el.status ? COST_ELEMENT_STATUS_LABELS[el.status] : '—'}</td>
                  <td className="py-1 pr-2">{formatCurrency(budget)}</td>
                  <td className="py-1 pr-2">{formatCurrency(el.variance)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <div className="space-y-8">
          {elements.map(el => {
            const isPct = el.element_type === 'percentage'
            const budget = isPct ? el.computed_budget : el.budget
            const actuals = isPct ? el.computed_actuals : el.actuals
            const forecast = isPct ? el.computed_forecast : el.forecast
            return (
              <div key={el.id} style={{ pageBreakInside: 'avoid' }} className="border-b border-gray-300 pb-6">
                <h2 className="text-base font-bold">{el.code} · {el.description}</h2>
                <p className="text-xs text-gray-500 mb-3">
                  {el.element_group ?? '—'} · {el.status ? COST_ELEMENT_STATUS_LABELS[el.status] : '—'} · Owner: {el.cost_owner ?? '—'}
                </p>

                <div className="grid grid-cols-4 gap-2 text-xs mb-3">
                  <div>Budget: {formatCurrency(budget)}</div>
                  <div>Actuals: {formatCurrency(actuals)}</div>
                  <div>Forecast: {formatCurrency(forecast)}</div>
                  <div>Variance: {formatCurrency(el.variance)}</div>
                </div>

                {el.scope_note && <p className="text-xs mb-2"><span className="font-semibold">Scope note: </span>{el.scope_note}</p>}
                {el.variance_commentary && <p className="text-xs mb-2"><span className="font-semibold">Variance commentary: </span>{el.variance_commentary}</p>}

                {(el.pct_complete !== null || el.pv !== null) && (
                  <table className="text-xs mb-3">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="pr-4">% Complete</th>
                        {el.pv !== null && (<><th className="pr-4">PV</th><th className="pr-4">EV</th><th className="pr-4">SV</th><th className="pr-4">SPI</th></>)}
                        <th className="pr-4">CV</th>
                        <th className="pr-4">CPI</th><th className="pr-4">EAC</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="pr-4">{el.pct_complete !== null ? `${el.pct_complete}%` : '—'}</td>
                        {el.pv !== null && (
                          <>
                            <td className="pr-4">{formatCurrency(el.pv)}</td>
                            <td className="pr-4">{formatCurrency(el.ev)}</td>
                            <td className="pr-4">{formatCurrency(el.sv)}</td>
                            <td className="pr-4">{el.spi ?? '—'}</td>
                          </>
                        )}
                        <td className="pr-4">{formatCurrency(el.cv)}</td>
                        <td className="pr-4">{el.cpi ?? '—'}</td>
                        <td className="pr-4">{formatCurrency(el.eac)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {el.qs_signoff_name && (
                  <p className="text-xs"><span className="font-semibold">QS sign-off: </span>{el.qs_signoff_name}{el.qs_signoff_date ? ` · ${el.qs_signoff_date}` : ''}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
