import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { downloadQualityReportCsv } from './exportQualityReport'
import type { QualityCheckStatus, QualityReport, SchedulingQualityCriterion, SchedulingQualityRunSummary } from './types'

interface Props {
  projectId: string
  periodId: string
  onClose: () => void
  // Whatever report is currently on screen (live or a viewed saved run) —
  // Scheduling.tsx holds onto this purely so the Print button can hand the
  // right data to SchedulingQualityPrintView without lifting this widget's
  // whole state up.
  onReportForPrint: (report: QualityReport | null, runName?: string) => void
  onPrint: () => void
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

export function SchedulingQualityWidget({ projectId, periodId, onClose, onReportForPrint, onPrint }: Props) {
  const [liveReport, setLiveReport] = useState<QualityReport | null>(null)
  const [criteria, setCriteria] = useState<SchedulingQualityCriterion[]>([])
  const [runs, setRuns] = useState<SchedulingQualityRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [editingThresholds, setEditingThresholds] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Viewing a saved run swaps the displayed report for a frozen snapshot —
  // thresholds aren't editable and Save isn't offered while viewing one,
  // since it's history, not the live schedule.
  const [viewingRun, setViewingRun] = useState<SchedulingQualityRunSummary | null>(null)
  const [viewingReport, setViewingReport] = useState<QualityReport | null>(null)

  const [showSaveForm, setShowSaveForm] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)

  const [includeDetailsInExport, setIncludeDetailsInExport] = useState(false)

  const report = viewingRun ? viewingReport : liveReport

  const loadLive = async () => {
    const { data } = await api.get<QualityReport>('/api/v1/scheduling-quality/', { params: { period_id: periodId } })
    setLiveReport(data)
    return data
  }

  const loadCriteria = async () => {
    const { data } = await api.get<SchedulingQualityCriterion[]>('/api/v1/scheduling-quality-criteria/', { params: { project_id: projectId } })
    setCriteria(data)
  }

