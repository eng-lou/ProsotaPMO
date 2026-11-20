# Original Prosota rolling deck — corrected rig v3

Uses the original model from D:\BIM Assets\Prosota Assets\Formwork\prosota-rolling-deck. That source folder is untouched. All 7,980 original faces and their material assignments are preserved at the original assembled rest pose.

## Import for delivery and assembly
1. Import Prosota_Rolling_Deck_Rigged.glb into Prosota. Keep the hierarchy intact; standard GLB Y up, metres.
2. Create an equipment rig for the placement.
3. Import Prosota_Rolling_Deck-Transport-equipment.json and Save rig & keys. This starts the editable model PACKED, with all controls at zero. Use the ordinary equipment JSON instead to start assembled.
4. Author your own keys. No delivery route or installation timeline is imposed.

Both presets target the SAME Rigged.glb. Do not use them on the old v2 asset or on the baked Transport_REFERENCE.glb. Replace the old placement with a fresh v3 placement to avoid stale node bindings.

## Controls
- Roll deck out: 0 retracted, 1 extended 3 m.
- Four independent screw adjustment controls: 0 lowered, 1 original height. Each turns the collar AND handle while translating the complete threaded spindle, thread rings and head together through 0.12 m. The upright sleeve and foot remain fixed. This replaces the incorrect 0.6 m head-only movement.
- Four prop deployed controls: 0 stowed horizontally, 1 installed upright. Each lifts the prop clear, lays it down and shifts it into its packing row. The screw and collar remain children of that prop.
- Two brace deployed controls: 0 laid down, 1 original braced position.
- Three barrier upright controls: front, left and right. 0 packed inward, 1 original upright position. Side panels include stacking clearance above the front panel.

## Sequence to author
For packing: retract tray; lower screw adjustment; lay down braces; lower front panel; lower side panels; stow props. For assembly, reverse this order. Do not animate every control simultaneously: the ordered sequence clears adjacent parts.

The original asset has solid panels and no modeled folding hinges or removable fastening details. These are visual disassembly/stowing controls using the original geometry, not a verified Cantideck hinge mechanism. Screw pitch is illustrative, derived from the modeled ring spacing. This kit is for animation, not installation instructions or temporary-works design.

## Files
- Rigged.glb: editable articulated original model.
- Rigged.blend: editable Blender source with mechanically grouped parts.
- equipment.json: assembled-start Prosota preset.
- Transport-equipment.json: packed-start Prosota preset; same original rest coordinates, values set to zero.
- Transport_REFERENCE.glb: baked packed geometry for inspection/static delivery scenes ONLY; no equipment preset required.
- geometry-validation.json: original geometry preservation and component grouping evidence.
- transport-settings.json: readable control values for packing.

## Slings and attach/release
The load-transfer tools are implemented locally but are NOT yet deployed. They capture world-preserving attachment/release events and procedural sling legs. Named LiftEye_1..4 points are animation references at existing tie-down features, not certified lifting eyes. Configure the intended lift pose before capturing sling points. Use named lifting eyes now saves live node bindings: endpoints follow articulated tray motion automatically. Manual points remain load-local. Missing or ambiguous named eyes hide the affected leg rather than drawing it at a stale position. Earlier carrier-motion changes require recapturing subsequent handovers.

## Validation
Original-rest geometry/material fingerprints match. All four screw groups include the upper tube, head and twelve rings; each collar group includes its handle. Actual Prosota rig evaluation checked rotation, 0.12 m screw travel, finite intermediate control poses and restoration of rest matrices. Assembled, lowered-screw, panel-packed and fully packed states were rendered in Chromium and visually inspected. This is not an automated collision certification of every combined control path.
