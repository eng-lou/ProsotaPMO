# Tower schedule generation

In **Generate Schedule from IFC → Review**, choose **Tower — core and following façade**. Standard remains the default.

1. Scan the model and choose **Tower**. Prosota proposes core walls, known façade components and construction-floor grouping.
2. Click **Core**, **Façade** or **Needs review**. The panel moves to the side so you can inspect the highlighted elements in the actual model. For multiple imports, review one model at a time.
3. Use normal viewport selection to correct a proposal: **Selection → core**, **Selection → façade**, or **Keep original role**. Exterior lattice/bracing is flagged rather than automatically treated as decorative cladding.
4. Accept the groups and generate. If no reliable core is found, you can select one visually or proceed without a separate core stream. Unresolved candidates retain their original classification.
5. Only if needed, open **Advanced** to adjust core lead, façade lag or construction floors. **Schedule details** retains the full-schedule and calendar options, and the activity/dependency preview remains available.

Detection combines stair/lift proximity, vertical wall repetition, explicit names, known IFC façade categories and perimeter geometry. These are proposals, not proof of structural function. Whole multi-storey façade objects are grouped with their highest supporting construction floor; the geometry is not split.

Generation adds a new WBS in the current schedule. It does **not** replace existing activities or create a separate schedule variant automatically. Use an empty working schedule for a clean comparison with an earlier generated programme.

## What changes

- Core walls have separate activities, retaining their IFC IDs and the existing wall phase/resource conventions.
- Façade mullions are linked to the frame installation phase; panels and assembly parents to glazing. Explicit IFC aggregation identifies curtain-wall parents, which are not counted again as panels when their components are present.
- Interiors follow the overhead structure and the local façade. Foundation-level buried services retain their dependency ahead of the slab above.
- Procurement, earthworks, commissioning and completion gates remain connected. Conflicting dependency graphs block generation rather than silently removing links.
- The existing animation-profile system is unchanged; generated activities use the usual default until a profile is assigned.

## Review limits

This is a first-draft construction recipe, not a verified construction method. Core membership and supporting floors are proposed automatically and require visual review. Durations still use the existing productivity defaults; full-height model objects remain whole during animation. Elevation/zone-specific façade crews and splitting multi-storey geometry are not implemented here. Where the scan has no measured wall volume, core selection does not invent concrete quantities; review the takeoff before generating material costs.

## Validation, 19 October 2026

- Regression snapshots compare standard-mode payloads with the pre-change generator, with and without the full schedule.
- Automated checks cover conventional/advancing cores, façade lag, element-link preservation, mapping errors, invalid offsets, façade phase quantities and buried services.
- Read-only client IFC check: the web-ifc assembly reader identified 409 curtain-wall assemblies and 7,856 assembly/component entities. The topology fixture retained 10,344 supported elements, with 5,670 façade members and 1,777 panels. Mapping nine intermediate authoring levels yielded 30 construction levels and acyclic graphs for core leads 1 and 3. Test core selections and placeholder quantities were used for graph validation, not as a proposed structural assessment or duration estimate.
- An isolated browser fixture verified standard mode as default, blocked tower generation without core selection/review, cleared review after changing assumptions, and generated a mocked payload. No client model or saved schedule was changed by these checks.

## Visual detection update

The read-only geometry check on the supplied tower found 9,935 renderable supported elements. It proposed 293 core walls and 7,447 known façade components, and flagged 89 ambiguous elements. Nine intermediate stair levels mapped to 30 construction floors; columns on those intermediate levels followed the floor above rather than the wall lift below. The generated test retained every scanned IFC identity exactly once and passed cycle validation. Geometry came from IfcOpenShell for this check; the live application uses its existing web-ifc world bounds. The proposals still need visual acceptance, particularly exterior structural/architectural roles.

The full-breakdown reference remains consistent with the existing optional preliminaries, earthworks, procurement and commissioning packages. No project-specific transfer structure, temporary works method or productivity is inferred solely from a reference screenshot.
