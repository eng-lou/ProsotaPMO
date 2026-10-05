import type { Activity, ActivityRelationship, Calendar, CalendarBreak, CalendarException, Resource, ResourceAssignment } from '../scheduling/types'
import type { CostElement } from '../costs/types'
import type { ModelElementLink } from './modelElementLinks'

export interface IntegratedIfcData {
  project: { id: string; name: string }
  schedulePeriodId: string
  costPeriodId: string
  currency: string
  exportedAt: string
  activities: Activity[]
  relationships: ActivityRelationship[]
  resources: Resource[]
  assignments: ResourceAssignment[]
  calendars: Calendar[]
  breaks: CalendarBreak[]
  exceptions: CalendarException[]
  costs: CostElement[]
  links: ModelElementLink[]
}

// STEP strings are ASCII with UTF-16 escape sequences. Never interpolate user
// content as STEP syntax (names can contain quotes, backslashes and newlines).
export function stepText(value: unknown): string {
  if (value == null) return '$'
  let result = ''
  for (const char of String(value)) {
    const n = char.codePointAt(0)!
    result += n > 0xFFFF ? `\\X4\\${n.toString(16).padStart(8, '0').toUpperCase()}\\X0\\` : char === "'" ? "''" : n < 32 || n > 126 || char === '\\'
      ? `\\X2\\${n.toString(16).padStart(4, '0').toUpperCase()}\\X0\\` : char
  }
  return `'${result}'`
}
const list = (values: string[]) => values.length ? `(${values.join(',')})` : '$'
const real = (value: unknown) => {
  if (value == null || value === '') return '$'
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric export value: ${value}`)
  return Number.isInteger(n) ? `${n}.` : String(n)
}
const duration = (hours: number | null) => hours == null ? '$' : stepText(`${hours < 0 ? '-' : ''}PT${Math.abs(hours)}H`)
const dateTime = (value: string | null) => stepText(value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
const bool = (value: boolean | null) => value == null ? '$' : value ? '.T.' : '.F.'

/** Native IFC4/IFC2X3 planning entities, plus named Prosota property sets retaining
 * fields that have no direct IFC equivalent. Original geometry is untouched. */
export function buildPlanningStep(data: IntegratedIfcData, projectId: number, firstId: number,
  elements: Map<string, number>, guid: () => string, legacyTimeUnitSeconds?: number) {
  const legacy = legacyTimeUnitSeconds !== undefined
  const measure = (hours: unknown) => hours == null ? '$' : real(Number(hours) * 3600 / legacyTimeUnitSeconds!)
  let next = firstId
  const lines: string[] = []
  const warnings: string[] = []
  const add = (type: string, ...args: string[]) => {
    const id = `#${next++}`
    lines.push(`${id}=${type}(${args.join(',')});`)
    return id
  }
  let owner = '$'
  if (legacy) {
    const person = add('IFCPERSON', '$', '$', stepText('Prosota user'), '$', '$', '$', '$', '$')
    const org = add('IFCORGANIZATION', '$', stepText('Prosota'), '$', '$', '$')
    const user = add('IFCPERSONANDORGANIZATION', person, org, '$')
    const app = add('IFCAPPLICATION', org, stepText('1'), stepText('Prosota integrated export'), stepText('Prosota'))
    owner = add('IFCOWNERHISTORY', user, app, '$', '.ADDED.', '$', '$', '$', String(Math.floor(Date.parse(data.exportedAt) / 1000)))
    warnings.push('IFC2X3 export: calendar rules, resource utilisation and assignment quantities are retained in Prosota properties. Receiving applications may not interpret these fields automatically.')
  }
  const root = (name: string | null, description: string | null = null) => [stepText(guid()), owner, stepText(name), stepText(description)]
  const stamp = (value: string | null) => {
    if (!legacy) return dateTime(value)
    if (!value) return '$'
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value)
    if (!m) throw new Error(`Invalid IFC date: ${value}`)
    const date = add('IFCCALENDARDATE', String(+m[3]), String(+m[2]), m[1])
    let zone = '$'
    if (m[7]) zone = add('IFCCOORDINATEDUNIVERSALTIMEOFFSET', m[7] === 'Z' ? '0' : String(+m[7].slice(1, 3)), m[7] === 'Z' ? '0' : String(+m[7].slice(4, 6)), m[7][0] === '-' ? '.BEHIND.' : '.AHEAD.')
    return add('IFCDATEANDTIME', date, add('IFCLOCALTIME', String(+(m[4] ?? 0)), String(+(m[5] ?? 0)), real(+(m[6] ?? 0)), zone, '$'))
  }
  const costValue = (name: string, value: unknown) => add('IFCCOSTVALUE', stepText(name), '$', `IFCMONETARYMEASURE(${real(value)})`, '$', '$', '$', stepText(name), '$', ...(legacy ? [] : ['$', '$']))
  const properties = (target: string, name: string, values: object) => {
    const props = Object.entries(values).filter(([, v]) => v != null).map(([key, value]) =>
      add('IFCPROPERTYSINGLEVALUE', stepText(key), '$', `IFCTEXT(${stepText(typeof value === 'object' ? JSON.stringify(value) : value)})`, '$'))
    if (!props.length) return
    const pset = add('IFCPROPERTYSET', ...root(name), list(props))
    add('IFCRELDEFINESBYPROPERTIES', ...root(null), list([target]), pset)
  }
  const control = (target: string, objects: string[], name: string | null = null) => {
    if (objects.length) add('IFCRELASSIGNSTOCONTROL', ...root(name), list(objects), '$', target)
  }
  const declare = (objects: string[]) => {
    if (objects.length && !legacy) add('IFCRELDECLARES', ...root(null), `#${projectId}`, list(objects))
  }
  const starts = data.activities.flatMap(a => a.start ? [a.start] : []).sort()
  const finishes = data.activities.flatMap(a => a.finish ? [a.finish] : []).sort()
  if (!starts.length && data.activities.length) warnings.push('No scheduled start dates: the work schedule uses the export date; task dates remain unset.')
  const schedule = add('IFCWORKSCHEDULE', ...root(`${data.project.name} — Prosota schedule`), '$', stepText(data.schedulePeriodId),
    stamp(data.exportedAt), '$', stepText('Prosota active schedule snapshot'), '$', '$', stamp(starts[0] ?? data.exportedAt), stamp(finishes[finishes.length - 1] ?? null), ...(legacy ? ['.PLANNED.', '$'] : ['.PLANNED.']))
  if (legacy) control(schedule, [`#${projectId}`])
  declare([schedule])
  properties(schedule, 'Prosota_Export', { project_id: data.project.id, schedule_period_id: data.schedulePeriodId,
    cost_period_id: data.costPeriodId, exported_at: data.exportedAt, currency: data.currency,
    geometry: 'Original source IFC geometry and placements. Viewport edits, splits and animation are not baked.',
    scope: 'Active schedule and cost period; original IFC data retained. Prosota custom fields use named property sets.' })

  const calendars = new Map<string, string>()
  for (const c of data.calendars) {
    if (legacy) {
      const calendar = add('IFCGROUP', ...root(c.name), stepText('Prosota calendar'))
      calendars.set(c.id, calendar)
      properties(calendar, 'Prosota_Calendar', { ...c, breaks: data.breaks.filter(b => b.calendar_id === c.id), exceptions: data.exceptions.filter(e => e.calendar_id === c.id) })
      continue
    }
    let intervals = [[c.day_start_time, c.day_end_time]]
    for (const b of data.breaks.filter(b => b.calendar_id === c.id)) {
      intervals = intervals.flatMap(([s, e]) => b.end_time <= s || b.start_time >= e ? [[s, e]] :
        [...(b.start_time > s ? [[s, b.start_time]] : []), ...(b.end_time < e ? [[b.end_time, e]] : [])])
    }
    const timePeriods = intervals.map(([s, e]) => add('IFCTIMEPERIOD', stepText(s), stepText(e)))
    const days = [c.works_monday, c.works_tuesday, c.works_wednesday, c.works_thursday, c.works_friday, c.works_saturday, c.works_sunday]
      .flatMap((works, i) => works ? [String(i + 1)] : [])
    const working: string[] = []
    if (days.length && timePeriods.length) {
      const pattern = add('IFCRECURRENCEPATTERN', '.WEEKLY.', '$', list(days), '$', '$', '$', '$', list(timePeriods))
      working.push(add('IFCWORKTIME', stepText(c.name), '.USERDEFINED.', stepText('Prosota'), pattern, '$', '$'))
    }
    const exceptions = data.exceptions.filter(e => e.calendar_id === c.id)
    const nativeExceptions: string[] = []
    for (const e of exceptions) {
      if (!e.is_working && !e.start_time && !e.end_time) nativeExceptions.push(add('IFCWORKTIME', stepText(e.label), '.USERDEFINED.', stepText('Prosota'), '$', stepText(e.start_date), stepText(e.end_date)))
      else warnings.push(`Calendar "${c.name}": exception "${e.label}" is retained in Prosota properties; receiving software must interpret it.`)
    }
    const calendar = add('IFCWORKCALENDAR', ...root(c.name), '$', stepText(c.id), list(working), list(nativeExceptions), '.NOTDEFINED.')
    calendars.set(c.id, calendar)
    properties(calendar, 'Prosota_Calendar', { ...c, breaks: data.breaks.filter(b => b.calendar_id === c.id), exceptions })
  }
  declare([...calendars.values()])
  const tasks = new Map<string, string>()
  const calendarTasks = new Map<string, string[]>()
  for (const a of data.activities) {
    const completion = a.pct_complete == null ? '$' : real(Number(a.pct_complete) / 100)
    const time = legacy ? add('IFCSCHEDULETIMECONTROL', ...root(a.task_name), '$', stamp(a.actual_start), '$', '$', stamp(a.start), stamp(a.actual_finish), '$', '$', stamp(a.finish), measure(a.duration_hours), '$', measure(a.remaining_duration_hours), measure(a.free_float_hours), measure(a.total_float_hours), bool(a.is_critical), '$', '$', '$', completion)
      : add('IFCTASKTIME', '$', '.USERDEFINED.', stepText('Prosota'), '.WORKTIME.', duration(a.duration_hours), dateTime(a.start), dateTime(a.finish),
      '$', '$', '$', '$', duration(a.free_float_hours), duration(a.total_float_hours), bool(a.is_critical), '$', '$', dateTime(a.actual_start), dateTime(a.actual_finish), duration(a.remaining_duration_hours), completion)
    const task = legacy ? add('IFCTASK', ...root(a.task_name, a.commentary), '$', stepText(a.code), stepText(a.status), '$', bool(a.activity_type.endsWith('milestone')), '$')
      : add('IFCTASK', ...root(a.task_name, a.commentary), '$', stepText(a.code), '$', stepText(a.status), '$', bool(a.activity_type.endsWith('milestone')), '$', time, '.NOTDEFINED.')
    if (legacy) add('IFCRELASSIGNSTASKS', ...root(null), list([task]), '$', schedule, time)
    tasks.set(a.id, task)
    properties(task, 'Prosota_Activity', a)
    const calendar = calendars.get(a.calendar_id ?? data.calendars.find(c => c.is_project_default)?.id ?? '')
    if (calendar) {
      if (legacy) calendarTasks.set(calendar, [...(calendarTasks.get(calendar) ?? []), task])
      else control(calendar, [task])
    }
  }
  if (legacy) for (const calendar of calendars.values()) {
    // IFC2X3 IfcGroup requires exactly one grouping relationship, even for an
    // unused calendar retained with the schedule snapshot.
    add('IFCRELASSIGNSTOGROUP', ...root(null), list(calendarTasks.get(calendar) ?? [schedule]), '$', calendar)
  }
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const a of data.activities) {
    const task = tasks.get(a.id)!
    const parent = a.parent_id && tasks.get(a.parent_id)
    if (parent) children.set(parent, [...(children.get(parent) ?? []), task])
    else roots.push(task)
  }
  if (!legacy) control(schedule, roots)
  declare(roots)
  for (const [parent, nested] of children) add('IFCRELNESTS', ...root(null), parent, list(nested))
  const sequences = { FS: 'FINISH_START', SS: 'START_START', FF: 'FINISH_FINISH', SF: 'START_FINISH' }
  for (const r of data.relationships) {
    const pred = tasks.get(r.predecessor_id), succ = tasks.get(r.successor_id)
    if (!pred || !succ) throw new Error('A schedule dependency refers to an activity outside the export. Refresh the schedule and retry.')
    const lag = legacy ? measure(r.lag_hours) : add('IFCLAGTIME', '$', '.USERDEFINED.', stepText('Prosota'), `IFCDURATION(${duration(r.lag_hours)})`, '.WORKTIME.')
    add('IFCRELSEQUENCE', ...root(null), pred, succ, lag, `.${sequences[r.relationship_type]}.`, ...(legacy ? [] : ['$']))
  }
  const byTask = new Map<string, Set<string>>()
  let missingLinks = 0, unsupportedLinks = 0
  for (const link of data.links) {
    const task = tasks.get(link.activity_id)
    if (!task) continue
    if (link.source_kind !== 'ifc') { unsupportedLinks++; continue }
    const id = elements.get(link.element_ref)
    if (!id) { missingLinks++; continue }
    const set = byTask.get(task) ?? new Set<string>()
    set.add(`#${id}`); byTask.set(task, set)
  }
  for (const [task, ids] of byTask) add('IFCRELASSIGNSTOPROCESS', ...root('Prosota model elements'), list([...ids]), '$', task, '$')
  if (missingLinks) warnings.push(`${missingLinks} activity/model links could not be resolved in the source IFCs.`)
  if (unsupportedLinks) warnings.push(`${unsupportedLinks} mesh, annotation or split links have no source IFC element; retained in export metadata only.`)
  properties(schedule, 'Prosota_ModelLinks', { links: data.links.filter(l => tasks.has(l.activity_id)) })

  const resourceTypes: Record<string, string> = { labour: 'IFCLABORRESOURCE', equipment: 'IFCCONSTRUCTIONEQUIPMENTRESOURCE', material: 'IFCCONSTRUCTIONMATERIALRESOURCE', crew: 'IFCCREWRESOURCE', subcontractor: 'IFCSUBCONTRACTRESOURCE', cost: 'IFCCONSTRUCTIONPRODUCTRESOURCE' }
  const resourceDefs = new Map(data.resources.map(r => [r.id, r]))
  const resourceRoots: string[] = []
  // Each assignment has its own occurrence: utilisation, quantity and budget
  // belong to an activity/resource pair, not to the shared resource catalogue.
  for (const a of data.assignments) {
    const task = tasks.get(a.activity_id), r = resourceDefs.get(a.resource_id)
    if (!task || !r) throw new Error('A resource assignment cannot be resolved. Refresh and retry.')
    const usage = a.utilisation_pct == null ? '$' : real(Number(a.utilisation_pct) / 100)
    const time = legacy ? '$' : add('IFCRESOURCETIME', '$', '.USERDEFINED.', stepText('Prosota'), '$', usage, '$', '$', '$', '$', '$', '$', '$', '$', '$', '$', '$', '$', '$')
    const cost = costValue('BUDGET', a.budget)
    // IFC2X3 resource subclasses have different trailing optional attributes.
    const legacyTail: Record<string, string[]> = { labour: ['$'], equipment: [], crew: [], material: ['$', '$'], subcontractor: ['$', '$'], cost: [] }
    const resource = legacy ? add(resourceTypes[r.resource_type], ...root(r.name), '$', stepText(a.id), '$', '$', '$', ...legacyTail[r.resource_type])
      : add(resourceTypes[r.resource_type], ...root(r.name), '$', stepText(a.id), '$', time, list([cost]), '$', '.NOTDEFINED.')
    if (legacy) add('IFCRELASSOCIATESAPPLIEDVALUE', ...root(null), list([resource]), cost)
    resourceRoots.push(resource)
    properties(resource, 'Prosota_ResourceAssignment', { ...r, assignment: a })
    add('IFCRELASSIGNSTOPROCESS', ...root('Prosota resource assignment'), list([resource]), '$', task, '$')
  }
  declare(resourceRoots)
  properties(schedule, 'Prosota_ResourceCatalogue', { resources: data.resources })
  const costSchedule = legacy ? add('IFCCOSTSCHEDULE', ...root(`${data.project.name} — Prosota cost plan`), '$', '$', '$', '$', '$', '$', stamp(data.exportedAt), stepText(data.costPeriodId), '.COSTPLAN.')
    : add('IFCCOSTSCHEDULE', ...root(`${data.project.name} — Prosota cost plan`), '$', stepText(data.costPeriodId), '.NOTDEFINED.', '$', '$', dateTime(data.exportedAt))
  if (legacy) control(costSchedule, [`#${projectId}`])
  declare([costSchedule])
  const costItems: string[] = []
  let unlinkedCosts = 0
  for (const c of data.costs) {
    // Separate categories avoid summing budget + actual + forecast as one cost.
    const values = [['BUDGET', c.bac], ['ACTUAL', c.computed_actuals ?? c.actuals], ['FORECAST', c.forecast]]
      .filter(([, value]) => value != null).map(([category, value]) => costValue(String(category), value))
    const item = legacy ? add('IFCCOSTITEM', ...root(c.description, c.scope_note), '$')
      : add('IFCCOSTITEM', ...root(c.description, c.scope_note), '$', stepText(c.code), '.NOTDEFINED.', list(values), '$')
    if (legacy) for (const value of values) add('IFCRELASSOCIATESAPPLIEDVALUE', ...root(null), list([item]), value)
    costItems.push(item)
    properties(item, 'Prosota_Cost', c)
    const task = c.linked_activity_id && tasks.get(c.linked_activity_id)
    if (task) control(item, [task])
    else if (c.linked_activity_id) unlinkedCosts++
  }
  control(costSchedule, costItems)
  if (unlinkedCosts) warnings.push(`${unlinkedCosts} cost items reference activities outside the active schedule. Their costs and source activity IDs are retained, but no IFC task link was created.`)
  properties(schedule, 'Prosota_ExportWarnings', { warnings })
  return { step: lines.join('\n'), warnings, nextId: next }
}
