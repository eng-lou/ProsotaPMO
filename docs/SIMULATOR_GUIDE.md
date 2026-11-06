# Prosota Simulator — Preview workflow

Open **BIM, Simulations & Reality Capture → Simulator**, or use **Open operational steps in Simulator** in an activity's Steps inspector. The inspector shows programme hours, derived hours, variance and whether the latest scenario needs recalculation.

## Promote and export the combined sequence (Preview.18)

Workers appear for their complete method (walk in, work, continue) and disappear
when it finishes. Seeking backwards brings them back at the correct stage.
Exiting detailed playback restores the ordinary scene and animation settings.

1. Run the scenario and open **Results**. The combined sequence groups steps and
   phase bars by activity; click a phase to inspect it in the viewport.
2. Choose **Promote to working**. All steps for each activity fit together between
   that parent's scheduled start and finish. Their relative durations, order and
   gaps are scaled together. For example, consecutive 10- and 20-second steps in
   a one-hour parent become 20 and 40 minutes; each step does not get a full hour.
3. The main workspace now offers **Detailed sequence** and **Simple 4D**. Detailed
   plays the promoted steps on the normal timeline. Simple restores the original
   activity profiles and permits model editing. The promoted sequence is saved
   with the project and included in portable backups.
4. To export the fitted programme playback, use **Export combined sequence video**
   in the working-sequence banner. Choose the video length in seconds and frame
   the scene first. Resolution, quality and overlays use **Capture** settings.
   Export covers the complete promoted time range in the current camera view.
5. To export the original operational timings instead, use the same export action
   in Simulator Results. This records the original run, before fitting it to the
   programme. Both exports are video (MP4/WebM according to Capture settings),
   not editable animation GLB/FBX files.

Promotion changes neither programme dates nor the original result's productivity,
resource hours or costs. It fits visual playback to the parent's elapsed date
window, including any non-working gaps in that span; it does not recalculate a
new production method. Programme-date acceptance remains a separate review.

An activity needs a valid, non-zero start/finish window. Promotion rejects incomplete
or stale runs, protected periods and fitted overlaps that would put the same worker,
tool or handled element in two places. Conflicting cross-activity ordering is also
rejected. Fix the parent windows or bindings and run again. Source changes mark the
working sequence stale and show Simple 4D until it is rerun and promoted again.
Only one combined sequence is active per working schedule period. Replacing it
requires **Replace working sequence**; the saved scenarios remain available.

## Walk, use a tool, then continue (Preview.17)

This method plays your placed worker and tool in the main 3D viewport. It uses
the same events as the simulation results. It is the first visual method in the
larger simulation plan; the excavation example below still calculates fleet
events without automatically choreographing the equipment.

1. Place a worker with compatible **idle, walk and work clips**, and place its tool
   through **3D Site tools**. Draw a path. The method uses its shape; it does not
   require a normal path binding or alter the path's existing pause keys.
2. Open **Simulator**, select the activity in **Scope**, then open **Steps** and
   choose **Walk → use tool → continue**. Pick the placed worker, tool and saved route.
3. Set **Work position on route**: 0% is the start, 100% is the end. Set work
   duration in seconds and walking speed in metres per second. Select standing
   idle, in-place walk and work motions from this worker's clip list.
4. Choose the hand and click **Fit tool in 3D**. Use **Move tool** and **Rotate
   tool**, dragging the coloured handles. Drag elsewhere to orbit. Scrub the work
   motion to check the grip through its full movement. **Copy existing grip** is
   available if the tool already has an attachment to this worker.
5. **Run simulation → Watch in 3D**. The large editor gives way to compact playback
   controls. Click Walk in, Use tool or Continue to jump to a stage; play or scrub
   the sequence. Playback speed changes viewing speed, not simulated duration.
6. **Edit / results** returns to the settings. Change work duration and run again:
   work, attachment and departure retime together. **Exit preview** restores the
   original scene. Your ordinary animation/path settings are preserved.
7. Expand **Save or reuse this method** to save a named template on this device.
   Templates retain motions, grip, duration and walking settings. Reuse clears
   the previous object/route bindings: choose a worker, tool and route for the new
   instance, check its clip names and grip, then run. Male and female exports may
   have different idle/walk clip names.

Save the **scenario** to retain its project bindings. **Save definitions to activity
steps** makes the method available when those steps are reused; it invalidates
the previous result, so run again. A changed route or replaced asset requires
revalidation. Running a method does not accept new dates into the programme.

The worker and tool are reserved for the whole method, preventing simultaneous
use by another method. Calendar interruptions hold progress and resume from the
same point. Physical actor reservations do not create labour/equipment costs;
assign priced resources explicitly when those costs are required.

The first version uses one hand anchor and a suitable authored work motion. It
does not solve two-hand contact, ground contact or automatic pose transitions.
Grip fitting must be checked when replacing a worker or tool. The scenario's
event-driven preview can be exported to video; editable scene animation export
does not yet bake these scenario events. Fleet cycles,
spatial queue slots and synchronised visual comparisons are subsequent stages.

