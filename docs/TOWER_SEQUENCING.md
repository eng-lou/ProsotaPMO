# Tower schedule generation

In **Generate Schedule from IFC → Review**, choose **Tower — core and following façade**. Standard remains the default.

1. Create a reviewed collection of the lift-shaft and stair-core walls in the model workspace. Add that collection in the wizard, or select individual walls by name, level or IFC ID. Only walls from the current scan can be selected.
2. Open **Construction floors**. Map intermediate authoring levels, such as stair landings, to the construction floor supporting their elements. This changes the generated grouping, not the IFC.
3. Set **Core lead**. `1` sequences each floor/frame, then its upward core lift, then the next floor. Larger values allow the core to advance, while retaining supporting-floor and preceding-core dependencies. The first lift still waits for the base floor/frame.
4. Set **Façade follows by**. `2`, for example, gates a floor's façade on structural work two floors above. At the top it uses the highest available floor. Façade work also follows the preceding floor's façade.
5. Open **Preview activities and dependencies**, review the assumptions, and confirm before generating. Changing the assumptions clears confirmation.

Generation adds a new WBS in the current schedule. It does **not** replace existing activities or create a separate schedule variant automatically. Use an empty working schedule for a clean comparison with an earlier generated programme.

## What changes

- Core walls have separate activities, retaining their IFC IDs and the existing wall phase/resource conventions.
- Façade mullions are linked to the frame installation phase; panels and assembly parents to glazing. Explicit IFC aggregation identifies curtain-wall parents, which are not counted again as panels when their components are present.
- Interiors follow the overhead structure and the local façade. Foundation-level buried services retain their dependency ahead of the slab above.
- Procurement, earthworks, commissioning and completion gates remain connected. Conflicting dependency graphs block generation rather than silently removing links.
- The existing animation-profile system is unchanged; generated activities use the usual default until a profile is assigned.

## Review limits

This is a first-draft construction recipe, not a verified construction method. Core membership and supporting floors require review. Durations still use the existing productivity defaults; full-height model objects remain whole during animation. Elevation/zone-specific façade crews and splitting multi-storey geometry are not implemented here. Where the scan has no measured wall volume, core selection does not invent concrete quantities; review the takeoff before generating material costs.

## Validation, 19 October 2026

- Regression snapshots compare standard-mode payloads with the pre-change generator, with and without the full schedule.
- Automated checks cover conventional/advancing cores, façade lag, element-link preservation, mapping errors, invalid offsets, façade phase quantities and buried services.
- Read-only client IFC check: the web-ifc assembly reader identified 409 curtain-wall assemblies and 7,856 assembly/component entities. The topology fixture retained 10,344 supported elements, with 5,670 façade members and 1,777 panels. Mapping nine intermediate authoring levels yielded 30 construction levels and acyclic graphs for core leads 1 and 3. Test core selections and placeholder quantities were used for graph validation, not as a proposed structural assessment or duration estimate.
- An isolated browser fixture verified standard mode as default, blocked tower generation without core selection/review, cleared review after changing assumptions, and generated a mocked payload. No client model or saved schedule was changed by these checks.
