import axios from 'axios'
import { useEffect, useState } from 'react'
import { useCurrentUser } from '@/lib/CurrentUserContext'
import {
  addTicketComment, createTicket, downloadFeedbackLog, listTickets, markFeedbackRead, updateTicketStatus,
  uploadTicketAttachment, type Ticket, type TicketStatus,
} from '@/lib/feedbackTickets'

const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', in_progress: 'In Progress', closed: 'Closed' }
const STATUS_CLASS: Record<TicketStatus, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-prosota-azure/15 dark:text-prosota-azure',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  closed: 'bg-gray-100 text-gray-500 dark:bg-prosota-panel2 dark:text-prosota-muted',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Feedback / bug-report tickets (2026-08-27, per Maro — modelled on
// Reallusion's own support-ticket flow: submit a subject/description/
// attachments, see your own ticket history with status, and — for super
// users — a queue of every ticket from every user with a way to move its
// status along). Reachable from both the Sidebar (once inside a project)
// and the Project Selector page, unlike Access Manager: this is for every
// approved user, not just super users.
//
// Extended 2026-08-28, per Maro ("its a two way comms... i need to be able
// to keep track of the progress... i can download the log"): each ticket
// now carries a `events` timeline (comments interleaved with status
// changes, backend/app/models/feedback_ticket.py's own TicketEvent) that
// both the ticket's owner and any super user can add comments to; opening
// this panel marks everything read (see useFeedbackUnread.ts for how the
// trigger buttons show a dot beforehand); super users get a "Download log"
// export of every event across every ticket.
export function FeedbackPanel({ onClose }: { onClose: () => void }) {
  const { currentUser } = useCurrentUser()
  const isSuperUser = !!currentUser?.is_super_user

  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [postingCommentId, setPostingCommentId] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const refresh = () => {
    listTickets()
      .then(setTickets)
      .catch(() => setError('Could not load tickets.'))
  }

  useEffect(() => {
    refresh()
    markFeedbackRead().catch(() => {})
  }, [])

  const handleAddFiles = (files: FileList | null) => {
    if (!files) return
    setPendingFiles(prev => [...prev, ...Array.from(files)])
  }

  const removeFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !description.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const attachments = []
      for (const file of pendingFiles) {
        attachments.push(await uploadTicketAttachment(file))
      }
      const ticket = await createTicket(subject.trim(), description.trim(), attachments)
      setTickets(prev => prev ? [ticket, ...prev] : [ticket])
      setCreating(false)
      setSubject('')
      setDescription('')
      setPendingFiles([])
    } catch (err) {
      setSubmitError(axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string'
        ? err.response.data.detail
        : 'Could not submit your ticket.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStatusChange = async (ticket: Ticket, status: TicketStatus) => {
    setUpdatingStatusId(ticket.id)
    try {
      const updated = await updateTicketStatus(ticket.id, status)
      setTickets(prev => prev?.map(t => t.id === updated.id ? updated : t) ?? null)
    } catch {
      setError('Could not update that ticket.')
    } finally {
      setUpdatingStatusId(null)
    }
  }

  const handlePostComment = async (ticketId: string) => {
    const body = (commentDrafts[ticketId] ?? '').trim()
    if (!body) return
    setPostingCommentId(ticketId)
    try {
      const updated = await addTicketComment(ticketId, body)
      setTickets(prev => prev?.map(t => t.id === updated.id ? updated : t) ?? null)
      setCommentDrafts(prev => ({ ...prev, [ticketId]: '' }))
    } catch {
      setError('Could not post that reply.')
    } finally {
      setPostingCommentId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print">
      <div className="bg-white dark:bg-prosota-panel rounded-lg shadow-xl max-w-lg w-full p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-prosota-paper">Feedback</h2>
          <button onClick={onClose} className="text-xs text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper">
            Close
          </button>
        </div>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        {creating ? (
          <form onSubmit={handleSubmit} className="border border-gray-200 dark:border-prosota-line rounded-lg p-4 space-y-3 mb-5">
            <input
              autoFocus
              type="text"
              placeholder="Subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div>
              <textarea
                placeholder="What steps can we follow to reproduce the problem? Please include error messages or a screenshot if possible."
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
                className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-prosota-muted cursor-pointer hover:text-gray-700 dark:hover:text-prosota-paper">
                📎 Attach files (under 25MB each)
                <input type="file" multiple className="hidden" onChange={e => { handleAddFiles(e.target.files); e.target.value = '' }} />
              </label>
              {pendingFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-gray-600 dark:text-prosota-muted bg-gray-50 dark:bg-prosota-panel2 rounded px-2 py-1">
                      <span className="truncate">{f.name} ({formatSize(f.size)})</span>
                      <button type="button" onClick={() => removeFile(i)} className="shrink-0 ml-2 text-gray-400 hover:text-red-600">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {submitError && <p className="text-xs text-red-600">{submitError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting || !subject.trim() || !description.trim()}
                className="bg-blue-600 dark:bg-prosota-azure text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
              <button
                type="button"
                onClick={() => { setCreating(false); setSubmitError(null) }}
                disabled={submitting}
                className="text-gray-500 dark:text-prosota-muted px-4 py-2 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-prosota-panel2 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="text-sm text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium mb-5"
          >
            + Report an issue or leave feedback
          </button>
        )}

        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide">
            {isSuperUser ? 'All tickets' : 'Your tickets'}{tickets && tickets.length > 0 ? ` (${tickets.length})` : ''}
          </h3>
          {isSuperUser && (
            <button
              onClick={() => downloadFeedbackLog().catch(() => setError('Could not download the log.'))}
              className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium"
            >
              ⬇ Download log
            </button>
          )}
        </div>
        {tickets === null ? (
          <p className="text-sm text-gray-500 dark:text-prosota-muted">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-prosota-muted">No tickets yet.</p>
        ) : (
          <div className="space-y-2">
            {tickets.map(t => {
              const expanded = expandedId === t.id
              return (
                <div key={t.id} className="border border-gray-200 dark:border-prosota-line rounded-md p-3">
                  <button onClick={() => setExpandedId(expanded ? null : t.id)} className="w-full flex items-start justify-between gap-3 text-left">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-prosota-paper truncate">{t.subject}</p>
                      <p className="text-xs text-gray-400 dark:text-prosota-muted mt-0.5">
                        {formatDate(t.created_at)}
                        {isSuperUser && ` · ${t.reporter_display_name}`}
                      </p>
                    </div>
                    <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${STATUS_CLASS[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </button>
                  {expanded && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-prosota-line space-y-3">
                      <p className="text-sm text-gray-700 dark:text-prosota-paper whitespace-pre-wrap">{t.description}</p>
                      {t.attachments.length > 0 && (
                        <div className="space-y-1">
                          {t.attachments.map((a, i) => (
                            <a key={i} href={a.download_url} target="_blank" rel="noreferrer" className="block text-xs text-blue-600 dark:text-prosota-cyan hover:underline">
                              📎 {a.filename} ({formatSize(a.size_bytes)})
                            </a>
                          ))}
                        </div>
                      )}
                      {isSuperUser && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-prosota-muted">Status:</span>
                          <select
                            value={t.status}
                            disabled={updatingStatusId === t.id}
                            onChange={e => handleStatusChange(t, e.target.value as TicketStatus)}
                            className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1 focus:outline-none"
                          >
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="closed">Closed</option>
                          </select>
                        </div>
                      )}

                      {t.events.length > 0 && (
                        <div className="space-y-2 border-t border-gray-100 dark:border-prosota-line pt-3">
                          {t.events.map(ev => ev.kind === 'status_change' ? (
                            <p key={ev.id} className="text-xs text-gray-400 dark:text-prosota-muted italic">
                              {ev.author_display_name} moved this from {STATUS_LABEL[ev.old_status!]} to {STATUS_LABEL[ev.new_status!]} · {formatDateTime(ev.created_at)}
                            </p>
                          ) : (
                            <div key={ev.id} className="bg-gray-50 dark:bg-prosota-panel2 rounded-md px-3 py-2">
                              <p className="text-xs font-medium text-gray-700 dark:text-prosota-paper">
                                {ev.author_display_name} <span className="font-normal text-gray-400 dark:text-prosota-muted">· {formatDateTime(ev.created_at)}</span>
                              </p>
                              <p className="text-sm text-gray-700 dark:text-prosota-paper whitespace-pre-wrap mt-0.5">{ev.body}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex items-start gap-2 pt-1">
                        <textarea
                          value={commentDrafts[t.id] ?? ''}
                          onChange={e => setCommentDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                          placeholder={isSuperUser ? 'Reply with guidance or a question…' : 'Add more detail or reply…'}
                          rows={2}
                          className="flex-1 min-w-0 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                        />
                        <button
                          onClick={() => handlePostComment(t.id)}
                          disabled={postingCommentId === t.id || !(commentDrafts[t.id] ?? '').trim()}
                          className="shrink-0 text-xs px-3 py-2 rounded-md bg-blue-600 dark:bg-prosota-azure text-white font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          {postingCommentId === t.id ? 'Sending…' : 'Send'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
