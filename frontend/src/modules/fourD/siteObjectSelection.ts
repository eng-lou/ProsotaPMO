import type { SiteItem } from './siteScene'

export type SiteSelectionMode = 'replace' | 'add' | 'toggle' | 'subtract'

// The viewport also holds imported models and IFC selections. Additive list
// gestures touch only the specified site placements.
export function changeSiteSelection(current: ReadonlySet<string>, ids: string[], mode: SiteSelectionMode) {
  const next = mode === 'replace' ? new Set<string>() : new Set(current)
  for (const id of ids) {
    const key = 'site:' + id
    if (mode === 'subtract' || (mode === 'toggle' && next.has(key))) next.delete(key)
    else next.add(key)
  }
  return next
}

export function removeSitePlacements(items: SiteItem[], ids: ReadonlySet<string>) {
  const targets = items.filter(item => ids.has(item.id))
  if (!ids.size || targets.length !== ids.size || targets.some(item => item.locked)) {
    throw new Error('The selected site objects changed. Review the selection before removing them.')
  }
  return items.filter(item => !ids.has(item.id))
}
