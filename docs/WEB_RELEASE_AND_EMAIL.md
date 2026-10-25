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

## Planner release channels (25 October 2026)

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
`b068e02893a1`, after reading that exact revision from the source branch. Its
connection is now saved as a Preview-only Vercel `DATABASE_url` secret, using
the application's `postgresql+psycopg` driver. The UI verified separate Preview
and Production entries. Live Preview project creation and reload have passed. `VITE_RELEASE_CHANNEL=preview` is also saved for Preview
only, so its badge cannot be mistaken for Stable. Schema-only cloning does not copy Alembic's revision
row: verify/stamp the matching source schema revision before applying newer
migrations. Do not blindly stamp head.

Auth0 application `ProsotaPMO Web` now includes `https://preview.prosota.com` in
its callback, logout, and web-origin allowlists, after explicit user approval.
Existing entries and authentication protections were preserved. Live Preview Google sign-in passed.

Cloudflare R2 now has a private `prosota-planner-preview` bucket in Western
Europe. Its persistent Object Read & Write credential is scoped to this bucket
only. After user approval, its access key, secret and bucket name were saved as
Preview-only Vercel variables; the original three variables are Production-only.
Preview also has its own explicit account-ID variable matching this bucket's
Cloudflare account; the original account-ID entry is Production-only. CORS permits GET/HEAD/PUT from
`https://preview.prosota.com`, Content-Type request headers and ETag responses.
Public bucket access remains disabled. No credentials are recorded here.

The `preview` Git branch was pushed at `47d0d69`; Vercel reports its first build
Ready. `preview.prosota.com` is assigned to that branch; the Namecheap CNAME
`preview` to `7e3a6b087dc7d2f0.vercel-dns-017.com.` is saved. HTTPS and Google
sign-in passed; the new database presented zero projects before the named release
smoke project was created successfully. The synthetic OBJ import, library publication, scene placement and full-page
reload now pass. Credentials and the explicit Preview account ID were corrected
before deployment. The reload check also exposed a browser download issue:
site assets used an authenticated API redirect to R2. Commit 9c4fee9 adds an
owner-checked JSON signed-URL option and a separate unauthenticated storage
request; the old redirect remains for older clients. Four isolated regression
tests pass (ready/archived/pending states, legacy clients, owner isolation), and
the production web build passes. Screenshot: outputs/planner-preview-restored-asset.png.
Preview Web is enabled only after this successful live round trip. Stable's new build, Google sign-in, existing
project list and dashboard load have passed. The two public GitHub releases
were checked without credentials: both installer sizes and SHA-256 digests match
the local manifests, with Preview marked prerelease and Stable not prerelease.
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
deployment/login/upload testing; the live checks above cover those paths.

Both channel installers were built from commit
`47d0d6960c4660c6c6c0f7ba22bc36af81bddf74` with clean source manifests; packaged
application metadata confirms the appropriate channel and version 0.2.41.
They are unsigned and now published as `planner-stable-v0.2.41` and
`planner-preview-v0.2.41` in eng-lou/ProsotaPMO (Preview is a prerelease). The release-page Electron check also
passed at 1440x1100 and 390x1100 with no overflow or renderer errors.

## Verification recorded 24 October 2026

- Frontend build and TypeScript pass; 186 frontend tests pass, two skipped.
- Five isolated email tests pass: TLS before authentication, successful delivery
  deduplication, failed delivery retaining the request, missing configuration,
  and approved/concurrently locked requests being skipped.
- Production SMTP configuration and inbox delivery have not yet been verified.

### Remaining service checks
Preview AI provider keys are not enabled yet; expanding their environment scope
is awaiting user confirmation. Do not claim Poe is verified in Preview. Gmail
SMTP configuration and inbox delivery also remain unverified. The published
0.2.41 desktop packages use local signed storage and do not require the web
cross-origin redirect correction; their exact source remains recorded above.

## Owner clarification: promotion policy
Preview is the owner's development environment, not a public tester channel.
The www.prosota.com homepage advertises only Stable Web and Stable Desktop.
Develop and push ongoing changes to the preview branch. Promote to main and
publish a new Stable installer only after the owner explicitly approves a
reviewed version. Passing automated checks alone is not promotion authority.
Today's initial release setup was already pushed to both branches before this
clarification; the public catalogue correction is the final setup adjustment.
Preview database approvals remain separate: do not approve other Preview users
without the owner's instruction. Existing public Preview GitHub artifacts have
not been deleted or made private; hiding a website link does not revoke those
previously published downloads. AI key scope has not been expanded.
