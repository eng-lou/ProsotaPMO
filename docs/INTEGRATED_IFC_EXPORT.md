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
- Model-to-task relationships resolved by original element GlobalId, exported
  as task outputs (IfcRelAssignsToProduct) in both schemas. Construction
  resources remain IfcRelAssignsToProcess assignments. Model links currently
  represent construction outputs; demolition/maintenance input roles and
  custom animation profiles are not inferred.
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

Use **Import Model** in the 4D toolbar. After saving an IFC with embedded
Prosota planning data, a dialog automatically previews its counts. Choose
**Include planning data** to restore it or **Keep model only** to skip it.
Multiple imported files are offered in sequence. There is no separate planning
import toolbar action.
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

### Representation contexts and STEP numbers (2026-10-13)

Integrated exports give Body, Axis and Box representations their own named
subcontexts when a source attaches them directly to the parent geometric
context. Existing subcontexts are retained. This prevents context-based
importers from choosing a wall axis instead of its solid; geometry items,
placements and parent coordinate systems are unchanged. Both IFC2X3 and IFC4
are covered by regression tests.

The clinic export was imported with Bonsai 0.9.0 in Blender 5.1.1 using default
geometry settings: all 1,106 walls had polygon meshes after this correction.
An independent IfcOpenShell comparison also retained all 1,080 architectural
wall volumes from the original source. Tests use local fixtures, not committed
model files.

STEP scientific notation now always has a decimal mantissa (`1.E-09`, not
`1E-09`), without rewriting strings or comments. This removes the reported
Synchro lexical errors. Synchro still rejects the separate native construction
resource occurrence at Excavation Crew; full Synchro planning interoperability
is not yet verified. Do not interpret the syntax correction as resolving that
resource compatibility issue.

### Synchro compatibility (2026-10-14)

Select **Synchro compatibility (IFC2X3)** in the export dialog and rebuild the
file. This option requires IFC2X3 source models and keeps native geometry,
tasks, dates, dependencies and cost entities. It writes each Prosota resource
assignment into a uniquely named task property set, retaining the complete
resource and assignment payload, instead of creating the non-geometric native
construction resources that stop Synchro at Excavation Crew. The resource
catalogue is also retained. These properties are not editable Synchro human or
equipment allocations. Standard export continues to emit native resources.

Validated in the installed Synchro 4D Pro: both an isolation file and the actual
exporter output completed import, creating 75 tasks, 80 links and 3,849 model
resources. All 102 assignment payloads in the rebuilt clinic export matched
the input exactly. The second import appended to the test project and reported
duplicate task-code warnings from the first import; original Revit user-field
name warnings also remain. This verifies the reported import blocker, not full
calendar, cost or 4D playback fidelity in Synchro. All 15 IFC integration tests
(including both local clinic fixtures) and the production build passed.

### Restored Synchro model assignments (2026-10-14)

The initial compatibility option did not restore model-to-task assignments:
the import counts above were not evidence of linked 3D resources. Commit
`19bd0ae` had replaced the original `69d6176` process assignments with product
outputs to correct Bonsai construction playback. Synchro's IFC2X3 reader
requires the original process assignments, as also emitted by its own exporter.
Synchro mode now emits those links; standard export retains product outputs.
The representation-context and STEP-number fixes apply to both paths.

A fresh installed Synchro import of the regenerated clinic created 75 tasks,
80 dependency links, 3,849 resources and **3,664 assignments**. Resource Usage
showed the linked model elements and their tasks. The integration suite also
checks shared elements, duplicate-link deduplication and the separate standard
output semantics. All 15 tests passed with both local clinic fixtures enabled.
Nonvisual labour/equipment allocations still remain task properties in Synchro
mode, and custom appearance profiles are not yet transferred as native Synchro
profiles. This correction does not claim to resolve those separate limitations.

### IFC4 animation predefined types (2026-10-14)

Export now fetches saved animation profiles. Explicit green color_from hues
(75–165 degrees) map to CONSTRUCTION; red hues (345–360 or 0–20) map to
DEMOLITION. Neutral, other-colour and uncoloured/default profiles remain
NOTDEFINED. This is a colour convention, not task-name inference. Bonsai uses
its own animation colour scheme for these native types; exact Prosota settings
are retained in Prosota_Animation properties rather than baked into geometry.
Element overrides take priority over activity profiles. Conflicting mapped
types on one task retain NOTDEFINED with an export warning. IFC2X3 has no
IfcTask.PredefinedType; the mapping is retained as metadata only in that schema.
Model assignment direction and geometry handling are unchanged. All 16 export
tests pass, including the real architecture/structure fixtures, default/type
mapping, element overrides, mixed profiles and Synchro model links.

### Synchro native appearance profiles (2026-10-15)

Synchro mode now emits the typed `4DVisualizationParameter` properties read by
Synchro's InPro integration: `RGBElementColour_Red/Green/Blue`, transparency,
Visualization and enumerated ConstructionType (`CONSTRUCT` or `DEMOLISH`).
Enable **File → Options → Synchronization → IFC → Use InPro profile for IFC
integration** before import. This setting was enabled in the isolated local
test instance; without it the same file falls back to Install.

Verified using the production exporter in installed Synchro 6.5.6.30: two new
tasks imported with model assignments and two native appearance profiles.
The profile editor showed Install with colour `22C55E` and Remove with colour
`EF4444`. The source reference task also imported, giving three tasks and three
assignments in the import log. The duplicate reference-task code warning was
from appending this test to the existing diagnostic project.

This transfers the explicit green/red active colour and action, not Prosota's
fade curves, movement, staggering or colour interpolation. Default/neutral
profiles remain unchanged. A task with different element profiles warns and
retains the source profiles as metadata instead of choosing one arbitrarily.
Standard IFC/Bonsai predefined types, product-output links and geometry are
unchanged. All 17 IFC tests passed with both clinic fixtures; build passed.

Native labour/equipment allocations remain unresolved. A minimal IFC containing
one labour resource and one equipment resource reproduces the resource-creation
failure with InPro both off and on. It is not caused by the clinic geometry or
appearance-property encoding. Synchro mode therefore still retains these
assignments as task properties; it must not be described as a full resource
allocation round trip. No companion package has been introduced.

### Resource/cost loading investigation (2026-10-15)

Native resource/cost loading is **not fixed**. In the installed Synchro
6.5.6.30 importer, the minimal labour/equipment probe fails independently of
the clinic model and with InPro enabled or disabled. A native reference export
with all export options enabled did not emit its assigned human resource;
that reference therefore cannot establish a working IFC allocation contract.

Read-only inspection suggests that the importer conditionally creates human
and equipment resource roots but subsequently attempts to import construction
resources even when those roots were not created. This is a hypothesis from
static inspection, not a confirmed runtime diagnosis or a vendor statement.
The inspected IFC options do not expose a corresponding human/equipment switch.

Native cost entities in an IFC, or cost values retained as task properties,
are not evidence of editable Synchro cost loading. No verified native cost
mapping was established in this investigation. Do not re-enable the failing
resource entities, attach labour costs to model elements, or claim a successful
allocation import based on the 3D-resource counts. A working native import
fixture or supported importer mapping is still needed before changing this path.

No production exporter change was made. All 17 IFC integration tests passed
again with both local clinic fixtures, including geometry preservation,
standard product-output links, Synchro process links, native standard-export
resources/cost associations and appearance properties.
