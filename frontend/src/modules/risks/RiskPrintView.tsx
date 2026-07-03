import { HeatMatrix } from '@/components/HeatMatrix'
import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import type { ProjectLetterhead } from '@/lib/letterhead'
import type { Risk } from './types'

function formatPercent(value: string | null) {
  if (value === null) return '—'
  return `${Math.round(Number(value) * 100)}%`
}

function formatCurrency(value: string | null) {
  if (value === null) return '—'
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString()}` : `£${n.toLocaleString()}`
}

interface RiskPrintViewProps {
  mode: 'list' | 'detail'
  risks: Risk[]
  projectName: string
  letterhead: ProjectLetterhead | null
}

// A dedicated printable rendering, shown only via @media print (see index.css
// .print-only). 'list' mirrors the on-screen table; 'detail' is a full-detail
// report per risk (statement, both heat-map assessments, 3-point EMV, response
// strategy) — doesn't include mitigation actions/reassessment history sub-lists,
// since those need a separate fetch per risk; everything stored on the risk
// record itself is included.
export function RiskPrintView({ mode, risks, projectName, letterhead }: RiskPrintViewProps) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const letterheadTokens = {
    project: projectName, module: 'Risk Register',
    count: `${risks.length} risk${risks.length === 1 ? '' : 's'}`,
    printed_at: printedAt,
  }

  return (
    <div className="print-only p-8">
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={letterheadTokens} />}
      <p className="text-sm text-gray-500 mb-4">{mode === 'list' ? 'Register (as shown)' : 'Full detail'} · {risks.length} risk{risks.length === 1 ? '' : 's'}</p>

      {mode === 'list' ? (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left border-b-2 border-gray-400">
              <th className="py-1.5 pr-2">Code</th>
              <th className="py-1.5 pr-2">Title</th>
              <th className="py-1.5 pr-2">Type</th>
              <th className="py-1.5 pr-2">Theme</th>
              <th className="py-1.5 pr-2">Status</th>
              <th className="py-1.5 pr-2">Prob.</th>
              <th className="py-1.5 pr-2">Impact</th>
              <th className="py-1.5 pr-2">Rating</th>
              <th className="py-1.5 pr-2">EMV Cost</th>
            </tr>
          </thead>
          <tbody>
            {risks.map(r => (
              <tr key={r.id} className="border-b border-gray-200">
                <td className="py-1 pr-2 font-mono">{r.code}</td>
                <td className="py-1 pr-2">{r.title}</td>
                <td className="py-1 pr-2 capitalize">{r.risk_type}</td>
                <td className="py-1 pr-2">{r.category ?? '—'}</td>
                <td className="py-1 pr-2">{r.status}</td>
                <td className="py-1 pr-2">{formatPercent(r.probability)}</td>
                <td className="py-1 pr-2">{formatPercent(r.impact)}</td>
                <td className="py-1 pr-2">{r.rating ?? '—'}</td>
                <td className="py-1 pr-2">{formatCurrency(r.emv_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="space-y-8">
          {risks.map(r => (
            <div key={r.id} style={{ pageBreakInside: 'avoid' }} className="border-b border-gray-300 pb-6">
              <h2 className="text-base font-bold">{r.code} · {r.title}</h2>
              <p className="text-xs text-gray-500 mb-3">
                {r.risk_type} · {r.category ?? '—'} / {r.area ?? '—'} · {r.status} · Owner: {r.risk_owner ?? '—'}
              </p>

              <div className="grid grid-cols-4 gap-2 text-xs mb-3">
                <div>Raised: {r.date_raised ?? '—'}</div>
                <div>Expected impact: {r.expected_impact_date ?? '—'}</div>
                <div>Last reviewed: {r.last_reviewed_date ?? '—'}</div>
                <div>Closed: {r.date_closed ?? '—'}</div>
              </div>

              {(r.cause || r.effect || r.rationale) && (
                <div className="text-xs mb-3 space-y-1">
                  {r.cause && <p><span className="font-semibold">Cause: </span>{r.cause}</p>}
                  {r.effect && <p><span className="font-semibold">Effect: </span>{r.effect}</p>}
                  {r.rationale && <p><span className="font-semibold">Rationale: </span>{r.rationale}</p>}
                </div>
              )}

              <div className="flex gap-10 flex-wrap mb-3">
                <HeatMatrix
                  label="Inherent (pre-mitigation)"
                  probability={r.probability !== null ? Number(r.probability) : null}
                  impact={r.impact !== null ? Number(r.impact) : null}
                />
                <HeatMatrix
                  label="Residual (post-mitigation target)"
                  probability={r.probability_residual !== null ? Number(r.probability_residual) : null}
                  impact={r.impact_residual !== null ? Number(r.impact_residual) : null}
                />
              </div>
              {r.rating_narrative && <p className="text-xs mb-3">{r.rating_narrative}</p>}

              <table className="text-xs mb-3">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pr-4"></th>
                    <th className="pr-4">Min</th>
                    <th className="pr-4">Most Likely</th>
                    <th className="pr-4">Max</th>
                    <th className="pr-4">EMV</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="pr-4 font-semibold">Cost</td>
                    <td className="pr-4">{r.cost_min ?? '—'}</td>
                    <td className="pr-4">{r.cost_most_likely ?? '—'}</td>
                    <td className="pr-4">{r.cost_max ?? '—'}</td>
                    <td className="pr-4">{formatCurrency(r.emv_cost)}</td>
                  </tr>
                  <tr>
                    <td className="pr-4 font-semibold">Schedule (days)</td>
                    <td className="pr-4">{r.schedule_min_days ?? '—'}</td>
                    <td className="pr-4">{r.schedule_most_likely_days ?? '—'}</td>
                    <td className="pr-4">{r.schedule_max_days ?? '—'}</td>
                    <td className="pr-4">{r.emv_schedule_days ?? '—'}</td>
                  </tr>
                </tbody>
              </table>

              <p className="text-xs">
                <span className="font-semibold">Response strategy: </span>{r.response_strategy ?? '—'}
              </p>
              {r.mitigation_status && <p className="text-xs mt-1"><span className="font-semibold">Mitigation status: </span>{r.mitigation_status}</p>}
              {r.contingency_plan && <p className="text-xs mt-1"><span className="font-semibold">Contingency plan: </span>{r.contingency_plan}</p>}
              {r.fallback_plan && <p className="text-xs mt-1"><span className="font-semibold">Fallback plan: </span>{r.fallback_plan}</p>}
            </div>
          ))}
        </div>
      )}
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={letterheadTokens} />}
    </div>
  )
}
