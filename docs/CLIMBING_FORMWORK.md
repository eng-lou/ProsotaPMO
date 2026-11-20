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
