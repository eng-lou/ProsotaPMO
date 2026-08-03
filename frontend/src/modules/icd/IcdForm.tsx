import { useState } from 'react'
import {
  CCB_DECISIONS, CHANGE_TYPES, CHANGE_TYPE_LABELS, ITEM_TYPE_LABELS, ITEM_TYPES, PRIORITIES,
  PRIORITY_LABELS, QUALITY_IMPACTS, REASSESSMENT_TRIGGER_FIELDS, SEVERITIES, STATUSES_BY_TYPE, STATUS_LABELS,
  type CcbDecision, type ChangeType, type IcdItem, type ItemType, type QualityImpact, type Severity,
} from './types'

export interface IcdFormValues {
  item_type: ItemType
  title: string
  description: string
  status: string
  priority: string
  raised_by: string
  owner: string
  raised_date: string
  due_date: string
  closed_date: string
  resolution: string
  last_reviewed_date: string
  cost_impact: string
  schedule_impact_days: string
  change_type: ChangeType | ''
  ccb_decision: CcbDecision | ''
  rejection_reason: string
  contract_reference: string
  cost_claim: string
  eot_claim_days: string
  quality_impact: QualityImpact | ''
  decision_maker: string
  required_by: string
  if_late_consequence: string
  severity: Severity | ''
}

function toFormValues(item: IcdItem | null): IcdFormValues {
  return {
    item_type: item?.item_type ?? 'issue',
    title: item?.title ?? '',
    description: item?.description ?? '',
    status: item?.status ?? STATUSES_BY_TYPE[item?.item_type ?? 'issue'][0],
    priority: item?.priority ?? '',
    raised_by: item?.raised_by ?? '',
    owner: item?.owner ?? '',
    raised_date: item?.raised_date ?? '',
    due_date: item?.due_date ?? '',
    closed_date: item?.closed_date ?? '',
    resolution: item?.resolution ?? '',
    last_reviewed_date: item?.last_reviewed_date ?? '',
    cost_impact: item?.cost_impact ?? '',
    schedule_impact_days: item?.schedule_impact_days?.toString() ?? '',
    change_type: item?.change_type ?? '',
    ccb_decision: item?.ccb_decision ?? '',
    rejection_reason: item?.rejection_reason ?? '',
    contract_reference: item?.contract_reference ?? '',
    cost_claim: item?.cost_claim ?? '',
    eot_claim_days: item?.eot_claim_days?.toString() ?? '',
    quality_impact: item?.quality_impact ?? '',
    decision_maker: item?.decision_maker ?? '',
    required_by: item?.required_by ?? '',
    if_late_consequence: item?.if_late_consequence ?? '',
    severity: item?.severity ?? '',
  }
}

// item_type is a discriminator — the backend rejects type-specific fields (cost_impact,
// decision_maker, severity, ...) that don't match it, and doesn't allow changing it after creation.
export function toIcdPayload(values: IcdFormValues) {
  return {
    title: values.title.trim(),
    description: values.description.trim() || null,
    status: values.status,
    priority: values.priority.trim() || null,
    raised_by: values.raised_by.trim() || null,
    owner: values.owner.trim() || null,
    raised_date: values.raised_date || null,
    due_date: values.item_type !== 'decision' && values.due_date ? values.due_date : null,
    closed_date: values.closed_date || null,
    resolution: values.resolution.trim() || null,
    last_reviewed_date: values.last_reviewed_date || null,
    cost_impact: values.item_type === 'change' && values.cost_impact !== '' ? values.cost_impact : null,
    schedule_impact_days: values.item_type === 'change' && values.schedule_impact_days !== '' ? Number(values.schedule_impact_days) : null,
    change_type: values.item_type === 'change' ? (values.change_type || null) : null,
    ccb_decision: values.item_type === 'change' ? (values.ccb_decision || null) : null,
    rejection_reason: values.item_type === 'change' && values.ccb_decision === 'rejected' ? (values.rejection_reason.trim() || null) : null,
    contract_reference: values.item_type === 'change' ? (values.contract_reference.trim() || null) : null,
    cost_claim: values.item_type === 'change' && values.cost_claim !== '' ? values.cost_claim : null,
    eot_claim_days: values.item_type === 'change' && values.eot_claim_days !== '' ? Number(values.eot_claim_days) : null,
    quality_impact: values.item_type === 'change' ? (values.quality_impact || null) : null,
    decision_maker: values.item_type === 'decision' ? (values.decision_maker.trim() || null) : null,
    required_by: values.item_type === 'decision' ? (values.required_by || null) : null,
    if_late_consequence: values.item_type === 'decision' ? (values.if_late_consequence.trim() || null) : null,
    severity: values.item_type === 'issue' ? (values.severity || null) : null,
  }
}

