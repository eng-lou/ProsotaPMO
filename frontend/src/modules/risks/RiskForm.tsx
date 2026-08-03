import { useState } from 'react'
import {
  REASSESSMENT_TRIGGER_FIELDS,
  RESPONSE_STRATEGIES_BY_TYPE,
  RISK_STATUSES,
  type Risk,
  type RiskType,
} from './types'

export interface RiskFormValues {
  title: string
  category: string
  area: string
  status: string
  risk_owner: string
  date_raised: string
  date_closed: string
  expected_impact_date: string
  last_reviewed_date: string
  cause: string
  effect: string
  rationale: string
  risk_type: RiskType
  response_strategy: string
  probability: string
  impact: string
  probability_residual: string
  impact_residual: string
  rating_narrative: string
  cost_min: string
  cost_most_likely: string
  cost_max: string
  schedule_min_days: string
  schedule_most_likely_days: string
  schedule_max_days: string
  mitigation_status: string
  contingency_plan: string
  fallback_plan: string
}

function toFormValues(risk: Risk | null): RiskFormValues {
  return {
    title: risk?.title ?? '',
    category: risk?.category ?? '',
    area: risk?.area ?? '',
    status: risk?.status ?? 'open',
    risk_owner: risk?.risk_owner ?? '',
    date_raised: risk?.date_raised ?? '',
    date_closed: risk?.date_closed ?? '',
    expected_impact_date: risk?.expected_impact_date ?? '',
    last_reviewed_date: risk?.last_reviewed_date ?? '',
    cause: risk?.cause ?? '',
    effect: risk?.effect ?? '',
    rationale: risk?.rationale ?? '',
    risk_type: risk?.risk_type ?? 'threat',
    response_strategy: risk?.response_strategy ?? '',
    probability: risk?.probability ?? '',
    impact: risk?.impact ?? '',
    probability_residual: risk?.probability_residual ?? '',
    impact_residual: risk?.impact_residual ?? '',
    rating_narrative: risk?.rating_narrative ?? '',
    cost_min: risk?.cost_min ?? '',
    cost_most_likely: risk?.cost_most_likely ?? '',
    cost_max: risk?.cost_max ?? '',
    schedule_min_days: risk?.schedule_min_days?.toString() ?? '',
    schedule_most_likely_days: risk?.schedule_most_likely_days?.toString() ?? '',
    schedule_max_days: risk?.schedule_max_days?.toString() ?? '',
    mitigation_status: risk?.mitigation_status ?? '',
    contingency_plan: risk?.contingency_plan ?? '',
    fallback_plan: risk?.fallback_plan ?? '',
  }
}

// probability/impact are 0-1 fractions used for the qualitative heat-map rating.
// cost_most_likely/schedule_most_likely_days are always entered as positive magnitudes
// ("how big is the impact if this happens") — EMV's sign is derived server-side from
// risk_type, not typed in (EMV = Probability x Impact, per PMBOK7 / Rita Mulcahy).
// rating and emv_cost/emv_schedule_days are computed server-side and never sent.
export function toRiskPayload(values: RiskFormValues) {
  return {
    title: values.title.trim(),
    category: values.category.trim() || null,
    area: values.area.trim() || null,
    status: values.status,
    risk_owner: values.risk_owner.trim() || null,
    date_raised: values.date_raised || null,
    date_closed: values.date_closed || null,
    expected_impact_date: values.expected_impact_date || null,
    last_reviewed_date: values.last_reviewed_date || null,
    cause: values.cause.trim() || null,
    effect: values.effect.trim() || null,
    rationale: values.rationale.trim() || null,
    risk_type: values.risk_type,
    response_strategy: values.response_strategy || null,
    probability: values.probability === '' ? null : values.probability,
    impact: values.impact === '' ? null : values.impact,
    probability_residual: values.probability_residual === '' ? null : values.probability_residual,
    impact_residual: values.impact_residual === '' ? null : values.impact_residual,
    rating_narrative: values.rating_narrative.trim() || null,
    cost_min: values.cost_min === '' ? null : values.cost_min,
    cost_most_likely: values.cost_most_likely === '' ? null : values.cost_most_likely,
    cost_max: values.cost_max === '' ? null : values.cost_max,
    schedule_min_days: values.schedule_min_days === '' ? null : Number(values.schedule_min_days),
    schedule_most_likely_days: values.schedule_most_likely_days === '' ? null : Number(values.schedule_most_likely_days),
    schedule_max_days: values.schedule_max_days === '' ? null : Number(values.schedule_max_days),
    mitigation_status: values.mitigation_status.trim() || null,
    contingency_plan: values.contingency_plan.trim() || null,
    fallback_plan: values.fallback_plan.trim() || null,
  }
}

interface RiskFormProps {
  risk: Risk | null
  onCancel: () => void
  // reassessmentNote is non-null only when a trigger field (probability/impact/
  // status/etc.) changed and the user filled in the "what changed and why" prompt.
  onSubmit: (values: RiskFormValues, reassessmentNote: string | null) => Promise<void>
}

