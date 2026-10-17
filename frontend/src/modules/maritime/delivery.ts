import { useEffect, useState } from 'react'

export type DeliveryInputs = { start_date: string; delay_days: number; delay_activity: string; overhead_day_rate: number }
export const DEFAULT_DELIVERY: DeliveryInputs = { start_date: '2026-10-19', delay_days: 15, delay_activity: 'foundation', overhead_day_rate: 1000 }
export type DeliveryActivity = { id: string; name: string; asset_id: string; predecessors: string[]; start: string; finish: string; duration_days: number; critical: boolean; float_days: number; cost: number }
export type DeliveryResource = { id: string; name: string; type: string; rate: number; rate_unit: string; hours: number; cost: number }
type Schedule = { start: string; finish: string; working_days: number; activities: DeliveryActivity[]; resources: DeliveryResource[]; direct_cost: number; overhead_cost: number; total_cost: number; daily: { date: string; resource_hours: number; cost: number; cumulative_cost: number }[] }
export type DeliveryResult = { inputs: DeliveryInputs; synthetic: boolean; currency: string; engine: string; baseline: Schedule; scenario: Schedule; impact: { working_days: number; calendar_days: number; cost: number; resource_hours: number }; assumptions: string[] }
const STORAGE = 'prosota_maritime_delivery_v1'
export const timestamp = (value: string) => Date.parse(value.length === 10 ? `${value}T00:00:00Z` : `${value}Z`)
export const dateLabel = (value: string) => new Date(timestamp(value)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const gbp = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value)
export const apiUrl = (path: string) => `${import.meta.env.VITE_API_URL ?? ''}/api/v1/maritime${path}`

export async function readResponse(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : response.status === 401 ? 'Sign in to use Poe.' : response.status === 403 ? 'Your account needs approval to use Poe.' : response.status === 429 ? 'Your daily Poe allowance has been reached.' : `Request failed (${response.status}). Check the inputs or try again.`)
  return body
}

function initial(): DeliveryInputs {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null')
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved.start_date) && Number.isInteger(saved.delay_days) && saved.delay_days >= 0 && saved.delay_days <= 90 && ['foundation','deck','procurement','installation','commission'].includes(saved.delay_activity) && Number.isFinite(saved.overhead_day_rate) && saved.overhead_day_rate >= 0 && saved.overhead_day_rate <= 100000) return saved
  } catch { /* Fresh defaults when storage is unavailable. */ }
  return { ...DEFAULT_DELIVERY }
}

export function useDelivery() {
  const [inputs, setInputs] = useState<DeliveryInputs>(initial)
  const [result, setResult] = useState<DeliveryResult | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setResult(null)
    const timer = setTimeout(async () => {
      const timeout = setTimeout(() => controller.abort('timeout'), 25000)
      try {
        const response = await fetch(apiUrl('/delivery/calculate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inputs), signal: controller.signal })
        const calculated: DeliveryResult = await readResponse(response)
        if (!controller.signal.aborted) {
          setResult(calculated)
          try { sessionStorage.setItem(STORAGE, JSON.stringify(inputs)) } catch { /* Session remains usable. */ }
        }
      } catch (e) {
        if (!controller.signal.aborted || controller.signal.reason === 'timeout') setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Calculation timed out. Try again.')
      } finally {
        clearTimeout(timeout)
        if (!controller.signal.aborted || controller.signal.reason === 'timeout') setLoading(false)
      }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [inputs, retry])
  const current = result && Object.entries(inputs).every(([key, value]) => result.inputs[key as keyof DeliveryInputs] === value) ? result : null
  return { inputs, setInputs, result: current, loading, error, retry: () => setRetry(v => v + 1) }
}
