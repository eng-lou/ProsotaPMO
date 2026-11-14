type SearchActivity = { id: string; parent_id: string | null; task_name: string; code: string }

// Search only the current scope; include ancestors and leave collapse state intact.
export function searchActivityIds(activities: SearchActivity[], query: string, scope: Set<string> | null = null): Set<string> | null {
  const text = query.trim().toLocaleLowerCase()
  if (!text) return null
  const byId = new Map(activities.map(a => [a.id, a]))
  const keep = new Set<string>()
  for (const a of activities) {
    if (scope && !scope.has(a.id)) continue
    if (!a.task_name.toLocaleLowerCase().includes(text) && !a.code.toLocaleLowerCase().includes(text)) continue
    let current: SearchActivity | undefined = a
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      keep.add(current.id)
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    }
  }
  return keep
}
