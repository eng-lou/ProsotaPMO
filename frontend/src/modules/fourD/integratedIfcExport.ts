import { IfcAPI, IFC2X3, IFCPROJECT, IFCPRODUCT, IFCROOT, IFCSIUNIT, IFCCONVERSIONBASEDUNIT, IFCMONETARYUNIT, REF } from 'web-ifc'
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
  let schema = ''
  try {
    for (const [index, source] of sources.entries()) {
      progress(`Combining model ${index + 1} of ${sources.length}: ${source.name}`)
      const model = api.OpenModel(source.bytes)
      try {
        const sourceSchema = api.GetModelSchema(model).toUpperCase()
        if (!['IFC4', 'IFC2X3'].includes(sourceSchema)) throw new Error(`"${source.name}" uses ${sourceSchema}. Integrated export supports IFC2X3 and IFC4.`)
        if (index && sourceSchema !== schema) throw new Error('The source models mix IFC2X3 and IFC4. Combining different schemas requires conversion; use source models with the same schema.')
        schema = sourceSchema
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
            if (value.type === REF) {
              if (value.value === 0) return null // web-ifc's unset/derived handle
              const mapped = remap.get(value.value)
              if (mapped == null) throw new Error(`"${source.name}" contains a dangling IFC reference #${value.value}.`)
              value.value = mapped
              return value
            }
            // Preserve generated measure prototypes/accessors. Only handles
            // need remapping; the schema-aware writer restores derived '*'
            // attributes (e.g. IfcSIUnit), which raw copies would omit.
            return value
          }
          return value
        }
        for (let offset = 0; offset < lineIds.length; offset += 1000) {
          for (const id of lineIds.slice(offset, offset + 1000)) {
            if (index && id === projects[0]) continue
            if (!index && !changedGuids.has(id)) continue
            const line = api.GetLine(model, id)
            for (const key of Object.keys(line)) line[key] = rewrite(line[key])
            line.expressID = remap.get(id)!
            if (changedGuids.has(id)) line.GlobalId.value = changedGuids.get(id)
            try { api.WriteLine(destination, line) }
            catch (error) { throw new Error(`Unable to copy ${api.GetNameFromTypeCode(line.type)} #${id} from "${source.name}": ${error instanceof Error ? error.message : String(error)}`) }
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
      const currency = schema === 'IFC2X3' ? (IFC2X3.IfcCurrencyEnum as any)[data.currency]
        : api.CreateIfcType(destination, api.GetTypeCodeFromName('IFCLABEL'), data.currency)
      if (!currency) throw new Error(`Currency ${data.currency} is not supported by IFC2X3.`)
      const unit = api.CreateIfcEntity(destination, IFCMONETARYUNIT, currency)
      unit.expressID = ++maxId
      api.WriteLine(destination, unit)
      const rawUnits = api.GetRawLineData(destination, project.UnitsInContext.value)
      rawUnits.arguments[0].push({ type: REF, value: unit.expressID })
      api.WriteRawLineData(destination, rawUnits)
    }
    let timeUnitSeconds: number | undefined
    if (schema === 'IFC2X3') {
      // IFC2X3 uses numeric IfcTimeMeasure values in the project's time unit.
      // Preserve any existing unit (including conversion-based hours/days).
      const timeUnits = unitAssignment.Units.filter((h: any) => api.GetLine(destination, h.value).UnitType?.value === 'TIMEUNIT')
      if (timeUnits.length > 1) throw new Error('Source IFC contains multiple time units; resolve them before exporting.')
      const scale = (id: number, visited = new Set<number>()): number => {
        if (visited.has(id)) throw new Error('Cyclic IFC time unit definition.')
        visited.add(id)
        const unit = api.GetLine(destination, id)
        if (unit.type === IFCSIUNIT && unit.Name?.value === 'SECOND') {
          const prefixes: Record<string, number> = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: .1, CENTI: .01, MILLI: .001, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18 }
          return unit.Prefix ? prefixes[unit.Prefix.value] : 1
        }
        if (unit.type === IFCCONVERSIONBASEDUNIT) {
          const factor = api.GetLine(destination, unit.ConversionFactor.value)
          return Number(factor.ValueComponent.value) * scale(factor.UnitComponent.value, visited)
        }
        throw new Error('Unsupported IFC time unit; cannot safely export task durations.')
      }
      if (timeUnits.length) timeUnitSeconds = scale(timeUnits[0].value)
      else {
        const unit = api.CreateIfcEntity(destination, IFCSIUNIT, IFC2X3.IfcUnitEnum.TIMEUNIT, null, IFC2X3.IfcSIUnitName.SECOND)
        unit.expressID = ++maxId; api.WriteLine(destination, unit)
        const rawUnits = api.GetRawLineData(destination, project.UnitsInContext.value)
        rawUnits.arguments[0].push({ type: REF, value: unit.expressID }); api.WriteRawLineData(destination, rawUnits)
        timeUnitSeconds = 1
      }
      if (!Number.isFinite(timeUnitSeconds) || timeUnitSeconds! <= 0) throw new Error('Invalid IFC time unit scale.')
    }
    const planning = buildPlanningStep(data, projectId, maxId + 1, elements, guid, timeUnitSeconds)
    const original = new TextDecoder().decode(api.SaveModel(destination))
    const marker = original.lastIndexOf('ENDSEC;')
    if (marker < 0) throw new Error('Could not serialise the combined IFC.')
    const output = new TextEncoder().encode(original.slice(0, marker) + planning.step + '\n' + original.slice(marker))
    return { bytes: output, warnings: [...warnings, ...planning.warnings] }
  } finally {
    if (destination >= 0) api.CloseModel(destination)
  }
}
