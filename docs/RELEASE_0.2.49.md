# Prosota Planner Web 0.2.49 - responsiveness and recovery

Prepared for Stable promotion at the owner's request on 14 November 2026.
C++ / WebAssembly migration is deferred. This is not evidence of publication.
The owner subsequently paused desktop work and asked to focus on web versions.
Web publication does not depend on a new desktop installer. Preserve the existing
verified desktop download links and keep desktop-only changes out of this promotion.

## Web changes
- Activity autosave shows saving, saved and failure states. Failed drafts stay
  editable and can be retried; cancelled relationship amendments do not report
  success. Duplicate submissions are suppressed and late completions cannot
  hide a newer error.
- The predecessor/successor add form now retains its element identity while
  typing. Previously the nested component definition remounted its inputs on
  every parent update. Relationship creation/removal now show pending and error
  states and distinguish a saved mutation from a subsequent refresh failure.
- Schedule edits retain references for unchanged activities, relationships and
  resource assignments, reducing downstream recalculation.
- The initial HTML has a readable loading/reload fallback when the application
  bundle cannot start. Account, access and workspace loading states now identify
  what is opening, show connection guidance when offline or waiting over 12
  seconds, and offer an explicit reload action. No automatic reload or storage
  clearing was introduced.

## Existing Preview improvements retained

The working tree includes the previously prepared Preview .8–.20 changes for
schedule refreshes, CPM calendar/row-refresh costs, resource demand loading,
IFC picking, paused 4D work, navigation settling, hidden workspace work,
selection animation ownership and reverse scrubbing. See LEARNING_LOG.md and
the November 12–13 performance audits for the measured scope and limitations.
The live Tower scene's previously reported 46.5 million submitted triangles
and remaining per-mesh costs are not claimed resolved by this release.

## Verification

- Frontend suite: 387 passed, two optional tests skipped.
- TypeScript and the final Stable web production build passed (19.47 seconds).
- The Preview web production build also passed (19.18 seconds), with its channel
  set explicitly and output separate from the Stable build. Neither is deployed.
- Final focused autosave/release checks: five passed.
- Backend scheduling/resource/calendar/IFC/profile regressions: 154 passed and
  10 subtests passed in 755.25 seconds, in a fresh disposable PostgreSQL database.
  This includes the seven focused performance regressions, which also passed
  separately. It is not a full-backend-suite pass. Disposable databases from
  this task were removed; user project databases were not used for tests.
- No live Tower FPS improvement or deployed-web interaction pass is claimed.

The public installer link remains at the existing verified 0.2.48 download
until a new installer is verified and published. Stable and Preview retain
their separate workspace directories; no user projects have been migrated.

## Web release blocker in this execution session

- Git cannot create `.git/index.lock` (permission denied). No source commit or
  push has been performed. The working branch is `codex/release-0.2.43`;
  production follows `main` as documented in WEB_RELEASE_AND_EMAIL.md.
- The normal Windows Git credential helper also cannot launch in this sandbox.
  This is not evidence that the owner's GitHub credentials are absent. The
  previously suggested GitHub connection is not installed in this session.

After restoring Git access: review and commit the intended frontend/backend
changes and release documentation (exclude desktop, project documents, uploads,
outputs and storage-maintenance scripts). Validate the Preview web deployment
against its separate database and storage, then promote the reviewed revision
to `main` without force and verify Stable login, project load, activity editing,
linking and BIM navigation. The owner's Stable promotion approval is already
recorded. Follow WEB_RELEASE_AND_EMAIL.md for environment separation.

## Desktop work retained locally, deferred by owner

Startup/recovery screens, bounded UI readiness, visible startup stages and
Electron-network-stack authentication were implemented before desktop was paused.
Authentication/approval/ownership checks remain enforced; offline access was not
introduced. The different-Wi-Fi incident has not been reproduced or diagnosed.
Before the pause, 16 desktop unit tests and a desktop UI build passed, and the
packaged backend fingerprint matched source. The subsequent web loading-state
change has not been rebuilt into desktop. The isolated UI smoke fixture remains
at desktop/tests/startup-ux.cjs; no live desktop visual pass is claimed.

- Installer packaging failed at the protected Electron download cache. The
  packager now reuses the already installed Electron distribution, avoiding a
  duplicate download. That attempt reached backend resource copying but was
  blocked by EPERM creating a botocore resource directory inside win-unpacked.
  No completed 0.2.49 installer exists. Do not distribute the partial directory.
- Live Electron smoke execution exited before creating its result. Escalation
  was rejected by the environment's approval policy. This requires a normal
  desktop execution session to verify.

Do not resume desktop packaging/publication as part of the current web task.
