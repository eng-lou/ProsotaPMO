import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { downloadJson, readJsonFile } from '@/lib/exportImport'
import { WEEKDAY_FIELDS, type Calendar, type CalendarBreak, type CalendarException } from './types'

function apiErrorDetail(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
}

interface Props {
  projectId: string
  calendars: Calendar[]
  onChange: () => Promise<void>
  onClose: () => void
}

interface NewCalendarValues {
  name: string
  day_start_time: string
  day_end_time: string
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
  day_start_time: '08:00',
  day_end_time: '17:00',
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
  const [breaks, setBreaks] = useState<CalendarBreak[]>([])
  const [exceptions, setExceptions] = useState<CalendarException[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const [addingBreak, setAddingBreak] = useState(false)
  const [breakLabel, setBreakLabel] = useState('')
  const [breakStart, setBreakStart] = useState('12:00')
  const [breakEnd, setBreakEnd] = useState('13:00')
  const [breakError, setBreakError] = useState<string | null>(null)

  const [addingException, setAddingException] = useState(false)
  const [exceptionLabel, setExceptionLabel] = useState('')
  const [exceptionStart, setExceptionStart] = useState('')
  const [exceptionEnd, setExceptionEnd] = useState('')
  const [exceptionIsWorking, setExceptionIsWorking] = useState(false)
  const [exceptionPartialDay, setExceptionPartialDay] = useState(false)
  const [exceptionStartTime, setExceptionStartTime] = useState('08:00')
  const [exceptionEndTime, setExceptionEndTime] = useState('09:00')
  const [exceptionError, setExceptionError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedCalendarId) {
      setBreaks([])
      setExceptions([])
      return
    }
    let cancelled = false
    Promise.all([
      api.get<CalendarBreak[]>('/api/v1/calendar-breaks/', { params: { calendar_id: selectedCalendarId } }),
      api.get<CalendarException[]>('/api/v1/calendar-exceptions/', { params: { calendar_id: selectedCalendarId } }),
    ]).then(([breaksRes, exceptionsRes]) => {
      if (cancelled) return
      setBreaks(breaksRes.data)
      setExceptions(exceptionsRes.data)
    })
    return () => { cancelled = true }
  }, [selectedCalendarId])

  const refreshBreaks = async () => {
    if (!selectedCalendarId) return
    const { data } = await api.get<CalendarBreak[]>('/api/v1/calendar-breaks/', { params: { calendar_id: selectedCalendarId } })
    setBreaks(data)
  }

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
      day_start_time: newCalendar.day_start_time,
      day_end_time: newCalendar.day_end_time,
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

  // Fetches breaks/exceptions fresh rather than reusing `breaks`/`exceptions`
  // state — that state only ever holds the *currently selected* calendar's
  // rows, but Export is a per-row button in the calendar list, not tied to
  // selection.
  const handleExportCalendar = async (calendar: Calendar) => {
    const [breaksRes, exceptionsRes] = await Promise.all([
      api.get<CalendarBreak[]>('/api/v1/calendar-breaks/', { params: { calendar_id: calendar.id } }),
      api.get<CalendarException[]>('/api/v1/calendar-exceptions/', { params: { calendar_id: calendar.id } }),
    ])
    downloadJson(`${calendar.name}.calendar.json`, {
      name: calendar.name,
      day_start_time: calendar.day_start_time,
      day_end_time: calendar.day_end_time,
      works_monday: calendar.works_monday,
      works_tuesday: calendar.works_tuesday,
      works_wednesday: calendar.works_wednesday,
      works_thursday: calendar.works_thursday,
      works_friday: calendar.works_friday,
      works_saturday: calendar.works_saturday,
      works_sunday: calendar.works_sunday,
      breaks: breaksRes.data.map(b => ({ label: b.label, start_time: b.start_time, end_time: b.end_time })),
      exceptions: exceptionsRes.data.map(e => ({
        label: e.label, start_date: e.start_date, end_date: e.end_date, is_working: e.is_working,
        start_time: e.start_time, end_time: e.end_time,
      })),
    })
  }

  // Recreates the calendar via the same create endpoint the "+ Add Calendar"
  // form uses, then loops its breaks/exceptions through their own existing
  // create endpoints against the new calendar's id — client-side only, like
  // every other Export/Import pair in this app (P6's own Copy/Paste,
  // adapted to a file-based workflow — 2026-07-05, per Maro).
  const handleImportFile = async (file: File) => {
    setImportError(null)
    try {
      const parsed = await readJsonFile(file) as Partial<Calendar> & {
        breaks?: Pick<CalendarBreak, 'label' | 'start_time' | 'end_time'>[]
        exceptions?: Pick<CalendarException, 'label' | 'start_date' | 'end_date' | 'is_working' | 'start_time' | 'end_time'>[]
      }
      if (typeof parsed.name !== 'string') throw new Error(`"${file.name}" isn't a valid exported calendar.`)
      const { data: created } = await api.post<Calendar>('/api/v1/calendars/', {
        project_id: projectId,
        name: parsed.name,
        day_start_time: parsed.day_start_time ?? '08:00',
        day_end_time: parsed.day_end_time ?? '17:00',
        works_monday: parsed.works_monday ?? true,
        works_tuesday: parsed.works_tuesday ?? true,
        works_wednesday: parsed.works_wednesday ?? true,
        works_thursday: parsed.works_thursday ?? true,
        works_friday: parsed.works_friday ?? true,
        works_saturday: parsed.works_saturday ?? false,
        works_sunday: parsed.works_sunday ?? false,
      })
      await Promise.all([
        ...(parsed.breaks ?? []).map(b => api.post('/api/v1/calendar-breaks/', { calendar_id: created.id, ...b })),
        ...(parsed.exceptions ?? []).map(ex => api.post('/api/v1/calendar-exceptions/', { calendar_id: created.id, ...ex })),
      ])
      await onChange()
    } catch (err) {
      setImportError(apiErrorDetail(err) ?? (err instanceof Error ? err.message : 'Could not import that file.'))
    }
  }

  const handleSetDefault = async (id: string) => {
    await api.patch(`/api/v1/calendars/${id}`, { is_project_default: true })
    await onChange()
  }

  const handleDeleteCalendar = async (calendar: Calendar) => {
    if (!(await confirmWithDontAsk('scheduling.calendar-delete', `Delete calendar "${calendar.name}"? Activities using it revert to the project default.`))) return
    await api.delete(`/api/v1/calendars/${calendar.id}`)
    if (selectedCalendarId === calendar.id) setSelectedCalendarId(null)
    await onChange()
  }

  const handleAddBreak = async () => {
    if (!selectedCalendarId || !breakLabel.trim() || !breakStart || !breakEnd) return
    setBreakError(null)
    try {
      await api.post('/api/v1/calendar-breaks/', {
        calendar_id: selectedCalendarId, label: breakLabel, start_time: breakStart, end_time: breakEnd,
      })
    } catch (err) {
      // Previously swallowed silently — a validation error (e.g. end before
      // start) looked exactly like the button doing nothing at all.
      setBreakError(apiErrorDetail(err) ?? 'Could not add that break — check your connection and try again.')
      return
    }
    setAddingBreak(false)
    setBreakLabel('')
    setBreakStart('12:00')
    setBreakEnd('13:00')
    await refreshBreaks()
    await onChange() // hours_per_day changed
  }

  const handleDeleteBreak = async (id: string) => {
    await api.delete(`/api/v1/calendar-breaks/${id}`)
    await refreshBreaks()
    await onChange()
  }

  const handleAddException = async () => {
    if (!selectedCalendarId || !exceptionLabel.trim() || !exceptionStart || !exceptionEnd) return
    setExceptionError(null)
    try {
      await api.post('/api/v1/calendar-exceptions/', {
        calendar_id: selectedCalendarId,
        label: exceptionLabel,
        start_date: exceptionStart,
        end_date: exceptionEnd,
        is_working: exceptionIsWorking,
        start_time: exceptionPartialDay ? exceptionStartTime : null,
        end_time: exceptionPartialDay ? exceptionEndTime : null,
      })
    } catch (err) {
      // Previously swallowed silently — a validation error (e.g. end date
      // before start) looked exactly like the button doing nothing at all.
      setExceptionError(apiErrorDetail(err) ?? 'Could not add that exception — check your connection and try again.')
      return
    }
    setAddingException(false)
    setExceptionLabel('')
    setExceptionStart('')
    setExceptionEnd('')
    setExceptionIsWorking(false)
    setExceptionPartialDay(false)
    await refreshExceptions()
    // The backend now recomputes the schedule itself when an exception
    // changes — but Scheduling.tsx's own activity list is still stale until
    // it refetches, or the Gantt won't visibly reflect the new exception.
    await onChange()
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
        <div className="text-xs text-gray-400">Working day patterns, breaks &amp; non-working periods</div>
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
                <th className="px-2 py-1.5 border border-gray-200">Day Envelope</th>
                <th className="px-2 py-1.5 border border-gray-200">Net Hours/Day</th>
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
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500 whitespace-nowrap">
                    {c.day_start_time.slice(0, 5)}–{c.day_end_time.slice(0, 5)}
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500" title="Envelope minus this calendar's breaks — computed, not editable directly">
                    {c.hours_per_day}h
                  </td>
                  <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap">
                    {!c.is_project_default && (
                      <button onClick={e => { e.stopPropagation(); handleSetDefault(c.id) }} className="text-blue-600 hover:text-blue-700 mr-2">
                        Set default
                      </button>
                    )}
                    <button onClick={e => { e.stopPropagation(); handleExportCalendar(c) }} className="text-blue-600 hover:text-blue-700 mr-2">
                      Export
                    </button>
                    {!c.is_project_default && (
                      <button onClick={e => { e.stopPropagation(); handleDeleteCalendar(c) }} className="text-gray-400 hover:text-red-600">
                        Delete
                      </button>
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
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  Day starts
                  <input
                    type="time"
                    value={newCalendar.day_start_time}
                    onChange={e => setNewCalendar(v => ({ ...v, day_start_time: e.target.value }))}
                    className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  Day ends
                  <input
                    type="time"
                    value={newCalendar.day_end_time}
                    onChange={e => setNewCalendar(v => ({ ...v, day_end_time: e.target.value }))}
                    className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                  />
                </label>
              </div>
              <div className="text-[10px] text-gray-400">
                Net working hours/day is derived from this envelope minus any breaks you add after creating the
                calendar — not typed in directly.
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setCreating(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                <button onClick={handleCreateCalendar} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Add Calendar</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => setCreating(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Calendar</button>
              <button onClick={() => importInputRef.current?.click()} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                ⇧ Import Calendar
              </button>
              <input
                ref={importInputRef} type="file" accept="application/json,.json" className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleImportFile(file)
                  e.target.value = ''
                }}
              />
            </div>
          )}
          {importError && <p className="text-xs text-red-600 mt-1">{importError}</p>}
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Daily Breaks{selectedCalendarId ? '' : ' — select a calendar'}
            </div>
            {selectedCalendarId && (
              <>
                <table className="w-full text-xs border-collapse mb-2">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-500">
                      <th className="px-2 py-1.5 border border-gray-200">Break</th>
                      <th className="px-2 py-1.5 border border-gray-200">Time</th>
                      <th className="px-2 py-1.5 border border-gray-200"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {breaks.map(b => (
                      <tr key={b.id}>
                        <td className="px-2 py-1.5 border border-gray-200">{b.label}</td>
                        <td className="px-2 py-1.5 border border-gray-200 text-gray-500 whitespace-nowrap">
                          {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}
                        </td>
                        <td className="px-2 py-1.5 border border-gray-200 text-right">
                          <button onClick={() => handleDeleteBreak(b.id)} className="text-gray-400 hover:text-red-600">✕</button>
                        </td>
                      </tr>
                    ))}
                    {breaks.length === 0 && (
                      <tr><td colSpan={3} className="px-2 py-3 text-center text-gray-400 border border-gray-200">None yet</td></tr>
                    )}
                  </tbody>
                </table>

                {addingBreak ? (
                  <div className="border border-gray-200 rounded p-3 space-y-2">
                    <input
                      value={breakLabel}
                      onChange={e => setBreakLabel(e.target.value)}
                      placeholder="Label (e.g. Lunch)"
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                    />
                    <div className="flex items-center gap-2">
                      <input type="time" value={breakStart} onChange={e => setBreakStart(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1" />
                      <span className="text-gray-400">–</span>
                      <input type="time" value={breakEnd} onChange={e => setBreakEnd(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1" />
                    </div>
                    {breakError && <p className="text-xs text-red-600">{breakError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setAddingBreak(false); setBreakError(null) }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      <button
                        onClick={handleAddBreak}
                        disabled={!breakLabel.trim() || !breakStart || !breakEnd}
                        title={!breakLabel.trim() ? 'Enter a label first' : undefined}
                        className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Add Break
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAddingBreak(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add Break</button>
                )}
              </>
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
                          {ex.start_time && ex.end_time && (
                            <span className="text-gray-400"> ({ex.start_time.slice(0, 5)}–{ex.end_time.slice(0, 5)})</span>
                          )}
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
                    <label className="flex items-center gap-1 text-xs text-gray-600">
                      <input type="checkbox" checked={exceptionPartialDay} onChange={e => setExceptionPartialDay(e.target.checked)} />
                      Only part of the day (e.g. "08:00–09:00 non-working") — leave unchecked for the whole day
                    </label>
                    {exceptionPartialDay && (
                      <div className="flex items-center gap-2">
                        <input type="time" value={exceptionStartTime} onChange={e => setExceptionStartTime(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1" />
                        <span className="text-gray-400">–</span>
                        <input type="time" value={exceptionEndTime} onChange={e => setExceptionEndTime(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1" />
                      </div>
                    )}
                    {exceptionError && <p className="text-xs text-red-600">{exceptionError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setAddingException(false); setExceptionError(null) }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      <button
                        onClick={handleAddException}
                        disabled={!exceptionLabel.trim() || !exceptionStart || !exceptionEnd}
                        title={!exceptionLabel.trim() ? 'Enter a label first' : (!exceptionStart || !exceptionEnd) ? 'Pick a start and end date first' : undefined}
                        className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Add Exception
                      </button>
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
    </div>
  )
}
