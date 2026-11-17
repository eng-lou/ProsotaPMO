# Camera presentation pauses — 17 November 2026

Camera Presets now supports inserted pauses within a shot and within an incoming transition. Pause controls use seconds even when the main timeline displays frames. In preview, Insert pause here captures the current movement position. Each pause adds presentation duration, holds camera movement and construction date, then resumes the original movement. Existing shots without pauses retain their timing.

Use Presentation pauses in the shot or sequence card to choose the time, duration, actor clock and details. Chosen callouts, paths and site objects are restricted to their selected pauses while that sequence is active. Restore returns control to their ordinary visibility. Only show details linked to an active activity intersects pause visibility with the linked activity intervals. Site objects also retain existing activity/profile visibility; pauses do not resurrect equipment outside its activity.

Preview-time actors may continue or freeze. Activity-fitted equipment continues to follow the held construction date; this change does not create a separate detailed operational simulation during a held activity. Manual visibility keyframes remain supported. Explicit pause cues take precedence for selected callouts/paths while their camera sequence is active. Global hidden objects/overlays remain respected.

Activity-linked callouts without manual visibility keyframes now hide at the activity finish and before its start. Multiple links use the union of their active intervals. No project data, materials, caches or saved settings are reset.

Preview and video export share the same movement-clock mapping. Validation covers inserted holds, transition holds, end boundaries, reverse seeks, activity intersections, schema limits, API save/load and an isolated Chromium interaction fixture (insert, select detail, save, remove). The user's live project and a full video export were not exercised.

The catalogue work remains separate and unpublished. Cloud publishing and the remaining asset conversion/previews are not prerequisites for these camera fixes.
