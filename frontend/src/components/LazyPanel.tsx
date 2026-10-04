import { lazy, Suspense, type ComponentType, type ComponentProps } from 'react'

// Keep optional panels out of the route's initial download. Each gets its
// own boundary so opening one never replaces the already-visible schedule.
export function lazyPanel<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const Panel = lazy(load) as ComponentType<ComponentProps<T>>
  return function DeferredPanel(props: ComponentProps<T>) {
    return (
      <Suspense fallback={<div role="status" className="p-4 text-sm text-gray-500">Loading panel…</div>}>
        <Panel {...props} />
      </Suspense>
    )
  }
}
