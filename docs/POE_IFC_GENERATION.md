# Poe and loaded IFC models

Poe can read the IFC files currently loaded in BIM, Simulations & Reality Capture,
including hidden elements. No schedule or selected element is required. Ask, for
example, “What levels and structural element types are in this model?” or “Read
the properties of the walls on Level 3.”

The live viewer supplies model IDs and type counts, paginated searches by type,
name/GUID and storey, and individual object attributes/property sets. This does
not give Poe a rendered image or establish a structural role from geometry.
Model text is treated as source data, not instructions. Property output is
bounded and reports truncation. Closing the BIM viewer removes these tools.

## AI schedule generation

1. Open **Generate Schedule**, choose the models and exclusions, and scan.
2. Select **Sequence → Poe AI Generation** after Standard and Tower.
3. Optionally describe the construction method, constraints or desired detail.
4. Choose **Create AI draft**. Poe receives a compact inventory of the selected
   scan and can inspect loaded IFC properties through the same read tools.
5. Review the proposed activities, working-hour estimates, finish-to-start
   dependencies, assumptions, linked-element counts and unassigned scope.
   Change the guidance and regenerate if the approach needs revision.
6. Confirm the review and choose **Save AI schedule**. This creates a new WBS
   using the existing transactional bulk-generation endpoint and CPM engine.
   Existing activities are retained. Normal Scheduling tools can edit the result.

The AI chooses the breakdown and logic; Standard/Tower recipes do not generate
its draft. Model groups and individual element keys are resolved locally to the
verified IFC GlobalIds and labels. Unknown identifiers, duplicate completion
assignments, duplicate activity IDs, invalid hours, circular hierarchies or logic,
and dependencies attached to summary nodes are rejected before saving. Models
with duplicate GlobalIds cannot be combined for this path.

This initial version supports up to 400 activities and 2,000 FS relationships,
with nonnegative lags. Release/handoff tasks can describe overlapping work.
Unassigned elements are shown explicitly; they are not silently assigned.
Non-modelled work and durations are planning assumptions, not facts from the IFC.
The generation scan has the same supported-element scope and exclusions as the
existing wizard. No labour, equipment, material quantities, rates or costs are
invented or saved by this step. AI drafts do not currently populate the recipe
phase keys used by rule-based automatic resource generation.

Generation uses the configured Poe provider and existing AI quota. Its isolated
conversation does not overwrite the normal Poe chat history. Stop/closing the
wizard discards late draft responses; an already-sent provider request may still
complete. No project write occurs until Save is selected. If save confirmation
fails, check Scheduling before retrying.

## Validation

- Actual Design Tower IFC: read 106 entity types, 39 authoring levels, wall GUIDs,
  storey assignments and property sets using the production web-ifc readers.
- Frontend regression suite: 121 passed, 2 optional tests skipped; production build passed.
- Isolated backend Poe tests: 19 passed, with mocked providers/database.
- Browser fixture: verified the third option, draft review, explicit save gate,
  and handoff of linked activities to the existing bulk-save API contract.
- Provider-generated schedule quality and a deployed end-to-end save remain to
  be verified with the configured live service; the UI test used a fixed AI response.
