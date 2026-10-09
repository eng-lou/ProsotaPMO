# Clash detection, review and external reports

Updated 9 October 2026.

## Workflow

1. Create collections in BIM, Simulations & Reality Capture. Open Clash Detective and add or edit a hard-intersection or clearance test.
2. Choose all collection elements or visible whole elements, confirm the scene units, and optionally choose a timeline date. Collections must resolve fully; unloaded models, ambiguous identities, unsupported level slices or invalid meshes stop the run and preserve saved results.
3. Run the test. Geometry is frozen before worker computation. Cancel stops the worker; cancellation is disabled during the final database save. Other tests cannot run concurrently in the same viewport.
4. Filter, search, group by model/type/level/element/status, select results and review them. The result list pages in groups of 50. Notes retain an audit history. Click a pair for its saved 3D viewport, contrasting A/B colours, framing, isolation and a location marker.
5. Create an issue with a responsible person, due date and live reporting period. The issue retains the clash/run references and a link back to its viewport; repeated creation returns the linked issue.
6. Select a saved run and the selected or filtered clashes, then choose **Send report**. Create a link with 1–90 day expiry, optionally enable reviewer comments, then copy it, open an email draft, or send through configured SMTP. Saved camera positions from the inspection window accompany the report.
7. Review external comments and revoke links through **Manage shared reports**. A new run or changed note does not modify an already-shared report.

## Detection and run evidence

- Hard tests detect surface contact/intersection and containment where the enclosing geometry is closed and manifold. Open/non-manifold surfaces are flagged; the engine does not claim reliable solid containment for them.
- Clearance uses the actual nearest distance and explicitly checks the threshold; overlapping bounding boxes alone cannot create a clash.
- Same-element pairs and repeated/reversed candidate pairs are excluded. IFC references include the model name; ambiguous duplicate model/GUID references fail rather than choose the first file.
- An element-level bounding-box sweep rejects distant pairs before triangle tests; the full Cartesian pair list is no longer allocated. Detailed computation runs in a terminable Web Worker.
- Each run saves its scope, scene units, timestamp, timeline date, coverage, collection identity, model names, geometry fingerprint, limitations and result geometry. The fingerprint describes the actual captured geometry, not an authoring-tool revision label.
- Missing pairs become **Resolved** only if both elements were checked. They retain their IDs, notes and linked issues; later detection becomes **Reopened**. Persistent new detections become **Active**. **Accepted** uses the existing `approved` storage value for compatibility.
- Results outside a visible run's scope are labelled **Not rechecked**, not silently resolved. Changes to test settings are flagged against the selected run. A failed or partial upload rolls back the whole run.
- A date range saves up to 31 samples with a configurable step. It is a sampled check, not continuous collision detection; collisions between samples are not guaranteed to be found.

## External access boundary

The public `/clash-report#TOKEN` page requires no Prosota account. The token is random, stored only as a SHA-256 hash server-side, and checked for expiry/revocation on every report/comment request. A large report download URL already issued can remain usable for at most 60 seconds after revocation. The public route never fetches the original IFC/model file or grants access to project APIs.

The server selects only the chosen result records, current review notes and their geometry from a saved run. Mesh data is restricted to validated triangle positions and indices, compressed for transport; textures, object scripts, source files, unselected elements, model inventory, private review history and linked issue data are excluded. Optional context means other elements already included in that report. Plain mesh imports represent whole-file elements, so sharing one includes its mesh geometry; this is stated before sharing.

External comments are attached to the shared snapshot and attributed as unverified reviewer names. Read-only links reject comments. Links have a maximum of 200 comments with 2,000 characters each. Private run/report management and issue creation check project ownership.

## Deployment

Migration `d7b284ec9012` adds run/report tables, linked issue references, approximate clash locations, metadata, review history and source-aware pair uniqueness. Deploy database migrations before publishing the backend (the existing deployment migration step handles this).

Direct email delivery uses STARTTLS SMTP. Configure these backend environment variables:

- `SMTP_HOST`, `SMTP_PORT` (default 587)
- `SMTP_FROM`
- `SMTP_USERNAME`, `SMTP_PASSWORD` if the server requires authentication
- `PUBLIC_APP_URL`, e.g. `https://www.prosota.com`

Without SMTP configuration, Copy link and Open email app work; Send email returns a clear configuration message. No delivery service credentials are embedded in the frontend.

## Bounds and explicit limitations

Runs larger than 2.8 MB use a direct, authenticated R2 upload rather than passing geometry through the function request body. Large saved runs, result lists and selected external reports download through short-lived signed R2 URLs. Uploads are bounded at 80 MB compressed, 220 MB expanded run JSON and 200 MB expanded geometry. Validation and result updates remain atomic. The existing R2 configuration and upload/download CORS rules are required; no new database migration is needed. Temporary upload objects under `clash-uploads/` should have an R2 expiry lifecycle rule to clean up cancelled uploads. Successful uploads are deleted after saving. Scene units are explicit: align mixed-unit models before testing. Visible scope respects whole-object/mesh visibility, not section-plane clipping. Level slices and independently skinned/instanced plain mesh imports require supported static geometry first. Hard tests include touching; no penetration-depth measurement is claimed. A containment marker is the overlap-box centre, not a calculated penetration centroid.

Run history shows the latest 50 runs; older snapshots remain saved and can still be located for a clash's inspection. Report geometry is immutable and restricted at the data level, not just hidden visually.

## Verification

- `cd frontend; node --test tests/clashGeometry.test.mjs`
- `cd frontend; npm run build`
- `cd backend; .venv\Scripts\python -m pytest tests/test_clash_tests.py tests/test_clash_review.py -q`
- Local visual/worker fixture: `/tests/clash-review-smoke.html`; append `?public=1#mock-token` for the public report. Uses synthetic geometry and mocked persistence, never sends an email.

Backend regressions cover lifecycle, incomplete/stale/changed-collection rejection, rollback, legacy approvals, sharing scope/immutability, ownership, expiry/revocation, comment permissions, issue deduplication, email validation/mocked delivery and migration upgrade/downgrade in a transaction-isolated test schema.
