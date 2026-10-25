import { plannerReleases, releaseChannel } from '@/lib/releases'

export function PlannerReleases({ onSignIn }: { onSignIn: () => void }) {
  const release = plannerReleases.stable
  return <section className="hp-releases" id="releases" aria-labelledby="planner-releases-title">
    <p className="hp-small">PROSOTA PLANNER · STABLE RELEASES</p>
    <h2 id="planner-releases-title">Choose how you use Planner.</h2>
    <p>Use the reviewed Stable release in your browser or download it for Windows.</p>
    <div className="hp-release-grid">
      <article className="hp-release-card hp-release-stable">
        <span className="hp-small">WEB</span>
        <h3>Stable Web</h3>
        <p>Open Planner in your browser. New releases are published after review and approval.</p>
        <div className="hp-release-actions">
          {release.web.available
            ? releaseChannel === 'stable'
              ? <button className="hp-button" onClick={onSignIn}>Open Stable Web <span aria-hidden="true">↗</span></button>
              : <a className="hp-button" href={release.web.url}>Open Stable Web <span aria-hidden="true">↗</span></a>
            : <span className="hp-release-pending">Preparing release</span>}
        </div>
        <small>Version {release.web.version}</small>
      </article>
      <article className="hp-release-card hp-release-stable">
        <span className="hp-small">WINDOWS</span>
        <h3>Stable Desktop</h3>
        <p>Install Planner on your PC, with projects stored locally.</p>
        <div className="hp-release-actions">
          {release.desktop.available
            ? <a className="hp-button" href={release.desktop.url}>Download Stable for Windows <span aria-hidden="true">↓</span></a>
            : <span className="hp-release-pending">Preparing release</span>}
        </div>
        <small>Version {release.desktop.version}</small>
      </article>
    </div>
    <p className="hp-release-note">Windows 10/11, 64-bit. Desktop installers are currently unsigned. Desktop projects stay on your PC and do not automatically sync with the web. Your Prosota account is used to request access.</p>
  </section>
}
