# TBM and piling sequences

Select a complete imported machine in 3D Site tools, then open **TBM & piling sequence**. The setup is saved with the project and follows activity date edits unless overridden. Changes in this panel are drafts until **Save sequence** is clicked. No asset geometry is rebuilt.

## TBM

1. Draw an open path along the tunnel alignment, with its points at the correct elevation. Chainage starts at zero and follows arc length in metres.
2. Place and orient the TBM at its first drive position. Set the working point offset from the object's placement to the cutting-face centre, in world metres. Its initial orientation should match the alignment tangent there.
3. Choose **Set up TBM drive**, select the path, then add drive activities. Generated 10 m sections are placeholders: enter actual start/end chainages for every drive. Consecutive drive sections must meet. Dates must not overlap.
4. Optionally select a separate site excavation volume for each drive. The same activity progress moves the cutter face and its removal plane. The whole volume disappears at drive completion. The machine holds between drives and after the last drive.
5. Save, then play/scrub the animation timeline. Rotation follows the alignment in 3D, including gradients, relative to the initial orientation.

Excavation is a visual clipping effect on selected volumes, not a boolean terrain simulation. Use volumes matching the tunnel bore, split into drive sections and at sharp bends. One plane cannot represent a long curved or looping tunnel. Do not select the complete terrain as a drive volume. This feature does not generate tunnel lining or rotate the cutterhead.

## Piling

1. Position the rig and set the working point offset to the drill centre at ground level.
2. Choose **Set up piling**, add the activity and expand its pile row. With the rig selected, Ctrl-click (Cmd-click on Mac) one IFC pile or site marker in the viewport. Click **Read selected pile position & depth** in the open row. It fills in the centre in plan, top elevation and vertical depth. For a short pile marker, enter the design depth. You can also enter all four values manually.
3. Enter elapsed travel hours before each activity. Travel is a straight line from the previous pile (or initial working point), followed by a stationary work cycle. Zero hours switches position immediately at activity start. Travel cannot overlap the previous pile's activity. This version does not plan collision-free routes or turn the chassis.
4. For an articulated auger, first configure a slide control in **Rigging**, then choose that control here. Enter its full calibrated travel and retracted/fully lowered values (0–1). The control is driven in proportion to pile depth. It must cover the deepest pile. No moving part is invented for an unarticulated GLB.
5. Optionally choose a pile-shaped excavation volume and a completed pile object for each step. These must be separate, stationary site objects; IFC geometry can be imported as site assets if needed. Existing activity visibility still applies to the targets; leave conflicting appearance profiles unassigned.
6. Save and play/scrub. The first 65% drills down, the next 20% withdraws, and the final 15% shows the completed pile. The rig holds until travel for the next pile. Excavation remains removed after withdrawal. These are presentation timings, not a detailed construction method simulation.

## Ownership and editing

A machine can have one movement owner: a work sequence, a normal route, climbing, or attachment/load transfers. Remove the current owner before switching. A visual target belongs to only one work step and cannot itself move. Removing a sequence restores its initial placement, stops its tool override and restores its visual targets. Normal equipment keys resume when no override exists; explicit Rigging previews take precedence while authoring.

Backward seeks evaluate from schedule time, not accumulated frame deltas. Missing activities, invalid dates or overlapping intervals are reported in the panel. Invalid machine setup falls back to its original placement. Re-read captured pile geometry after changing the source model. Keep detailed hydraulic, segment erection, cage and concrete cycles for later work.

Validation: unit checks cover arc length, gradients, holds, offsets, travel, drilling/withdrawal, targets, date edits and reverse seeks. A Chromium fixture exercises the real SiteSceneLayer, material clipping/shadow flags, tool output, reverse seeks and setup removal. User project assets have not been visually reviewed as part of these isolated tests.
