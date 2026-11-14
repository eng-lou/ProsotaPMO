import { useEffect, useRef, useState } from 'react'
import type { DataTexture } from 'three'
import { deleteSavedEnvironment, getSavedEnvironment, restoreEnvironmentTexture, saveEnvironment, type SavedEnvironment } from './environmentHdr'
import { readEnvironmentTexture } from './environmentTexture'

interface Session {
  projectId: string | undefined
  saved: SavedEnvironment | null
  busy: boolean
}

// Switching away and back while storage is being written must restore the
// replacement, even if the original panel was unmounted during the upload.
const writes = new Map<string, Promise<unknown>>()
async function finishWrite<T>(projectId: string, write: Promise<T>): Promise<T> {
  writes.set(projectId, write)
  try {
    return await write
  } finally {
    if (writes.get(projectId) === write) writes.delete(projectId)
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useProjectEnvironment(projectId: string | undefined) {
  const session = useRef<Session | null>(null)
  const [texture, setTexture] = useState<DataTexture | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => texture?.dispose(), [texture])

  useEffect(() => {
    const current: Session = { projectId, saved: null, busy: !!projectId }
    session.current = current
    setTexture(null)
    setName(null)
    setError(null)
    setStatus(projectId ? 'Loading environment…' : null)
    async function restore(id: string) {
      try {
        await writes.get(id)?.catch(() => {})
        if (session.current !== current) return
        const saved = await getSavedEnvironment(id)
        if (session.current !== current || !saved) return
        current.saved = saved
        setName(saved.name)
        const restored = await restoreEnvironmentTexture(saved)
        if (session.current === current) setTexture(restored)
        else restored.dispose()
      } catch (err) {
        if (session.current === current) setError(`Couldn't restore the project environment. ${errorText(err)}`)
      } finally {
        current.busy = false
        if (session.current === current) setStatus(null)
      }
    }
    if (projectId) void restore(projectId)
    return () => { session.current = null }
  }, [projectId])

  async function upload(file: File, onReady: () => void) {
    const current = session.current
    if (!current || current.busy) return
    current.busy = true
    setError(null)
    setStatus('Reading environment…')
    let displayed = false
    try {
      const next = await readEnvironmentTexture(file)
      if (session.current !== current) {
        next.dispose()
        return
      }
      setTexture(next)
      setName(file.name)
      onReady()
      displayed = true
      if (current.projectId) {
        setStatus('Saving environment…')
        current.saved = await finishWrite(current.projectId, saveEnvironment(current.projectId, file))
      }
    } catch (err) {
      if (session.current === current) setError(displayed
        ? `Showing ${file.name} for this session. Saving failed. ${errorText(err)}`
        : errorText(err))
    } finally {
      current.busy = false
      if (session.current === current) setStatus(null)
    }
  }

  async function clear() {
    const current = session.current
    if (!current || current.busy) return
    current.busy = true
    setStatus('Clearing environment…')
    setError(null)
    try {
      if (current.saved) await finishWrite(current.saved.project_id, deleteSavedEnvironment(current.saved))
      if (session.current !== current) return
      current.saved = null
      setName(null)
      setTexture(null)
    } catch (err) {
      if (session.current === current) setError(`Couldn't clear the project environment. ${errorText(err)}`)
    } finally {
      current.busy = false
      if (session.current === current) setStatus(null)
    }
  }

  function reportRenderError(message: string) {
    setError(`Couldn't display ${name ?? 'the environment'}. ${message}`)
    setTexture(null)
  }

  return { texture, name, status, error, upload, clear, reportRenderError }
}
