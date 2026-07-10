import { RESOURCE_TYPE_LABELS, type Calendar, type Resource } from './types'

interface Props {
  resources: Resource[]
  calendars: Calendar[]
}

// Content only — see ResourceTrackingPrintView.tsx's own note; the shared
// letterhead header/footer now lives once in ResourcesPrintView.tsx.
export function ResourcePoolPrintView({ resources, calendars }: Props) {
  return (
    <div className="mb-8">
      <p className="text-sm text-gray-500 mb-4">Resource Pool · {resources.length} resource{resources.length === 1 ? '' : 's'}</p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b-2 border-gray-400">
            <th className="py-1 pr-2">Type</th>
            <th className="py-1 pr-2">Name</th>
            <th className="py-1 pr-2">Role</th>
            <th className="py-1 pr-2">Unit</th>
            <th className="py-1 pr-2 text-right">Rate (£)</th>
            <th className="py-1 pr-2 text-right">Max h/day</th>
            <th className="py-1 pr-2">Calendar</th>
          </tr>
        </thead>
        <tbody>
          {resources.map(r => (
            <tr key={r.id} className="border-b border-gray-200">
              <td className="py-1 pr-2">{RESOURCE_TYPE_LABELS[r.resource_type]}</td>
              <td className="py-1 pr-2">{r.name}</td>
              <td className="py-1 pr-2">{r.role ?? '—'}</td>
              <td className="py-1 pr-2">{r.unit}</td>
              <td className="py-1 pr-2 text-right">{Number(r.rate).toLocaleString()}</td>
              <td className="py-1 pr-2 text-right">{r.max_hours_per_day}</td>
              <td className="py-1 pr-2">{r.calendar_id ? (calendars.find(c => c.id === r.calendar_id)?.name ?? '—') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
