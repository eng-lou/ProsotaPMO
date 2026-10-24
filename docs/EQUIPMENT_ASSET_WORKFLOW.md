# Equipment assets, assemblies and paths

Use **Import 3D** for GLB/glTF, FBX or OBJ and companion files. Selecting multiple
model files creates one assembly asset, retaining named parts and their authored
relative positions. Empty helper nodes are retained with the hierarchy. Choose
units/up axis for the whole set (Automatic uses each file's metadata), name the
assembly, review it and import. No per-part recentering is performed.

Place the asset, then open **Rigging** and select the placed machine. Select parts,
create moving groups, set pivots, parent relationships and controls, and save the
rig. Rigid equipment controls require an import without embedded animation;
animated characters continue using their embedded clips and path playback.

**Save rig to asset library** stores the rig template against the library asset and
sets its category to **Construction equipment**. New copies inherit that template.
Copies have separate poses. Saving an individual copy's rig creates an instance
override; template updates affect copies without overrides. Templates are saved
within the project's library. Part references use stable hierarchy paths, and site
instances use their IDs rather than display names.

Existing separately placed imports can be combined through **Assemble separate
imports**. This saves an assembly into the same library at its current pose and
retains hidden input backups. Configure the assembled copy's rig afterward;
individual input rigs/animations are not merged into a new rig automatically.

Bind the placed machine to a path using the normal Paths panel. The path moves
and turns the whole machine; rig controls/keyframes articulate its child parts.
These transforms are independent. Equipment playback uses the same actor clock
as path travel during camera previews. Set sensible travel speed and heading in
the path controls. Wheel rotation is not inferred from geometry: configure its
rig control/keyframes (or use an existing embedded wheel animation).

The 77-file backhoe regression uses the user's actual GLBs and a test hinge. It
verifies preserved parts, articulation, path movement, independent copies and
library rig reload. It does not automatically author a mechanically complete
backhoe rig or calibrate all hydraulic cylinders.
