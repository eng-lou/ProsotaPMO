# Prosota

A browser-native planning platform for construction and infrastructure. The schedule is the digital representation of how a project will be delivered — everything else exists to enrich, validate, optimise, or communicate that schedule (NEC/JCT-style construction programmes and beyond).

Built by [Prosota Ltd](https://prosota.com), founded by Louis Oghenemaro (Maro) Sota (Senior Planner / 4D Project Controls Specialist).

## What it does

- **Scheduling** — the heart of the platform: a real critical-path-method engine (hour-precision forward/backward pass, multi-calendar support, dependency logic, DCMA 14-point schedule quality checks, named/saved baselines, resource-loaded activities) — not a wrapper around someone else's scheduling tool.
- **Resources** — labour/plant/materials assignments integrated directly into the schedule, driving cost automatically.
- **Cost Plan** — derived from the schedule: fixed and percentage-based cost elements, real computed Earned Value Management (CV, CPI, SPI, EAC, ETC), configurable variance thresholds, rate cards, commitments.
- **Analysis** — schedule-focused risk and quality: a Risk Register (threat/opportunity split, inherent/residual heat-matrices, mitigation tracking, EMV) alongside DCMA schedule-quality checks and baseline comparison.
- **ICD Tracker** — Issues, Changes, and Decisions in one integrated change-control tracker, with real approval workflows and audit trails.
- Every capability cross-links back to the Activities that drive it — a risk can point at the cost line and the schedule activity it actually threatens, not live in its own silo.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, TailwindCSS, React Query, Vite |
| Backend | FastAPI (Python), SQLAlchemy, Alembic |
| Database | PostgreSQL |
| Auth | Auth0 (SSO/MFA) |

## Status

Active development. The scheduling, cost, risk, and change-control modules are built and in real use; further modules (a controls dashboard, contractor-facing tooling, AI-assisted analysis) are in progress.

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

## Testing

```
cd backend && pytest
cd frontend && npx tsc --noEmit
```

CI runs the full backend test suite against a real Postgres service container on every push/PR to `main`.

## License

Proprietary — © Prosota Ltd. All rights reserved.
