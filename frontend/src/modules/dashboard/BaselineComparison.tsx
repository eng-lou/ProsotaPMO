import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useBaselineSets } from '@/lib/baselineSets'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { formatCurrency, formatDate } from './Overview'
import type { BaselineComparisonResponse } from './types'

const SUB_TABS = ['Overview', 'Schedule', 'Risk', 'Cost', 'ICD'] as const
type SubTab = (typeof SUB_TABS)[number]

// Detail tables only show rows that actually moved since the baseline — a
// £0/unchanged row is noise, not a comparison (Maro: "i dont need to see 0
// variances"). null vs a real value still counts as changed (the item's
// own reference point disappeared), only true numeric equality is "no
// change."
function numChanged(baseline: string | null, current: string | null): boolean {
  if (baseline === null && current === null) return false
  if (baseline === null || current === null) return true
  return Number(baseline) !== Number(current)
}

// Favourable change green, unfavourable red, no change neutral — applied
// only to the delta itself, never the two absolute baseline/current values.
// Which direction is "favourable" depends on the metric, not the sign: SPI/
// CPI rising is good (higherIsBetter), but BAC/EAC/risk rating rising is bad
// (a budget or a risk growing is never good news) — a literal
// positive-always-green rule would get cost and risk backwards.
function formatDelta(
  baseline: string | number | null,
  current: string | number | null,
  decimals = 2,
  money = false,
  higherIsBetter = true,
) {
  const fmt0 = (n: number) => (money ? formatCurrency(n) : n.toFixed(decimals))
  if (baseline === null && current === null) return <span>—</span>
  // Added since the baseline (no prior value) or removed since (no current
  // value) — neither is a "delta" to colour, just say so plainly.
  if (baseline === null) return <span className="text-gray-500">(new) {fmt0(Number(current))}</span>
  if (current === null) return <span className="text-gray-500">{fmt0(Number(baseline))} (removed)</span>
  const b = Number(baseline)
  const c = Number(current)
  const delta = c - b
  const sign = delta > 0 ? '+' : ''
  const fmt = (n: number) => (money ? formatCurrency(n) : n.toFixed(decimals))
  const favourable = delta === 0 ? null : (delta > 0) === higherIsBetter
  const color = favourable === null ? 'text-gray-500' : favourable ? 'text-green-600' : 'text-red-600'
  return (
    <span>
      {fmt(b)} → {fmt(c)}{' '}
      <span className={`font-medium ${color}`}>({sign}{money ? formatCurrency(delta) : delta.toFixed(decimals)})</span>
    </span>
  )
}

