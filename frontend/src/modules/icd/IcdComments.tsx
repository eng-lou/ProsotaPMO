import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { IcdComment } from './types'

interface IcdCommentsProps {
  icdItemId: string
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// A discussion thread on an issue/change/decision, authored by the real
// signed-in user (via /users/me + Auth0) — genuinely buildable now since user
// identity already exists in this app, unlike Notifications which needs
// infrastructure that doesn't exist yet. Only the original author can edit
// or delete their own comment (enforced server-side too).
export function IcdComments({ icdItemId }: IcdCommentsProps) {
  const [comments, setComments] = useState<IcdComment[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get<IcdComment[]>('/api/v1/icd-comments/', { params: { icd_item_id: icdItemId } }),
      api.get<{ id: string }>('/api/v1/users/me'),
    ])
      .then(([commentsRes, meRes]) => {
        setComments(commentsRes.data)
        setCurrentUserId(meRes.data.id)
      })
      .catch(() => setError('Failed to load comments'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [icdItemId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    try {
      await api.post('/api/v1/icd-comments/', { icd_item_id: icdItemId, body: body.trim() })
      setBody('')
      load()
    } catch {
      setError('Failed to add comment')
    }
  }

  const startEdit = (comment: IcdComment) => {
    setEditingId(comment.id)
    setEditingBody(comment.body)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId || !editingBody.trim()) return
    try {
      await api.patch(`/api/v1/icd-comments/${editingId}`, { body: editingBody.trim() })
      setEditingId(null)
      load()
    } catch {
      setError('Failed to update comment')
    }
  }

  const handleDelete = async (comment: IcdComment) => {
    if (!(await confirmWithDontAsk('icd.comment-delete', 'Delete this comment? This cannot be undone.'))) return
    await api.delete(`/api/v1/icd-comments/${comment.id}`)
    load()
  }

  if (loading) return <p className="text-xs text-gray-400 dark:text-prosota-muted px-4 py-3">Loading comments…</p>

  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-prosota-panel2 border-t border-gray-100 dark:border-prosota-line">
      <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-2">Comments</div>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}

      {comments.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-prosota-muted mb-2">No comments yet.</p>
      )}

      <ul className="space-y-1.5 mb-2">
        {comments.map(comment => (
          <li key={comment.id} className="text-xs bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-md px-3 py-2">
            {editingId === comment.id ? (
              <form onSubmit={handleSaveEdit} className="space-y-2">
                <textarea
                  autoFocus
                  value={editingBody}
                  onChange={e => setEditingBody(e.target.value)}
                  className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1.5 text-xs"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button type="submit" className="text-xs bg-gray-800 text-white px-3 py-1 rounded-md hover:bg-gray-900">
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-xs text-gray-500 dark:text-prosota-muted px-2 py-1">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-medium text-gray-700 dark:text-prosota-muted">{comment.author_name}</span>
                  <span className="text-gray-400 dark:text-prosota-muted">{formatDateTime(comment.created_at)}</span>
                </div>
                <div className="text-gray-700 dark:text-prosota-muted mb-1">{comment.body}</div>
                {comment.author_id === currentUserId && (
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(comment)} className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan">edit</button>
                    <button onClick={() => handleDelete(comment)} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">remove</button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={handleAdd} className="space-y-2">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1.5 text-xs"
          rows={2}
          placeholder="Add a comment…"
        />
        <button type="submit" className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-md hover:bg-gray-900">
          Comment
        </button>
      </form>
    </div>
  )
}
