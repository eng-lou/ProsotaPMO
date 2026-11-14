import { Vector3 } from 'three'

export function GroupMovePanel({ count, locked, busy, onMove }: {
  count: number; locked: number; busy: boolean; onMove(delta: Vector3): void
}) {
  return <form className="space-y-2 px-3 py-2 text-xs" onSubmit={event => {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const delta = new Vector3(...(['x', 'y', 'z'] as const).map(axis => Number(fields.get(axis))))
    if (delta.lengthSq() && Number.isFinite(delta.lengthSq())) onMove(delta)
    form.reset()
  }}>
    <strong>Move selection</strong>
    <p>Drag the arrows in the viewport or enter a distance in metres.</p>
    {locked > 0 && <p>{locked} locked {locked === 1 ? 'object stays' : 'objects stay'} in place.</p>}
    <fieldset disabled={busy || !count} className="flex items-end gap-1">
      {['x','y','z'].map(axis => <label key={axis} className="flex-1 min-w-0">{axis.toUpperCase()}
        <input name={axis} type="number" step="any" defaultValue="0" className="w-full rounded border bg-transparent px-1"/>
      </label>)}
      <button className="rounded border px-2 py-1" type="submit">Move</button>
    </fieldset>
  </form>
}
