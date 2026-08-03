import { useState } from 'react'
import { ActivityPicker } from '@/modules/scheduling/ActivityPicker'
import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'
import type { ModelElementLink } from './modelElementLinks'

interface Props {
  activities: Activity[]
  links: ModelElementLink[]
  animationProfiles: AnimationProfile[]
  onLink: (activityId: string) => void
  onUnlink: (linkId: string) => void
  onAssignProfile: (linkId: string, profileId: string | null) => void
}

// Activity↔model-element linking (2026-07-11) — the frontend half of
// model_element_link.py's backend (table/schema/service/API/tests built
// earlier this session, but with no UI until now). Shared between
// IfcDataPanel.tsx (one specific selected IFC element, keyed by its
// GlobalId) and MeshDataPanel.tsx (a whole imported mesh object, keyed by
// filename) — both just hand this whichever links already reference their
// own element_ref plus callbacks to add/remove one. Many-to-many, matching
// the backend: an Activity like "Pour Level 2 Slab" can link many elements;
// an element could in principle belong to more than one Activity over its
// lifecycle too (formwork, then concrete, ...).
//
// Each link also gets an Animation profile dropdown (2026-07-11, per Maro)
// — only saved (project-library) profiles are selectable here, not
// AnimationProfilePanel.tsx's built-ins directly; a built-in has to be
// "+ Save"d into the library first (see that file's own header) before it
// can be assigned to a link, since assignment is a real FK to a DB row.
//
// WBS summary rows are excluded from the Activity picker — they're not real
// schedule work, linking a model element to one wouldn't mean anything.
export function ElementLinkFields({ activities, links, animationProfiles, onLink, onUnlink, onAssignProfile }: Props) {
  const [picking, setPicking] = useState('')
  const linkedActivityIds = new Set(links.map(l => l.activity_id))
  const pickable = activities.filter(a => !linkedActivityIds.has(a.id) && a.activity_type !== 'wbs_summary')

  return (
    <div className="space-y-1.5">
      {links.map(link => {
        const activity = activities.find(a => a.id === link.activity_id)
        // Whenever this link has no override of its own, it inherits
        // whatever profile is set on the activity itself (2026-07-22, per
        // Maro's own bulk-assignment feature — see Viewport3D.tsx's own
        // resolve() header for the full cascade) — named here so leaving
        // this dropdown on "Default" doesn't misleadingly read as "no
        // animation" when the activity has actually bulk-assigned one.
        const inheritedProfileName = activity?.animation_profile_id
          ? animationProfiles.find(p => p.id === activity.animation_profile_id)?.name
          : undefined
        return (
          <div key={link.id} className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-prosota-muted" title={activity?.task_name ?? link.activity_id}>
                {activity ? `${activity.code}: ${activity.task_name}` : '(activity not found)'}
              </span>
              <button onClick={() => onUnlink(link.id)} title="Unlink" className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 shrink-0">✕</button>
            </div>
            <select
              value={link.animation_profile_id ?? ''}
              onChange={e => onAssignProfile(link.id, e.target.value || null)}
              className="w-full text-[11px] border border-gray-200 dark:border-prosota-line rounded px-1.5 py-0.5 text-gray-500 dark:text-prosota-muted"
              title={inheritedProfileName ? `Inherits "${inheritedProfileName}" from this activity unless overridden here` : undefined}
            >
              <option value="">{inheritedProfileName ? `Default (activity: ${inheritedProfileName})` : 'Default (no animation profile)'}</option>
              {animationProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )
      })}
      {links.length === 0 && <p className="text-xs text-gray-400 dark:text-prosota-muted">Not linked to any activity.</p>}
      <ActivityPicker
        activities={pickable}
        value={picking}
        onChange={id => { onLink(id); setPicking('') }}
        placeholder="Link to activity…"
        className="w-full"
      />
    </div>
  )
}
