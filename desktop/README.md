# Prosota Desktop Preview

Separate Windows x64 edition for evaluating local Prosota. This does not change
the website deployment, migrate web projects, or change the product's licence.

## Try it

1. Run `release/Prosota-Desktop-Preview-0.2.10-Setup.exe`.
2. Open **Prosota Desktop Preview** and sign in in your browser using your
   existing Prosota account (including Google). New users submit the existing
   web access request and wait for approval. Once approved, choose **Continue
   to Prosota Desktop**, then create a project and import a model.
3. Use the existing Scheduling, BIM/4D, Resources, Cost, Risk and ICD screens.
4. For Poe, choose **Settings** in the sidebar (or **Prosota Desktop → Settings…**), select OpenAI or
   Anthropic, and enter your own API key and a model ID your account can use.
   Leave the provider **Off** to work without AI.
5. Add your Google Maps Platform key in the same Settings window for 3D site
   context. Optional concept renders have their own provider selection there.
   Saving settings never calls a paid API. Blank key fields preserve saved keys.
6. In **Reporting & Controls → Open in Power BI → Build and open**, Prosota
   builds an integrated snapshot and opens a local Power BI project with the
   custom visual and IFC already embedded. Power BI Desktop with PBIP support
   must be installed. The snapshot includes saved models, active schedule,
   linked resources/cost data and profiles; it is not a live connection.

The installer includes the UI, Python backend, IFC processing libraries and a
private PostgreSQL 16 runtime. Users do not install Python, Node, PostgreSQL,
Docker or Auth0. It runs as the Windows user, with no system database service.
The preview installer is unsigned.

Version 0.2.6 synchronises the signed-in owner's project entitlement on startup,
including existing local workspaces. Bootstrap owner accounts have unlimited
project creation; ordinary trial accounts retain the two-project cap. Cloud
responses with an explicit role take precedence over the legacy identity-only
compatibility mapping. Local project IDs and ownership are retained.

Version 0.2.10 adds **Site Tools → Asset library** for self-contained GLB models,
an orbitable preview, checked palette and independent viewport placements.
Importing or inspecting an asset does not add scene geometry. Choose **Place
this asset**, click a location in the viewport, then Save. Existing placeholders
remain under **Layout tools**. GLB animation is not played in this initial library.

## Data and connections

- Projects, model files and browser preferences are separate from Prosota Web.
- Data is under `%APPDATA%\Prosota Desktop Preview`. The application menu opens
  this folder. Uninstalling deliberately retains it.
- The backend and database listen only on loopback. The API also requires a
  randomly generated desktop-session secret; the database uses its own password.
- Provider keys and the database password are encrypted using Electron
  `safeStorage` (Windows DPAPI). They are not included in the installer or
  returned to the settings renderer. The Google Maps browser key is provided
  to the map renderer because Google Tiles requires it; restrict it to the
  necessary APIs in Google Cloud. Project/model files themselves are not encrypted.
- Poe sends relevant project/model data and attachments to the selected provider
  when used. Provider charges are paid by the key owner. A compatible tool-capable
  model is required. No paid provider call is made during installation or tests.
- Sign-in uses the web Auth0 login and approval system. The cloud desktop-auth
  endpoints and `/desktop-signin` page must be deployed before this installer
  can sign in. A connection is required at each startup to verify approval.
  Sessions last up to 30 days; approval is checked at startup, not continuously
  during an open desktop session. Sign out revokes the session when online and
  always removes its encrypted local credential. Projects and API keys remain.
- The first approved account claims the local workspace. Use the same account
  thereafter, or a separate Windows user profile for a different account.
  Sign-in does not sync projects to the web. Vercel telemetry and Cloudflare R2
  are not used by the desktop workspace.
- Online site-context services still need their own connectivity/credentials.
  Public cloud sharing, email invitations and multi-user collaboration are not
  supplied by this local preview. Existing web sharing UI does not make local
  links accessible to other computers.

## Backup, restore and updates

Use **Settings → Create backup** to save a `.prosota-backup` outside the app
data folder. Save edits first: the app pauses services and restarts afterwards.
The archive includes a logical PostgreSQL dump, local model/storage files and
generated Power BI report folders. It excludes provider keys, database passwords,
browser caches and the credential settings table. Backups contain unencrypted
project data and should be stored privately.

