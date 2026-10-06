import axios from 'axios'

export function scheduleLoadError(error: unknown): string {
  if (!axios.isAxiosError(error)) return 'Could not load schedule data. Please retry.'
  const path = error.config?.url?.split('?')[0] ?? ''
  const labels: Record<string, string> = {
    '/api/v1/activities/': 'activities',
    '/api/v1/activity-relationships/': 'activity relationships',
    '/api/v1/resource-assignments/': 'resource assignments',
    '/api/v1/calendars/': 'calendars',
    '/api/v1/resources/': 'resources',
    '/api/v1/model-element-links/': '3D element links',
  }
  const label = labels[path] ?? 'schedule data'
  if (!error.response) return `Could not load ${label}: no response from the server. Please retry.`
  return `Could not load ${label} (HTTP ${error.response.status}). Please retry.`
}
