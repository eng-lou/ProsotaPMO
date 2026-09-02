import { useState, type CSSProperties } from 'react'
import './HomePage.css'
import { ProsotaLogo } from './ProsotaLogo'

// The real marketing site (source/prosota-site.html, not in this repo) ported
// into the SPA as the signed-out landing experience (2026-08-28, per Maro:
// "create a homepage prior to actual weblogin prosota page" — referencing
// bexelmanager.com/fuzor's own marketing sites for the general shape of a
// construction-software homepage). tailwind.config.js's prosota-* palette
// was already lifted from that same source file, so this keeps the app's
// pre-login page consistent with the one actual brand asset that exists
// rather than inventing new positioning — copy/structure/animated Gantt
// signature are carried over close to verbatim, only the CTAs were rewired
// from mailto/anchor placeholders to the real Auth0 sign-in flow.

type Domain = 'model' | 'controls' | 'risk'

interface GanttRow {
  domain: Domain
  name: string
  key: string
  text: string
  s: number
  w: number
}

const GANTT_ROWS: GanttRow[] = [
  {
    domain: 'model', name: 'IFC model', key: 'IFC model',
    text: 'Load a federated IFC straight into the browser — full geometry and property sets, no export step, no separate viewer to maintain.',
    s: 0, w: 16,
  },
  {
    domain: 'controls', name: 'Schedule', key: 'Schedule',
    text: 'A complete CPM engine — WBS, multi-calendar logic, constraints, baselines and Primavera P6 exchange. Build it by hand like any planning tool, or seed the first draft from the model; it stays the same editable programme either way.',
    s: 14, w: 20,
  },
  {
    domain: 'controls', name: 'Resources', key: 'Resources',
    text: 'Assign labour, plant and materials against any activity, with rates and histograms that update live as the programme moves — planned by you from day one, not just handed down from a generator.',
    s: 32, w: 14,
  },
  {
    domain: 'controls', name: 'BOQ', key: 'BOQ',
    text: 'Build a bill of quantities activity by activity, or take it off the model when one exists — either way it stays traceable back to what it\'s actually pricing.',
    s: 44, w: 15,
  },
  {
    domain: 'risk', name: 'Risk register', key: 'Risk register',
    text: 'A full risk register — probability, impact, EMV, mitigation owners — sitting alongside the programme instead of in a separate workbook, mapped to the activities and costs it actually threatens.',
    s: 57, w: 13,
  },
  {
    domain: 'controls', name: 'Cost estimate', key: 'Cost estimate',
    text: 'Budget, forecast, actuals and earned value, tightly coupled to the schedule — because cost that isn\'t derived from the programme is just a guess.',
    s: 68, w: 16,
  },
  {
    domain: 'model', name: '4D simulation', key: '4D simulation',
    text: 'Play the programme against the model, built to hold real construction-scale IFC files. Sequence, clashes and method are reviewed as a build, not as a bar chart.',
    s: 82, w: 18,
  },
]

const CAP_GROUPS: { domain: Domain; title: string; items: [string, string][] }[] = [
  {
    domain: 'controls', title: 'Schedule',
    items: [
      ['SCH', 'CPM scheduling — WBS, calendars, constraints, baselines'],
      ['SCH', 'Resource levelling & smoothing'],
      ['SCH', 'Primavera P6 XML import/export'],
      ['SCH', 'Schedule quality (DCMA) analysis'],
      ['SCH', 'Earned value management'],
    ],
  },
  {
    domain: 'risk', title: 'Cost & risk',
    items: [
      ['CST', 'BOQ & cost estimating'],
      ['CST', 'Quantity take-off from model'],
      ['RSK', 'Risk management'],
      ['RSK', 'Register linked to programme'],
    ],
  },
  {
    domain: 'model', title: 'Model & simulation',
    items: [
      ['4D', '4D planning & construction simulation'],
      ['MDL', 'Clash detection'],
      ['MDL', '3D measurement tools'],
      ['MDL', 'IFC, FBX & glTF model support'],
      ['VIS', 'Material & texture editing'],
      ['VIS', 'Animation & rendering'],
    ],
  },
  {
    domain: 'controls', title: 'Dashboards',
    items: [
      ['DSH', '45+ configurable widgets — schedule, cost, risk, resources, quality'],
      ['DSH', 'Saved, switchable dashboard layouts'],
      ['DSH', 'Baseline comparison & variance'],
      ['DSH', 'WBS-scoped slicer across every card'],
    ],
  },
]

