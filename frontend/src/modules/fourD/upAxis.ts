// Blender-vs-three.js axis convention (2026-07-08, per Maro: "in our tool
// the axis differs from blender. y is up instead of z. which makes it
// confusing for me. so swap y and z"). three.js/GLTF/OBJ/FBX are natively
// Y-up; Blender (and this project's site-planning mental model) is Z-up.
// Rather than re-author every imported object's own geometry, Viewport3D.tsx
// visually rotates the whole scene's content (grid + imported objects) +90
// degrees about X so Y-up content renders Z-up on screen (see that file's
// own header for why that rotation is enough on its own) — this module is
// the matching remap for number fields (TransformPanel, and later
// ElementKeyframe's stored values, which are documented as "whatever
// TransformPanel would show"), so what the user types into the "Z" box is
// the height they see, not a raw and still-Y-up three.js value.
//
// Only Y and Z ever swap — X is untouched either way. Position/rotation
// have a direction, so the swap carries a sign flip (it's a 90-degree axis
// permutation, not a mirror): display = (x, -z, y), local = (x, z, -y).
// Scale has no direction, so it's a plain swap with no sign either way.
export type UpAxis = 'y' | 'z'
export type TransformAxis = 'x' | 'y' | 'z'

// Given a Blender-style display field (X/Y/Z as shown in the UI) and the
// current up-axis setting, resolves which underlying three.js local axis
// to actually read/write and what sign to apply. Self-inverse: the same
// {localAxis, sign} pair converts local->display (value = sign * local[axis])
// and display->local (local[axis] = sign * value), since sign is +-1.
export function resolveDisplayAxis(
  field: TransformAxis,
  upAxis: UpAxis,
  kind: 'position' | 'rotation' | 'scale',
): { localAxis: TransformAxis; sign: 1 | -1 } {
  if (upAxis === 'y' || field === 'x') return { localAxis: field, sign: 1 }
  const flip = kind !== 'scale'
  return field === 'y' ? { localAxis: 'z', sign: flip ? -1 : 1 } : { localAxis: 'y', sign: 1 }
}

// What content actually needs the Y<->Z display correction, and what
// doesn't. Originally guessed purely from file kind (mesh=Y-up, ifc=Z-up)
// but real files don't reliably follow either convention — export settings,
// authoring tool, and per-project habits all vary — so a fixed per-kind rule
// kept getting real imports wrong (2026-07-08, per Maro: "objects are still
// being imported in a wrong axis"). Now a per-object property instead,
// chosen explicitly at import time (ImportModelDialog.tsx) with the old
// per-kind guess only used as that dialog's *default* selection — never onto
// the object TransformPanel/gizmo/keyframes actually edit (a wrapper group
// around it instead, same as before). Grid is always 'y' — it's our own
// geometry, not anything imported.
export function axisCorrectionRotation(sourceUpAxis: UpAxis, displayUpAxis: UpAxis): [number, number, number] {
  if (sourceUpAxis === displayUpAxis) return [0, 0, 0]
  return displayUpAxis === 'z' ? [Math.PI / 2, 0, 0] : [-Math.PI / 2, 0, 0]
}

// ImportModelDialog.tsx's default suggestion — not a hardcoded rule (see
// axisCorrectionRotation's own header), just a starting point the user can
// override per-file before confirming import. Used to guess 'z' for IFC
// ("IFC is Z-up per spec") vs 'y' for mesh imports, but real IFC files
// empirically come back Y-up-native from web-ifc's own geometry extraction
// just as often (2026-07-08, per Maro's own test file: default 'z' — net
// zero correction against a Z-up display — left it lying on its side;
// manually forcing +90 on Rotation X was what actually fixed it, meaning the
// raw data was Y-up all along) — so both kinds now default to the same
// guess, 'y', until there's a more reliable signal than "kind" to go on.
export function defaultSourceUpAxis(_kind: 'ifc' | 'mesh'): UpAxis {
  return 'y'
}
