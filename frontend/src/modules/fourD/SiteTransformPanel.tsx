import type { Object3D } from 'three'
import type { GizmoMode, GizmoSpace } from './TransformPanel'
import { ResettableNumberInput } from './ResettableNumberInput'

export function SiteTransformPanel({ name, object, locked, mode, space, onMode, onSpace, onChange, onMaterials, error, busy }: {
  name: string; object: Object3D; locked: boolean; mode: GizmoMode; space: GizmoSpace
  onMode(mode: GizmoMode): void; onSpace(space: GizmoSpace): void; onChange(): void; onMaterials(): void
  error: string; busy: boolean
}) {
  return <section className="p-3 border-t border-gray-200 dark:border-prosota-line text-xs" aria-label="Selected library asset">
    <h3 className="font-semibold mb-2">Selected: {name}</h3>
    {locked ? <p>Unlock this asset in 3D Site tools to change its transform.</p> : <>
      <div className="flex gap-1 mb-2">{(['translate','rotate','scale'] as const).map((value,i) => <button key={value} onClick={() => onMode(value)} className={`px-2 py-1 border rounded ${mode === value ? 'bg-blue-600 text-white' : ''}`}>{['Move','Rotate','Scale'][i]}</button>)}</div>
      <div className="flex gap-1 mb-2">{(['world','local'] as const).map(value => <button key={value} onClick={() => onSpace(value)} className={`px-2 py-1 border rounded ${space === value ? 'bg-blue-600 text-white' : ''}`}>{value === 'world' ? 'Global' : 'Local'}</button>)}</div>
      {(['position','rotation','scale'] as const).map(field => <div key={field} className="mb-2">
        <div>{field === 'position' ? 'Location (m)' : field === 'rotation' ? 'Rotation (°)' : 'Scale'}</div>
        <div className="grid grid-cols-3 gap-1">{(['x','y','z'] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<ResettableNumberInput
          defaultValue={field === 'scale' ? 1 : 0} className="w-full bg-transparent border rounded px-1" value={object[field][axis] * (field === 'rotation' ? 180 / Math.PI : 1)}
          onChange={value => { object[field][axis] = value * (field === 'rotation' ? Math.PI / 180 : 1); object.updateMatrixWorld(true); onChange() }} /></label>)}</div>
      </div>)}
    </>}
    <button className="border rounded px-2 py-1" onClick={onMaterials}>Edit realistic materials</button>
    {busy && <p role="status">Saving…</p>}{error && <p role="alert" className="text-red-500">{error}</p>}
  </section>
}
