# Simple climbing formwork

Select the formwork GLB in 3D Site tools and open **Climbing formwork**.

1. Position the complete assembly at its first working elevation, then enable simple climb.
2. Confirm the vertical axis (normally Z for this project).
3. Open Add lifts from activities, select the core activities, enter typical lift height and climb duration, then add them in date order.
4. The first row has zero offset. Each subsequent row rises by the typical height, finishing at its activity start. The assembly holds between climbs.
5. Adjust individual heights or start/finish overrides as needed. Clear overrides to follow activity dates again. Use Preview working position to seek to a lift.

For irregular lifts, enter heights above the first position directly. Alternatively, capture the first core top elevation and then each selected core top; their difference becomes the lift offset. These are snapshots of geometry bounds, not live model links. Select only the relevant core lift geometry.

All parts move together, retaining the asset's existing placement, rotation and scale. The setup saves with the project. Playback and backward scrubbing compute positions directly from the current date. A route or attachment cannot own the same assembly while climbing is enabled.

Durations are elapsed schedule hours. Overlapping climb intervals are rejected. If later activity edits make the intervals invalid, the panel reports the error and the assembly returns to its initial placement until repaired. No hydraulic, panel-opening or anchoring cycle is simulated.

## Articulated core and placing boom

In 3D Site tools, open Asset library, expand **Core formwork with placing boom** and choose **Place core rig**. The same section has a downloadable GLB with a 12 x 8 m clear opening. It includes a three-metre example climb and a separate deployment clip. The web rig uses the actual lift heights entered in the project.

Existing placements of the original Prosota 12 x 8 m assembly can opt in through **Climbing formwork > Enable articulated core cycle**. Their placement, original material slots and lift rows are retained. Other assemblies can use the existing simple climb.

1. In **Add lifts from activities**, select one erection activity per lift. **Select matching generated core lifts** picks the matching formwork rows in the current search. For tower-generated rows the panel matches the climb, pour and strip phases by floor, parent and workstream. Each lift also has selectors for hand-built schedules or renamed activities.
2. The previous strip retracts the panels. During the climb the upper frame, mast and upper access flight rise first. The lower platforms follow, and the panels close during erection. A linked pour deploys the arm to its working pose, holds it and folds it at the end. These phase proportions are visualization settings.
3. Use the lift's **Preview climb progress** slider to seek through its actual scheduled window. In **Placing boom pose**, preview deployment (0 to 1) and slew, set a working pose, or key both at the playhead. Keys interpolate between dates. The boom stows during a scheduled climb.
4. A linked climb activity supplies its own start and finish. Otherwise the existing duration counts backwards from the erection activity start. Manual date overrides take precedence. Overlapping strip, climb and erection dates are flagged in the panel.

For a new generated tower programme, the advanced **Schedule a separate formwork climb between core lifts** option inserts one activity per transition and reserves the chosen working hours between the preceding strip and the next erection. It defaults off. Existing programmes can link an activity they already contain.

### Pour-driven boom animation

In **Placing boom pose**, enable **Sweep automatically during linked pours** and set the rig's start and finish angles. During each linked pour the boom unfolds and turns towards the start angle over the first 15%, sweeps to the finish angle over the middle 70%, then folds and returns to its resting heading over the last 15%. The working pose sets its reach.

To customise one lift, expand **Boom animation for this pour** inside the lift. Scrub **Pour progress** to a percentage, adjust the angle and click **Key slew**. Use **Key deployment** to control reach independently. The lift stores each key as a fraction of the elapsed interval between its pour's start and finish. Moving or resizing the activity moves the keys with it. Each keyed channel takes precedence for that lift's pour. Removing its last key restores the rig's usual movement.

**Fixed-date keys** still follow the project clock and supply both channels between climbs. A pour-relative key takes precedence for its own channel during that pour. An enabled automatic sweep takes precedence over fixed-date slew during linked pours. Every scheduled climb stows the boom.
