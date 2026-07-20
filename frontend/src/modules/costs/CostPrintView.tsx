import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import type { ProjectLetterhead } from '@/lib/letterhead'
import { type CostElement } from './types'

function formatCurrency(value: string | number | null) {
  if (value === null) return '—'
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString()}` : `£${n.toLocaleString()}`
}

// One column currently switched on, in order (2026-07-18, per Maro: "fix up
// the print version, to print what's shown in the cost plan (exact fields
// activated/grouping/collapsible etc)") — CostPlan.tsx is the single source
// of truth for which of its own toggleable columns (plus every UDF column,
// Comments included) are currently visible; this component only ever
// renders whichever ones it's handed.
export interface PrintColumn {
  key: string
  label: string
}

// One printed row, fully pre-resolved by CostPlan.tsx (2026-07-18) — every
// cell already formatted as display text, so this component needs zero
// knowledge of CostElement's own fixed/percentage split, computed_* fields,
// or the UDF value-type system; it only ever renders whatever string it's
// given. Covers both a real element row and a synthetic summary row
// (Construction/a discipline/Total/any other grouping's own aggregated
// line) identically — the same "print exactly what's on screen, collapse
// state included" data CostPlan.tsx's own renderRow/renderSummaryRow
// already compute for the live table.
export interface PrintRow {
  key: string
  label: string
  count?: number
  indent?: boolean
  bold?: boolean
  budget: string
  cells: Record<string, string>
}

interface CostPrintViewProps {
  mode: 'list' | 'detail'
  // 'list' mode (2026-07-18, rebuilt): printRows/printColumns are CostPlan.tsx's
  // own already-resolved "exactly what's on screen right now" data.
  // 'detail' mode is unchanged — a full-detail report over whichever
  // individual elements are checked for print, independent of grouping/
  // column visibility.
  printRows?: PrintRow[]
  printColumns?: PrintColumn[]
  printElementCount?: number
  elements: CostElement[]
  projectName: string
  letterhead: ProjectLetterhead | null
}

// A dedicated printable rendering, shown only via @media print (see index.css
// .print-only). 'list' mirrors the on-screen table exactly (same rows, same
// columns, same collapse state); 'detail' is a full-detail report per
// element (scope note, variance commentary, EVM, QS sign-off).
export function CostPrintView({ mode, printRows, printColumns, printElementCount, elements, projectName, letterhead }: CostPrintViewProps) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const count = mode === 'list' ? (printElementCount ?? 0) : elements.length
  const letterheadTokens = {
    project: projectName, module: 'Cost Plan',
    count: `${count} element${count === 1 ? '' : 's'}`,
    printed_at: printedAt,
  }

  return (
    <div className="print-only p-8">
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={letterheadTokens} />}
      <p className="text-sm text-gray-500 mb-4">{mode === 'list' ? 'Cost Plan (as shown)' : 'Full detail'} · {count} element{count === 1 ? '' : 's'}</p>

      {mode === 'list' ? (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left border-b-2 border-gray-400">
              <th className="py-1.5 pr-2">Description</th>
              {printColumns?.map(c => <th key={c.key} className="py-1.5 pr-2">{c.label}</th>)}
              <th className="py-1.5 pr-2">Budget</th>
            </tr>
          </thead>
          <tbody>
            {printRows?.map(row => (
              <tr key={row.key} className={`border-b border-gray-200 ${row.bold ? 'bg-gray-50' : ''}`}>
                <td className={`py-1 pr-2 ${row.bold ? 'font-bold' : ''} ${row.indent ? 'pl-4' : ''}`}>
                  {row.label}{row.count !== undefined && <span className="text-gray-400"> ({row.count})</span>}
                </td>
                {printColumns?.map(c => <td key={c.key} className="py-1 pr-2">{row.cells[c.key] ?? '—'}</td>)}
                <td className={`py-1 pr-2 ${row.bold ? 'font-bold' : ''}`}>{row.budget}</td>
              </tr>
            ))}
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
                  {el.element_group ?? '—'} · Owner: {el.cost_owner ?? '—'}
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
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={letterheadTokens} />}
    </div>
  )
}
