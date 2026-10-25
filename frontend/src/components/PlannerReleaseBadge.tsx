import { useEffect, useState } from 'react'
import { PLANNER_VERSION, releaseChannel, type ReleaseChannel } from '@/lib/releases'

export function PlannerReleaseBadge() {
  const desktop = (window as unknown as { prosotaDesktop?: { releaseInfo?: () => Promise<{ channel: ReleaseChannel; version: string }> } }).prosotaDesktop
  const [info, setInfo] = useState<{ channel: string; version: string }>({ channel: desktop ? 'desktop' : releaseChannel, version: PLANNER_VERSION })
  useEffect(() => {
    let active = true
    desktop?.releaseInfo?.().then(result => { if (active) setInfo(result) }).catch(() => {})
    return () => { active = false }
  }, [desktop])
  return <div className="px-6 pb-3 text-xs text-gray-500 dark:text-prosota-muted">
    <span className={info.channel === 'preview' ? 'text-amber-600 dark:text-amber-400' : ''}>{info.channel === 'preview' ? 'Preview · Test workspace' : info.channel === 'stable' ? 'Stable' : 'Desktop'}</span>
    {' · '}{info.version}
  </div>
}
