# Prepared construction equipment — Preview.16 mechanism audit

The owner-testing collection is saved at
`D:\BIM Assets\Prosota Assets\Prosota Rigged Equipment\2026-10-30-mechanisms-v2`.
Open `catalogue.html` for the 26 entries, controls, posed/rest previews and matching
files. Each includes `*-Prosota.glb`, `*-equipment.json`, and `*-Rigged.blend`.
The source models are untouched. Base machines were prioritised; rubble and
separate loaded/folded/extended duplicates are not delivered as extra rigs.

The three KitBash additions are the portable concrete mixer and tower cranes A/B.
The mixer has wheel, tow-handle, tipping-yoke and drum controls. Both cranes have
slew, trolley and hoist controls, with moving rope endpoints and fixed masts.

## Using a prepared asset

1. Install the included Prosota Planner Preview 0.2.43-preview.16.
2. Import the prepared GLB through **3D Site tools**, category Construction equipment,
   and place it in the scene.
3. Select that placement. In **Rigging → Import preset onto this model**, import its
   matching equipment JSON, then **Save rig & keys**.
4. Use **Animate** to set/key controls. Save to the asset library for reusable copies.
   Whole-machine travel belongs on a path; mechanical parts use the rig controls.

The original static mesh cannot use the prepared preset directly because its part
hierarchy differs. Keep each prepared GLB and JSON together. Project soil timing
does not travel in reusable presets.

The 30 October collection supersedes the prepared 29 October files without
overwriting them or the owner's corrected Blender file. Import the revised GLB
and its matching JSON as a new asset to use the corrected part ownership.
Installing Preview.16 alone does not replace models already saved in projects.

## Mechanism follow-up and minor details

The follow-up checks the full collection again and updates ten sets. Together with
the earlier audit, sixteen of the 26 assets have corrections recorded in their
catalogue cards. The previous dated folders remain available.

- **Crawler crane:** rear U-shaped counterweights belong to the slewing upper
  structure; the carbody ballast remains fixed.
- **Forklift:** chain runs, anchors and sheave follow the inner mast stage together.
  The repaired chain remains visible. Independent free-lift and physical chain
  reeving are outside this simplified authored mast.
- **Rotary drill:** the control now reads **Drill depth / retract (0 = down, 1 = up)**.
  It provides 3.8 m of feed, with the tool tip about 2.2 m below the machine's ground
  plane at full depth. The upper collar stays above the guide and the tool below
  the drive. The hoist swivel follows feed but does not rotate with the Kelly bar.
  Telescopic Kelly stages, crowd travel, transport folding and soil removal are
  not implemented.
- **SM tower crane and KitBash crane A:** access ladders are visible at rest and
  hidden beyond 0.5 degrees of slew, returning when the control returns to rest.
  This follows the owner's accepted fallback for minor conflicting details; it
  is a visual omission, not an invented ladder-retraction mechanism. Fixed landing
  guards stay on the mast. Counterweights remain visible and move correctly.
- **Track loader / wheel loader:** hydraulic port blocks, flanges and fittings
  belong to the appropriate cylinder barrels.
- **Steam roller:** rear articulation fasteners stay with their chassis attachment.
- **Both dump trucks:** body and tailgate branding follow their respective parts.

Optional `motion_details` rules reference one node and driving joint with a small
rest-clearance threshold. Hinge thresholds are degrees and slide thresholds are
metres. They apply consistently to live playback, seeking, setup previews and
sampled exports, and restore visibility on disposal. Already hidden parts remain
hidden. Preset import remaps their paths and scales slide thresholds. In Blender,
an empty-group Mask modifier hides the detail geometry while retaining dependency
evaluation; directly driving object viewport visibility suppresses that evaluation.

## Mechanical references

The references inform the mechanism, rather than implying that these generic
meshes match a manufacturer's exact machine:

