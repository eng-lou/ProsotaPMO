# Animation profile visual guidance

Review requested 2026-10-24. Proposal, not implemented in desktop 0.2.36.

## Findings

The built-in library is a flat name list with a `+ Save` action. The editor has
no preview and mixes trigger, movement, appearance and ordering. Duration is
shown only in frames. `grow` exists in the configuration and presets but is not
offered in the editor's Transform selector or axis-control condition; address
this as part of the editor review without changing existing saved recipes.

## Proposed experience

- Group visual cards by Fade, Move, Scale/Grow, Rotate, Pop/Spiral and Demolish.
  Use the camera preset card vocabulary: neutral object, ghost start pose,
  clear arrow and a labelled final pose. Axis and sign remain visible.
- Select a movement family first, then axis/direction. Keep existing saved
  preset names and identifiers compatible. Distinguish full-object scaling
  from a growth/reveal effect; derive previews from the actual evaluator.
- Add one scrub/play preview for the selected recipe, with Start, During and
  Finish markers. Do not run dozens of independent 3D previews in the list.
  Respect reduced motion and stop previews when the panel closes.
- Separate Movement, Appearance, Timing and Element order. Show an easing
  curve and a row of blocks for simultaneous versus staggered animation.
- Explain timing in a short sentence, including the activity start/finish
  trigger. Support dates, seconds and frames through the existing timeline
  conversions; do not silently equate activity dates with clip seconds.
- Make saving a recipe distinct from assigning it. Show the assignment target
  and whether this is an activity profile or element override. Preserve IFC
  linking and existing profile playback behaviour.

## Other useful visual identifiers

1. Shape operations: overlapping solids with the retained and removed pieces
   highlighted for subtract, intersection, union and excavation.
2. Path binding: front axis, heading offset, feet/base offset and follow-turns
   diagrams. Differentiate motion of the whole asset from its animated parts.
3. Array/scatter: spacing/count examples, path alignment and seeded density.
4. Rig joints: hinge, slider and wheel diagrams showing pivot, axis and limits.
5. Materials: rendered swatches for water, turf and glass, with UV scale and
   rotation diagrams. Avoid promising that a thumbnail matches all lighting.

Validation should compare previews against the production evaluator and check
saved recipes, activity/IFC assignments, all timing modes and reduced motion.


## Implementation in 0.2.37

Implemented searchable/filterable two-column preset cards, saved-profile preview
entry, one SVG playback/scrub preview using the production evaluator, an easing
curve and a staggered block example. The editor separates timing, movement,
appearance and element ordering; Grow is now editable. Duration entry supports
calendar days, playback seconds and frames using the main timeline speed/FPS.
The persisted legacy duration_frames field remains calendar days, exactly as the
existing evaluator reads it; switching display units alone does not modify it.

Saving is explicitly distinguished from assignment. Assignment controls, IFC
links, the playback evaluator and persisted preset identifiers are unchanged.
Legacy bounce/twist booleans are retained but no longer presented as effective
controls: the current evaluator does not read them. A notice directs users to
Bounce easing and Spiral movement instead. No automatic migration of recipes.

The diagram fits movement to a sample activity, projects a box and reveals its
extent for Grow. It is not a preview of the selected model, its materials or the
actual spatial element ordering. Cards are static; one preview runs on demand,
cancels on unmount and respects reduced motion. Absolute activity dates still
come from the linked activity. Other tool diagrams remain recommendations.


## Removal correction (0.2.38)

For a solid demolition/excavation wipe, choose Grow / reveal, then Geometry action
Remove, select the axis and direction, and keep Start/End opacity at 1. Set Colour
from to red; Colour to None holds that red during the activity and restores the
original material outside it. The removed solid remains invisible afterward.
Remove X/Y/Z presets supply this setup. Reveal uses the opposite clipping motion.
Old profiles retain Original profile behaviour until explicitly changed. Direction
selects the same retained end as existing Grow; Remove reverses the boundary sweep.


## Visual guidance extended — 2026-10-25

`ToolVisualGuide` extends the profile preview approach to shape operations, paths,
array/scatter, rigging, materials, camera tracking and activity/profile links.
Open **Visual guide** next to the relevant controls. Examples are isolated from
scene state and collapsed by default; motion examples offer manual scrubbing and
one-at-a-time playback. Materials use labelled schematic illustrations, not a
live shader preview. Current-setting badges appear only where a real control
value is supplied. The original tool controls remain authoritative.

Regression harness: `desktop/tests/tool-guides.cjs` renders all examples in an
isolated Electron window with production CSS, verifies mode changes, zero idle
animation, exclusive playback and cancellation when collapsed.
