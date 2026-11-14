# Moving a project between Preview, Desktop and Stable Web

Integrated IFC export is an exchange with other BIM tools, not a complete Prosota
project backup. Its IFC 2x3 → IFC4 conversion has a 128 MB uncompressed-source
limit. **Keep source** bypasses conversion, but still excludes non-IFC files and
authored site scenes. Do not use it as a substitute for project transfer.

## Project folders

After this change is deployed to the source and destination:

1. Save edits, then choose **Switch project → Export project** beside the project.
2. Select an output directory (D: is suitable for large desktop projects).
3. Keep the generated folder, `project.prosota.json` and its `files` directory together.
4. Sign into Stable Web and choose **Switch project → Import project**.
5. Select that folder, check the project name/counts, and choose **Import as new project**.

Existing projects are not overwritten. The source remains unchanged. The browser
shows progress, supports stopping/retrying an upload in the same panel, and removes
incomplete uploads when that panel is closed normally. An interrupted tab/browser
may leave staging objects in storage; no incomplete project is committed.

The package carries persisted project records: all schedule variants/periods,
activities, dependencies, resources, calendars, costs, risks, ICD records,
baselines, custom fields, model assignments, animation profiles, keyframes,
site scenes/assets, saved views, material presets/textures, paths, zones,
annotations/media, simulation settings, scans, environment maps, saved videos,
and IFC source/revision files. Browser export also includes the project's local
realistic-material mapping. Files retain their original bytes/schema.

Account credentials/settings, feedback tickets, command-deduplication records,
cached map tiles and general browser preferences are excluded. Unsaved/session-only
texture or opacity edits are not durable project records and cannot be recovered
from a database backup. External links and temporary AI attachments remain links.
This is a copy, not ongoing synchronisation between Preview and Stable.

Folder export needs Edge/Chrome's directory access. Import uses the ordinary folder
picker. Files stream separately, avoiding a multi-GB ZIP allocation and the web
backend's request-size cap. Limits: 128 MB of project metadata, 10,000 files, 5 GB
per file. The import checks the inventory, file sizes, record types and reference
graph; it remaps IDs and commits in one transaction without recalculating dates.
Transfer validates file sizes, not a content hash of each web-uploaded binary.

## Existing Desktop Preview installations

Older installers do not gain these controls just because Web is updated. Either
update Desktop, or create a **fresh workspace backup in Desktop Settings** and use
the bridge in `backend/scripts/export_desktop_project.py`:

```powershell
& <python-from-backend-venv> backend/scripts/export_desktop_project.py `
  --backup "D:\path\Current-Preview.prosota-backup" `
  --project "Tower" `
  --output "D:\path\Tower-for-Web" `
  --pg-restore "<desktop-runtime>\postgres\bin\pg_restore.exe"
```

The bridge reads a trusted backup into a newly created disposable local development
database, using a restricted role for the restore. It exports only the named project,
verifies backup-file SHA-256 checksums, then removes that disposable database/role.
It does not open or change the live Preview database. It requires local development
PostgreSQL; `PROSOTA_TRANSFER_ADMIN_URL` can supply its administrator connection.
Cloud database URLs are rejected. Save the output on a disk with enough free space.
Browser-only material mapping is not in a desktop workspace database backup.

## Verification and delivery status

Implemented in the web release worktree. Tests include a real PostgreSQL round trip,
linked/site objects, timestamps/calendars/decimal costs, identifier remapping,
ownership, invalid packages, incomplete files, atomic rollback, idempotent retries,
staging cleanup and a real legacy desktop backup conversion.

This change does not itself upload a user's Preview project or update an installed
desktop application. A fresh source export/backup and deployment are required.