export function HomePage({ onSignIn, onRequestAccess }: { onSignIn: () => void; onRequestAccess: () => void }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const active = GANTT_ROWS[activeIdx]

  return (
    <div className="homepage">
      <header>
        <div className="wrap bar">
          <button className="brand" onClick={() => document.getElementById('top')?.scrollIntoView({ block: 'start' })}>
            <ProsotaLogo size={26} />
            <span>PROSOTA</span>
          </button>
          <nav>
            <a href="#capabilities">Capabilities</a>
            <a href="#workflow">Workflow</a>
            <a href="#who">Who it's for</a>
            <a href="#status">Status</a>
          </nav>
          <button className="btn" onClick={onSignIn}>Sign in</button>
        </div>
      </header>

      <main id="top">
        {/* HERO */}
        <div className="hero">
          <div className="wrap">
            <div className="hero-grid">
              <div>
                <p className="eyebrow">Integrated project planning, controls &amp; 4D BIM</p>
                <h1>Plan. Control.<br /><em>Simulate.</em> Deliver.</h1>
                <div className="hero-actions">
                  <button className="btn" onClick={onRequestAccess}>Request early access</button>
                  <a className="btn btn-ghost" href="#capabilities">See what's built</a>
                </div>
              </div>
              <div className="hero-side">
                <p className="lede">One environment for scheduling, cost, risk, quantity take-off and BIM — built for construction, infrastructure, energy and engineering projects.</p>
                <div className="spec">
                  <div>Base<b>Browser-native</b></div>
                  <div>Model formats<b>IFC · FBX · glTF</b></div>
                </div>
              </div>
            </div>

            {/* SIGNATURE: the generation pipeline drawn as a programme */}
            <div className="gantt-block">
              <div className="gantt-head">
                <p>One connected dataset</p>
                <p>Schedule, cost, risk and the model — never out of sync</p>
              </div>
              <div className="gantt">
                <div className="datedate" aria-hidden="true" />
                <div className="axis" aria-hidden="true"><span>SETUP</span><span>QUANTIFY</span><span>PRICE</span><span>SIMULATE</span></div>

                {GANTT_ROWS.map((row, i) => (
                  <button
                    key={row.key}
                    className={`row${i === activeIdx ? ' is-active' : ''}`}
                    data-domain={row.domain}
                    onMouseEnter={() => setActiveIdx(i)}
                    onFocus={() => setActiveIdx(i)}
                    onClick={() => setActiveIdx(i)}
                    style={{ '--s': row.s, '--w': row.w, '--i': i } as CSSProperties}
                  >
                    <span className="name">{row.name}</span>
                    <span className="track"><span className="bar" /></span>
                  </button>
                ))}

                <div className="caption">
                  <div className="k">{active.key}</div>
                  <p className="v">{active.text}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CAPABILITIES */}
        <section id="capabilities">
          <div className="wrap">
            <div className="sec-head">
              <h2>Complete modules, not a wrapper</h2>
              <p>Scheduling, resource planning, cost, risk and 4D are each a complete, hand-built discipline in Prosota — not a thin automation layer over a generic project tool. They're connected because every one of them reads and writes the same Activities, not because a report stitches them together afterwards.</p>
            </div>
            <div className="caps">
              {CAP_GROUPS.map(group => (
                <div className="cap-group" data-domain={group.domain} key={group.title}>
                  <h3><span className="dot" />{group.title}</h3>
                  <ul>
                    {group.items.map(([tag, label]) => (
                      <li key={label}><span>{tag}</span>{label}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* WORKFLOW / WHY */}
        <section id="workflow">
          <div className="wrap">
            <div className="sec-head">
              <h2>Model-driven setup, when you want it</h2>
              <p>Every module above stands on its own — build the programme, the bill, the register and the estimate by hand, the way you always have. When there's a federated model to start from, Prosota can also generate a first pass of all of it in one run, so a planner's week doesn't disappear into retyping the WBS and re-measuring quantities that already exist in the model.</p>
            </div>
            <div className="three">
              <div className="cell">
                <div className="num">01 / OPTIONAL</div>
                <h3>A first pass in minutes, if you use it</h3>
                <p>Programme, resources, bill, register and estimate can all come out of one run against the federated model — entirely opt-in, never required to use Prosota.</p>
              </div>
              <div className="cell">
                <div className="num">02 / EDITABLE</div>
                <h3>Nothing is locked</h3>
                <p>Every generated activity, quantity and rate is fully editable. Automation writes a draft; the planner still owns the programme.</p>
              </div>
              <div className="cell">
                <div className="num">03 / CONNECTED</div>
                <h3>One dataset, not five</h3>
                <p>Change a duration and the cost curve, the histogram and the 4D sequence move with it — because they were never separate files.</p>
              </div>
            </div>
          </div>
        </section>

        {/* WHO */}
        <section id="who">
          <div className="wrap">
            <div className="sec-head">
              <h2>Built for the people who hold the programme together</h2>
              <p>Prosota is designed around how planning and controls teams actually work — and around the handover points where their data usually breaks.</p>
            </div>
            <ul className="who">
              {['Planners', 'Project managers', 'Project controls professionals', 'BIM specialists', 'Engineering teams', 'Estimators'].map(role => (
                <li key={role}>{role}</li>
              ))}
            </ul>
            <div className="sectors">
              {['Construction', 'Infrastructure', 'Energy', 'Engineering'].map(sector => (
                <div key={sector}>{sector}</div>
              ))}
            </div>
          </div>
        </section>

        {/* STATUS */}
        <section id="status">
          <div className="wrap">
            <div className="status">
              <div>
                <p className="eyebrow"><b>●</b> Under active development</p>
                <h2>Where it is now</h2>
                <p className="lede" style={{ marginTop: 18 }}>Prosota is being built in the open by practising planners, not adapted from a generic project tool. Everything below is what's actually running in the app today, not a pitch deck.</p>
              </div>
              <ul className="timeline">
                <li className="now">
                  <div className="stage">Shipped</div>
                  <p>Full CPM scheduling &amp; resourcing (WBS, calendars, constraints, baselines, resource levelling &amp; smoothing, P6 XML exchange), Reporting &amp; Controls with 45+ configurable widgets, Cost &amp; Quantity Takeoff with model-driven BOQ and earned value, a schedule-linked Risk Register &amp; Analysis, an Issues, Changes &amp; Decisions tracker, and BIM Coordination &amp; Animations with IFC/FBX/glTF support, clash detection and activity-linked timeline playback.</p>
                </li>
                <li>
                  <div className="stage">Next</div>
                  <p>An AI Project Controls Assistant that reasons across Schedule, Resources, Cost, Risk and 4D together — not a chatbot bolted onto one module. Plus collaborative multi-user projects and deeper MS Project interop.</p>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* CONTACT */}
        <section id="contact">
          <div className="wrap contact">
            <p className="eyebrow">Early access</p>
            <h2>Try it on a real programme</h2>
            <p className="lede">We're working with a small number of teams who plan complex work and are tired of stitching five tools together. Sign in to request access and we'll set you up.</p>
            <div className="contact-actions">
              <button className="btn" onClick={onRequestAccess}>Sign in to get started</button>
              <a className="btn btn-ghost" href="mailto:lsota@prosota.com?subject=Prosota%20early%20access">Email us</a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap foot">
          <div>PROSOTA · PLAN. CONTROL. SIMULATE. DELIVER.</div>
          <div>London · Founded 2025 · <button onClick={() => document.getElementById('top')?.scrollIntoView({ block: 'start' })}>prosota.com</button></div>
        </div>
      </footer>
    </div>
  )
}
