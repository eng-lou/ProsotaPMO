import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { ProsotaLogo } from '@/components/ProsotaLogo'
import { UndoControls } from '@/components/UndoControls'
import { useTheme } from '@/lib/ThemeContext'
import { useProject } from '@/lib/ProjectContext'
import { maritimeRoot as root, useMaritime } from './workspaceData'
import './workspace.css'

export function MaritimeChrome({children,onPoe}: {children: ReactNode; onPoe: () => void}) {
  const {selectedProject,clearProject} = useProject(), {theme,toggleTheme} = useTheme(), navigate = useNavigate()
  const {logout} = useAuth0(), {pathname} = useLocation()
  const {plan,version,dirty,busy,error,save,reload,attempt} = useMaritime()
  const section = pathname.split('/').pop() ?? 'project'
  const operations = ['operations','calls','berths','equipment','yard','results'].includes(section)
  const safety = ['exercises','setup','training','debrief'].includes(section)
  const delivery = ['schedule','resources','costs','risks','issues','dashboard'].includes(section)
  const [lastMode,setLastMode] = useState('operations')
  const mode = operations ? 'operations' : safety ? 'safety' : delivery ? 'delivery' : lastMode
  useEffect(()=>{if(operations||safety||delivery)setLastMode(mode)},[mode,operations,safety,delivery])
  const tabs = mode === 'operations' ? [['operations','Overview'],['calls','Vessel calls'],['berths','Berths'],['equipment','Equipment'],['yard','Yard & gates'],['results','Results']]
    : mode === 'safety' ? [['exercises','Exercises'],['setup','Setup'],['training','Run'],['debrief','Debrief']]
    : [['models','Model & sequence'],['schedule','Schedule'],['resources','Resources'],['costs','Costs'],['risks','Risks'],['issues','Issues & decisions']]
  const switchProject = () => {if((dirty||attempt) && !window.confirm('Discard unsaved Maritime changes and any active exercise, then switch project?')) return; clearProject(); navigate(root)}
  return <div className="maritime-app">
    <header className="mw-header"><Link to={`${root}/project`} className="mw-brand"><ProsotaLogo size={28}/> <strong>PROSOTA <span>MARITIME</span></strong></Link><button onClick={switchProject}>{selectedProject?.name} ▾</button><span className="mw-save-state" role="status">{busy ? 'Working…' : dirty ? 'Unsaved changes' : version ? `Saved · v${version}` : 'New working plan'}</span><button onClick={save} disabled={!dirty || busy || !!attempt}>Save changes</button><button onClick={() => {if(!dirty || window.confirm('Discard local changes and reload the saved plan?')) void reload()}} disabled={busy || !!attempt}>Reload</button></header>
    <div className="mw-body"><aside className="mw-sidebar"><nav>{[['project','Project'],['models','Models & Assets'],['scenarios','Scenarios'],['reports','Reports']].map(([path,label]) => <NavLink key={path} to={`${root}/${path}`}>{label}</NavLink>)}<button onClick={onPoe}>Poe</button></nav><div className="mw-utilities"><UndoControls/><button onClick={toggleTheme}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><button onClick={switchProject}>Switch project</button><a href="/construction" target="_blank" rel="noreferrer">Construction ↗</a><button onClick={() => {if((dirty||attempt)&&!window.confirm('Discard unsaved changes and sign out?'))return;logout({logoutParams:{returnTo:window.location.origin+'/maritime'}})}}>Sign out</button></div></aside>
    <main className="mw-main"><nav className="mw-modes" aria-label="Maritime workspaces">{[['operations','Port Operations','operations'],['safety','Safety & Training','exercises'],['delivery','Infrastructure Delivery','models']].map(([id,label,path]) => <Link key={id} className={mode === id ? 'active' : ''} to={`${root}/${path}`} onClick={() => setLastMode(id)}>{label}</Link>)}</nav>
      <nav className="mw-tabs" aria-label="Workspace tools">{tabs.map(([path,label]) => <NavLink key={path} to={`${root}/${path}`}>{label}</NavLink>)}</nav>
      {attempt && <div className="mw-notice no-print">Exercise in progress · <Link className="mw-link" to={`${root}/training`}>Return to attempt</Link>. Finish or discard it before saving plan changes.</div>}
      {error && <div role="alert" className="mw-error">{error}</div>}
      {!plan ? <div className="mw-empty">{busy ? 'Loading project…' : 'Unable to load this project.'}<button onClick={() => void reload()} disabled={busy}>Retry</button></div> : children}
    </main></div>
  </div>
}
