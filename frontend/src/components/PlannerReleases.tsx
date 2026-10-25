import { plannerReleases, type ReleaseChannel } from '@/lib/releases'

export function PlannerReleases() {
  return <section className="hp-releases" id="releases" aria-labelledby="planner-releases-title">
    <p className="hp-small">PROSOTA PLANNER · RELEASES</p>
    <h2 id="planner-releases-title">Choose how you use Planner.</h2>
    <p>Use Stable for everyday work, or try the latest improvements in Preview.</p>
    <div className="hp-release-grid">
      {(['stable', 'preview'] as ReleaseChannel[]).map(channel => {
        const release = plannerReleases[channel]
        const title = channel === 'stable' ? 'Stable' : 'Preview'
        return <article key={channel} className={`hp-release-card hp-release-${channel}`}>
          <span className="hp-small">{channel === 'stable' ? 'RECOMMENDED' : 'EARLY ACCESS'}</span>
          <h3>{title}</h3>
          <p>{channel === 'stable' ? 'Tested releases for normal project work. Updated after release checks.' : 'New features and fixes as they evolve. Changes may be incomplete or less reliable; use test projects.'}</p>
          <div className="hp-release-actions">
            {release.web.available
              ? <a className="hp-button" href={release.web.url}>Open {title} Web <span aria-hidden="true">↗</span></a>
              : <span className="hp-release-pending">{title} Web — preparing release</span>}
            {release.desktop.available
              ? <a className="hp-text-link" href={release.desktop.url}>Download {title} for Windows <span aria-hidden="true">↓</span></a>
              : <span className="hp-release-pending">{title} Desktop — preparing release</span>}
          </div>
          {(release.web.available || release.desktop.available) && <small>Web {release.web.available ? release.web.version : 'pending'} · Desktop {release.desktop.available ? release.desktop.version : 'pending'}</small>}
        </article>
      })}
    </div>
    <p className="hp-release-note">Windows 10/11, 64-bit. Desktop installers are currently unsigned. Stable and Preview use separate workspaces. Desktop projects stay on your PC and do not automatically sync with the web. Your Prosota account is used to request access.</p>
  </section>
}
