import { Fragment } from 'react'
import { PRINT_LEFT_PANE_WIDTH, PRINT_PERIOD_COL_WIDTH, RESOURCE_CHART_Y_AXIS_WIDTH } from './resourcesLayout'

export interface PrintResourceGroup {
  resourceName: string
  bucketHours: number[]
  rows: { code: string; name: string; start: string | null; finish: string | null; bucketHours: number[] }[]
}

interface Props {
  groups: PrintResourceGroup[]
  bucketLabels: string[]
  unit: 'hours' | 'days' | 'cost'
}

function fmt(value: number, unit: 'hours' | 'days' | 'cost'): string {
  if (value === 0) return ''
  return unit === 'cost' ? `£${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : value.toFixed(1).replace(/\.0$/, '')
}

// Content only — no letterhead header/footer or outer print-only wrapper of
// its own; ResourcesPrintView.tsx supplies exactly one shared header/footer
// for however many of the three Resources tables are checked to print
// (2026-07-09 fix, per Maro: "only one header above for all tables").
// Fixed pixel column widths (PRINT_LEFT_PANE_WIDTH/PRINT_PERIOD_COL_WIDTH,
// same table-layout:fixed technique the on-screen widget already uses)
// instead of auto-layout — so its period columns land under the exact same
// horizontal position as Resource Usage Profile's chart bars below it.
export function ResourceTrackingPrintView({ groups, bucketLabels, unit }: Props) {
  const codeWidth = 55, startWidth = 65, finishWidth = 65
  const nameWidth = PRINT_LEFT_PANE_WIDTH - codeWidth - startWidth - finishWidth

  return (
    <div className="mb-8">
      <p className="text-sm text-gray-500 mb-4">Resource Tracking · {groups.length} resource{groups.length === 1 ? '' : 's'}</p>

      <table className="border-collapse" style={{ tableLayout: 'fixed', width: PRINT_LEFT_PANE_WIDTH + RESOURCE_CHART_Y_AXIS_WIDTH + bucketLabels.length * PRINT_PERIOD_COL_WIDTH }}>
        <colgroup>
          <col style={{ width: codeWidth }} /><col style={{ width: nameWidth }} /><col style={{ width: startWidth }} /><col style={{ width: finishWidth }} />
          <col style={{ width: RESOURCE_CHART_Y_AXIS_WIDTH }} />
          {bucketLabels.map((_, i) => <col key={i} style={{ width: PRINT_PERIOD_COL_WIDTH }} />)}
        </colgroup>
        <thead>
          <tr className="text-left border-b-2 border-gray-400">
            <th className="py-1 pr-2">Code</th>
            <th className="py-1 pr-2">Activity</th>
            <th className="py-1 pr-2">Start</th>
            <th className="py-1 pr-2">Finish</th>
            {/* Blank — matches Resource Usage Profile's own y-axis gutter
                below, so both tables' period columns line up. */}
            <th />
            {bucketLabels.map((label, i) => <th key={i} className="py-1 pr-2 text-right truncate">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <Fragment key={group.resourceName}>
              <tr className="border-b border-gray-300 font-bold bg-gray-100">
                <td className="py-1 pr-2 truncate" colSpan={4}>{group.resourceName}</td>
                <td />
                {group.bucketHours.map((h, i) => <td key={i} className="py-1 pr-2 text-right">{fmt(h, unit)}</td>)}
              </tr>
              {group.rows.map(row => (
                <tr key={`${group.resourceName}-${row.code}`} className="border-b border-gray-200">
                  <td className="py-1 pr-2 font-mono truncate">{row.code}</td>
                  <td className="py-1 pr-2 truncate">{row.name}</td>
                  <td className="py-1 pr-2 truncate">{row.start ?? '—'}</td>
                  <td className="py-1 pr-2 truncate">{row.finish ?? '—'}</td>
                  <td />
                  {row.bucketHours.map((h, i) => <td key={i} className="py-1 pr-2 text-right">{fmt(h, unit)}</td>)}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
