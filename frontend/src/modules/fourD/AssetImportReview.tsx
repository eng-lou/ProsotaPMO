import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bounds, OrbitControls } from '@react-three/drei'
import { Group, Mesh, Texture } from 'three'
import { parseAsset } from './siteAssets'
import { applyAssetOpacityMask, inspectAssetMaterials, restoreAssetOpacity } from './assetImportRepair'

export function AssetImportReview({ file, onImport, onCancel }: { file: File; onImport(file: File): Promise<void>; onCancel(): void }) {
  const [bytes, setBytes] = useState<ArrayBuffer>(), [object, setObject] = useState<Group>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => { let active = true; void file.arrayBuffer().then(b => { inspectAssetMaterials(b); if (active) setBytes(b) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [file])
  useEffect(() => {
    if (!bytes) return
    let active = true
    let loaded: Group | undefined
    const dispose = (root: Group) => { const resources = new Set<{ dispose(): void }>(); root.traverse(node => { if (node instanceof Mesh) { resources.add(node.geometry); for (const material of Array.isArray(node.material) ? node.material : [node.material]) { resources.add(material); for (const value of Object.values(material)) if (value instanceof Texture) resources.add(value) } } }); resources.forEach(r => r.dispose()) }
    setObject(undefined)
    void parseAsset(bytes).then(result => { result.object.scale.set(1, 1, 1); if (active) { loaded = result.object; setObject(result.object) } else dispose(result.object) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false; if (loaded) dispose(loaded) }
  }, [bytes])
  async function repair(index: number, mask?: File) {
    if (!bytes) return
    setBusy(true); setError('')
    try { setBytes(mask ? await applyAssetOpacityMask(bytes, index, mask) : restoreAssetOpacity(bytes, index)); setMessage('Repair applied. Check the preview, then import. Your source file is unchanged.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Material repair failed') }
    finally { setBusy(false) }
  }
  const materials = bytes ? inspectAssetMaterials(bytes) : []
  return <section aria-label="Check imported materials" className="border rounded p-2 space-y-2">
    <strong>Check materials · {file.name}</strong>
    <div className="h-48 bg-slate-200 rounded"><Canvas camera={{ position: [2, 1.5, 2], fov: 40 }}><ambientLight intensity={1.8} /><directionalLight position={[3, 5, 4]} intensity={2} /><Suspense fallback={null}>{object && <Bounds key={object.uuid} fit clip observe margin={1.2}><primitive object={object} dispose={null} /></Bounds>}</Suspense><OrbitControls makeDefault /></Canvas></div>
    {!!object?.animations.length && <p className="text-xs">Animation clips retained: {object.animations.map((clip,index)=>clip.name || `Clip ${index+1}`).join(", ")}. Choose playback and speed after placing the asset.</p>}
    <p className="text-xs">Solid cards around leaves? Choose that material’s black-and-white opacity image below. White stays visible; black is cut out. Prosota embeds it automatically.</p>
    {materials.map(m => <div key={m.index} className="border rounded p-2 space-y-1"><strong>{m.name}</strong>
      <p className="text-xs">{m.invisible ? 'Zero opacity: this material may be invisible.' : m.cutout ? 'Cutout transparency enabled.' : m.textured ? 'Colour texture included. Check transparency in the preview.' : 'No colour texture included. This may be intentional; missing procedural finishes must be baked in Blender.'}</p>
      {m.invisible && <button disabled={busy} className="border rounded px-2" onClick={() => void repair(m.index)}>Restore opacity</button>}
      {m.textured && <label className="block text-xs">Add opacity mask<input aria-label={`Opacity mask for ${m.name}`} className="block w-full" disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const mask = e.target.files?.[0]; if (mask) void repair(m.index, mask); e.target.value = '' }} /></label>}
    </div>)}
    {error && <p role="alert" className="text-red-600">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="flex gap-2"><button disabled={busy || !bytes || !object} className="rounded bg-blue-600 text-white p-2 disabled:opacity-50" onClick={async () => { if (!bytes) return; setBusy(true); try { await onImport(new File([bytes], file.name, { type: 'model/gltf-binary' })) } finally { setBusy(false) } }}>Import checked asset</button><button disabled={busy} onClick={onCancel}>Cancel</button></div>
  </section>
}
