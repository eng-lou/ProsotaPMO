import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'
import { DEFAULT_ANIMATION_CONFIG } from './animationDefaults'
import type { ModelElementLink } from './modelElementLinks'
import type { ResolvedTimelineLink } from './timelinePlayback'
import type { SiteItem } from './siteScene'

export function resolveSiteLinks(id: string, links: ModelElementLink[], activities: Activity[], profiles: AnimationProfile[], items: SiteItem[] = []): ResolvedTimelineLink[] {
  const resolved: ResolvedTimelineLink[] = []
  for (const link of links) {
    if (link.source_kind !== 'site' || link.element_ref !== id) continue
    const activity = activities.find(a => a.id === link.activity_id)
    if (!activity?.start || !activity.finish) continue
    const profileId = link.animation_profile_id ?? activity.animation_profile_id
    const profile = profileId ? profiles.find(p => p.id === profileId)?.config : DEFAULT_ANIMATION_CONFIG
    const startMs = Date.parse(activity.start), finishMs = Date.parse(activity.finish)
    if (!profile || !Number.isFinite(startMs) || !Number.isFinite(finishMs) || finishMs < startMs) continue
    const value: ResolvedTimelineLink = { activity, startMs, finishMs, profile, axis: profile.axis }
    if (profile.stagger && items.length) {
      const peers = items.filter(item => links.some(l => l.source_kind === 'site' && l.element_ref === item.id && l.activity_id === activity.id && (l.animation_profile_id ?? activity.animation_profile_id) === profileId))
      const key = (item: SiteItem) => {
        const p = item.kind === 'fence' ? (item.points[0] || item.position) : item.position
        if (profile.stagger_order === 'vertical') return p[item.up_axis]
        if (profile.stagger_order === 'along_y') return p[item.up_axis === 'z' ? 'y' : 'z']
        if (profile.stagger_order === 'random') { const h = Math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719) * 43758.5453; return h - Math.floor(h) }
        return p.x
      }
      peers.sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id))
      if (profile.stagger_reverse) peers.reverse()
      value.staggerFraction = Math.max(0, peers.findIndex(item => item.id === id)) / Math.max(1, peers.length - 1)
    }
    resolved.push(value)
  }
  return resolved
}
