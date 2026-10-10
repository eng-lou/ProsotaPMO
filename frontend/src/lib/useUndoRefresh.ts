import { useEffect, useState } from 'react'
export function useUndoRefresh() {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1)
    window.addEventListener('prosota:undo-refresh', refresh)
    return () => window.removeEventListener('prosota:undo-refresh', refresh)
  }, [])
  return revision
}
