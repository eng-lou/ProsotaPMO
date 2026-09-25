import axios from 'axios'

// Turns a failed startup request into a message that says *who* refused it
// (2026-09-25, per Maro: on a work laptop every module but 4D sat on
// "Loading…" while the console showed POST /periods/bootstrap and
// /schedule-variants/bootstrap both returning 403). This backend always
// answers with JSON, so a non-JSON (typically HTML) error body means the
// response came from something between the browser and Prosota, such as a
// corporate web filter or proxy, not from Prosota itself. Saying so on
// screen is the difference between "Prosota is broken" and "your network is
// blocking this", which no amount of client-side retrying can fix.
export function describeLoadError(err: unknown, what: string): string {
  if (!axios.isAxiosError(err)) return `Couldn't load ${what}.`
  const res = err.response
  if (!res) {
    return `Couldn't load ${what}: no response from the server (network problem or timeout).`
  }
  const body = res.data
  const isProsotaResponse = body !== null && typeof body === 'object'
  if (!isProsotaResponse) {
    return `Couldn't load ${what}: the request was refused with HTTP ${res.status} by something between this device and Prosota (for example a corporate web filter or proxy), not by Prosota itself.`
  }
  const detail = (body as { detail?: unknown }).detail
  const detailText = typeof detail === 'string' ? detail
    : detail && typeof detail === 'object' && 'code' in detail ? String((detail as { code: unknown }).code)
    : null
  return `Couldn't load ${what} (HTTP ${res.status}${detailText ? `: ${detailText}` : ''}).`
}
