import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useProject, type Project } from '@/lib/ProjectContext'

export function ProjectSelector() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newClient, setNewClient] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)
  const { selectProject } = useProject()
  const navigate = useNavigate()

  const refresh = () =>
    api.get<Project[]>('/api/v1/projects/')
      .then(r => setProjects(r.data))
      .catch(() => setError('Failed to load projects'))
      .finally(() => setLoading(false))

  useEffect(() => {
    refresh()
  }, [])

  const handleSelect = (project: Project) => {
    selectProject(project)
    navigate('/dashboard')
  }

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedProjects = projects.filter(p => selectedIds.has(p.id))

  const handleSetStatus = async (status: 'active' | 'archived') => {
    setWorking(true)
    setError(null)
    try {
      await Promise.all(
        selectedProjects.map(p => api.patch(`/api/v1/projects/${p.id}`, { status }))
      )
      setSelectedIds(new Set())
      await refresh()
    } catch {
      setError(`Failed to update ${selectedProjects.length > 1 ? 'projects' : 'project'}`)
    } finally {
      setWorking(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(
      `Permanently delete ${selectedProjects.length} project${selectedProjects.length > 1 ? 's' : ''}?\n\n` +
      `${selectedProjects.map(p => p.name).join(', ')}\n\n` +
      `This removes everything in ${selectedProjects.length > 1 ? 'them' : 'it'} — schedule, cost plan, risks, ` +
      `ICD log, resources, calendars — for good. This cannot be undone. If you just want to hide old projects, ` +
      `use Archive instead.`
    )) return
    setWorking(true)
    setError(null)
    try {
      await Promise.all(selectedProjects.map(p => api.delete(`/api/v1/projects/${p.id}`)))
      setSelectedIds(new Set())
      await refresh()
    } catch {
      setError(`Failed to delete ${selectedProjects.length > 1 ? 'projects' : 'project'}`)
    } finally {
      setWorking(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      const { data } = await api.post<Project>('/api/v1/projects/', {
        name: newName.trim(),
        client_name: newClient.trim() || null,
      })
      setProjects(prev => [...prev, data])
      setCreating(false)
      setNewName('')
      setNewClient('')
    } catch {
      setError('Failed to create project')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="text-gray-400 text-sm">Loading projects…</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Select a project</h1>
          <p className="text-gray-500 text-sm mt-1">Choose a project to continue into ProsotaPMO</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {error}
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="mb-3 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
            <span className="text-xs font-medium text-blue-800">{selectedIds.size} selected</span>
            <button
              onClick={() => handleSetStatus('active')}
              disabled={working}
              className="text-xs text-green-700 hover:text-green-800 font-medium disabled:opacity-50"
            >
              Set Active
            </button>
            <button
              onClick={() => handleSetStatus('archived')}
              disabled={working}
              className="text-xs text-gray-600 hover:text-gray-800 font-medium disabled:opacity-50"
            >
              Archive
            </button>
            <button
              onClick={handleDelete}
              disabled={working}
              className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-gray-400 hover:text-gray-600 ml-auto"
            >
              Clear
            </button>
          </div>
        )}

        <div className="space-y-3 mb-6">
          {projects.map(project => (
            <div
              key={project.id}
              className="w-full flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-5 py-4 hover:border-blue-400 hover:shadow-sm transition-all group"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(project.id)}
                onChange={() => toggleSelected(project.id)}
                onClick={e => e.stopPropagation()}
                className="shrink-0"
              />
              <button onClick={() => handleSelect(project)} className="flex-1 text-left flex items-center justify-between min-w-0">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 group-hover:text-blue-600 truncate">{project.name}</p>
                  {project.client_name && (
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{project.client_name}</p>
                  )}
                </div>
                <span className={`shrink-0 ml-3 text-xs px-2 py-1 rounded-full font-medium ${
                  project.status === 'active'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {project.status}
                </span>
              </button>
            </div>
          ))}

          {projects.length === 0 && !creating && (
            <p className="text-gray-400 text-sm text-center py-8">
              No projects yet. Create your first one below.
            </p>
          )}
        </div>

        {creating ? (
          <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
            <h2 className="font-medium text-gray-900 text-sm">New project</h2>
            <input
              autoFocus
              type="text"
              placeholder="Project name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Client name (optional)"
              value={newClient}
              onChange={e => setNewClient(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-gray-500 px-4 py-2 rounded-md text-sm hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            + New project
          </button>
        )}
      </div>
    </div>
  )
}
