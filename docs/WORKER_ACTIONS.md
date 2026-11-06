# Construction worker actions and attachments

Preview 0.2.43-preview.15 includes timed imported motions and editable attachments to ordinary
3D site objects. These use the existing animation timeline, routes and equipment
rigs. This is the first worker-action workflow; automatic crowd navigation,
gamepad driving, automatic hand/foot contact and a general interaction planner
are not included.

## Import a worker and its motions

1. Import and place the worker through **3D Site tools**.
2. Select the placed worker. Under **Asset animation → Import motion FBX**, select
   one or several motion FBXs. Existing clips are retained and the new clips are
   appended. The character's materials and placement stay intact.
3. Choose the normal clip: an in-place walk for a worker following a route, or
   standing idle for a stationary worker.

Compatible Character Creator/ActorCore skeleton variations are adapted during
import. The supplied construction pack and male/female iClone walk/idle files do
not require a separate manual retargeting step. Import still checks matching bone
names and parents; unrelated skeletons are not silently accepted. Facial morph
tracks are omitted when importing these body motions, with a notice. Character
face geometry and materials remain unchanged.

An iClone motion's starting horizontal scene offset is removed for these compatible
CC rigs, while its subsequent travel and vertical movement are retained. Use
in-place motions when the Prosota route should supply movement; a travelling work
clip can otherwise move the body away from the route.

## Walk, stop and work

1. Bind the worker to a route in **Paths** and set its travel timing.
2. In **3D Site tools**, select the worker and find **Construction actions &
   attachments**. Click **+ Timed action at playhead / after last**.
3. Name the action, choose the work clip, then set **Start** and **Finish**.
   These inputs use the timeline's Date, Seconds or Frames display. The duration
   underneath is expressed in playback seconds at the current timeline speed.
4. Use **See action** to inspect its middle pose. Enable **Repeat motion for this
   action** for a suitable looping work motion. Otherwise it plays once and holds
   its final pose until the action ends. **Motion pace & transition** controls
   speed and blending with the normal clip.
5. Click **Add route stop for this action**. The worker stays at the route position
   reached when the action starts, works until it finishes, and then continues.

Example: walk from 0–2 seconds, drill from 2–7 seconds, then continue walking. The
stop adds equal route-progress keys at 2 and 7 seconds and moves subsequent route
keys five seconds later. Other work actions and equipment keys keep their times;
review them after changing route timing. Removing a work action does not remove
its route stop automatically. Edit the route keys in Paths when changing the stop.

Actions for the same worker cannot overlap. The normal clip resumes between
actions. A route pause freezes a route-paced walk; add a timed idle action if you
want standing idle movement during another pause. A motion that is not authored as
a loop can jump when repeated.

## Attach a tool or an operator

1. Place the tool and select it. Expand **Attach this object to a worker or
   machine**, then click **Set attachment**.
2. Choose the worker under **Follow object**, then click **Use right hand** or
   **Use left hand**. For other anchors, select the named bone or equipment part under
   **Attach to**. Choose a hand for a held tool, rather than the waist.
3. Choose the corresponding action under **Use action timing**, or enter the
   attach/release times yourself.
4. Click **Move attached tool** or **Rotate attached tool**, then drag the viewport
   gizmo to fit the tool to the grip. These buttons seek into the attachment's
   active interval. Dragging saves the attachment offset; the animation no longer
   snaps the tool back each frame. Use **Offset X/Y/Z (m)** and **Turn X/Y/Z (°)**
   for precise adjustments in the selected anchor's axes. The world-space gizmo
   and these local offsets describe the same placement.
   The motion must already provide an appropriate hand posture; attachment does
   not reposition both hands or solve contact automatically.
5. Enable **Show only while attached** if the tool should disappear outside the
   work interval. Otherwise it returns to its original site placement outside it.

For an operator, select the worker as the attached object and choose the machine's
cab/upper-body part as the parent anchor. Use an appropriate seated operating
motion and adjust the seat offset. The equipment's path and rig carry the worker;
the worker's timed motions still animate. Remove the worker's own path binding
before attaching it. This does not automatically animate climbing into the cab.

Use Simulator element handling for delivery → carrying → final placement. A
single timed attachment returns to the original placement rather than leaving the
object at the release point. Missing or ambiguous anchor names are reported;
an object with an unresolved anchor retains its original placement.

## Saving and replacement

Changes in this panel save immediately. Closing the panel, reopening the scene,
and scrubbing backwards preserve the saved action and attachment definitions.
Gizmo edits during attachment preserve the object's original site placement for
use outside the attachment interval. Simulator element handling takes precedence
while it owns the object's pose; attachment playback resumes afterwards.
Detach children before deleting their parent. Replacing an asset clears its
incompatible actions/attachments; replacing a parent with a different asset also
clears child attachments that referred to its old bones or parts. Re-importing
additional clips appends them, so existing action clip indices stay valid.

## Validation with the supplied assets

- All 139 construction motion files passed import compatibility against all 15
  supplied workers (2,085 combinations). This checks skeleton mapping, not a manual
  visual review of every motion on every worker.
- Prepared male M-0026 and female F-0012 examples with idle, walk, drill-floor and
  excavator-operation clips; reviewed the actual rendered poses.
- Actual React/Three scene test checked a route pause, animated hand attachment,
  real gizmo translation and rotation, persisted grip offsets, original placement,
  panel closure, scene serialization/reopen, reverse scrubbing and Frames inputs.
- Unit checks cover compatibility, root placement, timed actions, routes and
  attachment validation. The installer smoke test also checks backend persistence.

Local prepared examples are in `outputs/worker-actions/ready/`. Purchased source
assets remain untouched and are not included in the installer or published.
