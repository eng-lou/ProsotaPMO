import type { FenceOpening } from './siteScene'

export function restPose(gate: FenceOpening) {
  return gate.pose ?? (gate.kind !== 'turnstile' && (gate.angle ?? 0) !== 0 ? 1 : 0)
}

export function gateTrack(gate: FenceOpening) {
  const rest = restPose(gate)
  const keys = (gate.pose_keys ?? []).map(key => ({time: Date.parse(key.date), value: key.value})).sort((a,b) => a.time-b.time)
  return (time: number | null) => {
    if (time === null || !Number.isFinite(time) || !keys.length) return rest
    if (time <= keys[0].time) return keys[0].value
    for (let i=1; i<keys.length; i++) {
      if (time <= keys[i].time) {
        const a = keys[i-1], b = keys[i]
        return a.value + (b.value-a.value) * ((time-a.time)/(b.time-a.time))
      }
    }
    return keys[keys.length-1].value
  }
}

export function keyGatePose(gate: FenceOpening, time: Date, value: number) {
  const keys = gate.pose_keys ?? []
  return [...keys.filter(key => Date.parse(key.date) !== time.getTime()), {date: time.toISOString(), value}]
    .sort((a,b) => Date.parse(a.date)-Date.parse(b.date))
}
