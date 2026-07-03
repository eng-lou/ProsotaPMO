import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { ScheduleBaseline } from './types'

interface Props {
  periodId: string
  onChange: () => Promise<void>
  onClose: () => void
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function BaselineWidget({ periodId, onChange, onClose }: Props) {
  const [baselines, setBaselines] = useState<ScheduleBaseline[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [assigningId, setAssigningId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const res = await api.get<ScheduleBaseline[]>('/api/v1/schedule-baselines/', { params: { period_id: periodId } })
    setBaselines(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [periodId])

  const handleCreate = async () => {
    if (!name.trim() || !date) return
    await api.post('/api/v1/schedule-baselines/', { period_id: periodId, name, baseline_date: date })
    setCreating(false)
    setName('')
    setDate(today())
    await load()
  }

  const handleAssign = async (b: ScheduleBaseline) => {
    if (!window.confirm(
      `Assign "${b.name}" as the active baseline? This overwrites BL Start/BL Finish/Fin. Var (d) on every activity in this period with ${b.name}'s captured dates.`
    )) return
    setAssigningId(b.id)
    try {
      await api.post(`/api/v1/schedule-baselines/${b.id}/assign`)
      await Promise.all([load(), onChange()])
    } finally {
      setAssigningId(null)
    }
  }

  const handleDelete = async (b: ScheduleBaseline) => {
    if (!window.confirm(
      `Delete the saved baseline "${b.name}"? This cannot be undone.${
        b.is_active ? '\n\nIt is currently assigned — deleting it does not change any activity\'s BL Start/BL Finish, it just removes this saved snapshot from the list.' : ''
      }`
    )) return
    await api.delete(`/api/v1/schedule-baselines/${b.id}`)
    await load()
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎯</span>
        <div className="font-bold text-sm">Baseline</div>
        <div className="text-xs text-gray-400">Capture a named, dated snapshot of the current schedule, then choose which saved one is assigned</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-2 py-1.5 border border-gray-200">Name</th>
            <th className="px-2 py-1.5 border border-gray-200">Date</th>
            <th className="px-2 py-1.5 border border-gray-200 text-right">Activities</th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
          </tr>
        </thead>
        <tbody>
          {baselines.map(b => (
            <tr key={b.id} className={b.is_active ? 'bg-blue-50/50' : undefined}>
              <td className="px-2 py-1.5 border border-gray-200 font-medium">{b.name}</td>
              <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{b.baseline_date}</td>
              <td className="px-2 py-1.5 border border-gray-200 text-right text-gray-500">{b.activity_count}</td>
              <td className="px-2 py-1.5 border border-gray-200 whitespace-nowrap">
                {b.is_active ? (
                  <span className="text-blue-600 font-medium">✓ Assigned</span>
                ) : (
                  <button
                    onClick={() => handleAssign(b)}
                    disabled={assigningId === b.id}
                    className="text-blue-600 hover:text-blue-700 disabled:opacity-40"
                  >
                    Assign
                  </button>
                )}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 text-right">
                <button onClick={() => handleDelete(b)} className="text-gray-400 hover:text-red-600">Delete</button>
              </td>
            </tr>
          ))}
          {baselines.length === 0 && !loading && (
            <tr><td colSpan={5} className="px-2 py-3 text-center text-gray-400 border border-gray-200">No baselines saved yet for this period</td></tr>
          )}
        </tbody>
      </table>

      {creating ? (
        <div className="border border-gray-200 rounded p-3 flex items-end gap-2 flex-wrap">
          <label className="text-xs text-gray-600">
            Name
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Contract Baseline"
              autoFocus
              className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-48"
            />
          </label>
          <label className="text-xs text-gray-600">
            Date
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5"
            />
          </label>
          <button onClick={handleCreate} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">Save</button>
          <button onClick={() => { setCreating(false); setName(''); setDate(today()) }} className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1.5">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Set a new baseline</button>
      )}
    </div>
  )
}
