# Integrated IFC export

The 4D toolbar's **Export IFC** action creates one combined IFC file from all
saved IFC sources in the selected project. It reads the active schedule period
and the active cost period afresh at export time. It does not change source
files, server records or the viewport's IFC handles. Keep-source mode remains
the default: IFC2X3 produces IFC2X3 and IFC4 produces IFC4. Alternatively, select
IFC4 to convert saved IFC2X3 sources before embedding native IFC4 planning data.
The result shows activity, dependency, resource, assignment and cost counts,
with explicit notices for empty resource/assignment/cost data.

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

- IFC2X3 and IFC4 sources are supported. Mixed IFC2X3/IFC4 sources require IFC4
  output mode; IFC4X3 remains unsupported. No schema header relabelling occurs.
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

### Optional IFC4 conversion

The authenticated `POST /model3d-files/{id}/ifc4-export-source` endpoint checks
project owner and organisation, then migrates the saved source with pinned
IfcOpenShell 0.8.5. It preserves source product GlobalIds and checks represented
product coverage. Conversion runs in an isolated subprocess with a 180-second
timeout and a 128 MiB compressed/uncompressed input limit. Unsupported conversions
fail explicitly; original models are never overwritten. A checked conversion
does not imply that every source-specific field is interpreted by other viewers.

Converted source files are cached as gzip in R2 under immutable file IDs and
removed when the source is replaced or deleted. Signed downloads avoid Vercel
function body limits. Live planning records are added in the browser on every
export, so cached geometry never caches an old schedule. Deployment requires the
new native Python dependency; production deployment/runtime remains to be tested.

Native workers are explicitly imported for deployment packaging and launched by
absolute script path. Their PYTHONPATH inherits the API process's runtime
sys.path, including serverless dependency directories. Worker startup/dependency
failures return 503, timeouts return 504, and explicit snapshot validation
failures return 422; infrastructure failures must not be labelled invalid IFCs.
Regression tests cover runtime-only dependency paths. Both plain and gzip-stored
copies of the user's sample passed the complete local worker read path.

### Restoring planning into Prosota

After importing the geometry with **Import Model**, use **Import IFC planning**
in the 4D toolbar and select the saved file. Review its counts, then confirm.
This restores one Prosota snapshot from either IFC2X3 or IFC4. Arbitrary native
IFC schedules without Prosota snapshot properties are not supported by this
restore path; multiple embedded snapshots are rejected as ambiguous.

The server checks ownership and destination project scope. It requires an empty
schedule variant and cost period, both live and unlocked. Period row locks and
the empty-destination check prevent repeated imports from duplicating data.
Calendars, breaks, exceptions, tasks, dependencies, resources, assignments,
costs and IFC links receive fresh IDs, with internal references remapped. All
planning writes commit together; failure rolls back. Saved dates are preserved
without running CPM and the schedule anchor is set to the earliest saved start.

Imported calendars are explicitly assigned to tasks; the existing project
default is not replaced. Cost lines are restored as manual snapshots, avoiding
unintended cost regeneration. Approval signoffs, animation-profile references,
external organisation IDs, non-IFC links and baseline history are not restored.
The review dialog states these boundaries. The original source export contains
no risks, activity steps or historical reporting periods, so those cannot be
reconstructed. This is snapshot restoration, not a general project backup.

SYNCHRO has been observed by the user to display the IFC2X3 task hierarchy,
dates and linked model; this does not establish parity for every planning field.

### IFC2X3 representation

IFC2X3 exports use IfcTask, IfcScheduleTimeControl and IfcRelAssignsTasks for
scheduled/actual dates, duration, remaining time, float and completion.
Dependencies use numeric IfcRelSequence lags. Time measures respect the source
project's time unit (including conversion-based hours); seconds are added only
when the source has no time unit. Native resource occurrences are linked to
tasks, and IfcCostValue records are linked through IfcRelAssociatesAppliedValue.
New entities have their own Prosota owner history.

IFC2X3 does not have IFC4's work calendar or resource-time entities. Calendar
rules, breaks and exceptions are retained in Prosota_Calendar properties on
calendar groups linked to tasks. Assignment utilisation, quantity and all
original assignment fields remain in Prosota_ResourceAssignment properties.
The download shows a notice explaining this receiving-application limitation.
The IFC4 representation described above remains unchanged.

`node --test tests/integratedIfcExport.test.mjs` from frontend tests native
planning round trips, geometry/coordinate preservation, reference resolution,
Unicode, mixed units, ambiguous IDs and unresolved links. Setting
`PROSOTA_IFC_TEST_FILE` enables an additional real IFC2X3 or IFC4 fixture test that combines
two copies and checks geometry counts, property values and GlobalId uniqueness.
The source fixture is not copied into the repository.

The regression fixture covers both schemas, legacy time units, all six resource
types and mixed-schema rejection. `PROSOTA_IFC_OUTPUT` saves the IFC2X3 fixture
export for independent validation. The fixture passed IfcOpenShell schema and
EXPRESS validation with zero diagnostics. A local real IFC2X3 structural model
also passed geometry and source-property preservation checks when combined.

The production Vite build includes the separate IFC export worker. Browser UI,
large high-rise files and independent third-party IFC application interoperability
need further validation. Validation of the fixture does not certify arbitrary
input models or repair pre-existing source schema errors.
