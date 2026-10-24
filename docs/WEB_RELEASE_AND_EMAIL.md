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

## Verification recorded 24 October 2026

- Frontend build and TypeScript pass; 186 frontend tests pass, two skipped.
- Five isolated email tests pass: TLS before authentication, successful delivery
  deduplication, failed delivery retaining the request, missing configuration,
  and approved/concurrently locked requests being skipped.
- Production SMTP configuration and inbox delivery have not yet been verified.
