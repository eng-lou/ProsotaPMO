import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { WEEKDAY_FIELDS, type Calendar, type CalendarException } from './types'

interface Props {
  projectId: string
  calendars: Calendar[]
  onChange: () => Promise<void>
  onClose: () => void
}

interface NewCalendarValues {
  name: string
  hours_per_day: string
  works_monday: boolean
  works_tuesday: boolean
  works_wednesday: boolean
  works_thursday: boolean
  works_friday: boolean
  works_saturday: boolean
  works_sunday: boolean
}

const BLANK_NEW_CALENDAR: NewCalendarValues = {
  name: '',
  hours_per_day: '8',
  works_monday: true,
  works_tuesday: true,
  works_wednesday: true,
  works_thursday: true,
  works_friday: true,
  works_saturday: false,
  works_sunday: false,
}

export function CalendarWidget({ projectId, calendars, onChange, onClose }: Props) {
  const [creating, setCreating] = useState(false)
  const [newCalendar, setNewCalendar] = useState<NewCalendarValues>(BLANK_NEW_CALENDAR)
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null)
  const [exceptions, setExceptions] = useState<CalendarException[]>([])
  const [addingException, setAddingException] = useState(false)
  const [exceptionLabel, setExceptionLabel] = useState('')
  const [exceptionStart, setExceptionStart] = useState('')
  const [exceptionEnd, setExceptionEnd] = useState('')
  const [exceptionIsWorking, setExceptionIsWorking] = useState(false)

  useEffect(() => {
    if (!selectedCalendarId) {
      setExceptions([])
      return
    }
    let cancelled = false
    api.get<CalendarException[]>('/api/v1/calendar-exceptions/', { params: { calendar_id: selectedCalendarId } })
      .then(res => { if (!cancelled) setExceptions(res.data) })
    return () => { cancelled = true }
  }, [selectedCalendarId])

  const refreshExceptions = async () => {
    if (!selectedCalendarId) return
    const { data } = await api.get<CalendarException[]>('/api/v1/calendar-exceptions/', { params: { calendar_id: selectedCalendarId } })
    setExceptions(data)
  }

  const handleCreateCalendar = async () => {
    if (!newCalendar.name.trim()) return
    await api.post('/api/v1/calendars/', {
      project_id: projectId,
      name: newCalendar.name,
      hours_per_day: newCalendar.hours_per_day,
      works_monday: newCalendar.works_monday,
      works_tuesday: newCalendar.works_tuesday,
      works_wednesday: newCalendar.works_wednesday,
      works_thursday: newCalendar.works_thursday,
      works_friday: newCalendar.works_friday,
      works_saturday: newCalendar.works_saturday,
      works_sunday: newCalendar.works_sunday,
    })
    setCreating(false)
    setNewCalendar(BLANK_NEW_CALENDAR)
    await onChange()
  }

  const handleSetDefault = async (id: string) => {
    await api.patch(`/api/v1/calendars/${id}`, { is_project_default: true })
    await onChange()
  }

  const handleDeleteCalendar = async (calendar: Calendar) => {
    if (!window.confirm(`Delete calendar "${calendar.name}"? Activities using it revert to the project default.`)) return
    await api.delete(`/api/v1/calendars/${calendar.id}`)
    if (selectedCalendarId === calendar.id) setSelectedCalendarId(null)
    await onChange()
  }

  const handleAddException = async () => {
    if (!selectedCalendarId || !exceptionLabel.trim() || !exceptionStart || !exceptionEnd) return
    await api.post('/api/v1/calendar-exceptions/', {
      calendar_id: selectedCalendarId,
      label: exceptionLabel,
      start_date: exceptionStart,
      end_date: exceptionEnd,
      is_working: exceptionIsWorking,
    })
    setAddingException(false)
    setExceptionLabel('')
    setExceptionStart('')
    setExceptionEnd('')
    setExceptionIsWorking(false)
    await refreshExceptions()
  }

  const handleDeleteException = async (id: string) => {
    await api.delete(`/api/v1/calendar-exceptions/${id}`)
    await refreshExceptions()
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">📆</span>
        <div className="font-bold text-sm">Project Calendar</div>
        <div className="text-xs text-gray-400">Working day patterns, exceptions &amp; non-working periods</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Active Calendars</div>
          <table className="w-full text-xs border-collapse mb-2">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500">
                <th className="px-2 py-1.5 border border-gray-200">Calendar</th>
                <th className="px-2 py-1.5 border border-gray-200">Working Days</th>
                <th className="px-2 py-1.5 border border-gray-200">Hours/Day</th>
                <th className="px-2 py-1.5 border border-gray-200"></th>
              </tr>
            </thead>
            <tbody>
              {calendars.map(c => (
                <tr
                  key={c.id}
                  className={`cursor-pointer ${selectedCalendarId === c.id ? 'bg-blue-50' : ''}`}
                  onClick={() => setSelectedCalendarId(c.id)}
                >
                  <td className="px-2 py-1.5 border border-gray-200 font-medium">
                    {c.name}
                    {c.is_project_default && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">Default</span>}
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">
                    {WEEKDAY_FIELDS.filter(w => c[w.key]).map(w => w.label).join('/') || 'None'}
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{c.hours_per_day}h</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap">
                    {!c.is_project_default && (
                      <>
                        <button onClick={e => { e.stopPropagation(); handleSetDefault(c.id) }} className="text-blue-600 hover:text-blue-700 mr-2">
                          Set default
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDeleteCalendar(c) }} className="text-gray-400 hover:text-red-600">
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {creating ? (
            <div className="border border-gray-200 rounded p-3 space-y-2">
              <input
                value={newCalendar.name}
                onChange={e => setNewCalendar(v => ({ ...v, name: e.target.value }))}
                placeholder="Calendar name"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1"
              />
              <div className="flex items-center gap-3 flex-wrap">
                {WEEKDAY_FIELDS.map(w => (
                  <label key={w.key} className="flex items-center gap-1 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={newCalendar[w.key]}
                      onChange={e => setNewCalendar(v => ({ ...v, [w.key]: e.target.checked }))}
                    />
                    {w.label}
                  </label>
                ))}
                <label className="flex items-center gap-1 text-xs text-gray-600 ml-auto">
                  Hours/day
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={newCalendar.hours_per_day}
                    onChange={e => setNewCalendar(v => ({ ...v, hours_per_day: e.target.value }))}
                    className="w-14 border border-gray-300 rounded px-1.5 py-0.5"
                  />
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setCreating(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                <button onClick={handleCreateCalendar} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Add Calendar</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Calendar</button>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Non-Working Exceptions{selectedCalendarId ? '' : ' — select a calendar'}
          </div>
          {selectedCalendarId && (
            <>
              <table className="w-full text-xs border-collapse mb-2">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-500">
                    <th className="px-2 py-1.5 border border-gray-200">Exception</th>
                    <th className="px-2 py-1.5 border border-gray-200">Dates</th>
                    <th className="px-2 py-1.5 border border-gray-200">Type</th>
                    <th className="px-2 py-1.5 border border-gray-200"></th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.map(ex => (
                    <tr key={ex.id}>
                      <td className="px-2 py-1.5 border border-gray-200">{ex.label}</td>
                      <td className="px-2 py-1.5 border border-gray-200 text-gray-500 whitespace-nowrap">
                        {ex.start_date}{ex.start_date !== ex.end_date ? ` – ${ex.end_date}` : ''}
                      </td>
                      <td className="px-2 py-1.5 border border-gray-200">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${ex.is_working ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {ex.is_working ? 'Working' : 'Non-Working'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 border border-gray-200 text-right">
                        <button onClick={() => handleDeleteException(ex.id)} className="text-gray-400 hover:text-red-600">✕</button>
                      </td>
                    </tr>
                  ))}
                  {exceptions.length === 0 && (
                    <tr><td colSpan={4} className="px-2 py-3 text-center text-gray-400 border border-gray-200">None yet</td></tr>
                  )}
                </tbody>
              </table>

              {addingException ? (
                <div className="border border-gray-200 rounded p-3 space-y-2">
                  <input
                    value={exceptionLabel}
                    onChange={e => setExceptionLabel(e.target.value)}
                    placeholder="Label (e.g. Christmas Shutdown)"
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                  />
                  <div className="flex items-center gap-2">
                    <input type="date" value={exceptionStart} onChange={e => setExceptionStart(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1" />
                    <span className="text-gray-400">–</span>
                    <input type="date" value={exceptionEnd} onChange={e => setExceptionEnd(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1" />
                    <label className="flex items-center gap-1 text-xs text-gray-600 ml-2">
                      <input type="checkbox" checked={exceptionIsWorking} onChange={e => setExceptionIsWorking(e.target.checked)} />
                      Working (e.g. planned Saturday)
                    </label>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setAddingException(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                    <button onClick={handleAddException} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Add Exception</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAddingException(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Exception</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
