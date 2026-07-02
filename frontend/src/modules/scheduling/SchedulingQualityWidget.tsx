import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { QualityCheckStatus, QualityReport } from './types'

interface Props {
  periodId: string
  onClose: () => void
}

const STATUS_STYLES: Record<QualityCheckStatus, string> = {
  pass: 'text-green-700 bg-green-50',
  warn: 'text-amber-700 bg-amber-50',
  fail: 'text-red-700 bg-red-50',
  na: 'text-gray-400 bg-gray-50',
}

const STATUS_LABELS: Record<QualityCheckStatus, string> = {
  pass: '✓ PASS',
  warn: '⚠ WARN',
  fail: '✗ FAIL',
  na: 'N/A',
}

export function SchedulingQualityWidget({ periodId, onClose }: Props) {
  const [report, setReport] = useState<QualityReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get<QualityReport>('/api/v1/scheduling-quality/', { params: { period_id: periodId } })
      .then(res => { if (!cancelled) setReport(res.data) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [periodId])

  const failCount = report?.checks.filter(c => c.status === 'fail').length ?? 0
  const warnCount = report?.checks.filter(c => c.status === 'warn').length ?? 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🔬</span>
        <div className="font-bold text-sm">Schedule Quality Analysis</div>
        <div className="text-xs text-gray-400">DCMA 14-Point checks 1–12</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      {loading || !report ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center bg-blue-50 border border-blue-100 rounded-lg p-2.5">
              <div className="text-lg font-extrabold text-blue-600">{report.logic_score}%</div>
              <div className="text-[10px] font-semibold text-blue-800">Logic Score</div>
            </div>
            <div className={`text-center rounded-lg p-2.5 border ${failCount > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
              <div className={`text-lg font-extrabold ${failCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{failCount}</div>
              <div className={`text-[10px] font-semibold ${failCount > 0 ? 'text-red-800' : 'text-green-800'}`}>Failing Checks</div>
            </div>
            <div className={`text-center rounded-lg p-2.5 border ${warnCount > 0 ? 'bg-amber-50 border-amber-100' : 'bg-green-50 border-green-100'}`}>
              <div className={`text-lg font-extrabold ${warnCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>{warnCount}</div>
              <div className={`text-[10px] font-semibold ${warnCount > 0 ? 'text-amber-800' : 'text-green-800'}`}>Warning Checks</div>
            </div>
          </div>

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500">
                <th className="px-2 py-1.5 border border-gray-200">Check</th>
                <th className="px-2 py-1.5 border border-gray-200">Standard</th>
                <th className="px-2 py-1.5 border border-gray-200 text-right">Threshold</th>
                <th className="px-2 py-1.5 border border-gray-200 text-right">Actual</th>
                <th className="px-2 py-1.5 border border-gray-200">Result</th>
              </tr>
            </thead>
            <tbody>
              {report.checks.map(c => (
                <tr key={c.number}>
                  <td className="px-2 py-1.5 border border-gray-200">{c.name}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{c.standard}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right text-gray-500">{c.threshold_label}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right">
                    {typeof c.actual === 'number' ? `${c.actual}%` : c.actual ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200">
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${STATUS_STYLES[c.status]}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.activity_count === 0 && (
            <div className="text-xs text-gray-400 mt-3">No activities yet — add some to see real quality metrics.</div>
          )}
        </>
      )}
    </div>
  )
}