## Visual workflow introduced in Preview.16

The interface now uses five icon tabs: **Scope → Steps → Resources → Disruption →
Results**. Scenario management is in its own expandable header, with save/run
actions available without reading a long instruction panel.

- **Scope:** search activities, select the work to model and use the selected count
  to check the scope. Expand scenario settings when dates or calendars need changing.
- **Steps:** choose one of four duration cards: fixed time, quantity/rate, repeated
  cycle or illustrative. Steps are numbered. A repeated cycle shows a strip of
  phases; click a phase to edit only that phase. Switching phases keeps your edits.
  Cycle durations initially display in minutes; seconds and hours remain available.
- **Resources:** configure capacity and cost in individual resource cards.
- **Disruption:** add a dated change to test an alternative; the empty state explains
  what to add before there are any changes.
- **Results:** start with completed steps, working unit-hours, waiting events and
  the coloured sequence bars. Expand utilisation, cost and comparison details as
  needed. Programme impact still requires its existing explicit review and acceptance.

Dependencies, conditions and detailed notes remain available in expandable sections.
This is a presentation change; it does not change calculations, resource allocation,
element handling or the rules for accepting dates into the programme.

## Start with the excavation example

1. Choose one activity in **Scope**, then **Configure steps**.
2. In **Steps**, click **Add excavation example**. An empty initial step is replaced; an already configured method is retained.
3. The example contains one excavator and three trucks, loading → travel loaded → tip → return, and explicit sample assumptions. It does not place equipment models.
4. Replace the sample 120 m³ total, 10 m³ truck load, 1.5 m³ bucket, 90% fill and 30-second bucket cycle with your method data. Travel, tip and return are editable fixed durations. Durations can be entered as hours, minutes or seconds.
5. **Run simulation**. Results show working times, activity duration/variance, resource utilisation, queue information and operating cost where supplied.
6. **Duplicate / test alternative**. In **Disruption**, choose the truck resource, set **Unavailable**, enter one unavailable unit and its start/end. Run again and select the original scenario for comparison.
7. **Review programme impact** only when the method is ready. Select the activities to apply, inspect downstream dates and float, enter a rationale, then accept. Running, saving or comparing alone does not change programme dates.

The example's truck stays reserved for its complete load/travel/tip/return cycle. The excavator is only required during loading and can load another truck while the first travels. Without a whole-cycle resource reservation, repeated cycles run serially. The final partial load completes the remaining quantity; bucket loading rounds up to whole scoops for that load.

## Scope and reusable steps

A scenario belongs to a project and schedule period. It can contain several activities and cross-activity step links. Activity steps remain inside their parent activities; creating a scenario does not create new programme activities.

Existing checklist steps are copied into the scenario. **Save definitions to activity steps** explicitly saves the operational method for future scenarios, including resource references. It does not mark checklist completion or apply dates. Scenario edits otherwise remain isolated. Reused definitions linked to the same programme resource share one capacity pool.

Scenario names, revision, method, source snapshot, calculated results and acceptance history persist in the project database and portable backup. Duplicating starts an independent method without a result. Local drafts survive switching Simulator tabs, but use **Save scenario** before refreshing the app. **Reload saved scenario** becomes **Discard draft & reload** when there are local edits.

Changes to the source programme, calendars, resource bookings, reusable steps, files, transforms, paths, rig keys or site scene flag the result as stale. Reopening Simulator or returning focus checks freshness; acceptance always checks it again on the server. Recalculate before using a stale result.

## Timing, conditions and capacity

| Setting | Behaviour |
|---|---|
| Fixed | Enter working duration. |
| Quantity / rate | Remaining quantity divided by units per working hour. |
| Repeated cycle | Repeat phases until the remaining quantity is complete. |
| Illustrative | Plays a method but does not establish an acceptable programme duration. |
| Bucket-derived loading | For m³ cycles, whole scoops = ceiling of load ÷ (bucket capacity × fill factor); loading time = scoops × seconds per scoop. |
| Route timing | For a straight saved path, distance ÷ speed. Curved routes currently require a measured duration. This calculates travel time; it does not create vehicle path keys. |
| Required resources | Occupied during a step or phase. Capacity is a number of interchangeable units, not a production-rate multiplier. |
| Whole-cycle resources | Remain reserved through all phases, including waits. Use this for a truck or crew that cannot be reassigned mid-cycle. |
| Resource calendar | Uses the selected calendar or the linked resource/project default, including shifts, breaks and exceptions. |
| Space resource | Explicit simultaneous occupancy of an area or route. Assign it like other capacity. |
| Condition | Confirmed, assumed or awaiting confirmation; may have a release date. Awaiting confirmation blocks calculation of that work. Assumptions remain visible. |
| Access windows | Work must occur in the supplied windows. If access is required and no window is supplied, the step remains unresolved. |
| Pause/resume | Allows work to span working/access windows. Turn off for a phase that must fit into one continuous available window. |
| Priority | Higher-priority ready operations compete for resources first; dispatch is repeatable. |