interface IcdFormProps {
  item: IcdItem | null
  onCancel: () => void
  // reassessmentNote is non-null only when a trigger field (status/priority/
  // severity/ccb_decision/cost_impact/quality_impact) changed and the user
  // filled in the "what changed and why" prompt.
  onSubmit: (values: IcdFormValues, reassessmentNote: string | null) => Promise<void>
}

const inputClass =
  'w-full border border-gray-300 dark:border-prosota-line rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const labelClass = 'block text-xs font-medium text-gray-600 dark:text-prosota-muted mb-1'

export function IcdForm({ item, onCancel, onSubmit }: IcdFormProps) {
  const [values, setValues] = useState<IcdFormValues>(() => toFormValues(item))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reassessmentNote, setReassessmentNote] = useState('')

  const set = <K extends keyof IcdFormValues>(key: K, value: IcdFormValues[K]) =>
    setValues(prev => ({ ...prev, [key]: value }))

  const hasTriggerChanges = item !== null && REASSESSMENT_TRIGGER_FIELDS.some(
    field => (item[field] ?? '') !== values[field]
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
      setError('Failed to save item')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 space-y-4 mb-6"
    >
      <h2 className="font-medium text-gray-900 dark:text-prosota-paper text-sm">{item ? 'Edit item' : 'New issue / change / decision'}</h2>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/30 rounded-md text-red-700 dark:text-red-400 text-xs">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Type</label>
          <select
            value={values.item_type}
            onChange={e => {
              const newType = e.target.value as ItemType
              setValues(prev => ({
                ...prev,
                item_type: newType,
                status: STATUSES_BY_TYPE[newType].includes(prev.status) ? prev.status : STATUSES_BY_TYPE[newType][0],
              }))
            }}
            className={inputClass}
            disabled={!!item}
          >
            {ITEM_TYPES.map(t => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}
          </select>
          {item && <p className="text-xs text-gray-400 dark:text-prosota-muted mt-1">Type can't be changed after creation.</p>}
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select
            value={values.status}
            onChange={e => set('status', e.target.value)}
            className={inputClass}
          >
            {!STATUSES_BY_TYPE[values.item_type].includes(values.status) && (
              <option value={values.status}>{STATUS_LABELS[values.status] ?? values.status}</option>
            )}
            {STATUSES_BY_TYPE[values.item_type].map(s => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Title *</label>
        <input
          autoFocus
          type="text"
          value={values.title}
          onChange={e => set('title', e.target.value)}
          className={inputClass}
          placeholder="e.g. Underground service clash — 450mm water main"
        />
      </div>

      <div>
        <label className={labelClass}>Description</label>
        <textarea
          value={values.description}
          onChange={e => set('description', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="What is this, in more detail?"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Priority</label>
          <select
            value={values.priority}
            onChange={e => set('priority', e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Raised by</label>
          <input
            type="text"
            value={values.raised_by}
            onChange={e => set('raised_by', e.target.value)}
            className={inputClass}
            placeholder="Who raised it"
          />
        </div>
        <div>
          <label className={labelClass}>Owner</label>
          <input
            type="text"
            value={values.owner}
            onChange={e => set('owner', e.target.value)}
            className={inputClass}
            placeholder="Who's resolving it"
          />
        </div>
      </div>

      <div className={values.item_type === 'decision' ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-3 gap-3'}>
        <div>
          <label className={labelClass}>Raised date</label>
          <input
            type="date"
            value={values.raised_date}
            onChange={e => set('raised_date', e.target.value)}
            className={inputClass}
          />
        </div>
        {values.item_type !== 'decision' && (
          <div>
            <label className={labelClass}>Due date</label>
            <input
              type="date"
              value={values.due_date}
              onChange={e => set('due_date', e.target.value)}
              className={inputClass}
            />
          </div>
        )}
        <div>
          <label className={labelClass}>Closed date</label>
          <input
            type="date"
            value={values.closed_date}
            onChange={e => set('closed_date', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {values.item_type === 'issue' && (
        <div>
          <label className={labelClass}>Severity</label>
          <select
            value={values.severity}
            onChange={e => set('severity', e.target.value as Severity)}
            className={inputClass}
          >
            <option value="">—</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {values.item_type === 'change' && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Change type</label>
              <select
                value={values.change_type}
                onChange={e => set('change_type', e.target.value as ChangeType)}
                className={inputClass}
              >
                <option value="">—</option>
                {CHANGE_TYPES.map(t => <option key={t} value={t}>{CHANGE_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>CCB decision</label>
              <select
                value={values.ccb_decision}
                onChange={e => set('ccb_decision', e.target.value as CcbDecision)}
                className={inputClass}
              >
                <option value="">Pending</option>
                {CCB_DECISIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Quality impact</label>
              <select
                value={values.quality_impact}
                onChange={e => set('quality_impact', e.target.value as QualityImpact)}
                className={inputClass}
              >
                <option value="">—</option>
                {QUALITY_IMPACTS.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
          </div>

          {values.ccb_decision === 'rejected' && (
            <div>
              <label className={labelClass}>Rejection reason</label>
              <textarea
                value={values.rejection_reason}
                onChange={e => set('rejection_reason', e.target.value)}
                className={inputClass}
                rows={2}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Cost impact (£)</label>
              <input
                type="number" step="0.01"
                value={values.cost_impact}
                onChange={e => set('cost_impact', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Schedule impact (days)</label>
              <input
                type="number" step="1"
                value={values.schedule_impact_days}
                onChange={e => set('schedule_impact_days', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Cost claim (£)</label>
              <input
                type="number" step="0.01"
                value={values.cost_claim}
                onChange={e => set('cost_claim', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>EOT claim (days)</label>
              <input
                type="number" step="1"
                value={values.eot_claim_days}
                onChange={e => set('eot_claim_days', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Contract reference</label>
            <textarea
              value={values.contract_reference}
              onChange={e => set('contract_reference', e.target.value)}
              className={inputClass}
              rows={2}
              placeholder="e.g. NEC3 ECC Clause 60.1(12). CE-009 submitted 10/05/2024."
            />
          </div>
        </>
      )}

      {values.item_type === 'decision' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Decision maker</label>
            <input
              type="text"
              value={values.decision_maker}
              onChange={e => set('decision_maker', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Required by</label>
            <input
              type="date"
              value={values.required_by}
              onChange={e => set('required_by', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {values.item_type === 'decision' && (
        <div>
          <label className={labelClass}>Consequence if late</label>
          <textarea
            value={values.if_late_consequence}
            onChange={e => set('if_late_consequence', e.target.value)}
            className={inputClass}
            rows={2}
            placeholder="What happens to cost/schedule/quality if this decision isn't made by the required-by date?"
          />
        </div>
      )}

      <div>
        <label className={labelClass}>Resolution</label>
        <textarea
          value={values.resolution}
          onChange={e => set('resolution', e.target.value)}
          className={inputClass}
          rows={2}
          placeholder="How was (or will) this be resolved?"
        />
      </div>

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

      {hasTriggerChanges && (
        <div className="p-3 bg-blue-50 border border-blue-200 dark:border-prosota-azure/30 rounded-md">
          <label className={labelClass}>
            Status, priority, severity, CCB decision, cost, or quality impact changed — what changed and why? (optional, logged with today's date)
          </label>
          <textarea
            value={reassessmentNote}
            onChange={e => setReassessmentNote(e.target.value)}
            className={inputClass}
            rows={2}
            placeholder="e.g. Priority escalated from Medium to High following client escalation."
          />
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : item ? 'Save changes' : 'Create item'}
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
