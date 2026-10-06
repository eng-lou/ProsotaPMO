type ProfileActivity = { id: string; animation_profile_id: string | null }

export async function applyActivityProfiles(
  targets: ProfileActivity[],
  profileId: string | null,
  save: (id: string, profileId: string | null) => Promise<unknown>,
  reload: () => Promise<ProfileActivity[] | undefined>,
) {
  const uncertain: string[] = []
  for (let offset = 0; offset < targets.length; offset += 8) {
    const batch = targets.slice(offset, offset + 8)
    const results = await Promise.allSettled(batch.map(a => save(a.id, profileId)))
    results.forEach((result, i) => { if (result.status === 'rejected') uncertain.push(batch[i].id) })
  }
  let saved: ProfileActivity[] | undefined
  try {
    saved = await reload()
  } catch {
    throw new Error(uncertain.length
      ? 'Could not confirm the saved profiles. Refresh the schedule to check before retrying.'
      : 'Profiles saved, but the schedule could not refresh. Refresh the schedule to see the changes.')
  }
  if (!uncertain.length) return
  if (!saved) throw new Error('Could not confirm the saved profiles. Refresh the schedule to check before retrying.')
  const byId = new Map(saved.map(a => [a.id, a.animation_profile_id]))
  const unconfirmed = uncertain.filter(id => !byId.has(id) || byId.get(id) !== profileId)
  if (unconfirmed.length) {
    throw new Error(`${unconfirmed.length} of ${targets.length} profile changes could not be confirmed. Other changes are saved; refresh or retry the remaining activities.`)
  }
}
