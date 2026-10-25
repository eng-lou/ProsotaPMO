# Web releases, desktop download and access emails

## Existing publishing route

The web repository is `eng-lou/ProsotaPMO`; production follows `main`.
Use normal Git through Windows Credential Manager. A signed-out `gh` CLI or
missing local `.vercel` directory does **not** mean Git publishing is unavailable.
Check `git push --dry-run origin main` before asking the owner to reconnect.
After pushing, verify the actual production deployment at www.prosota.com.

The homepage's Windows link targets the versioned GitHub release asset.
`desktop/publish_release.py` verifies the local installer against
`desktop/release/release-manifest.json`, uploads the installer and manifest, then
publishes a preview release. It does not publish project data or model sources.
The current preview is unsigned. Desktop projects remain local, separate from web.

## Provider key setup links

Desktop Settings includes direct key-management links for OpenAI, Anthropic / Claude,
Google Maps and Gemini. Site Context includes the Maps key page and Map Tiles API
setup guide in both builds. Google 3D Tiles needs the Map Tiles API enabled and
billing configured in the user's Google Cloud project.

Desktop opens only the exact public setup URLs listed in `desktop/provider-links.cjs`
in the system browser. Other external popups remain blocked; keys are not attached
to the URLs. The allowlist module must be included in the installer file list.

## Gmail notification configuration

Configure these in the production backend's environment settings, never source
control or chat:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=<sending Gmail address>
SMTP_PASSWORD=<Google app password for that account>
SMTP_FROM=<same sending Gmail address>
ACCESS_REQUEST_NOTIFY_EMAIL=sotalouisx@gmail.com
PUBLIC_APP_URL=https://www.prosota.com
```

Google documents Gmail SMTP and app-password requirements at
https://support.google.com/a/answer/176600.

Migration `af57df178290` adds notification attempt/sent timestamps. The request is
saved before email delivery, so SMTP failure does not lose it. Successful deliveries
are not repeated on form resubmission. Delivery uses STARTTLS; provider responses
and credentials are not logged. SMTP acceptance is not proof of inbox delivery.

Access Manager shows notification status and offers a retry for unsent requests,
up to five eligible requests at a time, with a five-minute retry cooldown.
There is no scheduled retry worker yet. The existing approval queue remains the
source of truth. After configuring Gmail, submit a real access request and verify
both the email inbox and Access Manager; local mocked tests cannot verify Gmail.

## Planner release channels (25 October 2026 — setup in progress)

Prosota is the group brand; the application is Prosota Planner. The approved
destinations are `www.prosota.com` for Stable and `preview.prosota.com` for Preview.
Preview must use separate database records and file storage. Never publish a
Preview deployment with production storage credentials or a production database.

The existing Vercel project is `prosota/prosota-pmo`; production deploys from
`eng-lou/ProsotaPMO` main. On 25 October, its existing `DATABASE_url` variable was
restricted from Production + Preview to Production only. This affects future
deployments; it does not reconfigure any previously deployed preview.

Neon project `young-rice-65534909` now has a schema-only branch named
`prosota-planner-preview` (`br-tiny-field-za7am7o2`), with no copied production
records and no expiry. SQL checks confirmed 93 tables, zero projects and zero
users. Its initially empty Alembic revision table was initialized to
`b068e02893a1`, after reading that exact revision from the source branch. It is
not yet connected to Vercel. Schema-only cloning does not copy Alembic's revision
row: verify/stamp the matching source schema revision before applying newer
migrations. Do not blindly stamp head.

Remaining deployment gates: preview database assignment and schema verification,
separate R2 bucket/credentials, Auth0 callback verification, preview domain and
branch configuration, release packaging/publication, and live smoke tests.
The release catalogue keeps unavailable links disabled until these checks pass.

Desktop channel packaging uses `npm run package:stable` and
`npm run package:preview` from `desktop`. Stable uses its own application identity
and workspace. Preview retains the existing `Prosota Desktop Preview` workspace
so current users keep their projects. Transfer projects explicitly with backup
and restore; never point both installations at the same live database directory.
Publish channel manifests/installers with `desktop/publish_planner.py --channel`.

Local release checks: 1,107 backend tests passed, seven skipped and 19 subtests
passed; 199 frontend tests passed with two optional fixture tests skipped; all
11 desktop configuration tests passed. Web and desktop UI production builds
passed. Packaged backend smoke checks passed. These checks do not replace live
deployment/login/upload testing, which remains pending.

## Verification recorded 24 October 2026

- Frontend build and TypeScript pass; 186 frontend tests pass, two skipped.
- Five isolated email tests pass: TLS before authentication, successful delivery
  deduplication, failed delivery retaining the request, missing configuration,
  and approved/concurrently locked requests being skipped.
- Production SMTP configuration and inbox delivery have not yet been verified.
