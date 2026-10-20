# Power BI from Reporting & Controls

Choose **Open in Power BI**, then **Build Power BI report**. Download and extract
the entire ZIP, then open `Prosota.pbip` in Power BI Desktop for Windows. Enable
Power BI Project support in Desktop if required. The report includes the Prosota
custom visual and the integrated IFC snapshot: model geometry, schedule, links,
resources, costs and animation-profile properties supported by the visual.

The browser cannot launch a local application with arbitrary files. This download
handoff is the web equivalent of the Windows edition's direct-open action.
Nothing is automatically published to Power BI Service. Export again to refresh
the snapshot; sharing the report shares its embedded project data.

The report starts at schedule finish so the model is visible. Use Start/Play to
view the sequence. Saved IFC sources must have matching schemas and units, as
with the existing integrated IFC export. The snapshot limit is 256 MB; browser
memory can impose a lower practical limit.

## Bundled template

`frontend/public/powerbi/prosota-template-1.2.0.zip` is the clean Power BI Project
template with Prosota visual 1.2.0.0 installed. It contains no user IFC, credentials
or `.pbi` caches. The matching visual source is in `prosotaPowerBI/`.

For a future refresh, save a clean PBIP containing the current packaged custom
visual using Power BI Desktop, remove all `.pbi` directories, and ZIP the PBIP and
its sibling Report/SemanticModel folders at the archive root. Version the asset
URL in `powerBIReport.ts` and update the fixture path in its test. Do not bundle
a report containing a user's model or local caches.

Validation: `cd frontend; node --test tests/powerBIReport.test.mjs` checks exact
snapshot bytes, visual inclusion, unique report identity and invalid inputs.
The frontend production build validates the shared dialog and lazy-loaded ZIP
builder. Desktop's direct handoff remains available through its native bridge.
