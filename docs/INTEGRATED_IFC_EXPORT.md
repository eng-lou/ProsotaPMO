# Integrated IFC export

The 4D toolbar's **Export IFC** action creates one combined IFC4 file from all
saved IFC sources in the selected project. It reads the active schedule period
and the active cost period afresh at export time. It does not change source
files, server records or the viewport's IFC handles.

## Contents

- Original source geometry, placements, materials and properties.
- One IfcProject with the source representation contexts retained.
- IfcWorkSchedule, IfcTask/IfcTaskTime, nested task hierarchy and
  IfcRelSequence dependencies with signed hour lags.
- IfcWorkCalendar with weekly working intervals, daily breaks and whole-day
  non-working exceptions. Other exceptions are retained in custom properties
  and explicitly reported, rather than approximated as native calendar rules.
- Model-to-task relationships resolved by original element GlobalId.
- Construction resource occurrences per assignment, usage ratios and total
  assignment budgets; original catalogue and assignment fields retained.
- IfcCostSchedule/IfcCostItem with separately labelled BUDGET, ACTUAL and
  FORECAST values and links to tasks where resolvable. These categories must
  not be added together as a project total. Resource budgets are another view
  of the same costs, not additional costs to add to the cost plan.
- Named Prosota property sets retain activity baseline fields, constraints,
  progress/EVM values and other returned activity/resource/cost fields. This
  is an active-period snapshot, not all historical baselines or every module.

## Boundaries and safeguards

- IFC4 sources only. IFC2X3/IFC4X3 schema conversion is not implemented.
- Project units must match across sources. Export does not rescale geometry or
  reconcile distinct coordinate reference systems; original coordinates remain.
- Currency is explicitly selected; source currencies must agree. No conversion.
- Viewport transformations, material overrides, split geometry, animation,
  meshes and point clouds are not baked into this export. Hidden/unloaded IFC
  elements remain because export uses the complete original saved source.
- Missing model links, unsupported split/mesh/annotation links and costs linked
  outside the active schedule are reported before download.
- Duplicate linked GlobalIds stop export because Prosota's stored links cannot
  distinguish those source elements. Unlinked duplicates receive fresh IDs;
  this is reported. EXPRESS references are remapped independently of GlobalIds.
- Original IFC planning data is retained alongside the named Prosota snapshot.
  Re-importing an enriched IFC and exporting again is not an in-place update of
  its previously embedded Prosota snapshot.
- Generation runs on a cancellable worker, loaded only when export starts.
  The combined model still has to fit within web-ifc's WASM/browser memory.
- Current project data is fetched through existing authenticated APIs. The
  multi-request read is not a database transaction: avoid editing during export.
- Other IFC applications may ignore native planning entities or custom property
  sets. Cross-vendor scheduling parity is not claimed.

## Verification

`node --test tests/integratedIfcExport.test.mjs` from frontend tests native
planning round trips, geometry/coordinate preservation, reference resolution,
Unicode, mixed units, ambiguous IDs and unresolved links. Setting
`PROSOTA_IFC_TEST_FILE` enables an additional real IFC4 fixture test that combines
two copies and checks geometry counts, property values and GlobalId uniqueness.
The source fixture is not copied into the repository.

The production Vite build includes the separate IFC export worker. Browser UI,
large high-rise files, formal EXPRESS validation and independent third-party
IFC application interoperability need further validation.
