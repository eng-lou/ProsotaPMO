import { useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import {
  COST_ELEMENT_STATUSES, COST_ELEMENT_STATUS_LABELS, ELEMENT_TYPES, REASSESSMENT_TRIGGER_FIELDS,
  type CostElement, type CostElementStatus,
} from './types'

export interface CostFormValues {
  description: string
  element_group: string
  element_type: 'fixed' | 'percentage'
  rate: string
  cost_owner: string
  status: CostElementStatus | ''
  scope_note: string
  variance_commentary: string
  qs_signoff_name: string
  qs_signoff_date: string
  budget: string
  actuals: string
  pct_complete: string
  last_reviewed_date: string
}

function toFormValues(el: CostElement | null): CostFormValues {
  return {
    description: el?.description ?? '',
    element_group: el?.element_group ?? '',
    element_type: el?.element_type ?? 'fixed',
    rate: el?.rate ?? '',
    cost_owner: el?.cost_owner ?? '',
    status: el?.status ?? '',
    scope_note: el?.scope_note ?? '',
    variance_commentary: el?.variance_commentary ?? '',
    qs_signoff_name: el?.qs_signoff_name ?? '',
    qs_signoff_date: el?.qs_signoff_date ?? '',
    budget: el?.budget ?? '',
    actuals: el?.actuals ?? '',
    pct_complete: el?.pct_complete?.toString() ?? '',
    last_reviewed_date: el?.last_reviewed_date ?? '',
  }
}

export function toCostElementPayload(values: CostFormValues) {
  const isPercentage = values.element_type === 'percentage'
  return {
    description: values.description.trim(),
    element_group: values.element_group.trim() || null,
    element_type: values.element_type,
    rate: isPercentage ? values.rate : null,
    cost_owner: values.cost_owner.trim() || null,
    status: values.status || null,
    scope_note: values.scope_note.trim() || null,
    variance_commentary: values.variance_commentary.trim() || null,
    qs_signoff_name: values.qs_signoff_name.trim() || null,
    qs_signoff_date: values.qs_signoff_date || null,
    budget: !isPercentage && values.budget !== '' ? values.budget : null,
    actuals: !isPercentage && values.actuals !== '' ? values.actuals : null,
    pct_complete: values.pct_complete === '' ? null : Number(values.pct_complete),
    last_reviewed_date: values.last_reviewed_date || null,
  }
}

interface CostFormProps {
  costElement: CostElement | null
  onCancel: () => void
  // reassessmentNote is non-null only when a trigger field (status/budget/
  // actuals/rate) changed and the user filled in the "what changed and why" prompt.
  onSubmit: (values: CostFormValues, reassessmentNote: string | null) => Promise<void>
}

const inputClass =
  'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const labelClass = 'block text-xs font-medium text-gray-600 mb-1'

export function CostForm({ costElement, onCancel, onSubmit }: CostFormProps) {
  const [values, setValues] = useState<CostFormValues>(() => toFormValues(costElement))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reassessmentNote, setReassessmentNote] = useState('')

  const set = <K extends keyof CostFormValues>(key: K, value: CostFormValues[K]) =>
    setValues(prev => ({ ...prev, [key]: value }))

  const hasTriggerChanges = costElement !== null && REASSESSMENT_TRIGGER_FIELDS.some(
    field => (costElement[field] ?? '') !== values[field]
  )

  // Resources module: a "schedule"-sourced element's budget is normally kept in
  // sync automatically from resource assignments in Scheduling. Editing it here
  // directly unlinks it permanently — warn before that happens, matching how
  // Scheduling's own inline-edit-Start confirms before applying a constraint.
  const isScheduleLinked = costElement?.source === 'schedule'
  const budgetChanged = costElement !== null && (costElement.budget ?? '') !== values.budget

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!values.description.trim()) {
      setError('Description is required')
      return
    }
    if (values.element_type === 'percentage' && values.rate === '') {
      setError('Rate is required for percentage elements')
      return
    }
    if (isScheduleLinked && budgetChanged && !(await confirmWithDontAsk(
      'cost.form-unlink-from-schedule',
      'This line\'s budget is currently managed automatically from Scheduling resource assignments. ' +
      'Editing it directly will unlink it permanently — future resource assignment changes won\'t update it anymore. Continue?'
    ))) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(values, hasTriggerChanges && reassessmentNote.trim() ? reassessmentNote.trim() : null)
    } catch {
      setError('Failed to save cost element')
    } finally {
      setSubmitting(false)
    }
  }

  const isPercentage = values.element_type === 'percentage'

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-gray-200 rounded-lg p-5 space-y-4 mb-6"
    >
      <h2 className="font-medium text-gray-900 text-sm">{costElement ? 'Edit cost element' : 'New cost element'}</h2>

      {isScheduleLinked && (
        <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800">
          🔗 This line is managed automatically from Scheduling resource assignments (see the linked activity's
          Resources tab). Editing Budget below will unlink it permanently — resource changes won't update it anymore.
        </div>
      )}

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded-md text-red-700 text-xs">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Description *</label>
          <input
            autoFocus
            type="text"
            value={values.description}
            onChange={e => set('description', e.target.value)}
            className={inputClass}
            placeholder="e.g. Substructure, Prelims"
          />
        </div>
        <div>
          <label className={labelClass}>Group</label>
          <input
            type="text"
            value={values.element_group}
            onChange={e => set('element_group', e.target.value)}
            className={inputClass}
            placeholder="e.g. Structure, On Costs"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Cost owner</label>
          <input
            type="text"
            value={values.cost_owner}
            onChange={e => set('cost_owner', e.target.value)}
            className={inputClass}
            placeholder="Who's accountable for this line"
          />
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select
            value={values.status}
            onChange={e => set('status', e.target.value as CostElementStatus)}
            className={inputClass}
          >
            <option value="">—</option>
            {COST_ELEMENT_STATUSES.map(s => <option key={s} value={s}>{COST_ELEMENT_STATUS_LABELS[s]}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">Over Budget/Monitor/Saving are shown automatically from variance, not set here.</p>
        </div>
      </div>

      <div>
        <label className={labelClass}>Type</label>
        <select
          value={values.element_type}
          onChange={e => set('element_type', e.target.value as 'fixed' | 'percentage')}
          className={inputClass}
        >
          {ELEMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <p className="text-xs text-gray-400 mt-1">
          Percentage elements (e.g. Prelims, Contingency) compute their value from the sum of all fixed elements — they don't get their own budget figure.
        </p>
      </div>

      {isPercentage ? (
        <div>
          <label className={labelClass}>Rate (e.g. 0.15 = 15%, negative for a credit/deduction)</label>
          <input
            type="number" min={-1} max={10} step={0.001}
            value={values.rate}
            onChange={e => set('rate', e.target.value)}
            className={inputClass}
            placeholder="0.15"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Budget (£)</label>
            <input
              type="number" step="0.01"
              value={values.budget}
              onChange={e => set('budget', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Actuals (£)</label>
            <input
              type="number" step="0.01"
              value={values.actuals}
              onChange={e => set('actuals', e.target.value)}
              className={inputClass}
            />
            {isScheduleLinked && (
              <p className="text-xs text-gray-400 mt-1">Can also be entered from the activity's Resources tab in Scheduling — same figure, either place.</p>
            )}
          </div>
        </div>
      )}
      {!isPercentage && (
        <p className="text-xs text-gray-400 -mt-2">
          Forecast isn't entered here — it's the computed EAC (Estimate at Completion) once % complete is set below, or the budget itself before then.
          {!costElement && ' The budget entered here also becomes the Rev A baseline, since there\'s no prior revision yet — it stays fixed after this, even if budget changes later.'}
        </p>
      )}

      {!isPercentage && (
        <div>
          <label className={labelClass}>% Complete</label>
          <input
            type="number" min={0} max={100} step={1}
            value={values.pct_complete}
            onChange={e => set('pct_complete', e.target.value)}
            disabled={isScheduleLinked}
            className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400`}
            placeholder="e.g. 70"
          />
          <p className="text-xs text-gray-400 mt-1">
            {isScheduleLinked
              ? 'Synced automatically from the linked activity\'s % Complete in Scheduling — edit it there, not here, so this line\'s EVM always matches Scheduling\'s.'
              : 'Physical progress — drives Earned Value (CV/CPI/EAC/ETC/VAC/TCPI), shown read-only once saved.'}
          </p>
        </div>
      )}

      <div>
        <label className={labelClass}>Scope / specification note</label>
        <textarea
          value={values.scope_note}
          onChange={e => set('scope_note', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="What does this line actually cover?"
        />
      </div>
      <div>
        <label className={labelClass}>Variance commentary</label>
        <textarea
          value={values.variance_commentary}
          onChange={e => set('variance_commentary', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="Why has this line moved vs baseline?"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>QS sign-off</label>
          <input
            type="text"
            value={values.qs_signoff_name}
            onChange={e => set('qs_signoff_name', e.target.value)}
            className={inputClass}
            placeholder="Who signed off this variance"
          />
        </div>
        <div>
          <label className={labelClass}>Sign-off date</label>
          <input
            type="date"
            value={values.qs_signoff_date}
            onChange={e => set('qs_signoff_date', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Last reviewed</label>
        <input
          type="date"
          value={values.last_reviewed_date}
          onChange={e => set('last_reviewed_date', e.target.value)}
          className={inputClass}
        />
        <p className="text-xs text-gray-400 mt-1">Auto-updated whenever a reassessment is logged below; editable here too.</p>
      </div>

      {hasTriggerChanges && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
          <label className={labelClass}>
            Status, budget, actuals, or rate changed — what changed and why? (optional, logged with today's date)
          </label>
          <textarea
            value={reassessmentNote}
            onChange={e => setReassessmentNote(e.target.value)}
            className={inputClass}
            rows={2}
            placeholder="e.g. Budget increased following tender return — rate revised £450→£576/nr."
          />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : costElement ? 'Save changes' : 'Create cost element'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-gray-500 px-4 py-2 rounded-md text-sm hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
