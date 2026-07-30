import { Fragment } from 'react'
import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import type { ProjectLetterhead } from '@/lib/letterhead'
import type { Activity } from '@/modules/scheduling/types'
import { buildBoqTree } from './boqGeneration'
import type { CostRateLine } from './types'

function formatCurrency(value: number) {
  return value < 0 ? `-£${Math.abs(value).toLocaleString()}` : `£${value.toLocaleString()}`
}

interface BoqPrintViewProps {
  lines: CostRateLine[]
  total: number
  projectName: string
  letterhead: ProjectLetterhead | null
  // Real section/element labels come from these, not parsed description
  // text — see buildBoqTree's own header for why.
  activities: Activity[]
}

// A dedicated printable rendering of the BOQ tab (2026-07-19, per Maro:
// "add... print features like the cost tab") — same .print-only/@media
// print convention as CostPrintView.tsx.
//
// Two sheets (2026-07-27, per Maro's QS review — item 8: "Add an elemental
// rollup. Everything is sorted by location, so you can't answer 'what's
// total curtain walling' without a pivot. Issue the elemental summary as
// the front sheet and the locational breakdown as the detail"): an
// elemental rollup first (element name -> total across every location,
// answers "what's total Columns" in one line), then the full
// section -> element -> activity -> resource tree the on-screen Boq.tsx
// table already builds (buildBoqTree, same function, same numbers — not a
// second, independently-derived total).
export function BoqPrintView({ lines, total, projectName, letterhead, activities }: BoqPrintViewProps) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const letterheadTokens = {
    project: projectName, module: 'Bill of Quantities',
    count: `${lines.length} line${lines.length === 1 ? '' : 's'}`,
    printed_at: printedAt,
  }

  const tree = buildBoqTree(lines, activities)

  // Location-independent — grouped by element label alone, across every
  // section, so "Columns" on Level 1 and "Columns" on Level 3 roll up into
  // one real total instead of staying scattered across the locational tree
  // below.
  const elementalRollup = new Map<string, number>()
  for (const section of tree.sections) {
    for (const element of section.elements) {
      elementalRollup.set(element.label, (elementalRollup.get(element.label) ?? 0) + element.subtotal)
    }
  }
  const elementalRows = [...elementalRollup.entries()].sort((a, b) => b[1] - a[1])

  let sr = 0
  const renderLine = (line: CostRateLine, label: string, indent: number, showSr: boolean) => {
    if (showSr) sr++
    return (
      <tr key={line.id} className="border-b border-gray-200">
        <td className="py-1 pr-2 text-gray-400">{showSr ? sr : ''}</td>
        <td className="py-1 pr-2" style={{ paddingLeft: indent * 12 }}>{label}</td>
        <td className="py-1 pr-2 text-gray-400 font-mono" style={{ fontSize: '9px' }}>{line.cost_code ?? ''}</td>
        <td className="py-1 pr-2 text-right">{Number(line.qty).toLocaleString()}</td>
        <td className="py-1 pr-2 text-gray-500">{line.unit ?? '—'}</td>
        <td className="py-1 pr-2 text-right">{formatCurrency(Number(line.rate))}</td>
        <td className="py-1 pr-2 text-right font-medium">{formatCurrency(Number(line.total))}</td>
      </tr>
    )
  }

  return (
    <div className="print-only p-8">
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={letterheadTokens} />}
      <p className="text-sm text-gray-500 mb-4">Bill of Quantities · {lines.length} line{lines.length === 1 ? '' : 's'}</p>
      <p className="text-xs text-gray-400 mb-4">Excludes VAT.</p>

      {elementalRows.length > 0 && (
        <>
          <p className="text-xs font-bold text-gray-600 mb-1">Elemental Summary</p>
          <table className="w-full text-xs border-collapse mb-6">
            <thead>
              <tr className="text-left border-b-2 border-gray-400">
                <th className="py-1.5 pr-2">Element</th>
                <th className="py-1.5 pr-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {elementalRows.map(([label, sum]) => (
                <tr key={label} className="border-b border-gray-200">
                  <td className="py-1 pr-2">{label}</td>
                  <td className="py-1 pr-2 text-right">{formatCurrency(sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="text-xs font-bold text-gray-600 mb-1">Locational Detail</p>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left border-b-2 border-gray-400">
            <th className="py-1.5 pr-2 w-8">Sr.</th>
            <th className="py-1.5 pr-2">Name of Item</th>
            <th className="py-1.5 pr-2">Cost Code</th>
            <th className="py-1.5 pr-2 text-right">Quantity</th>
            <th className="py-1.5 pr-2">Unit</th>
            <th className="py-1.5 pr-2 text-right">Rate</th>
            <th className="py-1.5 pr-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {tree.sections.map(section => (
            <Fragment key={section.key}>
              <tr className="bg-gray-50 border-b border-gray-300">
                <td className="py-1 pr-2"></td>
                <td className="py-1 pr-2 font-bold">{section.label}</td>
                <td className="py-1 pr-2 text-gray-400 font-mono" style={{ fontSize: '9px' }}>{section.key}</td>
                <td colSpan={3}></td>
                <td className="py-1 pr-2 text-right font-bold">{formatCurrency(section.subtotal)}</td>
              </tr>
              {section.elements.map(element => (
                <Fragment key={element.key}>
                  <tr className="border-b border-gray-200">
                    <td className="py-1 pr-2"></td>
                    <td className="py-1 pr-2 font-semibold text-gray-600" style={{ paddingLeft: 12 }}>{element.label}</td>
                    <td className="py-1 pr-2 text-gray-400 font-mono" style={{ fontSize: '9px' }}>{element.key}</td>
                    <td colSpan={3}></td>
                    <td className="py-1 pr-2 text-right font-semibold text-gray-600">{formatCurrency(element.subtotal)}</td>
                  </tr>
                  {element.activities.map(activity => (
                    <Fragment key={activity.line.id}>
                      {renderLine(activity.line, activity.label, 2, true)}
                      {activity.resources.map(resource => renderLine(resource.line, resource.label, 3, false))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
          {tree.ungrouped.map(line => renderLine(line, line.description, 0, true))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-400 font-bold">
            <td colSpan={6} className="py-1.5 pr-2 text-right">Total Cost</td>
            <td className="py-1.5 pr-2 text-right">{formatCurrency(total)}</td>
          </tr>
        </tfoot>
      </table>
      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={letterheadTokens} />}
    </div>
  )
}
