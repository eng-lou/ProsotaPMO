# Prosota Maritime User Guide

Version 1.1 | 18 October 2026 | Interactive port environment

Prosota Maritime brings port operations, safety exercises and infrastructure delivery into a shared project. This guide explains how to create useful project data, connect it to models, run the available calculations and interpret the results. It covers the implementation released in October 2026, with practical examples for someone learning the platform from the beginning.

For the quickest visual introduction, open **Port Operations**, create the editable terminal if the project is empty, and choose **Follow the story**. This saves and runs the selected alternative, then takes you from vessel arrival to an outage and a comparison. **Assets** and **Details** toggle the side panels; **Focus view** expands the environment.

The Word edition remains version 1.0; this page includes the new port environment. Start with sections 1 to 4. They explain the interface and take you through a complete operational comparison without requiring a model. Then import your geometry, build a guided exercise and use the existing Prosota planning tools for delivery. The later sections explain calculations, reporting, Poe and recovery from common problems.

**Three things to understand before starting.** An imported model supplies geometry. An asset record supplies identity and operational settings. A delivery activity supplies schedule dates and assignments. Linking these records makes them easier to use together, but each link has a specific purpose; it does not automatically activate every calculation or animation.

**Workspace:** [Open Prosota Maritime](https://www.prosota.com/maritime/workspace). Sign in with an approved Prosota account. The older demonstration at `/maritime/demo` is separate from your editable projects.

## 1 Choose the right workspace

### Port Operations

Use this workspace to answer questions such as: Can the terminal handle the planned cargo? What happens if a crane stops for six hours? Will trucks or outbound gates become the bottleneck? What utilisation and operating costs result from those assumptions?

You enter assets, vessel calls, handling rates, yard capacity and availability restrictions. The engine calculates cargo flow and saves a run containing both its inputs and outputs. The port environment replays recorded quantities and equipment states. Crane cycles and representative truck movement follow calculated handling progress, freezing during outages. The layout is generated from your editable assets; imported geometry is available through Models & Assets. Travel paths are illustrative, and operational runs do not yet drive arbitrary imported rigged equipment.

### Safety and Training

Use this workspace to author a guided exercise, inspect its linked asset in the model, record participant actions and review their timing and order. An example is identifying a lifting-zone intrusion, stopping the lift, securing the zone and notifying the supervisor.

Configure a scene control for each action in **Setup**. Participants can identify the hazard, stop practice equipment, place barriers and acknowledge notification through scene markers. Stopping freezes the practice animation at that timestamp. Existing exercises without mappings remain record-only. These controls do not operate imported cranes or detect hazards automatically. Use the exercise as a guided rehearsal and review tool.

### Infrastructure Delivery

Use this workspace to plan maritime construction, refurbishment and installation. It reuses Prosota's schedule, calendars, resource assignments, costs, risks, issues, baselines, model links and 4D animation profiles.

A berth extension, quay repair or crane installation can have a real schedule and a model sequence. This is the part of Maritime where activity dates control linked model geometry. The operational flow engine and the delivery scheduling engine currently run separately.

| Your immediate question | Start here | Result to inspect |
| --- | --- | --- |
| What will an outage do to vessel completion? | Port Operations and Scenarios | Saved run comparison |
| Which equipment is limiting cargo flow? | Equipment and Results | Rates, cargo flow and performance |
| Did the participant follow the exercise? | Safety and Training | Saved debrief and action log |
| When will the berth extension finish? | Infrastructure Delivery and Schedule | Calculated dates and baseline variance |
| How will the works appear over time? | Models & Assets | Schedule-linked 4D sequence |
| What evidence supports a decision? | Reports and Poe | A named saved run and its assumptions |

## 2 Find your way around

The header identifies the project and shows the Maritime working-plan save state. The three workspace tabs change the task area. The shared sidebar remains available so you can move between assets, scenarios, reports and Poe without changing project.

| Control or location | What you use it for |
| --- | --- |
| Project selector in the header | Switch between Maritime projects |
| Project in the sidebar | Currency, data source, simulation start, horizon and optional starter |
| Models & Assets | Import and inspect geometry, map it to assets and open the existing 4D tools |
| Scenarios | Availability alternatives and planned maintenance |
| Reports | Saved operations runs and safety attempts; a link to delivery dashboards |
| Poe | Ask questions grounded in saved project data and available tools |
| Save changes | Persist edits to the Maritime working plan |
| Reload | Retrieve the saved plan; discards local changes after confirmation |
| Undo and Redo | Up to ten recorded editing steps in the current session |
| Light mode or Dark mode | Change the workspace appearance |

**Port Operations tabs:** Overview, Vessel calls, Berths, Equipment, Yard & gates and Results. Equipment has Details, Performance and Maintenance views for the selected asset. Yard & gates currently manages yard, gate and truck records; a physical route editor is not part of the operational solver.

**Safety & Training tabs:** Exercises, Setup, Run and Debrief. Exercises and Setup expose the authoring controls. Run conducts the selected exercise. Debrief opens saved attempts.

**Infrastructure Delivery tabs:** Model & sequence, Schedule, Resources, Costs, Risks and Issues & decisions. Delivery dashboards are reached through **Reports → Delivery dashboards & reports**. These are the existing Prosota modules inside Maritime navigation.

**If the layout changes:** model panels, tables and Gantt windows use the existing dockable layout controls. A hidden panel does not mean the data has disappeared. Reopen the relevant tool from its toolbar and check the current project and schedule.

## 3 Understand the records and connections

### The project is the container

A Maritime project holds its working plan, models, delivery schedule and shared records. Construction and Maritime have separate project lists. Saving the working plan increments its version; each run captures that version so later edits cannot change an earlier result.

| Record | Meaning | Example |
| --- | --- | --- |
| Model | Imported geometry and associated model properties | Terminal IFC or crane GLB |
| Asset | Stable record for equipment, a vessel or a location | QC-02 or Berth 02 |
| Vessel call | One arrival and unloading workload | Horizon discharge of 1,200 moves |
| Scenario | Availability restrictions applied to the saved working plan | QC-02 unavailable from hour 8 for 6 hours |
| Run | Saved execution with captured inputs and calculated outputs | Working plan versus QC-02 outage |
| Exercise | Authored hazard, linked asset, required actions and time limit | Quayside lifting exercise |
| Attempt | Saved participant actions and assessment against an exercise | Four actions recorded in 42 seconds |
| Delivery activity | Scheduled work in the existing planning module | Install quay deck |

### Four connections with different jobs

**Geometry to Maritime asset:** use **Link selected geometry** in the model inspector. This lets you identify, select and isolate the geometry belonging to an asset. One asset can reference several elements.

**Geometry to delivery activity:** use **Activity Link** or **Bulk Activity Link** in the model data panel. These assignments drive the existing 4D sequence. An asset mapping alone does not create these schedule assignments.

**Planning resource to delivery activity:** assign a resource in the scheduling tools. This drives the delivery resource and cost calculations under their calendar and rate rules.

**Maritime asset to planning record:** choose **Linked planning resource** or **Linked delivery activity** in asset Details. These fields identify related project records. They do not create a resource assignment, copy rates, link geometry to an activity or reschedule delivery when an outage occurs.

### Two meanings of baseline

The operational **Working-plan vessel finish** uses the saved plan without the selected scenario restrictions, but includes scheduled maintenance. The export calls this result `baseline`. A delivery **Baseline** is a separately managed, named schedule snapshot whose assignment supplies baseline dates and variances. Capturing a delivery baseline does not change an operational run's reference.

## 4 Complete your first operational comparison

This exercise uses the editable terminal starter. Geometry is optional: complete the calculation first, then connect a model in section 7.

1. Open the Maritime workspace and create a new project, for example **Terminal learning project**. Open that project from the list.
2. In **Project**, click **Load editable terminal starter**. The button is available while the asset register is empty. It loads records and settings, so check them before saving.
3. Confirm **Synthetic example**, **GBP**, simulation start **19 October 2026 at 08:00 UTC**, and a **72-hour** calculation horizon.
4. Click **Save changes**. Wait for **Saved · v1**, or the next saved version if you have already edited the project.
5. Open **Port Operations → Equipment**. Find QC-01 and QC-02. Each has a handling rate of **30 moves/h** and operating rate of **120 GBP/h**.
6. Check the truck fleet at **90 moves/h**, Yard A capacity at **1,500 moves**, and outbound gates at **90 moves/h**.
7. Open **Vessel calls**. Horizon discharge should use MV Horizon, Berth 02, both cranes, arrival hour **2** and **1,200 cargo moves**.
8. Open **Overview**, select **Working plan**, then **Run simulation**. Use **Play**, scrub the timeline and open **Full results** before changing any inputs. The two sides of this run are identical, so its completion and cost impacts are zero.
9. Open **Scenarios** and select **QC-02 outage**. Confirm QC-02, start hour **8**, duration **6 hours**.
10. If you changed anything, save it. Click **Run comparison**. You will be taken to Results.
11. Check **Working-plan vessel finish = 22.00 h**, **Scenario vessel finish = 25.00 h** and **Completion impact = 3.00 h**.
12. Open **Reports**, select the saved comparison and use **Download full report** to retain its inputs, version and results. This downloads JSON. Use **Print / save PDF** for a readable report.

**What success looks like:** the outage run remains in the saved list, and reopening it gives the same result. After a later plan edit it is marked as an older version; its figures do not change.

The hour values are measured from simulation start. In this example, hour 2 is 19 October at 10:00 UTC. Hour 22 is 20 October at 06:00 UTC; hour 25 is 20 October at 09:00 UTC. The screen uses UTC for the operational start, so do not enter local summer time as though it were UTC.

## 5 Manage settings and save your work

### Project settings

**Currency** labels operational monetary inputs and outputs. The available choices are GBP, USD, EUR, AED, SGD and AUD. Changing the currency does not convert the numbers. Check currency and units separately in the reused delivery modules; the Maritime selector is not a project-wide exchange-rate service.

**Data source** distinguishes user-entered inputs from the synthetic example. Changing the label does not validate values or connect a live data feed. Use asset notes to record where a rate or capacity came from.

**Simulation start (UTC)** is the reference for elapsed arrival, outage and maintenance hours. **Calculation horizon** is an integer from 1 to 336 hours. Operations use elapsed time continuously; delivery schedules use their own working calendars.

### What the save state means

| State or action | Practical meaning |
| --- | --- |
| New working plan | No persisted Maritime plan version yet |
| Unsaved changes | Local plan edits need Save changes |
| Working… | A request is in progress; wait for its outcome |
| Saved · vN | The working plan is stored at version N |
| Error message after Save | The save did not complete successfully; read the message before continuing |
| Reload | Replace local plan edits with the saved server version |

The header save state covers the Maritime working plan. Imported model files, activity links, schedules, profiles and rigging use the existing modules' own save or update controls. **Save changes** is not a universal save button for every open editor. For example, a rig draft still needs **Save rig & keys**.

### Undo and redo

Use **Ctrl+Z** to undo a recorded application edit. Use **Ctrl+Shift+Z** or **Ctrl+Y** to redo it. On systems using Command shortcuts, the equivalent Command modifier is supported. The sidebar buttons show the available actions.

When focus is inside a text field, the browser retains normal text-editing undo. Click outside the field or use the sidebar button to undo a recorded application action. Repeated typing in one control may count as a single step. The history holds ten steps, is session-based and is not a project backup. Reloading the Maritime plan clears its local edit history. Undoing a plan edit marks it unsaved again.

### Conflicts and duplication

If another tab saves a newer version, your stale save or run is rejected. Note any local edits you need, choose **Reload**, then reapply them to the current version. There is no automatic merge. Avoid editing one project in multiple tabs while conducting an exercise.

**Switch project** returns to the selector, where you can rename, duplicate or archive projects. A Maritime duplicate copies the working plan and remaps its planning associations. Model files and Maritime run history are not copied; geometry mappings are cleared. Import and link geometry in the copy. Archive is preferable to deletion when you may need the project again. Project deletion cannot be recovered through the ten-step undo history.

## 6 Build a useful asset register

Open **Port Operations → Equipment → Add asset**. Select the record, choose its type and enter a meaningful name. Berths also have their own tab, while Yard & gates groups yard, gate and truck records. These are views of the same register, not separate copies of the equipment.

Use names that identify the physical or operational role, such as **QC-02**, **Berth 02**, **Gate East** or **Truck fleet A**. Generic imported names such as Cube.021 can remain in the model; the Maritime asset name gives users a readable identity.

| Asset type | Operational fields | How the current solver uses it |
| --- | --- | --- |
| Berth | Operating rate per hour | Exclusive occupancy for a vessel call; availability and occupied-hour costs |
| Crane | Handling rate and operating rate | Assigned to calls; productive handling capacity and costs |
| Truck | Aggregate handling rate including travel and operating rate | Shared transport capacity across calls |
| Yard | Storage capacity and initial stored cargo | Pooled storage buffer measured in cargo moves |
| Gate | Handling rate and operating rate | Shared outbound processing capacity |
| Vessel | Name, links and notes | Identity assigned to a call; cannot occupy two berths at once |
| Infrastructure | Name, links and notes | Shared reference for geometry and delivery work; no automatic flow capacity |

**Rates are aggregate for the record.** If one truck-fleet record represents six trucks whose combined output is 90 moves/h, enter 90. Do not enter 90 for each truck as well unless you intend to add that capacity. Use individual records when you need individual outage and utilisation comparisons; use a fleet record when only the fleet total matters.

Multiple yards are summed into one buffer. Multiple available truck and gate rates are pooled. The engine does not yet route a particular call to a particular yard, gate or truck fleet. A visually distant gate still contributes to the shared capacity if it exists in the plan and is available.

In **Details**, add notes and, where useful, select a related planning resource or delivery activity. These lists draw from the same project's existing records. Create the delivery records first if the lists are empty.

In **Performance**, select a saved operational run. Compare productive or occupied hours, moves and elapsed-time utilisation for that asset. A dash means the asset is absent from that run or the measure is unavailable. A changed working plan does not update the performance of an old run.

In **Maintenance**, create work orders for cranes, trucks, gates and berths. Other asset types do not currently support operational availability orders.

To remove an asset, first remove references from calls, scenario restrictions, maintenance and exercises. Removing the asset retains imported geometry. Unlinking geometry also retains the underlying model file.

## 7 Import models and map your assets

### Import and inspect

1. Open **Models & Assets → Import Model**.
2. Choose a supported model file. The existing importer accepts IFC, GLB, glTF, OBJ and FBX, with relevant material or image companions. XYZ and E57 point-cloud inputs are also offered by the existing viewer. Use the file type appropriate to the geometry you need to select and animate.
3. Wait for import and persistence to complete. Check any upload or conversion error before leaving the viewer.
4. Use **IFC Data** for IFC elements and **3D Data** for imported mesh objects. A model can be loaded while you are looking at the other data tab.
5. Select an item and use **Frame Selected**. Use **Show All** to recover from isolation or hidden items. Confirm scale, orientation and placement before creating links.

GLB is convenient for a self-contained mesh asset. IFC is useful when you need element identities and properties. With formats that use external textures or materials, supply the required companions through the importer. A missing texture does not necessarily mean the geometry failed to load.

### Connect geometry to an asset

1. Register the asset first, for example QC-02.
2. In the model viewer, select the geometry that belongs to it. Inspect the selection so unrelated terminal elements are excluded.
3. In the **Shared asset register** inspector, choose QC-02 from **Inspect Maritime asset**.
4. Click **Link selected geometry**. This adds the selection to that asset's existing mapping and avoids duplicate references.
5. Click the header **Save changes** to persist the mapping.
6. Clear the viewer selection, choose **Select in model**, then **Frame Selected**. Confirm that the expected geometry is selected.
7. Try **Isolate asset**. Use **Show All** afterwards. Reopen the project once to confirm the model and mapping restore correctly.

To remove an incorrect mapping, open the asset's **Details → Linked geometry**, click **Unlink** for the unwanted reference and save. Linking a new selection adds to the existing mapping; it does not replace it.

### Choose the right level of detail

An IFC asset can map to several identifiable elements. Mesh mappings identify imported objects; they do not independently identify every internal submesh of a single GLB. If a crane has many internal parts, use the existing rigging tools to define moving groups. If separate operational assets need independent selection, import or prepare suitably separated objects.

Model links depend on stable references. Replacing files or changing identifiers and mesh names can require remapping. Avoid duplicate mesh filenames for distinct objects. Keep a naming convention and verify the selected geometry after a replacement.

## 8 Configure vessel calls and capacity

Create at least a vessel, berth, crane, truck capacity, yard and outbound gate before running operations. A usable call must reference a vessel and berth and have at least one assigned crane. Missing or incorrectly typed references prevent saving a valid plan.

1. Open **Vessel calls → Add vessel call**.
2. Enter a call name that distinguishes the visit, for example **Horizon discharge 19 October**. The vessel record can be reused for a later visit.
3. Choose **Vessel** and **Berth**.
4. Enter **Arrival (hours from simulation start)**. This is an elapsed offset, not a clock time or calendar date.
5. Enter **Cargo to unload (moves)** as a positive whole number.
6. Select the assigned cranes. Check both their rates and any availability restrictions.
7. Save the plan and run it from Overview or Scenarios.

### How calls compete

Calls are processed in arrival order. A berth, crane or vessel cannot serve incompatible concurrent calls in the same calculation step. For equal arrival times, the internal identifier determines the order; the list is not a manual priority control. Use distinct arrival times if order matters to the example.

Truck capacity is shared and consumed in call order. Cargo can unload only when there is crane capacity, transport capacity and free yard storage. Outbound gates drain the yard. A call can occupy a berth while cargo handling is constrained, so its berth start is not necessarily the first productive lift.

The berth model is a capacity approximation. A berth outage blocks its availability in the calculation. It does not simulate a vessel physically vacating the berth, manoeuvring or being relocated.

### Avoid misleading input combinations

Use the same definition of a cargo move throughout the plan. The current model does not convert TEU, tonnes or container sizes. A rate of 30 moves/h and a demand of 1,200 moves must refer to compatible handling units.

An asset rate of zero contributes no processing capacity. A yard with no free capacity stops further unloading until stock can leave. A call arriving after the horizon cannot finish within that run. Increase the horizon only after checking that the plan contains a viable route through all capacity stages.

Start with one call, prove the figures, then add competing calls. This makes it easier to see whether a change comes from a berth queue, shared crane, truck limit or full yard.

## 9 Create alternatives and maintenance plans

### Compare an availability restriction

1. Open **Scenarios → Create scenario** and give it a descriptive name.
2. Click **Add restriction**.
3. Choose an unavailable crane, truck, gate or berth.
4. Enter **Start (elapsed h)** and **Duration (h)**. For a restriction from hour 8 to hour 14, enter 8 and 6.
5. Add further restrictions only where the alternative requires them. Save the plan.
6. Click **Run comparison**. The engine runs the same saved plan with and without these scenario restrictions.
7. Review completion, cargo flow, remaining workload and costs together. Keep the saved run before revising the alternative.

**Duplicate** copies a scenario's restrictions under a new name. It does not copy a complete independent working plan. All scenarios use the current saved plan when executed. Changing the truck rate and rerunning an older scenario therefore evaluates that scenario against the new truck rate; the previous run still retains the old inputs.

The scenario editor currently varies availability. To test a different capacity, workload or hourly rate, edit and save the working plan, then produce a new run. Use clearly named projects or preserve the run exports when comparing materially different plans. There is no automatic scenario-adoption button in this release.

### Schedule a work order

1. Open an eligible asset's **Maintenance** view, or **Scenarios → Planned maintenance**.
2. Click **New work order**. Set Task, Asset, Start, Duration, Work order cost and Notes / checklist.
3. Leave **draft** while defining it. Set **scheduled** when it should affect calculations.
4. Save and run the plan again. Examine the new result and its version.

| Work order status | Availability effect | Work order charge in the run |
| --- | --- | --- |
| draft | None | None |
| scheduled | Asset unavailable during its interval | Fixed cost once, if its start falls before the run ends |
| complete | No planned restriction applied | No scheduled-order charge applied |

Scheduled maintenance affects **both** sides of an operational comparison. If the working plan already contains a scheduled crane inspection, it is not the difference between the two sides. To measure that inspection's impact, retain a run without it and a run with it, or model the proposed restriction as a scenario before adding it to the working plan.

Changing an order to complete changes future calculations; it does not create an actual-cost ledger. Keep historical runs for evidence. Overlapping restrictions on one asset do not remove it twice, but separate scheduled work orders can each carry a fixed cost. Avoid duplicate orders for the same job.

## 10 Read results and replay the evidence

Every operational run records its name, run identifier, input version and creation time. Select a run in **Results** or **Reports** before interpreting its values. A warning that the plan has changed means the result is historical, not that it is invalid.

| Result | How to read it |
| --- | --- |
| Working-plan vessel finish | Latest call completion without the selected scenario restrictions |
| Scenario vessel finish | Latest call completion with those restrictions |
| Completion impact | Scenario vessel finish minus working-plan vessel finish |
| Cost impact | Scenario total cost minus working-plan total cost |
| Unloaded | Cumulative cargo moved off the vessels |
| Yard stock | Cargo currently in the pooled yard, including initial stock |
| Gate cleared | Cumulative cargo processed out through the gates |
| Berth start | First calculation time the call occupies its assigned berth |
| Remaining moves | Work still on that call at the end of the calculation |

**Vessel finish and terminal clearance are different.** A vessel can finish unloading while cargo remains in the yard. The full JSON report includes terminal completion as well as vessel completion. The headline delay compares vessel completion, so check yard stock and gate clearance when the decision concerns the entire terminal.

If the horizon is reached, the report says so and shows **Not reached** for a finish that was not achieved. A vessel finish can still exist while terminal clearance remains incomplete. Cost to that point is a partial-run cost, not a final estimate for completing the remaining work.

### Use replay correctly

Click **Replay results** to advance through the saved quantities, or drag the slider to a chosen elapsed hour. The quantity strip shows the latest stored sample at or before that time. Samples are recorded periodically, so the quantities change in steps even though the calculation runs in one-minute increments.

**Reset playback** returns the replay cursor to zero. It does not delete the run, undo inputs or recalculate the scenario. The cargo chart displays the full saved series; the replay controls change the quantity readout. Imported equipment is not driven by this replay yet.

### Inspect performance

The equipment table reports equivalent productive hours for cranes, trucks and gates, and occupied hours for berths. Utilisation divides those hours by the elapsed duration of that specific run, including time before the vessel arrives and time while the yard drains.

Use **Equipment → Performance → Saved operational run** to compare an individual asset between the two sides. A longer scenario can have lower utilisation even when it performs the same total work, because the denominator has increased. This is not a shift-based or available-time utilisation measure.

## 11 Understand the calculations

### The capacity chain

The current flow is vessel unloading → available cranes → shared trucks → pooled yard → outbound gates. The engine advances in one-minute fluid steps. Quantities can be fractional inside a step; it is not modelling each container as an individual physical object.

At each step, gates remove stored cargo up to their available rate. Calls then unload subject to their remaining workload, assigned crane rate, remaining shared truck capacity and free yard space. This order means terminal clearance may lag vessel finish by a small time step even when gates are faster than unloading.

**Conservation check:** initial yard stock + cargo unloaded = current yard stock + cargo cleared through gates. For a completed starter run with no initial stock, the unloaded and gate-cleared totals are both 1,200 and the yard is empty. If you begin with 200 stored moves, a fully cleared terminal can show 1,400 gate-cleared moves against 1,200 newly unloaded moves.

### Why a six hour outage causes a three hour delay

The starter vessel arrives at hour 2. Two cranes provide 30 + 30 = 60 moves/h. Trucks and gates each provide 90 moves/h, and yard capacity is sufficient.

Without an outage, 1,200 ÷ 60 = 20 productive elapsed hours. Arrival at hour 2 gives vessel completion at hour 22.

With QC-02 unavailable from hour 8 to 14, both cranes handle 360 moves from hour 2 to 8. One crane handles 180 moves during the six-hour outage. At hour 14, 660 moves remain. Both cranes clear those in 11 hours, producing vessel completion at hour 25. The lost output is 180 moves, equivalent to three hours at the restored 60 moves/h rate.

### Why slower trucks can remove the outage difference

Change the truck fleet rate to 20 moves/h, save and rerun the comparison. The truck fleet now limits both cases. Even one available crane can provide 30 moves/h, above the truck limit.

The vessel requires 1,200 ÷ 20 = 60 hours after arrival, so both sides finish at hour 62. A zero completion impact here does not mean the outage was ignored. It means another constraint already limits throughput. Restore the truck rate to 90 and save when finished with this experiment.

### Why cost can remain unchanged

Crane, truck and gate operating charges use equivalent full-rate productive hours. Berth charges use occupied hours. The model does not automatically charge idle time, fuel, demurrage or extra labour.

| Starter cost component | Calculation | Amount |
| --- | --- | --- |
| Combined cranes | 1,200 moves ÷ 30 moves/h × 120 GBP/h | 4,800 GBP |
| Truck fleet | 1,200 ÷ 90 × 60 GBP/h | 800 GBP |
| Outbound gates | 1,200 ÷ 90 × 30 GBP/h | 400 GBP |
| Berth and maintenance | Default rates or costs are zero | 0 GBP |
| Total | Productive operating charges | 6,000 GBP |

The two identical cranes redistribute their work during the outage, but the combined productive charge remains the same. With a zero berth rate, both cases total 6,000 GBP, so cost impact is zero despite the three-hour delay.

For a controlled experiment, set Berth 02 to **50 GBP/h**. At 20 occupied hours, the working plan adds 1,000 GBP. At 23 occupied hours, the outage adds 1,150 GBP. Total costs become 7,000 and 7,150 GBP, giving a 150 GBP impact. These are illustrative inputs, not market rates.

Scheduled maintenance fixed costs are added to total cost if they start before the run ends. The CSV's **Operating cost** series excludes that fixed maintenance addition; use the full report's operating, maintenance and total cost fields when reconciling totals. Do not add the entire operational total to the delivery cost plan without checking whether the same resources are already charged there.

## 12 Author a guided safety exercise

Create an exercise around a specific registered asset or location. Give the participant an objective that can be observed and discussed. The current assessment compares recorded action names, timing and order to the rules you author.

1. Open **Safety & Training → Setup → New exercise**.
2. Enter **Exercise name**, for example **Quayside lifting exclusion zone**.
3. Select **Equipment or location**, such as QC-02. Map that asset to model geometry if you want participants to inspect it spatially.
4. In **Hazard / objective**, explain the situation and what the participant is expected to recognise.
5. Set **Response limit from exercise start (seconds)**. This one limit applies to every required action; it is not a fresh timer for each step.
6. Enter **Required actions in order**. The starter uses Identify hazard, Stop lift, Secure zone and Notify supervisor.
7. For scene interaction, choose a **Scene control** beside each action. These map to identification, stopping the practice animation, barriers or notification; **Record only** keeps the action in the log without a scene effect. Add or remove actions as needed. Names must be non-empty and unique. The current authoring list has no drag-to-reorder control; edit the action text in the required sequence.
8. Save the plan, then open **Run exercise**.

Use precise, distinct actions. For example, **Identify the person in the lifting zone** is easier to review than **Check safety**. Keep an exercise focused enough that its sequence and time limit are meaningful.

**Inspect linked environment** opens the shared model area and selects the exercise's asset in the inspector. Use **Select in model**, **Isolate asset** or **Frame Selected** to inspect its geometry. If no geometry is linked, the exercise still runs against the representative asset in the operational layout. Imported geometry and its existing inspector remain available separately.

Scene mappings display practice markers and barriers around the selected asset. They do not create a collision-tested exclusion volume or trigger hazards from live model geometry. Do not treat an authored time limit as an externally validated safety standard.

## 13 Conduct an attempt and interpret the debrief

### Run the exercise

1. In **Safety & Training → Run**, select the intended exercise. Confirm its hazard and linked asset.
2. Click **Start exercise**. The timer begins and the exercise version is captured.
3. Use the scene markers or inspector action buttons. Configured effects update the practice scene. Every action receives a timestamp and cannot be recorded twice in the same attempt.
4. Navigate to **Models & Assets** if you need to inspect the environment. The attempt remains active and the same action controls appear in the model inspector. Navigation time counts towards the response limit.
5. Click **Finish & review** in the port environment, or **Finish & save attempt** in the imported-model inspector. Wait for the saved debrief. Finishing is what persists the attempt.

An active attempt survives navigation within the current project session. It is not resumable after a browser refresh or closed tab. The browser warns before leaving with an active attempt. Complete or discard it before switching projects. Plan save and reload controls are disabled while an attempt is active.

**Restart attempt** clears its recorded actions and starts its timer again. **Discard attempt** abandons the unsaved attempt. Neither removes previously saved attempts. **Reset playback** in a saved debrief only resets its replay cursor.

### Review more than the completion count

| Debrief field | Meaning |
| --- | --- |
| Recorded actions | Number of distinct required actions recorded |
| Missed actions | Required actions that were not recorded |
| First action | Time from Start attempt to the first recorded action |
| Configured order | Whether recorded actions follow their relative authored order |
| Within limit | Whether each action was recorded by the single response deadline |

A result of **4/4** means all four actions were recorded. It does not automatically mean all were on time or in the correct order. Likewise, **Configured order: Followed** can appear when only some actions were completed, provided those recorded actions followed their relative order. Review completion, missed actions, order and timing together.

Click **Replay action log** or drag the slider to see which actions had been recorded at each point. This replays evidence, not equipment motion or a video recording. Download the full report to preserve the exercise definition, asset, action log and criteria with the attempt.

If a newer plan was saved in another tab during the attempt, the server can reject the stale submission. Do not assume a failed finish was saved. Retain the visible action details, resolve the version conflict and restart against the intended saved exercise.

## 14 Plan maritime infrastructure delivery

Infrastructure Delivery uses the existing Prosota planning engine. Begin with a small, coherent work package so its dates, model links and resource costs can be checked before extending the schedule.

### Build or import the schedule

1. Open **Infrastructure Delivery → Schedule** and confirm the active project and working schedule.
2. Use **Add Activity** to create work, or **Import from P6** to bring in an existing programme through the established import flow.
3. Organise the work into WBS summaries and executable activities. For a learning example, use Prepare work area, Install piles, Install deck and Commission berth.
4. Set the appropriate working calendar and durations. Create predecessor relationships rather than relying on manually typed dates alone.
5. Review **Quality Check**, then use **Reschedule** when you want the engine to calculate the programme from its logic and calendars.
6. Inspect the activity table and Gantt together. Confirm start, finish, duration, milestones and relationships before adding a baseline.

Operational elapsed hours and scheduling working days are not interchangeable. A six-hour crane outage does not automatically mean one lost construction day. The consequence depends on the affected activity, its calendar, resource assignment, logic and available float.

### Capture and assign a delivery baseline

Open **Baseline**, create a named, dated snapshot of the agreed schedule, then assign the intended baseline. Capturing and assigning are separate actions. The assigned baseline supplies BL Start, BL Finish and finish variance values. Unassigning clears the active comparison without deleting the saved snapshot.

For a learning experiment, capture a baseline, increase one critical activity's duration and reschedule. Compare the calculated finish with the assigned baseline. Preserve the original plan through the existing schedule-variant or baseline tools before changing a working programme you need to retain.

### Make the connection to operations explicit

You can associate a Maritime asset with the relevant delivery activity and resource in asset Details. Use these links to identify affected work when reviewing an outage. The current release does not propagate the outage into delivery dates or create a berth closure from construction activity dates.

If a calculated disruption requires a delivery change, review the affected work, edit the delivery inputs deliberately and reschedule. Record the reason in the appropriate issue, decision or risk record. Compare the resulting delivery dates with the assigned baseline. Do not copy the operational headline delay blindly into every activity duration.

## 15 Link the delivery model and apply animation profiles

### Assign geometry to scheduled work

1. Open **Models & Assets** or **Infrastructure Delivery → Model & sequence**.
2. Open **Activity Table** or **Gantt Chart** and confirm the working schedule contains the activities you intend to animate.
3. Select the relevant geometry in the viewport or data tree.
4. For one item, use **Activity Link → Link to activity…** in its model data panel. For multiple items, use **Bulk Activity Link**, choose the activity and click **Link Selected**.
5. Link executable tasks rather than WBS summaries. Review the selected elements before bulk linking.
6. Scrub the existing animation timeline through dates before, during and after the activity. Confirm that the correct geometry changes at the correct time.

These are schedule assignments. They are separate from **Link selected geometry** in the Maritime asset inspector. You may need both: one identifies the asset and the other drives its delivery sequence.

### Choose and apply profiles

Open **Profiles** to inspect built-in recipes or create a project profile. Save a built-in recipe into the project library before assigning it where the selector lists saved profiles. Use a clear name such as **Quay construction green fade** or **Demolition red removal**.

Select activities in the Activity Table or Gantt, choose **Activity animation profile** and click **Apply profile**. Shift-click selects a range and Ctrl/Cmd-click adds activities. Individual element links can retain profile overrides, so an activity-wide change does not necessarily replace every element's appearance.

Review colour, opacity, motion and timing settings together. The current default profile starts green; a custom profile can override that. A profile colour communicates a chosen animation treatment, not a measured safety state, live equipment status or verified progress result.

If an element behaves unexpectedly, check its activity dates, the active schedule, the activity profile and the element-link override. Inspect one item before applying a change to hundreds of elements. Imported materials and a selected-object highlight can also change how a profile appears on screen.

### Equipment motion and paths

Use the existing **Rigging** tools for rigid moving groups, pivots, axes, travel limits and keyed equipment controls. Use root transforms or **Paths** to move the whole machine. This is authored animation; changing an operational handling rate does not generate those keyframes.

For a crane or loader, first group the pieces that move together, name the group, place and orient its pivot, choose the motion axis, establish its travel endpoints and test the control. Save the rig and keys with the rig panel's own command. Keep a neutral reference pose before making broad changes.

Start delivery demonstrations with a few correctly linked tasks and a simple profile. Add articulated equipment motion only after schedule timing and geometry assignments work, so you can distinguish a rig problem from a schedule or mapping problem.

## 16 Use resources costs risks and delivery reports

### Resources and assignments

Open **Infrastructure Delivery → Resources** to use the existing resource pool, tracking and usage tools. Create or review resources with meaningful names, types, units, rates and capacity settings. Return to an activity's detail panel to assign resources and set the applicable quantity or utilisation.

A crane asset in the Maritime register and an equipment resource in the planning module can describe the same real machine. Linking the records helps users recognise that relationship, but the operational handling rate and the delivery resource rate remain separate inputs.

Check rate bases before comparing budgets. An operational rate expressed per productive hour is different from a planning rate per day or a material cost per unit. For time-based delivery resources, inspect the activity calendar, resource settings and utilisation. For materials, check quantities and unit rates.

### Costs and actuals

Use **Costs** for the existing cost plan and quantity workflows. Keep operational scenario cost, delivery budget and recorded actual cost clearly identified. Do not interpret a simulated productive-hour charge as an invoice or automatically add it to a budget already containing that resource.

Resource tracking and usage help reveal when assignments occur and whether demand exceeds available capacity. Enter actual quantities or costs through the relevant existing controls when actual records are available. A blank actual is unknown; it is not proof of zero expenditure.

In earned-value reporting, BAC is budget at completion, PV is planned value, EV is earned value and AC is actual cost. SPI compares EV with PV; CPI compares EV with AC. Check the reporting date, progress basis, baseline and available actuals before interpreting these ratios. They describe delivery performance, not port-flow throughput.

### Risks and issues

Use **Risks** for uncertain events, their ratings and responses. Use **Issues & decisions** for current problems, changes and decisions. A crane outage scenario can provide evidence for a risk discussion, but its calculated cost difference is not automatically probability-weighted risk exposure.

For example, save the outage run, record its three-hour vessel impact and assumptions, and reference its run identifier in the relevant issue or risk notes. If a decision changes the delivery plan, capture the change in the delivery records as well.

### Delivery dashboards

Open **Reports → Delivery dashboards & reports** to use the existing Reporting & Controls module. Review its scope, reporting date, baseline and widget filters before drawing conclusions. Maritime saved-run reports and delivery dashboards answer different questions; make the chosen source explicit when presenting them together.

## 17 Use Poe with saved evidence

Open **Poe** from the shared sidebar after saving the working plan. For operations and safety questions, Poe has a project-scoped read-only tool that retrieves saved Maritime inputs, recent run references or the detailed results of a specified run.

The tool does not see unsaved form edits. Its recent-run list contains the latest 20 runs; the Reports interface lists up to 100. Give Poe the run identifier from a report when you want a particular older result or an unambiguous comparison.

Useful requests include:

- “Read this project's saved Maritime plan. Summarise vessel demand, crane capacity, truck capacity, yard storage and outbound gate capacity.”
- “For run [run identifier], explain the completion impact using its saved inputs. State the version and whether it differs from the current plan.”
- “Explain why this outage changes completion time but not total cost. Identify the cost assumptions in this run.”
- “Compare QC-01 and QC-02 in this saved run. Explain what the utilisation denominator includes.”
- “Review this saved safety attempt. Separate missed actions, wrong order and late responses.”
- “Identify the delivery resource and activity associated with QC-02. Explain what still needs review before changing the delivery programme.”

Ask Poe to distinguish calculated outputs from suggested experiments. It can explain a proposed truck-rate test, but you should save and run that test before treating the outcome as a project result. The Maritime evidence tool itself does not edit assets, run scenarios, control equipment or detect hazards. Existing planning tools may support separate planning actions; review their proposed changes in context.

For a reliable answer, expect a reference to the selected run or saved plan, its version, the relevant numbers and their units. If the answer conflicts with the report, return to the saved evidence and ask Poe to reconcile the difference. Avoid asking it to infer physical clearance or crane reach from an asset name.

Poe responses require the configured AI service to be available. If the provider reports unavailable credit or another service error, the deterministic scenario engine and saved reports can still be used. An AI explanation is supplementary; it does not replace running the calculation.

## 18 Export and present your findings

Open **Reports**, choose the intended saved run and confirm its name, input version and creation time. Results filters operations; Debrief filters safety; Reports can show both. The saved-run list currently exposes the latest 100 entries.

| Export control | Contents | Best use |
| --- | --- | --- |
| Download full report | JSON containing the saved run, inputs and results | Traceability, detailed review and preservation of assumptions |
| Export CSV for operations | Scenario time samples: elapsed hours, handled moves, yard stock, gate clearance, waiting vessels and operating cost | Spreadsheet analysis of the scenario series |
| Export CSV for safety | Recorded action names and seconds from start | Review of action timing |
| Print / save PDF | Browser print view of the displayed report | Readable meeting or review record |

The operations CSV does not contain both sides of the comparison or the full input plan. Use JSON for the complete baseline/scenario data. The safety CSV does not contain the full criteria or exercise definition. Use JSON or the printed debrief when those are needed.

A run export is not a full project backup: it does not include model files and the entire delivery database, and there is no Maritime run-JSON reimport command in this release. Keep original model and schedule files with your project records.

### A clear demonstration sequence

1. Show the project settings and say whether the data is synthetic or user-entered.
2. Open the imported terminal and select a mapped asset to establish the physical context.
3. Show the call's workload and the capacities that govern it.
4. Run or reopen the outage comparison and explain the completion difference and cost basis.
5. Conduct a short guided safety attempt at that asset and review the saved debrief.
6. Open the delivery schedule, demonstrate an assigned model sequence and compare the programme with its delivery baseline.
7. Finish with the saved reports and state which links currently identify related records versus calculate consequences automatically.

Use the same project and asset names across this demonstration. A realistic imported model helps explain the environment, but its visual detail does not make the operational assumptions more accurate. Keep those assumptions visible and defensible.

## 19 Work efficiently and avoid misleading results

### Build in a useful order

First prove one call with a small asset register. Then map geometry, add an availability scenario and confirm the saved results. Add multiple calls only after you understand the single-call result. Build a guided exercise around a mapped asset, then add the delivery schedule and its independent geometry assignments.

This order separates data problems from presentation problems. You can validate an operational calculation without waiting for a detailed model, and you can test a model sequence without implying a physical logistics simulation.

### Keep a trustworthy working plan

- Record the unit and source of each capacity in asset notes. State whether a truck rate represents one vehicle or a fleet.
- Save before running. Give scenarios meaningful names, such as “QC-02 outage 8h to 14h”, rather than “Test 3”.
- Change one assumption at a time when investigating a bottleneck. Keep the resulting run before changing another input.
- Check both vessel completion and terminal clearance. Gate capacity can matter after unloading finishes.
- Review all costs on a consistent basis and retain unknown actuals as unknown.
- Confirm important geometry links after replacing a model or duplicating a project.
- Finish active exercises before reloading the browser or editing the same project elsewhere.

### Use three repeatable learning experiments

**Outage experiment:** use the starter settings and compare the 22-hour working-plan vessel finish with the 25-hour outage finish. Explain the lost 180 moves of capacity.

**Bottleneck experiment:** change truck capacity from 90 to 20 moves/h. Both vessel finishes should become 62 hours. Restore the rate afterwards or retain a clearly named separate project for that assumption set.

**Cost experiment:** restore the original truck rate, then add a 50 GBP/h berth rate. Compare the 7,000 GBP working-plan total with the 7,150 GBP outage total in the full report. Explain that the added 150 GBP is an occupied-berth charge.

For delivery, use a separate small duration-change experiment against an assigned schedule baseline. For safety, deliberately record one late or out-of-order action and check that the debrief distinguishes it from a missed action. Keep training experiments separate from evidence you intend to present as a successful attempt.

## 20 Resolve common problems

### I cannot run or start an attempt

Check the header for unsaved changes and save first. A new working plan needs a saved version. Wait for any current request to finish. For operations, confirm a valid vessel call, yard, truck capacity and outbound gate exist. The call also needs a vessel, berth and at least one crane.

If Save fails, read the validation message. Common causes include empty names, a missing asset selection, no assigned crane, duplicate exercise action names, initial yard stock above capacity or a record whose type was changed after it was referenced elsewhere.

### The result did not change after I edited a rate

Check whether you are viewing an earlier saved run. Save the edit, run again and select the new result. If the new result is also unchanged, another capacity stage may be the bottleneck, the edited asset may not be assigned, or the outage may fall outside the useful operating interval.

### Completion is not reached or the yard stays full

Inspect remaining moves, gate-cleared quantities and yard stock. Check zero rates, unavailable equipment, missing free yard capacity and arrivals near the horizon. Increase the horizon only if the plan can eventually clear the cargo. A persistent zero outbound rate cannot be solved by a longer horizon alone.

### All scenarios contain the same maintenance delay

Scheduled work orders are part of the working plan and apply to both comparison sides. Use an availability scenario to isolate a proposed outage, or compare saved runs made before and after scheduling the order.

### The delay is real but cost impact is zero

Check the cost model. Productive crane, truck and gate charges can be unchanged when the same work is simply spread over longer elapsed time. Idle cost and demurrage are not assumed. A nonzero occupied-berth rate can make additional berth time visible in the calculation.

### An asset is mapped but nothing animates

Check which link you created. Asset geometry mapping supports selection and inspection. Delivery animation requires geometry-to-activity assignments and valid dates. Operational run replay currently shows quantities, not model motion. Rigged equipment also needs authored controls or keyframes.

### Select in model finds nothing

Wait for model restoration, check IFC Data versus 3D Data, and confirm the mapped file is loaded. Use Show All and Frame Selected. Replaced files or changed element references may need relinking. A duplicated project needs model import and remapping because those files are not copied.

### The profile looks wrong or an activity name is difficult to find

Check the active schedule and the element-link profile override before changing the activity-wide profile. Use the activity picker search and the existing layout controls to enlarge the table or panel. Test one element across its full activity dates before bulk editing.

### Undo seems to do nothing

If the cursor is inside a text input, Ctrl+Z operates on that text. Click outside or use the sidebar Undo button. Check whether a request is in progress or an exercise is active. Only ten recorded steps are retained, and a reload clears Maritime local edit history.

### I cannot save while training

Finish and save the active attempt, or discard it. The project keeps the exercise version stable while the attempt is active. If another browser tab changed the plan, resolve the conflict before starting again.

### The debrief says the order was followed but actions are missing

Order describes the relative sequence of the actions that were recorded. Read the missed-action count and criterion rows too. Completion, timing and order are separate checks.

### The dashboard and operations report show different figures

Check what each figure measures. Delivery budgets, PV, EV and AC are not operational productive-hour charges. Also check project, reporting date, schedule baseline, widget scope and saved-run version. A link between records does not make their metrics interchangeable.

### Poe cannot answer or reports stale data

Save the plan and specify the run identifier. Poe's Maritime evidence tool reads saved data. If the provider returns a service or credit error, use the report directly and retry when service is available. Do not substitute an assumed AI answer for a missing calculated run.

## 21 Know the current boundaries

The current platform supports persistent editable projects, imported models, asset mapping, deterministic flow comparisons, guided safety attempts and the existing delivery planning tools. Use that foundation for evidence you can inspect and reproduce.

The following approved capabilities still require further implementation. They should not be presented as controls already available in this release:

- Operational playback that physically moves equipment and cargo from calculated states.
- Transport routing, tide restrictions, operational shift calendars, arrival windows and user-defined call priorities in the flow solver.
- Spatial hazard volumes, automatic triggers, physical equipment-stop interactions and distinct system-event logs for exercises.
- Automatic calculated consequences between operations, safety and delivery, followed by reviewed adoption of changes.
- A separately managed operational baseline library and broader scenario parameter alternatives.
- Live AIS or IoT feeds, predictive maintenance, advanced physics, VR hardware integration and certified training.

The existing delivery viewer can already support authored animation, paths and rigging. Those presentation capabilities should be described separately from the operational solver's current capacity calculations.

### Practical limits

The current Maritime plan supports up to 250 assets, 100 vessel calls, 100 scenarios, 250 work orders and 100 exercises. A scenario can contain up to 100 restrictions. A call supports up to 20 cranes. An exercise supports 1 to 20 unique required actions and a response limit of 1 to 3,600 seconds.

The persisted working plan is limited to 2 MB, including its geometry references; this is separate from model-file storage. Use meaningful asset groupings instead of indiscriminately linking every model element. The displayed run history is limited to the latest 100 runs, so retain important exports as you work.

### Further reference

The maintained user guide is `docs/MARITIME_USER_GUIDE.md`. The approved target scope is `docs/MARITIME_SCOPE.md`; the implemented release and calculation contract are recorded in `docs/MARITIME_BUILD.md`. This guide describes the persistent-workspace milestone introduced by commit `a0e9722`.

## 22 Glossary

| Term | Meaning in this guide |
| --- | --- |
| 4D | Geometry shown against a schedule over time |
| 5D | Schedule and model information considered alongside costs |
| Asset mapping | References connecting a Maritime asset to model geometry |
| Cargo move | The consistent handling unit used by the operational calculation |
| Capacity bottleneck | The constraint currently limiting throughput |
| Elapsed hour | Continuous time measured from the simulation start |
| FIFO | First in, first out allocation by call arrival order |
| Horizon | Maximum elapsed duration evaluated in a run |
| Input version | Saved working-plan version captured by a run |
| Productive equivalent hour | Handled moves divided by the asset's configured full handling rate |
| Scenario | A saved set of availability restrictions evaluated against the working plan |
| Stale result | A valid saved result whose input version differs from the current plan |
| Terminal clearance | All vessel cargo unloaded and all yard stock cleared through gates |
| Utilisation in operations | Productive or occupied hours divided by elapsed run hours |
| Working calendar | Working-time rules used by the delivery schedule |
| WBS | Work breakdown structure used to organise delivery activities |
