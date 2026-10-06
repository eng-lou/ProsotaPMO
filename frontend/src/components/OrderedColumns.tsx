import { Children, Fragment, type ReactNode } from 'react'

// Reorder complete cells together with their headers and colgroup widths.
// sourceKeys describes the existing render order after visibility filtering.
export function OrderedColumns({ children, sourceKeys, order }: {
  children: ReactNode; sourceKeys: string[]; order: string[]
}) {
  const cells = Children.toArray(children)
  const rank = new Map(order.map((key, i) => [key, i]))
  return <>{cells.map((cell, i) => ({cell, key: sourceKeys[i], index: i}))
    .sort((a, b) => (rank.get(a.key) ?? order.length + a.index) - (rank.get(b.key) ?? order.length + b.index))
    .map(({cell, key, index}) => <Fragment key={key ?? index}>{cell}</Fragment>)}</>
}

export function reconcileColumnOrder(saved: string[], available: string[]): string[] {
  return [...new Set([...saved.filter(key => available.includes(key)), ...available])]
}