- [Toyota: mast chains](https://www.toyotaforklift.com/resource-library/blog/parts-and-service/mast-chains-purpose-and-maintenance)
  for chain, sheave and carriage relationships.
- [Liebherr: Kelly drilling](https://www.liebherr.com/en-us/deep-foundation/methods/drilling/kelly-drilling-4424937)
  and [Bauer drilling equipment](https://www.bauer.de/en/media/2035/download?inline=)
  for separation of the rotary drive, Kelly bar and drilling tool.
- [Manitowoc crawler-crane reference](https://www.manitowoc.com/media/525/download)
  for carbody versus upperworks counterweight arrangements.
- [ACT tower-crane guidance](https://www.legislation.act.gov.au/DownloadFile/ni/2025-173/current/PDF/2025-173.PDF),
  printed page 52, describes an upper ladder striking an internal guardrail during
  slew. The model therefore uses explicit detail omission instead of assuming all
  access ladders retract.
- [Wirtgen asphalt paving](https://www.wirtgen-group.com/en-gb/applications/road-construction/new-road-construction/asphalt-paving/),
  [Caterpillar grader controls](https://www.cat.com/en_US/articles/for-owners/the-basics-of-motor-grader-lever-controls.html)
  and [Genie telehandler manual](https://manuals.genielift.com/operators/english/57.0009.0808_52.pdf)
  informed the other control and limitation checks.

## 30 October audit corrections

All 26 rigs were checked at rest, individual control extremes and intermediate
poses, plus combined control samples. The earlier Preview.15 pass corrected eleven
assets, before the mechanism follow-up above:

- Tower crane: counterweights now belong to the slewing assembly.
- KitBash cranes: corrected fixed brace ownership and complete trolley carriage,
  fittings and outer hoist falls.
- Mobile crane: complete hook assembly and two-stage outrigger movement.
- Crawler crane: fixed track/deck details and independently following boom stops.
- Luffing tower crane: fixed crown, deck and cab details remain on the slew body;
  the complete lower cable loop follows the hook.
- Concrete pump: pipe geometry split at the hinged section boundary; turntable
  fittings follow the turret.
- American mixer truck: cab trim no longer rotates with the wheel.
- Asphalt paver: auger shaft travels with the screed assembly.
- Rotary drill: upper floor follows the slewing body.
- Wheel loader: headlight lenses follow their articulated housings; upper bucket
  pins follow the bucket rather than the lift arm.

Blender piston parenting also preserves the rest inverse of its aiming frame.
The catalogue's audit notes describe the changes per asset.

In Blender, select the named machine root and adjust its 0–1 custom properties.
Joint drivers, piston constraints and weighted hose deformation are in the Blend
file. The source reference is hidden. Exporting a GLB does not export Blender
drivers; Prosota still needs its matching equipment definition.

## Scope

- Dump trucks have a calibrated preloaded body with soil, sand, gravel and rocks;
  see [Soil simulation](SOIL_SIMULATION.md). Receiving a live load from another
  excavator is not implemented.
- Tracks remain rigid. The motor grader has wheel/steering/moldboard-angle controls,
  not drawbar lift, wheel lean or frame articulation.
- The telehandler fork carriage keeps its authored angle relative to the boom.
  Bobcat lift follows a simplified arc rather than a manufacturer-specific mechanism.
- Cranes provide visual rope deformation, without sway, collision or load-chart
  simulation. Pump/mixer concrete flow is not simulated.
- Each catalogue entry states its supported controls and restrictions. Inspect the
  intended cycle for collisions rather than treating sampled rig tests as a physical
  validation of every possible pose.

## Implementation and verification

Preparation scripts and recipes are under `outputs/equipment-library`. Inspection
uses connected components, face-level splits where strokes were welded to barrels,
mechanical hinge centres, linkage response curves and explicit accessory ownership.
The number of source/output faces is identical for every asset, with original UVs,
material assignments and normals retained.

Prosota checks use its actual parser, part-path remapper and rig evaluator. All 26
pass preset import, sampled finite transforms and exact rest restoration. Blender
checks compare independent control poses against expected joint matrices and verify
rigid follower endpoints. These do not establish collision-free motion everywhere.

The runtime supports dependent followers in topological order, preserves follower
mount roll, and deforms authored hose curves in owned geometry buffers. Disposal
restores geometry and bounds. Backend validation rejects follower cycles and invalid
curves. Aggregate settings are optional with backward-compatible defaults.

The delivered manifest records sizes and SHA-256 hashes. This is a local Preview
delivery; no Stable or web release was published.

Preview.16 validation includes 30 focused frontend rig/Simulator tests, nine isolated
equipment API tests, TypeScript compilation, per-asset Blender/Prosota checks and
targeted ownership/travel/stop regressions. Each asset includes `mechanism-checks.json`.
