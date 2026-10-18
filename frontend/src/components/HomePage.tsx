import { useState } from 'react'
import { ProsotaLogo } from './ProsotaLogo'
import './HomePage.css'

const activities = [
  { name: 'Site preparation', start: 0, width: 18 },
  { name: 'Foundations', start: 16, width: 25 },
  { name: 'Structure', start: 39, width: 29 },
  { name: 'Envelope', start: 65, width: 23 },
]

const capabilities = [
  [
    '01',
    'Explore the build before it happens.',
    '4D simulation & BIM',
    'Link model elements to programme activities and play back the construction sequence. Review phases, investigate clashes, take measurements and communicate the plan through animations and renders.',
  ],
  [
    '02',
    'Build a programme you can interrogate.',
    'Scheduling & resources',
    'Work with logic, calendars, constraints and baselines. Import a Primavera P6 XML programme or build your own, then check its quality and resource demand.',
  ],
  [
    '03',
    'Keep the numbers close to the work.',
    'Cost & risk',
    'Connect resource assignments, quantities and costs to activities. Review earned value, track risks and keep issues, changes and decisions in context.',
  ],
  [
    '04',
    'Bring a clearer picture to the meeting.',
    'Reporting & controls',
    'Compare baselines and explore schedule, cost, resource and risk information through configurable dashboards and saved layouts.',
  ],
]

function ProgrammePreview() {
  const [revised, setRevised] = useState(false)
  const [phase, setPhase] = useState(3)
  return (
    <div className="hp-preview">
      <div className="hp-preview-top">
        <span>
          <i /> 4D CONSTRUCTION EXPLORER
        </span>
        <span>ILLUSTRATIVE PROJECT / 01</span>
      </div>
      <div className="hp-preview-title">
        <div>
          <span className="hp-small">RIVERSIDE / STRUCTURAL WORKS</span>
          <h3>Your programme. In three dimensions.</h3>
        </div>
        <div className="hp-toggle" aria-label="Example programme scenario">
          <button aria-pressed={!revised} onClick={() => setRevised(false)}>
            Baseline
          </button>
          <button aria-pressed={revised} onClick={() => setRevised(true)}>
            +2 weeks
          </button>
        </div>
      </div>
      <div className="hp-preview-grid">
        <div className="hp-programme">
          <div className="hp-chart-heading">
            <span>ACTIVITY</span>
            <div>
              <span>W01</span>
              <span>W08</span>
              <span>W16</span>
              <span>W24</span>
            </div>
          </div>
          {activities.map((activity, i) => (
            <div className="hp-activity" key={activity.name}>
              <span>{activity.name}</span>
              <div className="hp-track">
                <span className="hp-baseline" style={{ left: `${activity.start}%`, width: `${activity.width}%` }} />
                <span
                  className={`hp-task hp-task-${i}`}
                  style={{
                    left: `${activity.start + (revised && i > 1 ? (100 / 24) * 2 : 0)}%`,
                    width: `${activity.width + (revised && i === 1 ? (100 / 24) * 2 : 0)}%`,
                  }}
                />
              </div>
            </div>
          ))}
          <div className="hp-chart-key">
            <span>
              <i /> Current sequence
            </span>
            <span>
              <i /> Baseline
            </span>
          </div>
          <div className="hp-example-note" aria-live="polite">
            <span>↳</span>
            <p>
              {revised
                ? 'Foundations take two weeks longer. Review the downstream sequence, resource timing and linked costs.'
                : 'Start with the baseline. Select “+2 weeks” to explore a longer foundation phase.'}
            </p>
          </div>
        </div>
        <div className="hp-model">
          <div className="hp-model-label">
            <span>4D / SEQUENCE STUDY</span>
            <span>ISOMETRIC</span>
          </div>
          <svg
            viewBox="0 0 380 240"
            role="img"
            aria-label="Illustrative structural model with highlighted construction phase"
          >
            <defs>
              <pattern id="hp-grid" width="32" height="18" patternUnits="userSpaceOnUse">
                <path d="M0 9L16 0L32 9L16 18Z" fill="none" stroke="#1C3049" strokeWidth=".6" />
              </pattern>
            </defs>
            <rect width="380" height="240" fill="url(#hp-grid)" />
            <g transform="translate(72 30)">
              <path d="M0 146L130 211L254 145L124 81Z" fill="#101F36" stroke="#345c91" />
              {[108, 72, 36].map((y, i) => (
                <g key={y} opacity={i >= phase ? 0.08 : revised && i === 2 ? 0.25 : 1}>
                  <path
                    d={`M22 ${y}L128 ${y + 53}L231 ${y}L125 ${y - 53}Z`}
                    fill={i === 2 ? '#2E7DF7' : '#1e477d'}
                    fillOpacity={i === 2 ? '.8' : '.85'}
                    stroke="#7ab9ff"
                    strokeWidth="1.2"
                  />
                  {[0, 1, 2, 3].map(j => (
                    <g key={j}>
                      <path
                        d={`M${22 + j * 35.3} ${y + j * 17.7}v34M${128 + j * 34.3} ${y + 53 - j * 17.7}v34`}
                        stroke="#b2d2fa"
                        strokeWidth="3"
                      />
                    </g>
                  ))}
                </g>
              ))}
            </g>
          </svg>
          <div className="hp-model-foot">
            <span>
              <i /> {revised ? 'Review revised timing' : 'Structure / planned sequence'}
            </span>
            <span>0{phase + 1} / 04</span>
          </div>
          <label className="hp-scrubber">
            <span>
              EXPLORE THE BUILD <b>{['Foundations', 'Level 01', 'Level 02', 'Structure'][phase]}</b>
            </span>
            <input
              aria-label="Construction phase"
              type="range"
              min="0"
              max="3"
              step="1"
              value={phase}
              onChange={event => setPhase(Number(event.target.value))}
            />
          </label>
        </div>
      </div>
      <div className="hp-preview-bottom">
        <span>
          Model <b>+</b> Programme <b>→</b> 4D <b>+</b> Project controls
        </span>
        <span>Example only · no live project data</span>
      </div>
    </div>
  )
}

