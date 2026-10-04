import { useMemo, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'

interface Props {
  activities: Activity[]
  visibleActivities: Activity[]
  selectedActivityIds: Set<string>
  animationProfiles: AnimationProfile[]
  onSelectActivities: (ids: Set<string>) => void
  onApplyProfile: (ids: string[], profileId: string | null) => Promise<void>
}

// Shares the data sidebar with element-to-activity linking controls.
export function ActivityProfileMapper({ activities, visibleActivities, selectedActivityIds, animationProfiles, onSelectActivities, onApplyProfile }: Props) {
  const [profile, setProfile] = useState('')
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState('')
  const selectedTasks = useMemo(() => activities.filter(a => selectedActivityIds.has(a.id) && a.activity_type !== 'wbs_summary'), [activities, selectedActivityIds])

  const apply = async () => {
    if (applying || selectedTasks.length === 0) return
    setApplying(true)
    setMessage('')
    try {
      await onApplyProfile(selectedTasks.map(a => a.id), profile || null)
      setMessage(`Profile applied to ${selectedTasks.length} activities.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not apply profile.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-1.5 text-[11px]" role="group" aria-label="Activity profile mapper">
      <div className="flex items-center justify-between gap-2">
        <span title="Shift-click selects a range; Ctrl/Cmd-click adds rows. Summary rows are excluded.">{selectedTasks.length} activities selected</span>
        <button type="button" onClick={() => { onSelectActivities(new Set(visibleActivities.filter(a => a.activity_type !== 'wbs_summary').map(a => a.id))); setMessage('') }} className="text-blue-600 dark:text-blue-400">Select visible</button>
      </div>
      <label className="block text-gray-500 dark:text-prosota-muted" htmlFor="activity-profile-mapper">Activity animation profile</label>
      <select id="activity-profile-mapper" aria-label="Profile for selected activities" value={profile} onChange={e => { setProfile(e.target.value); setMessage('') }} disabled={applying} className="w-full h-7 border rounded px-1 dark:bg-prosota-panel2 dark:border-prosota-line">
        <option value="">Default</option>
        {animationProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" title="Apply to selected activities. Element profile overrides stay in effect." disabled={applying || selectedTasks.length === 0} onClick={apply} className="w-full h-7 rounded bg-blue-600 text-white px-2 disabled:opacity-40">{applying ? 'Applying…' : 'Apply profile'}</button>
      <p className="text-[10px] text-gray-500 dark:text-prosota-muted">Select activities in the table or Gantt. Shift-click selects a range; Ctrl/Cmd-click adds rows. Element profile overrides stay in effect.</p>
      {message && <p role="status" className="break-words">{message}</p>}
    </div>
  )
}
