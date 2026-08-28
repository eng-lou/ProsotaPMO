import { useCallback, useEffect, useState } from 'react'
import { hasUnreadFeedback } from '@/lib/feedbackTickets'

// Shared by both the Sidebar's and the Project Selector's own Feedback
// trigger buttons (2026-08-28, per Maro: "the feedback icon needs to show
// there's a new notification") — each mounts its own instance (they're
// never both on screen at once, since one only renders pre-project-
// selection and the other post-), so no cross-instance sync is needed;
// `refresh` just lets the trigger re-check right after FeedbackPanel closes
// (which marks everything read on open), clearing the dot immediately
// rather than waiting for the next full remount.
export function useFeedbackUnread() {
  const [hasUnread, setHasUnread] = useState(false)

  const refresh = useCallback(() => {
    hasUnreadFeedback().then(setHasUnread).catch(() => {})
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { hasUnread, refresh }
}
