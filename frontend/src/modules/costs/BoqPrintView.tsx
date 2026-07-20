import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import type { ProjectLetterhead } from '@/lib/letterhead'
import type { CostRateLine } from './types'

function formatCurrency(value: number) {
  return value < 0 ? `-£${Math.abs(value).toLocaleString()}` : `£${value.toLocaleString()}`
}

interface BoqPrintViewProps {
  lines: CostRateLine[]
  total: number
  projectName: string
  letterhead: ProjectLetterhead | null
}

// A dedicated printable rendering of the BOQ tab (2026-07-19, per Maro:
// "add... print features like the cost tab") — same .print-only/@media
// print convention as CostPrintView.tsx, scoped down to what BOQ actually
// has: one flat rate-line table, no grouping/column-visibility/detail mode
// to mirror (a BOQ line has no percentage/fixed split or EVM fields the way
// a CostElement does).
export function BoqPrintView({ lines, total, projectName, letterhead }: BoqPrintViewProps) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const letterheadTokens = {
    project: projectName, module: 'Bill of Quantities',
    count: `${lines.length} line${lines.length === 1 ? '' : 's'}`,
    printed_at: printedAt,
  }

  return (
    <div className="print-only p-8">
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={letterheadTokens} />}
      <p className="text-sm text-gray-500 mb-4">Bill of Quantities · {lines.length} line{lines.length === 1 ? '' : 's'}</p>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left border-b-2 border-gray-400">
            <th className="py-1.5 pr-2 w-8">Sr.</th>
            <th className="py-1.5 pr-2">Name of Item</th>
            <th className="py-1.5 pr-2 text-right">Quantity</th>
            <th className="py-1.5 pr-2">Unit</th>
            <th className="py-1.5 pr-2 text-right">Rate</th>
            <th className="py-1.5 pr-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={line.id} className="border-b border-gray-200">
              <td className="py-1 pr-2 text-gray-400">{i + 1}</td>
              <td className="py-1 pr-2">{line.description}</td>
              <td className="py-1 pr-2 text-right">{Number(line.qty).toLocaleString()}</td>
              <td className="py-1 pr-2 text-gray-500">{line.unit ?? '—'}</td>
              <td className="py-1 pr-2 text-right">{formatCurrency(Number(line.rate))}</td>
              <td className="py-1 pr-2 text-right font-medium">{formatCurrency(Number(line.total))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-400 font-bold">
            <td colSpan={5} className="py-1.5 pr-2 text-right">Total Cost</td>
            <td className="py-1.5 pr-2 text-right">{formatCurrency(total)}</td>
          </tr>
        </tfoot>
      </table>
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={letterheadTokens} />}
    </div>
  )
}