  const loadRuns = async () => {
    const { data } = await api.get<SchedulingQualityRunSummary[]>('/api/v1/scheduling-quality-runs/', { params: { period_id: periodId } })
    setRuns(data)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([loadLive(), loadCriteria(), loadRuns()]).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId, projectId])

  useEffect(() => { onReportForPrint(report, viewingRun?.name) }, [report, viewingRun, onReportForPrint])

  const failCount = report?.checks.filter(c => c.status === 'fail').length ?? 0
  const warnCount = report?.checks.filter(c => c.status === 'warn').length ?? 0
  const criteriaByCheck = new Map(criteria.map(c => [c.check_number, c]))

  const handleThresholdChange = async (criterion: SchedulingQualityCriterion, value: string) => {
    const num = Number(value)
    if (Number.isNaN(num) || num < 0 || num > 100 || num === Number(criterion.threshold)) return
    const { data } = await api.patch<SchedulingQualityCriterion>(`/api/v1/scheduling-quality-criteria/${criterion.id}`, { threshold: num })
    setCriteria(prev => prev.map(c => c.id === data.id ? data : c))
    await loadLive()
  }

  const handleReset = async () => {
    if (!window.confirm('Reset all thresholds to the standard DCMA defaults?')) return
    setResetting(true)
    try {
      const { data } = await api.post<SchedulingQualityCriterion[]>('/api/v1/scheduling-quality-criteria/reset', null, { params: { project_id: projectId } })
      setCriteria(data)
      await loadLive()
    } finally {
      setResetting(false)
    }
  }

  const handleSaveRun = async () => {
    if (!saveName.trim()) return
    setSaving(true)
    try {
      await api.post('/api/v1/scheduling-quality-runs/', { period_id: periodId, name: saveName.trim() })
      setSaveName('')
      setShowSaveForm(false)
      await loadRuns()
    } finally {
      setSaving(false)
    }
  }

  const handleViewRun = async (run: SchedulingQualityRunSummary) => {
    const { data } = await api.get<{ report: QualityReport }>(`/api/v1/scheduling-quality-runs/${run.id}`)
    setViewingRun(run)
    setViewingReport(data.report)
  }

  const handleBackToLive = () => {
    setViewingRun(null)
    setViewingReport(null)
  }

  const handleDeleteRun = async (run: SchedulingQualityRunSummary) => {
    if (!window.confirm(`Delete the saved analysis "${run.name}"? This cannot be undone.`)) return
    await api.delete(`/api/v1/scheduling-quality-runs/${run.id}`)
    if (viewingRun?.id === run.id) handleBackToLive()
    await loadRuns()
  }

  const handleExport = () => {
    if (!report) return
    downloadQualityReportCsv(report, includeDetailsInExport, viewingRun?.name)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-lg">🔬</span>
        <div className="font-bold text-sm">Schedule Quality Analysis</div>
        <div className="text-xs text-gray-400">DCMA 14-Point checks 1–12</div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setEditingThresholds(o => !o)}
            disabled={!!viewingRun}
            className={`text-xs px-2 py-1 rounded border font-medium disabled:opacity-40 ${
              editingThresholds ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            ✏️ Edit Thresholds
          </button>
          <button onClick={handleReset} disabled={resetting || !!viewingRun} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40">
            {resetting ? 'Resetting…' : '↺ Reset'}
          </button>
          <button onClick={onPrint} disabled={!report} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40">
            🖨️ Print
          </button>
          <button onClick={handleExport} disabled={!report} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40">
            ⇩ Export
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
        <input type="checkbox" checked={includeDetailsInExport} onChange={e => setIncludeDetailsInExport(e.target.checked)} />
        Include failing-activity details in export
      </label>

      {/* Saved Analyses */}
      <div className="border border-gray-200 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Saved Analyses</div>
          {!showSaveForm && (
            <button onClick={() => setShowSaveForm(true)} className="ml-auto text-xs text-blue-600 hover:text-blue-700 font-medium">
              + Save this analysis
            </button>
          )}
        </div>
        {showSaveForm && (
          <div className="flex items-center gap-2 mb-2">
            <input
              value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="e.g. Baseline sign-off review" autoFocus
              className="text-xs border border-gray-300 rounded px-2 py-1 w-64"
            />
            <button onClick={handleSaveRun} disabled={saving || !saveName.trim()} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setShowSaveForm(false); setSaveName('') }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        )}
        {runs.length === 0 ? (
          <div className="text-xs text-gray-400">No saved analyses yet.</div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <tbody>
              {runs.map(r => (
                <tr key={r.id} className={viewingRun?.id === r.id ? 'bg-blue-50/50' : undefined}>
                  <td className="py-1 pr-2 font-medium">{r.name}</td>
                  <td className="py-1 pr-2 text-gray-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="py-1 pr-2 text-gray-500">{r.logic_score ?? '—'}% score</td>
                  <td className="py-1 pr-2 text-red-600">{r.failing_count} fail</td>
                  <td className="py-1 pr-2 text-amber-600">{r.warning_count} warn</td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                    <button onClick={() => handleViewRun(r)} className="text-blue-600 hover:text-blue-700 mr-2">View</button>
                    <button onClick={() => handleDeleteRun(r)} className="text-gray-400 hover:text-red-600">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {viewingRun && (
        <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-3">
          <span>Viewing saved analysis <strong>{viewingRun.name}</strong> from {new Date(viewingRun.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
          <button onClick={handleBackToLive} className="ml-auto text-blue-600 hover:text-blue-700 font-medium">← Back to live</button>
        </div>
      )}

      {loading || !report ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center bg-blue-50 border border-blue-100 rounded-lg p-2.5">
              <div className="text-lg font-extrabold text-blue-600">{report.logic_score ?? 'N/A'}{report.logic_score !== null ? '%' : ''}</div>
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
              {report.checks.map(c => {
                const criterion = criteriaByCheck.get(c.number)
                return (
                  <tr key={c.number}>
                    <td className="px-2 py-1.5 border border-gray-200" title={c.failing_activity_codes.length > 0 ? `Failing: ${c.failing_activity_codes.join(', ')}` : undefined}>
                      {c.name}
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{c.standard}</td>
                    <td className="px-2 py-1.5 border border-gray-200 text-right text-gray-500">
                      {editingThresholds && criterion ? (
                        <input
                          type="number" min={0} max={100} step={0.5}
                          defaultValue={criterion.threshold}
                          onBlur={e => handleThresholdChange(criterion, e.target.value)}
                          className="w-16 border border-blue-400 rounded px-1 py-0.5 text-right text-xs"
                        />
                      ) : c.threshold_label}
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200 text-right">
                      {typeof c.actual === 'number' ? `${c.actual}%` : c.actual ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 border border-gray-200">
                      <span className={`px-1.5 py-0.5 rounded font-semibold ${STATUS_STYLES[c.status]}`}>
                        {STATUS_LABELS[c.status]}
                      </span>
                    </td>
                  </tr>
                )
              })}
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
