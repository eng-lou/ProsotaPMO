import type { ReactNode } from 'react'

export function SiteToolSection({ title, disabled, children }: {
  title: string
  disabled?: boolean
  children: ReactNode
}) {
  return <details className="construction-controls min-w-0 rounded border p-3 dark:border-prosota-line">
    <summary>{title}</summary>
    <fieldset disabled={disabled} className="min-w-0 space-y-2 pt-2">{children}</fieldset>
  </details>
}
