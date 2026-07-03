import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import type { ProjectLetterhead } from '@/lib/letterhead'
import { ITEM_TYPE_LABELS, STATUS_LABELS, type IcdItem } from './types'

function formatCurrency(value: string | null) {
  if (value === null) return '—'
  return `£${Number(value).toLocaleString()}`
}

interface IcdPrintViewProps {
  mode: 'list' | 'detail'
  items: IcdItem[]
  projectName: string
  letterhead: ProjectLetterhead | null
}

// A dedicated printable rendering, shown only via @media print (see index.css
// .print-only). 'list' mirrors the on-screen table; 'detail' is a full-detail
// report per item (description, dates, type-specific fields, resolution) —
// doesn't include the reassessment history sub-list, since that needs a
// separate fetch per item; everything stored on the item record is included.
export function IcdPrintView({ mode, items, projectName, letterhead }: IcdPrintViewProps) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const letterheadTokens = {
    project: projectName, module: 'ICD Tracker',
    count: `${items.length} item${items.length === 1 ? '' : 's'}`,
    printed_at: printedAt,
  }

  return (
    <div className="print-only p-8">
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={letterheadTokens} />}
      <p className="text-sm text-gray-500 mb-4">{mode === 'list' ? 'Tracker (as shown)' : 'Full detail'} · {items.length} item{items.length === 1 ? '' : 's'}</p>

      {mode === 'list' ? (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left border-b-2 border-gray-400">
              <th className="py-1.5 pr-2">Code</th>
              <th className="py-1.5 pr-2">Title</th>
              <th className="py-1.5 pr-2">Type</th>
              <th className="py-1.5 pr-2">Status</th>
              <th className="py-1.5 pr-2">Priority</th>
              <th className="py-1.5 pr-2">Owner</th>
              <th className="py-1.5 pr-2">Due</th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id} className="border-b border-gray-200">
                <td className="py-1 pr-2 font-mono">{i.code}</td>
                <td className="py-1 pr-2">{i.title}</td>
                <td className="py-1 pr-2 capitalize">{ITEM_TYPE_LABELS[i.item_type]}</td>
                <td className="py-1 pr-2">{STATUS_LABELS[i.status] ?? i.status}</td>
                <td className="py-1 pr-2 capitalize">{i.priority ?? '—'}</td>
                <td className="py-1 pr-2">{i.owner ?? '—'}</td>
                <td className="py-1 pr-2">{i.item_type === 'decision' ? (i.required_by ?? '—') : (i.due_date ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="space-y-8">
          {items.map(i => (
            <div key={i.id} style={{ pageBreakInside: 'avoid' }} className="border-b border-gray-300 pb-6">
              <h2 className="text-base font-bold">{i.code} · {i.title}</h2>
              <p className="text-xs text-gray-500 mb-3">
                {ITEM_TYPE_LABELS[i.item_type]} · {STATUS_LABELS[i.status] ?? i.status} · Priority: {i.priority ?? '—'} · Owner: {i.owner ?? '—'}
              </p>

              <div className="grid grid-cols-4 gap-2 text-xs mb-3">
                <div>Raised: {i.raised_date ?? '—'}</div>
                <div>Due: {i.item_type === 'decision' ? (i.required_by ?? '—') : (i.due_date ?? '—')}</div>
                <div>Last reviewed: {i.last_reviewed_date ?? '—'}</div>
                <div>Closed: {i.closed_date ?? '—'}</div>
              </div>

              {i.description && <p className="text-xs mb-2"><span className="font-semibold">Description: </span>{i.description}</p>}

              {i.item_type === 'issue' && i.severity && (
                <p className="text-xs mb-2"><span className="font-semibold">Severity: </span>{i.severity}</p>
              )}

              {i.item_type === 'change' && (
                <div className="text-xs mb-2 space-y-1">
                  <p><span className="font-semibold">Change type: </span>{i.change_type ?? '—'} · <span className="font-semibold">CCB decision: </span>{i.ccb_decision ?? 'Pending'}</p>
                  {i.rejection_reason && <p><span className="font-semibold">Rejection reason: </span>{i.rejection_reason}</p>}
                  <p><span className="font-semibold">Cost impact: </span>{formatCurrency(i.cost_impact)} · <span className="font-semibold">Schedule impact: </span>{i.schedule_impact_days ?? '—'} days</p>
                  <p><span className="font-semibold">Cost claim: </span>{formatCurrency(i.cost_claim)} · <span className="font-semibold">EOT claim: </span>{i.eot_claim_days ?? '—'} days</p>
                  {i.contract_reference && <p><span className="font-semibold">Contract reference: </span>{i.contract_reference}</p>}
                  {i.quality_impact && <p><span className="font-semibold">Quality impact: </span>{i.quality_impact}</p>}
                </div>
              )}

              {i.item_type === 'decision' && (
                <div className="text-xs mb-2 space-y-1">
                  <p><span className="font-semibold">Decision maker: </span>{i.decision_maker ?? '—'} · <span className="font-semibold">Required by: </span>{i.required_by ?? '—'}</p>
                  {i.if_late_consequence && <p><span className="font-semibold">Consequence if late: </span>{i.if_late_consequence}</p>}
                </div>
              )}

              {i.resolution && <p className="text-xs"><span className="font-semibold">Resolution: </span>{i.resolution}</p>}
            </div>
          ))}
        </div>
      )}
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={letterheadTokens} />}
    </div>
  )
}
