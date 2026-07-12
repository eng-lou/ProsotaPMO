// Which unit system the Spatial Decomposition list's storey elevations are
// shown in (2026-07-11, per Maro: "add a unit conversion toggle for people
// who prefer metric system") — local/per-browser only, same
// STORAGE_KEY+localStorage shape as hiddenNavPanels.ts. 'auto' (the
// default) matches whatever the loaded IFC project's own LENGTHUNIT turns
// out to be (see ifcModel.ts's getLengthUnitToMetres, verified against a
// real file); 'imperial'/'metric' override that with the viewer's own
// preference regardless of what unit the file itself declares.
export type IfcUnitDisplay = 'auto' | 'imperial' | 'metric'

const STORAGE_KEY = 'prosota_ifc_unit_display'

export function loadIfcUnitDisplay(): IfcUnitDisplay {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'imperial' || raw === 'metric' || raw === 'auto' ? raw : 'auto'
  } catch {
    return 'auto'
  }
}

export function saveIfcUnitDisplay(value: IfcUnitDisplay) {
  localStorage.setItem(STORAGE_KEY, value)
}

// Shared length-conversion math (2026-07-11, per Maro: "rewire units" —
// applying this same Auto/ft/m preference to TransformPanel's Location
// fields, not just IfcDataPanel's read-only storey elevations). Both
// consumers need the same "is this a foot-declaring project, and which way
// does the toggle override it" decision — kept here once rather than
// duplicated, so the two panels can't quietly disagree on where the 1ft
// tolerance or the override logic lives. toMetres === null throughout means
// "no declared unit known" (a plain mesh import, not an IFC model) — every
// function here is a no-op passthrough in that case, since there's nothing
// to convert *from*.
export function isFeetUnit(toMetres: number): boolean {
  return Math.abs(toMetres - 0.3048) < 0.001
}

function showFeet(toMetres: number, preference: IfcUnitDisplay): boolean {
  return preference === 'imperial' || (preference === 'auto' && isFeetUnit(toMetres))
}

// Raw model-space length (in the project's own declared unit) -> whatever
// number should sit in a display/edit field per the current preference.
export function toDisplayLength(raw: number, toMetres: number | null, preference: IfcUnitDisplay): number {
  if (toMetres === null) return raw
  const metres = raw * toMetres
  return showFeet(toMetres, preference) ? metres / 0.3048 : metres
}

// The exact inverse of toDisplayLength — what a user just typed (in
// whatever unit the field's own suffix currently claims) back to raw
// model-space, so it can be written straight onto object.position.
export function fromDisplayLength(display: number, toMetres: number | null, preference: IfcUnitDisplay): number {
  if (toMetres === null) return display
  const metres = showFeet(toMetres, preference) ? display * 0.3048 : display
  return metres / toMetres
}

export function lengthUnitSuffix(toMetres: number | null, preference: IfcUnitDisplay): string {
  if (toMetres === null) return 'm'
  return showFeet(toMetres, preference) ? 'ft' : 'm'
}