const inputClass =
  'w-full border border-gray-300 dark:border-prosota-line rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const labelClass = 'block text-xs font-medium text-gray-600 dark:text-prosota-muted mb-1'
const sectionClass = 'text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide pt-2 border-t border-gray-100 dark:border-prosota-line first:pt-0 first:border-0'

export function RiskForm({ risk, onCancel, onSubmit }: RiskFormProps) {
  const [values, setValues] = useState<RiskFormValues>(() => toFormValues(risk))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reassessmentNote, setReassessmentNote] = useState('')

  const set = <K extends keyof RiskFormValues>(key: K, value: RiskFormValues[K]) =>
    setValues(prev => ({ ...prev, [key]: value }))

  const hasTriggerChanges = risk !== null && REASSESSMENT_TRIGGER_FIELDS.some(
    field => (risk[field] ?? '') !== values[field]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!values.title.trim()) {
      setError('Title is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(values, hasTriggerChanges && reassessmentNote.trim() ? reassessmentNote.trim() : null)
    } catch {
      setError('Failed to save risk')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 space-y-4 mb-6"
    >
      <h2 className="font-medium text-gray-900 dark:text-prosota-paper text-sm">{risk ? 'Edit risk' : 'New risk'}</h2>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/30 rounded-md text-red-700 dark:text-red-400 text-xs">
          {error}
        </div>
      )}

      <div>
        <label className={labelClass}>Title *</label>
        <input
          autoFocus
          type="text"
          value={values.title}
          onChange={e => set('title', e.target.value)}
          className={inputClass}
          placeholder="e.g. Unforeseen ground conditions"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Risk type</label>
          <select
            value={values.risk_type}
            onChange={e => {
              const newType = e.target.value as RiskType
              setValues(prev => ({
                ...prev,
                risk_type: newType,
                response_strategy: RESPONSE_STRATEGIES_BY_TYPE[newType].includes(prev.response_strategy)
                  ? prev.response_strategy
                  : '',
              }))
            }}
            className={inputClass}
          >
            <option value="threat">Threat</option>
            <option value="opportunity">Opportunity</option>
          </select>
          <p className="text-xs text-gray-400 dark:text-prosota-muted mt-1">Threats cost/delay the project if realized; opportunities save money/time.</p>
        </div>
        <div>
          <label className={labelClass}>Risk owner</label>
          <input
            type="text"
            value={values.risk_owner}
            onChange={e => set('risk_owner', e.target.value)}
            className={inputClass}
            placeholder="Who watches for and leads the response"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Theme (category)</label>
          <input
            type="text"
            value={values.category}
            onChange={e => set('category', e.target.value)}
            className={inputClass}
            placeholder="e.g. Schedule, Safety, Regulatory"
          />
        </div>
        <div>
          <label className={labelClass}>Area</label>
          <input
            type="text"
            value={values.area}
            onChange={e => set('area', e.target.value)}
            className={inputClass}
            placeholder="e.g. Vendor, Site, Stakeholders"
          />
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select value={values.status} onChange={e => set('status', e.target.value)} className={inputClass}>
            {RISK_STATUSES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={sectionClass}>Key dates</div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Date raised</label>
          <input
            type="date"
            value={values.date_raised}
            onChange={e => set('date_raised', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Expected impact date</label>
          <input
            type="date"
            value={values.expected_impact_date}
            onChange={e => set('expected_impact_date', e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-gray-400 dark:text-prosota-muted mt-1">When the risk is expected to occur/materialise, if it does.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Last reviewed</label>
          <input
            type="date"
            value={values.last_reviewed_date}
            onChange={e => set('last_reviewed_date', e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-gray-400 dark:text-prosota-muted mt-1">Auto-updated whenever a reassessment is logged below; editable here too.</p>
        </div>
        <div>
          <label className={labelClass}>Date closed</label>
          <input
            type="date"
            value={values.date_closed}
            onChange={e => set('date_closed', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className={sectionClass}>Risk statement</div>

      <div>
        <label className={labelClass}>Cause</label>
        <textarea
          value={values.cause}
          onChange={e => set('cause', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="What could cause this risk to occur?"
        />
      </div>
      <div>
        <label className={labelClass}>Effect</label>
        <textarea
          value={values.effect}
          onChange={e => set('effect', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="What happens to the project if it occurs?"
        />
      </div>
      <div>
        <label className={labelClass}>Rationale / Assumptions</label>
        <textarea
          value={values.rationale}
          onChange={e => set('rationale', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="Why do we believe this is a risk right now?"
        />
      </div>

      <div className={sectionClass}>Qualitative analysis (heat-map)</div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Probability (0–1)</label>
          <input
            type="number" min={0} max={1} step={0.01}
            value={values.probability}
            onChange={e => set('probability', e.target.value)}
            className={inputClass}
            placeholder="0.65"
          />
          <p className="text-xs text-gray-400 dark:text-prosota-muted mt-1">Likelihood the risk occurs — used for both the heat-map rating and EMV.</p>
        </div>
        <div>
          <label className={labelClass}>Impact rating (0–1)</label>
          <input
            type="number" min={0} max={1} step={0.01}
            value={values.impact}
            onChange={e => set('impact', e.target.value)}
            className={inputClass}
            placeholder="0.80"
          />
          <p className="text-xs text-gray-400 dark:text-prosota-muted mt-1">Qualitative severity score for the heat-map only (not money/time).</p>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-prosota-muted -mt-2">Inherent (pre-mitigation) position, above. Residual (post-mitigation target), below.</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Residual probability (0–1)</label>
          <input
            type="number" min={0} max={1} step={0.01}
            value={values.probability_residual}
            onChange={e => set('probability_residual', e.target.value)}
            className={inputClass}
            placeholder="0.20"
          />
        </div>
        <div>
          <label className={labelClass}>Residual impact (0–1)</label>
          <input
            type="number" min={0} max={1} step={0.01}
            value={values.impact_residual}
            onChange={e => set('impact_residual', e.target.value)}
            className={inputClass}
            placeholder="0.40"
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Rating narrative</label>
        <textarea
          value={values.rating_narrative}
          onChange={e => set('rating_narrative', e.target.value)}
          className={inputClass}
          rows={3}
          placeholder="Why is the inherent rating what it is, and what does the residual target assume?"
        />
      </div>

      <div className={sectionClass}>Quantitative analysis (EMV) — 3-point estimate</div>

      <div>
        <label className={labelClass}>Cost impact if realized (£): Min / Most Likely / Max</label>
        <div className="grid grid-cols-3 gap-3">
          <input
            type="number" step="0.01"
            value={values.cost_min}
            onChange={e => set('cost_min', e.target.value)}
            className={inputClass}
            placeholder="50000"
          />
          <input
            type="number" step="0.01"
            value={values.cost_most_likely}
            onChange={e => set('cost_most_likely', e.target.value)}
            className={inputClass}
            placeholder="120000"
          />
          <input
            type="number" step="0.01"
            value={values.cost_max}
            onChange={e => set('cost_max', e.target.value)}
            className={inputClass}
            placeholder="340000"
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>Schedule impact if realized (days): Min / Most Likely / Max</label>
        <div className="grid grid-cols-3 gap-3">
          <input
            type="number" step="1"
            value={values.schedule_min_days}
            onChange={e => set('schedule_min_days', e.target.value)}
            className={inputClass}
            placeholder="7"
          />
          <input
            type="number" step="1"
            value={values.schedule_most_likely_days}
            onChange={e => set('schedule_most_likely_days', e.target.value)}
            className={inputClass}
            placeholder="21"
          />
          <input
            type="number" step="1"
            value={values.schedule_max_days}
            onChange={e => set('schedule_max_days', e.target.value)}
            className={inputClass}
            placeholder="63"
          />
        </div>
      </div>
      <p className="text-xs text-gray-400 dark:text-prosota-muted -mt-2">
        EMV (Expected Monetary Value = Probability x Impact) is calculated automatically from the Most Likely value —
        shown read-only in the table once saved. Min/Max give the range context only.
      </p>

      <div className={sectionClass}>Response strategy</div>

      <div>
        <label className={labelClass}>Response strategy</label>
        <select
          value={values.response_strategy}
          onChange={e => set('response_strategy', e.target.value)}
          className={inputClass}
        >
          <option value="">—</option>
          {RESPONSE_STRATEGIES_BY_TYPE[values.risk_type].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400 dark:text-prosota-muted mt-1">
          Options depend on risk type — {values.risk_type === 'threat' ? 'Avoid/Mitigate/Transfer/Escalate/Accept' : 'Exploit/Enhance/Share/Escalate/Accept'}.
        </p>
      </div>

      <div>
        <label className={labelClass}>Mitigation status</label>
        <textarea
          value={values.mitigation_status}
          onChange={e => set('mitigation_status', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="e.g. Mitigation plan agreed with subcontractor"
        />
      </div>

      <div>
        <label className={labelClass}>Contingency plan</label>
        <textarea
          value={values.contingency_plan}
          onChange={e => set('contingency_plan', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="What will we do if this risk occurs?"
        />
      </div>
      <div>
        <label className={labelClass}>Fallback plan</label>
        <textarea
          value={values.fallback_plan}
          onChange={e => set('fallback_plan', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="What will we do if the contingency plan doesn't work?"
        />
      </div>

      {hasTriggerChanges && (
        <div className="p-3 bg-blue-50 border border-blue-200 dark:border-prosota-azure/30 rounded-md">
          <label className={labelClass}>
            Probability, impact, or status changed — what changed and why? (optional, logged with today's date)
          </label>
          <textarea
            value={reassessmentNote}
            onChange={e => setReassessmentNote(e.target.value)}
            className={inputClass}
            rows={2}
            placeholder="e.g. Probability reduced from 0.65 to 0.30 following supplier confirmation of dual-sourcing."
          />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : risk ? 'Save changes' : 'Create risk'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-gray-500 dark:text-prosota-muted px-4 py-2 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-prosota-panel2"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
