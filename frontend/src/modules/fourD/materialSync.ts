export type MaterialValues = Record<string, string>
export type MaterialChanges = Record<string, { before: string | null; after: string | null }>
export function materialChanges(before: MaterialValues, after: MaterialValues): MaterialChanges {
  const changes: MaterialChanges = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) changes[key] = { before: before[key] ?? null, after: after[key] ?? null }
  }
  return changes
}
export function rebaseMaterials(remote: MaterialValues, sent: MaterialValues, latest: MaterialValues): MaterialValues {
  const result = { ...remote }
  for (const [key, edit] of Object.entries(materialChanges(sent, latest))) {
    if (edit.after === null) delete result[key]
    else result[key] = edit.after
  }
  return result
}
