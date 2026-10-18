import { undoHistory } from './undoHistory'
import { createContext, useContext, useLayoutEffect, useState } from 'react'

export interface Project {
  id: string
  org_id: string
  name: string
  client_name: string | null
  status: string
}

interface ProjectContextValue {
  selectedProject: Project | null
  selectProject: (project: Project) => void
  clearProject: () => void
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

const STORAGE_KEY = 'prosota_selected_project'

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(() => {
    try {
      sessionStorage.removeItem('prosota_maritime_selected_project')
      sessionStorage.removeItem('prosota_maritime_delivery_v1')
      const stored = sessionStorage.getItem(STORAGE_KEY)
      const project = stored ? JSON.parse(stored) : null
      if (project?.workspace === 'maritime') {
        sessionStorage.removeItem(STORAGE_KEY)
        return null
      }
      return project
    } catch {
      return null
    }
  })

  useLayoutEffect(() => { undoHistory.setScope(selectedProject?.id ?? '') }, [selectedProject?.id])

  const selectProject = (project: Project) => {
    setSelectedProject(project)
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(project))
  }

  const clearProject = () => {
    setSelectedProject(null)
    sessionStorage.removeItem(STORAGE_KEY)
  }

  return (
    <ProjectContext.Provider value={{ selectedProject, selectProject, clearProject }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProject must be used within ProjectProvider')
  return ctx
}
