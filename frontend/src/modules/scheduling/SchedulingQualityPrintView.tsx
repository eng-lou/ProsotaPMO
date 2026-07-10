import { PrintLetterheadFooter, PrintLetterheadHeader } from '@/components/PrintLetterhead'
import type { ProjectLetterhead } from '@/lib/letterhead'
import type { QualityCheckStatus, QualityReport } from './types'

interface Props {
  report: QualityReport
  projectName: string
  letterhead: ProjectLetterhead | null
  runName?: string
}

const STATUS_LABELS: Record<QualityCheckStatus, string> = {
  pass: '✓ PASS', warn: '⚠ WARN', fail: '✗ FAIL', na: 'N/A',
}

// Mirrors SchedulingQualityWidget.tsx's on-screen layout exactly (3 summary
// cards + the checks table) — "print it how it appears in the viewport"
// (Maro). A dedicated print target, not folded into SchedulingPrintView,
// since only one .print-only block should be visible per print — see
// Scheduling.tsx's printTarget state.
export function SchedulingQualityPrintView({ report, projectName, letterhead, runName }: Props) {
  const printedAt = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const letterheadTokens = {
    project: projectName, module: 'Schedule Quality Analysis',
    count: `${report.activity_count} activit${report.activity_count === 1 ? 'y' : 'ies'} assessed`,
    printed_at: printedAt,
  }
  const failCount = report.checks.filter(c => c.status === 'fail').length
  const warnCount = report.checks.filter(c => c.status === 'warn').length

  return (
    <div className="print-only p-8">
      {letterhead && <PrintLetterheadHeader letterhead={letterhead} tokens={letterheadTokens} />}
      <p className="text-sm text-gray-500 mb-4">
        DCMA 14-Point checks 1–12{runName ? ` — saved analysis "${runName}"` : ''}
        {report.scope_name ? ` — scoped to "${report.scope_name}"` : ''}
      </p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center bg-blue-50 border border-blue-100 rounded-lg p-3">
          <div className="text-xl font-extrabold text-blue-600">{report.logic_score ?? 'N/A'}{report.logic_score !== null ? '%' : ''}</div>
          <div className="text-[10px] font-semibold text-blue-800">Logic Score</div>
        </div>
        <div className={`text-center rounded-lg p-3 border ${failCount > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
          <div className={`text-xl font-extrabold ${failCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{failCount}</div>
          <div className={`text-[10px] font-semibold ${failCount > 0 ? 'text-red-800' : 'text-green-800'}`}>Failing Checks</div>
        </div>
        <div className={`text-center rounded-lg p-3 border ${warnCount > 0 ? 'bg-amber-50 border-amber-100' : 'bg-green-50 border-green-100'}`}>
          <div className={`text-xl font-extrabold ${warnCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>{warnCount}</div>
          <div className={`text-[10px] font-semibold ${warnCount > 0 ? 'text-amber-800' : 'text-green-800'}`}>Warning Checks</div>
        </div>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500 border-b-2 border-gray-400">
            <th className="px-2 py-1.5">Check</th>
            <th className="px-2 py-1.5">Standard</th>
            <th className="px-2 py-1.5 text-right">Threshold</th>
            <th className="px-2 py-1.5 text-right">Actual</th>
            <th className="px-2 py-1.5">Result</th>
          </tr>
        </thead>
        <tbody>
          {report.checks.map(c => (
            <tr key={c.number} className="border-b border-gray-200" style={{ pageBreakInside: 'avoid' }}>
              <td className="px-2 py-1">{c.name}</td>
              <td className="px-2 py-1 text-gray-500">{c.standard}</td>
              <td className="px-2 py-1 text-right text-gray-500">{c.threshold_label}</td>
              <td className="px-2 py-1 text-right">{typeof c.actual === 'number' ? `${c.actual}%` : c.actual ?? '—'}</td>
              <td className="px-2 py-1">{STATUS_LABELS[c.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {letterhead && <PrintLetterheadFooter letterhead={letterhead} tokens={letterheadTokens} />}
    </div>
  )
}