export function HomePage({ onSignIn, onRequestAccess }: { onSignIn: () => void; onRequestAccess: () => void }) {
  return (
    <div className="homepage">
      <a className="hp-skip" href="#hp-main">
        Skip to content
      </a>
      <header className="hp-header">
        <div className="hp-wrap hp-nav">
          <a className="hp-brand" href="#hp-main" aria-label="Prosota home">
            <ProsotaLogo size={32} />
            <span>
              PROSOTA<span className="hp-brand-dot">.</span>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a href="#workflow">The workflow</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#about">Why Prosota</a>
          </nav>
          <button className="hp-signin" onClick={onSignIn}>
            Sign in <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>
      <main id="hp-main">
        <section className="hp-hero hp-wrap">
          <div className="hp-eyebrow">
            <span /> 4D SIMULATION + CONNECTED PROJECT CONTROLS
          </div>
          <div className="hp-hero-copy">
            <h1>
              Plan the work.
              <br />
              <em>See it take shape.</em>
            </h1>
            <div className="hp-hero-aside">
              <p>
                Bring your model and programme together in 4D. Explore how the build unfolds, review the sequence and
                understand the resources, cost and risk behind it.
              </p>
              <div className="hp-actions">
                <button className="hp-button" onClick={onRequestAccess}>
                  Request early access <span aria-hidden="true">↗</span>
                </button>
                <a className="hp-text-link" href="#workflow">
                  Explore 4D planning <span aria-hidden="true">↓</span>
                </a>
              </div>
              <span className="hp-hero-note">Browser-native · 4D BIM, planning & project controls</span>
            </div>
          </div>
          <ProgrammePreview />
          <div className="hp-compat">
            <span>START WITH THE WORK YOU ALREADY HAVE</span>
            <div>
              <span>Primavera P6 XML</span>
              <span>IFC models</span>
              <span>FBX & glTF</span>
              <span>Or a blank programme</span>
            </div>
          </div>
        </section>
        <section id="workflow" className="hp-workflow">
          <div className="hp-wrap">
            <div className="hp-section-head">
              <div>
                <p className="hp-eyebrow">01 / THE WORKFLOW</p>
                <h2>
                  From model and programme
                  <br />
                  to a build you can explore.
                </h2>
              </div>
              <p>
                Connect what you’re building with when you’re building it. Review the sequence visually, then follow the
                detail through to your project controls.
              </p>
            </div>
            <div className="hp-steps">
              {[
                [
                  '01',
                  'Bring the model and plan together.',
                  'Load an IFC, FBX or glTF model. Import your P6 XML programme or build one in Prosota, then link model elements to activities.',
                ],
                [
                  '02',
                  'Explore how the build unfolds.',
                  'Play the activity-linked 4D sequence. Review construction phases, investigate clashes and communicate the proposed method visually.',
                ],
                [
                  '03',
                  'Put the sequence in context.',
                  'Review the resources, costs and risks behind the activities. Compare baselines and bring the findings into your reporting.',
                ],
              ].map(([n, title, copy]) => (
                <article key={n}>
                  <span className="hp-step-number">
                    {n}
                    <span aria-hidden="true">↗</span>
                  </span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section id="capabilities" className="hp-capabilities hp-wrap">
          <div className="hp-section-head">
            <div>
              <p className="hp-eyebrow">02 / CONNECTED CAPABILITIES</p>
              <h2>
                The detail you need.
                <br />
                The context that matters.
              </h2>
            </div>
            <p>
              A common thread through planning, controls and BIM: the activities that describe how your project will be
              delivered.
            </p>
          </div>
          <div className="hp-cap-grid">
            {capabilities.map(([n, title, label, copy]) => (
              <article key={n}>
                <div className="hp-cap-label">
                  <span>{label}</span>
                  <span>{n}</span>
                </div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="about" className="hp-about">
          <div className="hp-wrap hp-about-grid">
            <div>
              <p className="hp-eyebrow">03 / THE THINKING BEHIND PROSOTA</p>
              <h2>
                A plan you can analyse.
                <br />A build you can see.
              </h2>
            </div>
            <div>
              <p className="hp-about-lead">
                The model shows what you’re building. The programme describes how and when. Put them together in 4D and
                the delivery plan becomes something the whole team can explore.
              </p>
              <p>
                Prosota was founded by Louis Oghenemaro Sota, a Senior Planner and 4D Project Controls Specialist,
                around that idea. Built for the people responsible for turning complex work into a credible delivery
                sequence.
              </p>
              <div className="hp-founder">
                <ProsotaLogo size={36} />
                <span>
                  Practitioner-led.
                  <br />
                  <strong>Built for construction & infrastructure.</strong>
                </span>
              </div>
            </div>
          </div>
        </section>
        <section id="contact" className="hp-contact hp-wrap">
          <div>
            <p className="hp-eyebrow">
              <span /> EARLY ACCESS / ACTIVE DEVELOPMENT
            </p>
            <h2>
              See your next project
              <br />
              take shape in 4D.
            </h2>
            <p>
              Bring your model, your programme and your planning workflow.
              <br />
              Create an account to request access; approval is required.
            </p>
          </div>
          <div className="hp-contact-actions">
            <button className="hp-button" onClick={onRequestAccess}>
              Request early access <span aria-hidden="true">↗</span>
            </button>
            <a className="hp-text-link" href="mailto:lsota@prosota.com?subject=Prosota%20early%20access">
              Talk to the founder <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>
      </main>
      <footer className="hp-footer">
        <div className="hp-wrap">
          <a className="hp-brand" href="#hp-main">
            <ProsotaLogo size={25} />
            <span>PROSOTA.</span>
          </a>
          <span>Plan. Control. Simulate. Deliver.</span>
          <span>© {new Date().getFullYear()} Prosota Ltd</span>
        </div>
      </footer>
    </div>
  )
}
