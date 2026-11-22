import type { EquipmentJoint } from './equipmentRig'

export interface CraneSweep {
  activity_id: string
  control: string
  start_value: number
  end_value: number
  cycles: number
  enabled: boolean
  keys: {progress: number; value: number}[]
}

type DatedActivity = {id: string; start: string | null; finish: string | null}
type SweepWindow = CraneSweep & {start: number; end: number}
const isUnit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1

export function validateCraneSweeps(sweeps: CraneSweep[], joints: EquipmentJoint[]) {
  if (!Array.isArray(sweeps) || sweeps.length > 300) throw Error('A rig supports up to 300 linked sweep activities.')
  const activityIds = new Set<string>()
  const hinges = new Set(joints.filter(joint => joint.kind === 'hinge').map(joint => joint.control))
  for (const sweep of sweeps) {
    if (!sweep.activity_id || activityIds.has(sweep.activity_id)) throw Error('Link each activity once per crane.')
    activityIds.add(sweep.activity_id)
    if (!hinges.has(sweep.control)) throw Error('Choose a slew control with a calibrated hinge.')
    if (!isUnit(sweep.start_value) || !isUnit(sweep.end_value) ||
        !Number.isInteger(sweep.cycles) || sweep.cycles < 1 || sweep.cycles > 200) {
      throw Error('Choose slew limits from 0 to 1 and between 1 and 200 round trips.')
    }
    const keys = sweep.keys
    if (!Array.isArray(keys) || keys.length > 128 || keys.some(k => !isUnit(k.progress) || !isUnit(k.value)) ||
        new Set(keys.map(k => k.progress)).size !== keys.length) {
      throw Error('Invalid activity-relative slew keys.')
    }
  }
}

export function craneSweepWindows(sweeps: CraneSweep[], activities: readonly DatedActivity[]): SweepWindow[] {
  if (!sweeps.length) return []
  const byId = new Map(activities.map(activity => [activity.id, activity]))
  const windows: SweepWindow[] = []
  for (const sweep of sweeps) {
    if (!sweep.enabled) continue
    const activity = byId.get(sweep.activity_id)
    const start = Date.parse(activity?.start ?? ''), end = Date.parse(activity?.finish ?? '')
    if (end > start) {
      windows.push({...sweep, start, end, keys: [...sweep.keys].sort((a, b) => a.progress - b.progress)})
    }
  }
  return windows
}

const mix = (from: number, to: number, t: number) => from + (to - from) * t
const ease = (t: number) => t * t * (3 - 2 * t)
const transition = 0.05

// The first linked active task wins an overlap. At a shared endpoint use the task that starts there.
export function sampleCraneSweep(windows: SweepWindow[], time: number | null, manual: (id: string) => number): Record<string, number> {
  if (time === null) return {}
  const sweep = windows.find(w => w.start <= time && time < w.end) ?? windows.find(w => w.end === time)
  if (!sweep) return {}

  const progress = (time - sweep.start) / (sweep.end - sweep.start)
  const keys = sweep.keys
  let value: number
  if (keys.length) {
    const next = keys.findIndex(key => key.progress >= progress)
    const right = next < 0 ? {progress: 1, value: manual(sweep.control)} : keys[next]
    const left = next === 0 ? {progress: 0, value: manual(sweep.control)} : keys[next < 0 ? keys.length - 1 : next - 1]
    value = right.progress === left.progress ? right.value : mix(left.value, right.value, (progress - left.progress) / (right.progress - left.progress))
  } else if (progress < transition || progress > 1 - transition) {
    const blend = ease(Math.min(progress, 1 - progress) / transition)
    value = mix(manual(sweep.control), sweep.start_value, blend)
  } else {
    const travel = (progress - transition) / (1 - 2 * transition)
    const phase = 2 * Math.PI * sweep.cycles * travel
    value = mix(sweep.start_value, sweep.end_value, (1 - Math.cos(phase)) / 2)
  }
  return {[sweep.control]: value}
}
