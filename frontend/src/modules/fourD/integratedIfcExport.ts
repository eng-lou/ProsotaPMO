import { IfcAPI, IFCPROJECT, IFCPRODUCT, IFCROOT, IFCMONETARYUNIT, IFCREAL, LABEL, REAL, REF, type RawLineData } from 'web-ifc'
import { buildPlanningStep, type IntegratedIfcData } from './integratedIfcData'

export interface IfcExportSource { name: string; bytes: Uint8Array }

// Work on private WASM models, never the live viewport's handles. This module is
// loaded exclusively by the export worker (and by Node integration tests).
export async function exportIntegratedIfc(api: IfcAPI, sources: IfcExportSource[], data: IntegratedIfcData,
  progress: (message: string) => void = () => {}) {
  if (!sources.length) throw new Error('There are no saved IFC models to export.')
  if (!/^[A-Z]{3}$/.test(data.currency)) throw new Error('Choose a three-letter currency code before exporting.')
  const ids = (model: number, type: number, derived = false) => {
    const v = api.GetLineIDsWithType(model, type, derived)
    return Array.from({ length: v.size() }, (_, i) => v.get(i))
  }
  const all = (model: number) => {
    const v = api.GetAllLines(model)
    return Array.from({ length: v.size() }, (_, i) => v.get(i))
  }
  const guid = () => api.CreateIFCGloballyUniqueId(destination).value as string
  let destination = -1, projectId = -1, maxId = 0
  const elements = new Map<string, number>()
  const seenRoots = new Set<string>()
  const linked = new Set(data.links.filter(l => l.source_kind === 'ifc').map(l => l.element_ref))
  const warnings: string[] = []
  // Unit definitions are compared recursively, not by EXPRESS ID (local to each
  // file). Refuse mixed units instead of silently stretching a discipline model.
  const canonical = (model: number, value: any): any => {
    if (Array.isArray(value)) return value.map(v => canonical(model, v))
    if (value && typeof value === 'object') {
      if (value.type === REF) {
        const line = api.GetRawLineData(model, value.value)
        return { type: line.type, arguments: canonical(model, line.arguments) }
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canonical(model, v)]))
    }
    return value
  }
  const units = (model: number, p: any) => {
    if (!p.UnitsInContext) throw new Error('Source IFC has no project units.')
    const u = api.GetLine(model, p.UnitsInContext.value)
    return u.Units.filter((h: any) => api.GetRawLineData(model, h.value).type !== IFCMONETARYUNIT)
      .map((h: any) => JSON.stringify(canonical(model, h))).sort().join('|')
  }
  let expectedUnits = ''
  try {
    for (const [index, source] of sources.entries()) {
      progress(`Combining model ${index + 1} of ${sources.length}: ${source.name}`)
      const model = api.OpenModel(source.bytes)
      try {
        if (api.GetModelSchema(model).toUpperCase() !== 'IFC4') throw new Error(`"${source.name}" uses ${api.GetModelSchema(model)}. Integrated export currently requires IFC4 source files; export this model as IFC4 from its authoring tool.`)
        const projects = ids(model, IFCPROJECT)
        if (projects.length !== 1) throw new Error(`"${source.name}" must contain exactly one IfcProject.`)
        const p = api.GetLine(model, projects[0])
        const signature = units(model, p)
        const sourceUnits = api.GetLine(model, p.UnitsInContext.value)
        if (sourceUnits.Units.some((h: any) => api.GetRawLineData(model, h.value).type === IFCMONETARYUNIT && api.GetLine(model, h.value).Currency.value !== data.currency)) {
          throw new Error(`"${source.name}" has a different currency from the export. This exporter does not convert money.`)
        }
        if (index && signature !== expectedUnits) throw new Error(`"${source.name}" uses different project units. Convert the source models to matching units before combining them.`)
        const lineIds = all(model)
        const remap = new Map<number, number>()
        if (!index) {
          destination = model; projectId = projects[0]; expectedUnits = signature
          for (const id of lineIds) { remap.set(id, id); maxId = Math.max(maxId, id) }
        } else {
          for (const id of lineIds) remap.set(id, id === projects[0] ? projectId : ++maxId)
        }
        const changedGuids = new Map<number, string>()
        for (const id of ids(model, IFCROOT, true)) {
          if (index && id === projects[0]) continue
          const g = api.GetLine(model, id).GlobalId?.value as string | undefined
          if (!g) continue
          if (seenRoots.has(g)) {
            if (linked.has(g)) throw new Error(`Duplicate linked IFC GlobalId ${g} in "${source.name}". Its activity links are ambiguous; resolve the duplicate source elements before export.`)
            const replacement = guid()
            changedGuids.set(id, replacement); seenRoots.add(replacement)
          } else seenRoots.add(g)
        }
        if (changedGuids.size) warnings.push(`${source.name}: regenerated ${changedGuids.size} duplicate, unlinked IFC identifiers to keep the combined model valid.`)
        for (const id of ids(model, IFCPRODUCT, true)) {
          const g = api.GetLine(model, id).GlobalId?.value as string | undefined
          if (g && !changedGuids.has(id)) elements.set(g, remap.get(id)!)
        }
        const rewrite = (value: any): any => {
          if (Array.isArray(value)) return value.map(rewrite)
          if (value && typeof value === 'object') {
            // web-ifc reads REAL tokens as strings, but its writer requires
            // the generated measure object's numeric accessors.
            if (value.type === REAL) return api.CreateIfcType(destination, IFCREAL, Number(value.value))
            if (value.type === LABEL && value.typecode) {
              const typed = api.CreateIfcType(destination, value.typecode, value.value)
              const key = typed.type === REAL ? 'internalValue' : 'value'
              return { [key]: typed[key], valueType: typed.type, type: LABEL, label: typed.name }
            }
            if (value.type === REF) {
              const mapped = remap.get(value.value)
              if (mapped == null) throw new Error(`"${source.name}" contains a dangling IFC reference #${value.value}.`)
              return { ...value, value: mapped }
            }
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]))
          }
          return value
        }
        for (let offset = 0; offset < lineIds.length; offset += 1000) {
          const batch: RawLineData[] = []
          for (const id of lineIds.slice(offset, offset + 1000)) {
            if (index && id === projects[0]) continue
            if (!index && !changedGuids.has(id)) continue
            const raw = api.GetRawLineData(model, id)
            const args = rewrite(raw.arguments)
            if (changedGuids.has(id)) args[0] = { ...args[0], value: changedGuids.get(id) }
            batch.push({ ...raw, ID: remap.get(id)!, arguments: args })
          }
          for (const line of batch) {
            try { api.WriteRawLineData(destination, line) }
            catch { throw new Error(`Unable to copy ${api.GetNameFromTypeCode(line.type)} #${line.ID} from "${source.name}".`) }
          }
        }
        if (index) {
          const master = api.GetRawLineData(destination, projectId)
          master.arguments[7] = [...(master.arguments[7] ?? []), ...(p.RepresentationContexts ?? []).map((h: any) => ({ type: REF, value: remap.get(h.value) }))]
          api.WriteRawLineData(destination, master)
        }
      } finally {
        if (model !== destination) api.CloseModel(model)
      }
    }
    progress('Embedding schedule, resources and cost plan…')
    const project = api.GetLine(destination, projectId)
    const unitAssignment = api.GetLine(destination, project.UnitsInContext.value)
    const currencies = unitAssignment.Units.filter((h: any) => api.GetRawLineData(destination, h.value).type === IFCMONETARYUNIT)
    if (currencies.some((h: any) => api.GetLine(destination, h.value).Currency.value !== data.currency)) {
      throw new Error('The source IFC currency differs from the export currency. Select the source currency; this exporter does not convert money.')
    }
    if (!currencies.length) {
      const unit = api.CreateIfcEntity(destination, IFCMONETARYUNIT, api.CreateIfcType(destination, api.GetTypeCodeFromName('IFCLABEL'), data.currency))
      unit.expressID = ++maxId
      api.WriteLine(destination, unit)
      const rawUnits = api.GetRawLineData(destination, project.UnitsInContext.value)
      rawUnits.arguments[0].push({ type: REF, value: unit.expressID })
      api.WriteRawLineData(destination, rawUnits)
    }
    const planning = buildPlanningStep(data, projectId, maxId + 1, elements, guid)
    const original = new TextDecoder().decode(api.SaveModel(destination))
    const marker = original.lastIndexOf('ENDSEC;')
    if (marker < 0) throw new Error('Could not serialise the combined IFC.')
    const output = new TextEncoder().encode(original.slice(0, marker) + planning.step + '\n' + original.slice(marker))
    return { bytes: output, warnings: [...warnings, ...planning.warnings] }
  } finally {
    if (destination >= 0) api.CloseModel(destination)
  }
}
