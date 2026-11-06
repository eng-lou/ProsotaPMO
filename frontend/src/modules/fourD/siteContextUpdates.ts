import type { SiteContext } from './siteContext'

export type SiteContextPatch = Partial<Omit<SiteContext, 'id' | 'project_id' | 'created_at' | 'updated_at'>>

// The endpoint saves a full row. Merge each queued patch with the last saved
// response so rapid visibility changes cannot overwrite a newly captured frame.
export function createSiteContextUpdates(
  read: () => SiteContext | null,
  activeProject: () => string | undefined,
  save: (data: Omit<SiteContext, 'id' | 'created_at' | 'updated_at'>) => Promise<SiteContext>,
  publish: (data: SiteContext) => void,
) {
  let queue: Promise<unknown> = Promise.resolve()
  return (projectId: string, patch: SiteContextPatch) => {
    const pending = queue.catch(() => {}).then(async () => {
      const current = read()
      if (activeProject() !== projectId || current?.project_id !== projectId) return
      const { id, created_at, updated_at, ...fields } = current
      const result = await save({ ...fields, ...patch, project_id: projectId })
      if (activeProject() === projectId) publish(result)
    })
    queue = pending
    return pending
  }
}