Quantities and rates use the selected unit consistently. There is no automatic mass/volume conversion: supply a conversion basis yourself before entering values. No duration is inferred when essential method inputs are missing.

The event simulation runs independently of viewport frames. Dates, working time, releases, availability changes and phase completions determine the result. A short playback represents the calculated time range; speeding it up does not change productivity.

**Estimate capacity** is an explicitly approximate independent-operation estimate. It excludes resource competition and queue allocation and cannot be accepted into the programme. Use **Run simulation** for the actual resource-constrained comparison.

## Links across activities

Add a predecessor from any activity in the scope. A 50% partial release means half of the predecessor's cycles have completed; a single fixed operation still needs its one completion. Lag entered in the editor is elapsed hours.

Programme finish-to-start links retain all predecessor steps; start-to-start links release when the first predecessor step begins. Programme lag follows the successor's working calendar. Outside-scope predecessors remain dated boundary conditions, and linked resources reserve existing outside-scope commitments unless **Assume available** is explicitly chosen.

An alternative method can explicitly **refine** a matching programme relationship inside its scenario. This prevents applying that same dependency twice. Finish-to-finish, start-to-finish and negative programme leads currently require explicit review/refinement; they are reported as pending instead of being silently converted.

Programme acceptance retains the programme's existing relationships. The impact review runs the real CPM rules on copies and shows the actual proposed downstream outcome, which may differ from a scenario using refined relationships. Accepted changes update selected duration/remaining-duration drivers and eligible start floors. For started work, the remaining span includes waiting from the simulation start; the reviewed finish is translated to the total-duration driver used by Prosota CPM. This changes the forecast without moving the recorded start or changing logged progress. Actual dates, completed activities and protected periods are not overwritten. Existing constraints other than start-no-earlier-than require separate review.

## Move the real IFC or imported object

In a fixed step or cycle phase, expand **Element handling and visual state** / **Element state during this phase**:

1. Select an IFC element or imported 3D object in the viewport, then **Use selected IFC element / 3D object**. An IFC element is identified by its GlobalId; all its materialised geometry pieces travel together.
2. Choose a state. **Delivered**, **waiting**, **moving** and **placed** use the entered poses. **Attached** follows a chosen carrier and optional rig part. **Installed** restores the object's designed pose.
3. Position values are offsets from the designed location in project metres. Rotations are XYZ degrees. Equal From/To values hold a pose; different values interpolate during that operation.
4. For **Attached**, choose the truck/crane and its bed/hook/part. The attachment offset is in metres along that part's axes. Carrier import scale does not shrink the load.
5. Add a subsequent placed/moving/installed state to release the object. An attachment continues following its carrier between stages until a later handling state takes over.
6. Run, play or scrub the result. The Gantt segments can seek to a phase. Exit scenario view before editing model transforms.

For a beam, one explicit method is delivered on truck → attached to crane hook → moved to laydown position → attached for the final lift → installed. Use step dependencies to establish the order, or a one-cycle operation with ordered phases. Reusing the same physical object in overlapping operations is flagged as a conflict.

The same object keeps its links and identity; no replacement beam is spawned. During handling, its ordinary appearance/transform profile yields to the operation. Exiting restores the designed transform and ordinary playback resumes. Manual hide/isolation remains respected. Existing carrier paths and rig animation still run on the timeline; this release does not automatically author crane motion, retarget rigs or generate fleet routes from the event calculation.

## Read and share results

- Activity durations use compatible working calendars. Started activities are labelled as remaining work.
- Resource operating hours are unit-hours. Operating cost uses only these hours and the optional entered hourly cost, not idle hire costs.
- Queue hours sum waiting operation intervals. Peak queue counts queued cycle requests, including planned cycles not yet dispatched; it is not a physical parked-vehicle count.
- The detailed waiting list identifies calendar, access, dependency and capacity blockers.
- Comparison includes finish, working hours, queue hours, configured operating cost and output by step.
- **Export visual report** creates an HTML report with the sequence, results, conditions, warnings and any programme review. Open it in a browser and print to PDF if needed. It sends nothing automatically.
- **Export full report & recipe** saves JSON with the full calculated event detail, saved source snapshot and decisions.

## Current boundaries

This Preview proves the generic method/scenario/calculation/review pipeline and explicit real-object state changes. Space constraints are capacity and time-window rules, not geometric clearance or swept-path checks. Resource representation and rig choreography remain explicit. Existing soil simulation remains its own keyed visual workflow; the excavation calculation does not infer soil/bucket poses.

There are bounded calculation limits (500 steps, 2,000 cycles per step, 10,000 operations, 730-day horizon and event/work budgets). Large scopes should use coarser cycles. Non-resumable work conservatively requires a continuous window without a known resource or productivity boundary. Any unfinished operation or limit reached is reported instead of receiving an invented finish.

Further spatial envelopes, automated equipment state/clip choreography, richer method alternatives and statistical uncertainty remain later work. Test the functioning method and object-handling flow first; simplify authoring based on observed friction.
