# Undo and redo

The sidebar has Undo/Redo buttons. Ctrl+Z undoes; Ctrl+Shift+Z or Ctrl+Y redoes
(Cmd also works). Text fields retain native typing undo. Click outside the field
or use the sidebar button to undo a committed edit.

History retains **10 steps total**, in memory for the current project/browser tab.
A new edit clears redo. Switching projects, signing out, or refreshing clears
history. Transform history stores numeric poses and references, not model copies.

## Covered edits

- Saved record field updates across Scheduling, Resources, Risk, Cost, ICD and
  the 3D configuration panels. The supported update endpoints/fields are listed
  in `frontend/src/lib/undoFields.json`, derived from backend update schemas.
- Schedule duration and Finish edits restore the underlying duration; downstream
  schedule calculations run through the normal update API.
- Whole-object and group Move/Rotate/Scale, numeric transform fields, and pivot
  edits. A continuous drag is one step, including all selected scene objects.
- Unsaved equipment group, pivot, control and keyframe edits. Saving/discarding
  clears those draft steps; an existing rig's saved update becomes a normal
  saved-record step.

Saved-record undo writes the reversal through the existing API and refreshes
module data. 3D data is refreshed without unloading imported geometry. Replays
check current editable server values against the recorded state; a detected
newer edit or missing record leaves the history entry available and reports an
error. Versioned rigs use the latest version. Failed writes create no steps.
The preflight comparison is not a database-wide transaction or lock.

## Boundaries

This is edit history, not a project backup. Create/delete/import, bulk operations,
relationship-amending activity type/hierarchy changes, report sharing, uploaded
files, and geometry baking are not reversed. Viewing/selecting/orbiting is not
an edit step. Unsaved forms use normal text undo until submitted. Unsaved equipment
steps expire when their editor closes. The response cache is bounded to 1,000
compact editable records; evicted records are retrieved on demand when edited.

## Validation

`node --test tests/undo.test.mjs tests/equipmentRig.test.mjs` from frontend covers
10-step eviction, grouped gestures, redo branching, failed replay, duration and
cross-module API reversals, server-change detection, versioned rigs, and grouped
transform snapshots. Browser smoke verified the shared buttons and redo shortcut
in the equipment editor. `npm run build` verifies production compilation.