On another PC, install Prosota Desktop and choose **Settings → Restore backup**.
Only restore trusted backups. Restore replaces the local workspace, validates
checksums and paths, builds a fresh database, then swaps directories. The previous
workspace remains in `before-restore-*` inside the data folder. API keys on the
destination are retained; re-enter them on a new PC. Close any generated Power BI
reports before backup/restore so that external edits are not in progress.

Install newer preview installers over the existing installation. On first launch
of a new app version, a backup is created **before** migrations in the sibling
`Prosota Desktop Preview Backups` folder. A failed backup prevents startup.
Backups/recovery folders are never automatically pruned. Browser preferences are
kept on this PC; portable restores include project data, not browser preferences.

This release does not download updates automatically. A release host and signing
identity are not configured. `build.ps1 -SignedRelease` requires valid signing
credentials through electron-builder's release environment and fails closed;
normal preview builds remain unsigned. `release/release-manifest.json` records
the version, installer SHA-256 and signature status.

## Power BI limits

Each handoff creates a new report under the local data folder's **Power BI reports**,
preserving previous reports and edits. The compressed IFC is stored in the report's
visual properties, so it opens without a local HTTP server or file picker. Sharing
the report therefore shares its model and embedded project data. The preview
limit is 256 MB of uncompressed integrated IFC. Opening a different IFC manually
inside the visual replaces it only for that session; generate a new report from
Prosota to update the embedded snapshot. Baseline comparison still uses the
visual's existing baseline IFC control. Power BI organisational policy may block
uncertified custom visuals. No publishing or Power BI account login is automated.

Clean-machine installation, signed distribution and live paid provider acceptance
remain unverified. There is no automatic cloud synchronisation.

## Build

Prerequisites for developers only: Node, the frontend dependencies, the backend
Python environment, PyInstaller 6.22.3, and a PostgreSQL 16 Windows distribution.

```powershell
cd desktop
npm ci
cd ..
backend/.venv/Scripts/python.exe -m pip install pyinstaller==6.22.3
./desktop/build.ps1
```

`build.ps1 -PostgresRoot <folder>` selects PostgreSQL binaries; it never copies
the installed server's `data` directory. Runtime files and installers are ignored
by Git. Third-party PostgreSQL licence files accompany the runtime; Electron's
licences accompany the packaged application. Complete dependency notice/licence
review is still needed before public distribution.

All edition-specific code is under `desktop/`. A separate Vite configuration
substitutes desktop authentication and omits telemetry. The desktop Python
composition root injects local object storage and local account dependencies;
the web entry point never imports it. The backend settings are explicitly reset
to defaults, rather than inheriting development/production `.env` credentials.

## Verification

```powershell
node --test desktop/tests/settings.test.cjs
node --test desktop/tests/powerbi.test.cjs
backend/.venv/Scripts/python.exe desktop/tests/backup_test.py
backend/.venv/Scripts/python.exe desktop/tests/smoke.py
backend/.venv/Scripts/python.exe desktop/tests/smoke.py --packaged
desktop/node_modules/.bin/electron.cmd desktop/tests/ui-smoke.cjs
```

The smoke tests create isolated data under `desktop/.test-data`, test real local
API/database/file behaviour, and stop their private database on exit. The UI test
blocks external HTTP(S) requests. Test data is not bundled in the installer.

Validated on 20 October 2026: source and bundled backend project/activity/resource/
cost creation, assignment persistence, model upload/download after restart, and
native IFC2X3-to-IFC4 conversion. Electron testing with external HTTP(S) blocked
confirmed project selection, dashboard loading, saved IFC geometry selection and
framing, and saving/removing a dummy encrypted AI key. Storage traversal/signature
tests and settings validation tests also passed. No live paid AI request was made.
Portable backup/restore also passed with a new database password, preserving
model bytes and resource/cost assignments. The upgrade test preserved the project
and created a recovery backup before startup. The Reporting & Controls handoff
passed in Electron; native Power BI opened both a linked test model and the
49 MB Design Tower IFC with its schedule. Embedded reports now open at schedule
finish so geometry is visible immediately; browser regression tests cover this
and preservation of playback during host updates.

The installer has not yet been tested on a separate clean Windows machine.
