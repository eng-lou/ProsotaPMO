# Soil cycles (Preview)

In **Rigging → select equipment → Soil · scoop, carry & pour**, add a soil cycle.
Use a rigid equipment rig. The bucket needs to be a
separate part; an embedded skeletal animation is not supported by this tool.

1. Seek to an upright, lowered bucket pose. Choose its part and use **Fit volume
   to bucket at current pose**. The fit is a starting point: use the yellow box
   and blue opening arrow to adjust the volume into the cavity. Coordinates are
   local to that part, so imported centimetre-scale models need local units.
2. Set capacity and the angle at which material should spill. **Place pile at
   current bucket** positions the source near it; adjust the base elevation,
   radius and height to sit on the site ground.
3. Open **Simple pickup & dump cycle**. Choose **Pick up**, adjust its controls,
   then **Capture pickup pose**. Repeat for **Carry** and **Tip**. If Carry says
   the bucket is spilling when its mouth visibly faces up, hold the opening
   straight up and click **Set mouth-up reference & capture Carry**. This sets
   the opening direction from the actual part pose, without changing the fitted
   volume, pile, capacity, timing or rig keys. Capture Tip again if needed; it must
   pass the pour angle measured from the corrected reference. The blue guide
   arrow and the simulation use that same direction. The reference saves with
   the rig and cycle. Existing rigs keep their old reference until calibrated.
4. If the machine needs to travel, bind one path covering the journey. Set the
   pickup and dump percentages, or scrub to each location and use **Pickup/Dump
   at current position**. Set the start in Date / Seconds / Frames. Stage durations
   have defaults and can be changed under **Stage durations & starting position**.
5. **Create & save cycle** creates control keys, parks the route while lifting and
   pouring, and sets the soil window with enough time to empty plus a short margin.
   It saves the three poses for later reuse. It replaces keys in the cycle window;
   keys outside the window remain. When rebuilding a previously generated cycle,
   its previous window is replaced too. The source pile is not moved automatically.
6. Play or scrub the Animation Timeline. The pile loses soil, the bucket retains
   its load until it tips, and released soil lands and builds a deposit. Rewind
   restores the original state. The panel shows bucket and deposited volumes.

The cycle is stored with the project rig and survives closing the widget and
reopening the project. Disable it to hide the effect while retaining setup.
Switching dock tabs preserves unsaved rig/soil settings and captured poses, and
releases the Setup pose override so playback can continue. Save before closing or
refreshing; tab preservation is not automatic persistence to disk. Moving Rigging
to the other dock requires saving or discarding pending edits first.
Removing it is a draft edit until the rig is saved. Soil cycles are deliberately
excluded from reusable library rigs and settings presets: their pile location
and timing belong to the equipment's project placement.

For manual authoring, **Manual controls & keyframes** retains the existing rig
workflow. Paths offers **Add timed stops**: 0% is the route start and 100% its end.
Repeated progress at two different times creates a pause; decreasing progress backs
along the route. **Pause here** adds a dwell and shifts later route keys. It does
not shift rig keys or soil timing, so review those when manually retiming a cycle.
The route owns whole-machine position; independent root position keys do not stack
with it. Keep lift/curl/tip on the rig controls. Separate scheduled route bindings
are not introduced by this update.

The soil window is the complete collection/carry/release interval. For example,
a carry key at 12.0 seconds and a tipping key at 12.3 seconds rotate the bucket in
0.3 seconds. They do not empty it instantly. At a 1.5-second full-bucket discharge
rate, hold the tipped pose and let the cycle run to about 15 seconds. Release stops
at To; material already falling continues to land. The simple cycle builder
calculates this margin automatically.

This first version models an independent source pile and deposits on a horizontal
surface at its base elevation. It uses the rigid-part keys and site path motion,
not arbitrary root transform keyframes or activity profile transforms. Deposited
soil is not a second excavatable source. Multiple equipment cycles have separate
piles; they do not share material. Truck-bed interception, material collision,
compaction and geotechnical behaviour are outside this visual model.

The amount is conserved by the simulation; the rendered convex bucket envelope
is an approximation, not an engineering volume measurement. Small or fast bucket
motions may need Fine detail or a longer cycle. A cycle supports up to 200 m of
travel and 100 m of drop height. The final released soil continues falling after
the last rig key; allow a tail in the timeline. Pour/gravity timing is authored
in simulation seconds, then mapped to the saved date window, so seeking and
changing playback speed do not alter the cycle's result.

Video capture uses the same evaluated state and hides the calibration guides.
The procedural soil meshes are not yet included in IFC or animated GLB/FBX scene
exports; use the viewport/video workflow for this Preview.

Implementation: 48×48 source and 64×64 receiving height fields, up to 96 instanced
falling clods, fixed 120/240/600-step evaluation, immutable shared snapshots for
unchanged terrain. There is no per-grain physics loop. Closing/rebinding the rig
releases generated geometry and materials.


### Adjusting a bucket that will not tip far enough

Capture always stores the chosen stage and reports beside the button whether its
opening will hold or pour soil. A warning marker means the pose needs adjustment
before Create & save cycle becomes available. The opening angle is measured from
world up, using the calibrated bucket opening direction.

Use **Adjust bucket travel** to open the bucket's **Movement range**. Move the
part with the setup slider, then press **Set 0 position** or **Set 1 position**.
That endpoint applies immediately to the draft. Preview both ends, switch to
Animate, and capture the improved pose. These endpoints define the control slider's
travel; they are not keyframes at time 0 and 1. **Save rig & keys** preserves the
range after closing. **Create & save cycle** saves the captured stages and timing.
Existing keys keep their normalized values and now use the changed range. Linked
parts retain their own calibration, so inspect the whole mechanism after adjusting.

### Loaded trucks and different aggregates (Preview.13)

The **Bulk material** selector offers Soil / fine aggregate, Sand, Gravel and
Stones / rocks. Sand and soil retain a continuous surface; coarse materials add
bounded instanced stones on the source, carried load and deposit. These are visual
representations, not per-stone rigid-body simulations.

For a prepared dump truck:

1. Import its prepared GLB and matching equipment preset, then save the rig.
2. Open **Soil · scoop, carry & pour** and **Add soil cycle**. The prepared
   `Tipper_body` is recognised as a preloaded body and supplies an initial volume
   fit. Check the yellow guide sits inside the bed with the bed lowered.
3. Use **Load source → Start with a loaded body**, choose **Bulk material** and
   **Starting load (%)**. Use **Discharge edge → Rear of body** for these trucks.
4. Under **Receiving ground**, set the ground base elevation. No source pile is
   created in this mode.
5. Key **Tailgate open** and **Tipper raise** in the rig controls. A starting pour
   threshold is 28 degrees, with 5 seconds to empty a full load. Keep the bed raised
   long enough inside the cycle window. Opening the tailgate is an animation step;
   the material simulation does not test tailgate collisions.
6. **Save rig & keys** and play or scrub. **Rewind soil cycle** restores the starting
   load. Paths controls travel independently; the load follows the bed.

The cycle window covers the loaded journey and complete discharge. It does not
generate the bed animation. Material already falling continues to land after To.
Changing the material or starting fill changes the visual cycle deterministically.
Live transfer from another machine into the truck is not implemented. As with
excavation soil, procedural aggregates are not included in animated 3D exports.