export function BaselineComparison() {
  const { selectedProject } = useProject()
  const { period } = useActivePeriod(selectedProject?.id)
  const { period: schedulePeriod } = useActiveScheduleVariant(selectedProject?.id)
  const { baselineSets, loading: setsLoading, captureAll } = useBaselineSets(selectedProject?.id)

  const [selectedSetId, setSelectedSetId] = useState<string>('')
  const [subTab, setSubTab] = useState<SubTab>('Overview')
  const [data, setData] = useState<BaselineComparisonResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [showCaptureForm, setShowCaptureForm] = useState(false)
  const [captureName, setCaptureName] = useState('')
  const [captureDate, setCaptureDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!selectedSetId && baselineSets.length > 0) setSelectedSetId(baselineSets[0].id)
  }, [baselineSets, selectedSetId])

  useEffect(() => {
    if (!selectedSetId) {
      setData(null)
      return
    }
    setLoading(true)
    api.get<BaselineComparisonResponse>('/api/v1/dashboard/baseline-comparison', { params: { baseline_set_id: selectedSetId } })
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [selectedSetId])

  const handleCapture = async () => {
    if (!period || !schedulePeriod || !captureName.trim()) return
    setCapturing(true)
    try {
      const created = await captureAll(captureName.trim(), captureDate, period.id, schedulePeriod.id)
      setSelectedSetId(created.id)
      setShowCaptureForm(false)
      setCaptureName('')
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <select
            className="border border-gray-300 rounded-md px-2 py-1.5 min-w-[200px]"
            value={selectedSetId}
            onChange={e => setSelectedSetId(e.target.value)}
          >
            {baselineSets.length === 0 && <option value="">No baseline sets yet</option>}
            {baselineSets.map(bs => (
              <option key={bs.id} value={bs.id}>{bs.name} — {formatDate(bs.baseline_date)}</option>
            ))}
          </select>
          {data && <span className="text-gray-400">Comparing against: {data.baseline_set_name}</span>}
        </div>
        <button
          className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-blue-700"
          onClick={() => setShowCaptureForm(v => !v)}
        >
          + Capture All Now
        </button>
      </div>

      {showCaptureForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-end gap-3 text-sm">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              className="border border-gray-300 rounded-md px-2 py-1.5"
              value={captureName}
              onChange={e => setCaptureName(e.target.value)}
              placeholder="e.g. Contract Baseline"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Date</label>
            <input
              type="date"
              className="border border-gray-300 rounded-md px-2 py-1.5"
              value={captureDate}
              onChange={e => setCaptureDate(e.target.value)}
            />
          </div>
          <button
            className="bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50"
            disabled={capturing || !captureName.trim()}
            onClick={handleCapture}
          >
            {capturing ? 'Capturing…' : 'Capture Schedule + Risk + Cost + ICD'}
          </button>
        </div>
      )}

      {setsLoading || loading ? (
        <div className="p-8 text-gray-400 text-sm">Loading…</div>
      ) : !data ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
          No baseline set yet — click "Capture All Now" to snapshot the current Schedule, Risk, Cost, and ICD state.
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-gray-200">
            {SUB_TABS.map(tab => (
              <button
                key={tab}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${subTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                onClick={() => setSubTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {subTab === 'Overview' && <OverviewSubTab data={data} />}
          {subTab === 'Schedule' && <ScheduleSubTab data={data} />}
          {subTab === 'Risk' && <RiskSubTab data={data} />}
          {subTab === 'Cost' && <CostSubTab data={data} />}
          {subTab === 'ICD' && <IcdSubTab data={data} />}
        </>
      )}
    </div>
  )
}

function EmptyModule({ label }: { label: string }) {
  return <div className="text-xs text-gray-400">No {label} baseline linked to this set.</div>
}

function OverviewSubTab({ data }: { data: BaselineComparisonResponse }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="font-semibold text-sm mb-2">Schedule</div>
        {data.schedule ? (
          <div className="text-xs space-y-1 text-gray-600">
            <div>{data.schedule.summary.slipped_count} of {data.schedule.summary.total} activities slipped</div>
            <div>Avg slip: {data.schedule.summary.avg_slip_days ?? '—'} days</div>
            <div>SPI: {formatDelta(data.schedule.summary.baseline_spi, data.schedule.summary.current_spi)}</div>
          </div>
        ) : <EmptyModule label="Schedule" />}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="font-semibold text-sm mb-2">Risk</div>
        {data.risk ? (
          <div className="text-xs space-y-1 text-gray-600">
            <div>{data.risk.summary.increased_count} increased, {data.risk.summary.decreased_count} decreased</div>
            <div>EMV: {formatDelta(data.risk.summary.baseline_emv_cost_total, data.risk.summary.current_emv_cost_total, 0, true)}</div>
          </div>
        ) : <EmptyModule label="Risk" />}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="font-semibold text-sm mb-2">Cost</div>
        {data.cost ? (
          <div className="text-xs space-y-1 text-gray-600">
            <div>BAC: {formatDelta(data.cost.summary.baseline_bac, data.cost.summary.current_bac, 0, true, false)}</div>
            <div>CPI: {formatDelta(data.cost.summary.baseline_cpi, data.cost.summary.current_cpi)}</div>
          </div>
        ) : <EmptyModule label="Cost" />}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="font-semibold text-sm mb-2">ICD</div>
        {data.icd ? (
          <div className="text-xs space-y-1 text-gray-600">
            <div>Issues open: {data.icd.summary.issue.baseline_open} → {data.icd.summary.issue.current_open}</div>
            <div>Changes open: {data.icd.summary.change.baseline_open} → {data.icd.summary.change.current_open}</div>
          </div>
        ) : <EmptyModule label="ICD" />}
      </div>
    </div>
  )
}

function ScheduleSubTab({ data }: { data: BaselineComparisonResponse }) {
  if (!data.schedule) return <EmptyModule label="Schedule" />
  const changed = data.schedule.items.filter(i =>
    (i.variance_days !== null && i.variance_days !== 0) || i.baseline_finish === null || i.current_finish === null
  )
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-3">
        {data.schedule.summary.slipped_count} of {data.schedule.summary.total} activities slipped since "{data.schedule.baseline_name}" —
        average slip {data.schedule.summary.avg_slip_days ?? '—'} days. SPI: {formatDelta(data.schedule.summary.baseline_spi, data.schedule.summary.current_spi)}
        <span className="text-gray-400"> ({changed.length} of {data.schedule.items.length} moved)</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-100">
            <th className="py-1.5 pr-2">Code</th><th className="py-1.5 pr-2">Activity</th>
            <th className="py-1.5 pr-2">Baseline Finish</th><th className="py-1.5 pr-2">Current Finish</th><th className="py-1.5 pr-2">Variance</th>
          </tr>
        </thead>
        <tbody>
          {changed.length === 0 && (
            <tr><td colSpan={5} className="py-3 text-center text-gray-400">No slipped or advanced activities.</td></tr>
          )}
          {changed.map(i => (
            <tr key={i.activity_id} className="border-b border-gray-50">
              <td className="py-1.5 pr-2 text-gray-500">{i.code}</td>
              <td className="py-1.5 pr-2">{i.task_name}</td>
              <td className="py-1.5 pr-2">{i.baseline_finish === null ? <span className="text-gray-400">(new)</span> : formatDate(i.baseline_finish)}</td>
              <td className="py-1.5 pr-2">{i.current_finish === null ? <span className="text-gray-400">(removed)</span> : formatDate(i.current_finish)}</td>
              <td className={`py-1.5 pr-2 font-medium ${i.variance_days === null ? 'text-gray-500' : i.variance_days > 0 ? 'text-red-600' : i.variance_days < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                {i.variance_days !== null ? `${i.variance_days > 0 ? '+' : ''}${i.variance_days}d` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RiskSubTab({ data }: { data: BaselineComparisonResponse }) {
  if (!data.risk) return <EmptyModule label="Risk" />
  const changed = data.risk.items.filter(i => numChanged(i.baseline_rating, i.current_rating) || numChanged(i.baseline_emv_cost, i.current_emv_cost))
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-3">
        Since "{data.risk.baseline_name}": {data.risk.summary.increased_count} increased, {data.risk.summary.decreased_count} decreased,{' '}
        {data.risk.summary.unchanged_count} unchanged. Total EMV: {formatDelta(data.risk.summary.baseline_emv_cost_total, data.risk.summary.current_emv_cost_total, 0, true)}.
        <span className="text-gray-400"> ({changed.length} of {data.risk.items.length} moved)</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-100">
            <th className="py-1.5 pr-2">Code</th><th className="py-1.5 pr-2">Title</th>
            <th className="py-1.5 pr-2">Rating</th><th className="py-1.5 pr-2">EMV Cost</th>
          </tr>
        </thead>
        <tbody>
          {changed.length === 0 && (
            <tr><td colSpan={4} className="py-3 text-center text-gray-400">No risks have moved.</td></tr>
          )}
          {changed.map(i => (
            <tr key={i.risk_id} className="border-b border-gray-50">
              <td className="py-1.5 pr-2 text-gray-500">{i.code}</td>
              <td className="py-1.5 pr-2">{i.title}</td>
              <td className="py-1.5 pr-2">{formatDelta(i.baseline_rating, i.current_rating, 2, false, false)}</td>
              <td className="py-1.5 pr-2">{formatDelta(i.baseline_emv_cost, i.current_emv_cost, 0, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CostSubTab({ data }: { data: BaselineComparisonResponse }) {
  if (!data.cost) return <EmptyModule label="Cost" />
  const changed = data.cost.items.filter(i => numChanged(i.baseline_budget, i.current_budget) || numChanged(i.baseline_cpi, i.current_cpi))
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-3">
        Since "{data.cost.baseline_name}": BAC {formatDelta(data.cost.summary.baseline_bac, data.cost.summary.current_bac, 0, true, false)},
        {' '}CPI {formatDelta(data.cost.summary.baseline_cpi, data.cost.summary.current_cpi)},
        {' '}EAC {formatDelta(data.cost.summary.baseline_eac, data.cost.summary.current_eac, 0, true, false)}.
        <span className="text-gray-400"> ({changed.length} of {data.cost.items.length} moved)</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-100">
            <th className="py-1.5 pr-2">Code</th><th className="py-1.5 pr-2">Description</th>
            <th className="py-1.5 pr-2">Budget</th><th className="py-1.5 pr-2">CPI</th>
          </tr>
        </thead>
        <tbody>
          {changed.length === 0 && (
            <tr><td colSpan={4} className="py-3 text-center text-gray-400">No cost elements have moved.</td></tr>
          )}
          {changed.map(i => (
            <tr key={i.cost_element_id} className="border-b border-gray-50">
              <td className="py-1.5 pr-2 text-gray-500">{i.code}</td>
              <td className="py-1.5 pr-2">{i.description}</td>
              <td className="py-1.5 pr-2">{formatDelta(i.baseline_budget, i.current_budget, 0, true, false)}</td>
              <td className="py-1.5 pr-2">{formatDelta(i.baseline_cpi, i.current_cpi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IcdSubTab({ data }: { data: BaselineComparisonResponse }) {
  if (!data.icd) return <EmptyModule label="ICD" />
  const changed = data.icd.items.filter(i => i.current_status !== i.baseline_status)
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="grid grid-cols-3 gap-4 mb-3 text-xs">
        {(['issue', 'change', 'decision'] as const).map(t => (
          <div key={t} className="bg-gray-50 rounded-md p-2.5 text-center">
            <div className="font-semibold capitalize">{t}s</div>
            <div className="text-gray-600">{data.icd!.summary[t].baseline_open} → {data.icd!.summary[t].current_open} open</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-400 mb-2">{changed.length} of {data.icd.items.length} changed status</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-100">
            <th className="py-1.5 pr-2">Code</th><th className="py-1.5 pr-2">Type</th><th className="py-1.5 pr-2">Title</th>
            <th className="py-1.5 pr-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {changed.length === 0 && (
            <tr><td colSpan={4} className="py-3 text-center text-gray-400">No status changes.</td></tr>
          )}
          {changed.map(i => (
            <tr key={i.icd_item_id} className="border-b border-gray-50">
              <td className="py-1.5 pr-2 text-gray-500">{i.code}</td>
              <td className="py-1.5 pr-2 text-gray-500 capitalize">{i.item_type}</td>
              <td className="py-1.5 pr-2">{i.title}</td>
              <td className="py-1.5 pr-2 text-gray-500">
                {i.baseline_status === null ? '(new) ' + i.current_status : i.current_status === null ? i.baseline_status + ' (removed)' : `${i.baseline_status} → ${i.current_status}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
