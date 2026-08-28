import { api } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'

export type TicketStatus = 'open' | 'in_progress' | 'closed'

export interface TicketAttachment {
  filename: string
  size_bytes: number
  content_type: string
  download_url: string
}

export type EventKind = 'comment' | 'status_change'

export interface TicketEvent {
  id: string
  kind: EventKind
  body: string | null
  old_status: TicketStatus | null
  new_status: TicketStatus | null
  created_at: string
  author_email: string
  author_display_name: string
}

export interface Ticket {
  id: string
  created_by: string
  subject: string
  description: string
  status: TicketStatus
  attachments: TicketAttachment[]
  events: TicketEvent[]
  created_at: string
  updated_at: string
  reporter_email: string
  reporter_display_name: string
}

export async function listTickets(): Promise<Ticket[]> {
  const res = await api.get<Ticket[]>('/api/v1/feedback-tickets/')
  return res.data
}

export async function hasUnreadFeedback(): Promise<boolean> {
  const res = await api.get<{ has_unread: boolean }>('/api/v1/feedback-tickets/unread')
  return res.data.has_unread
}

export async function markFeedbackRead(): Promise<void> {
  await api.post('/api/v1/feedback-tickets/mark-read')
}

export async function addTicketComment(ticketId: string, body: string): Promise<Ticket> {
  const res = await api.post<Ticket>(`/api/v1/feedback-tickets/${ticketId}/comments`, { body })
  return res.data
}

// Authenticated CSV download (2026-08-28, super-user only) — a plain <a
// href> can't carry the Bearer token, so the file is fetched via the
// shared axios instance and handed to the browser as a Blob download
// instead, same trick as any other authenticated-export flow in an SPA.
export async function downloadFeedbackLog(): Promise<void> {
  const res = await api.get('/api/v1/feedback-tickets/export', { responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'feedback-ticket-log.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// Direct-to-R2 upload (same three-step presign/PUT flow as siteCaptures.ts's
// own uploadSiteCapture — see that module's header for the full "why").
// Attachments are uploaded up front, one at a time, before the ticket
// itself is submitted; createTicket then just records the resulting keys.
export async function uploadTicketAttachment(file: File): Promise<{ key: string; filename: string; size_bytes: number; content_type: string }> {
  const contentType = file.type || 'application/octet-stream'
  const { data: presigned } = await api.post<{ storage_key: string; upload_url: string }>(
    '/api/v1/feedback-tickets/presign', { name: file.name, content_type: contentType },
  )
  await uploadDirectToStorage(presigned.upload_url, file, contentType)
  return { key: presigned.storage_key, filename: file.name, size_bytes: file.size, content_type: contentType }
}

export async function createTicket(
  subject: string, description: string,
  attachments: { key: string; filename: string; size_bytes: number; content_type: string }[],
): Promise<Ticket> {
  const res = await api.post<Ticket>('/api/v1/feedback-tickets/', { subject, description, attachments })
  return res.data
}

export async function updateTicketStatus(id: string, status: TicketStatus): Promise<Ticket> {
  const res = await api.patch<Ticket>(`/api/v1/feedback-tickets/${id}`, { status })
  return res.data
}
