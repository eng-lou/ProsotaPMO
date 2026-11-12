# Prosota

Prosota is a planning, project controls and construction simulation platform for construction and infrastructure, with a web application and a Windows desktop edition.

The schedule represents how a project will be delivered. Resources, costs, risks, BIM models and operational sequences connect to that schedule so teams can plan the work, test delivery methods and communicate the resulting programme.

Built by [Prosota Ltd](https://prosota.com), founded by Louis Oghenemaro (Maro) Sota, Senior Planner / 4D Project Controls Specialist.

## What it does

- **Scheduling and resourcing** — a native critical-path-method engine with dependency types and lag, calendars, whole-day scheduling and underlying hour-precision calculations, constraints, milestones, WBS rollups, subprojects, working schedules and baselines. Includes Gantt editing, schedule-quality checks and Primavera P6 import/export workflows.
- **Resources and cost control** — labour, plant and material assignments, resource tracking and usage profiles, overallocation highlighting, rate cards and schedule-linked costs. Cost planning includes fixed and percentage-based elements, commitments, Earned Value Management and configurable variance thresholds.
- **Risk and change control** — threat/opportunity registers, inherent and residual risk assessment, mitigation tracking and EMV; integrated Issues, Changes and Decisions with approvals and audit history. Records can link to the activities and costs they affect.
- **BIM and 4D sequencing** — federated IFC models and imported 3D assets linked to activities, model-derived schedule generation, reusable animation profiles, removal/reveal effects, staggered sequences, keyframes and path-based motion. Activity search, linked-element selection, isolation, collections and section tools support model navigation.
- **3D site tools** — an asset library, independent placements, arrays and scattered vegetation, fences, drawn surfaces, shape operations and excavation workflows. Material, texture and surface-wear controls support construction-stage presentation and site context.
- **Visualisation and communication** — realistic materials, sun/sky and HDR environments, shadows and ambient occlusion; camera presets, saved views and animated cameras; overlays, image capture and video export. Model review includes clash workflows and point-cloud tools.
- **Operational Simulator (Preview)** — define activity steps, resources and dependencies; run and compare operational scenarios; inspect duration and resource impacts; and preview supported worker/tool methods in 3D. A validated combined sequence can be promoted into the working 4D timeline and exported to video.
- **Reporting and Poe** — project reporting and Power BI snapshot workflows, plus AI-assisted planning and model tools. Desktop Poe uses a configured provider and the user's API key; availability depends on provider/model support.

Resource Tracking and Profile support Budgeted, Actuals and Earned Value figures, aligned timelines and adjustable print spacing. See [resource display and print notes](docs/RESOURCE_DISPLAY_AND_PRINT.md) for controls and calculation limits.

## Web and Windows desktop

The Windows desktop edition packages the frontend, Python backend, IFC processing libraries and a local PostgreSQL runtime. End users do not need to install Node.js, Python or PostgreSQL separately.

Desktop project records are stored in the local database; model and asset files are stored separately in the local workspace. Desktop and web projects are separate: signing in does not automatically synchronise them. Sign-in and approval checks, AI providers and online site-context services require connectivity.

Preview and Stable use separate release channels. Preview is for evaluating changes before wider release; building a local Preview installer does not publish the website or a Stable release.

See [desktop setup and data notes](desktop/README.md) for sign-in, storage, provider settings and packaging details. Some historical version notes in that document describe earlier feature stages.

## Simulator scope

Operational simulation is under active development. Supported methods connect activity steps to resource usage and visual playback; this is not a general-purpose physics simulation of every construction operation. For example, calculating excavation fleet events does not automatically choreograph every machine.

Promoting a detailed sequence fits its visual playback into the parent activities' scheduled windows. It does not itself change programme dates or recalculate the original simulation's productivity and costs. Reviewing and accepting programme impacts is a separate action.

See the [Simulator guide](docs/SIMULATOR_GUIDE.md) for supported methods, scenario freshness checks and playback/export limitations.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Tailwind CSS, React Query, Vite |
| 3D workspace | Three.js, React Three Fiber, WebGL, web-ifc |
| Backend | FastAPI, Python, SQLAlchemy, Alembic |
| Database | PostgreSQL, accessed through psycopg |
| Desktop | Electron, packaged Python backend and local PostgreSQL 16 |
| Authentication | Auth0 for web sign-in; desktop sign-in and approval integration |

## Status

Active development, including local Windows Preview builds. Scheduling, controls, BIM/4D, site tools and operational simulation are implemented to different levels of maturity. Preview capabilities continue to receive correctness, rendering and performance fixes; feature presence should not be read as a claim that every workflow or model scale has been validated.

Current implementation notes and known limitations are tracked in the [learning log](docs/LEARNING_LOG.md), [improvement backlog](docs/IMPROVEMENT_BACKLOG.md) and feature guides.

## Local development

**Backend**

```
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
alembic upgrade head
python run.py
```

**Frontend**

```
cd frontend
npm install
npm run dev
```

Requires a local PostgreSQL 16 instance and an Auth0 tenant configured via environment variables.

## Local desktop Preview build

From the repository root, with desktop dependencies installed and a current packaged backend:

```powershell
npm.cmd --prefix desktop run build:ui
Copy-Item -LiteralPath desktop/ui/desktop-settings.html,desktop/ui/desktop-settings.js -Destination desktop/dist
npm.cmd --prefix desktop run package:preview
```

Installers are written to `desktop/release/preview/`. Packaging checks the bundled backend's source fingerprint and rejects a stale backend. After backend changes, rebuild it using the desktop build workflow (`desktop/build.ps1 -SkipInstaller`) before packaging. Building the desktop runtime requires the development tools and PostgreSQL binaries described in that script; these are bundled for end users.

## Vercel database migrations

The backend service build runs `deploy_migrations.py` using its configured
`DATABASE_URL`. Production builds (`VERCEL_ENV=production`) apply Alembic upgrades
under a PostgreSQL transaction lock before deployment. Connection, migration or
schema-version failures fail the build. The Dockerfile is not used by the Vercel
Python service, so its startup migration command does not cover Vercel deployments.

Preview builds only check the schema version and never upgrade a potentially
shared production database. Use a separate preview database and apply
`alembic upgrade head` to it before deploying a preview containing schema changes.
Production credentials must be available to the backend build as well as runtime.

## Testing

Product improvements and implementation status: [improvement backlog](docs/IMPROVEMENT_BACKLOG.md).

From `backend` with its development environment activated:

```sh
pytest
```

From `frontend`:

```sh
npm test
npm run build
```

CI runs the backend test suite against a real PostgreSQL service container, plus the frontend Node tests, production build and desktop configuration checks, on pushes and pull requests to `main` and `preview`. Two frontend IFC fixture tests require optional local model paths and are skipped when those files are not supplied.

## License

Proprietary — © Prosota Ltd. All rights reserved.

Clash detection and external review: [workflow, sharing and SMTP setup](docs/CLASH_REVIEW_AND_SHARING.md).
