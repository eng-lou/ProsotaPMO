import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { api, downloadLargeBlob } from '@/lib/api'
import { uploadDirectToStorage } from '@/lib/directUpload'
import { prepareCutoutRendering } from './cutoutRendering'

export interface SiteAsset {
  id: string; project_id: string; name: string; category: string; status: 'ready'
  dimensions: { width: number; height: number; depth: number }; size_bytes: number; created_at: string
}
export function checkPortableGlb(bytes: ArrayBuffer) {
  const view = new DataView(bytes)
  if (bytes.byteLength < 20 || bytes.byteLength > 512 * 1024 * 1024 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw Error('Choose a self-contained GLB under 512 MB')
  const length = view.getUint32(12, true)
  if (view.getUint32(16, true) !== 0x4e4f534a || length > bytes.byteLength - 20) throw Error('Invalid GLB metadata')
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)))
  if ([...(json.buffers || []), ...(json.images || [])].some(entry => entry.uri)) throw Error('Embed all textures and buffers in the GLB first')
  if (json.extensionsRequired?.length) throw Error('Export an uncompressed GLB without required extensions for this release')
}
export async function parseAsset(bytes: ArrayBuffer) {
  checkPortableGlb(bytes)
  const gltf = await new GLTFLoader().parseAsync(bytes, '')
  prepareCutoutRendering(gltf.scene)
  const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3())
  if (![size.x, size.y, size.z].every(Number.isFinite) || Math.max(size.x,size.y,size.z)<=.000001) throw Error('Asset needs visible geometry')
  // Flat OBJ surfaces still need a finite normalization scale.
  size.max(new THREE.Vector3(.001,.001,.001))
  const dimensions = { width: size.x, height: size.y, depth: size.z }
  const group = new THREE.Group(); group.userData.siteAssetRigRoot = true
  // Keep authored materials, hierarchy and static pose; place from base centre.
  const offset=new THREE.Group()
  offset.position.set(-(box.min.x+box.max.x)/2,-box.min.y,-(box.min.z+box.max.z)/2)
  offset.add(gltf.scene);group.add(offset);group.animations=gltf.animations
  group.scale.set(1 / size.x, 1 / size.y, 1 / size.z)
  return { object: group, dimensions }
}
const loaded = new Map<string, Promise<THREE.Group>>()
export async function downloadSiteAssetBytes(id: string) {
  const {data}=await api.get<{download_url:string}>(`/api/v1/site-assets/${id}/download`,{params:{direct:true}})
  if(!data || typeof data.download_url!=='string' || !data.download_url.trim())
    throw Error('The asset service returned an invalid download response. Please update or restart Prosota before importing motion.')
  const bytes=await (await downloadLargeBlob(data.download_url,true)).arrayBuffer()
  checkPortableGlb(bytes)
  return bytes
}
export async function loadSiteAsset(id: string) {
  let pending = loaded.get(id)
  if (!pending) {
    pending = downloadSiteAssetBytes(id).then(parseAsset).then(result => result.object)
    loaded.set(id, pending)
    pending.catch(() => loaded.delete(id))
  }
  return clone(await pending)
}
export async function importSiteAsset(projectId: string, file: File, category: string, progress: (value: number) => void, displayName = file.name) {
  if (!file.name.toLowerCase().endsWith('.glb')) throw Error('Choose a .glb file')
  const bytes = await file.arrayBuffer()
  const prepared = await parseAsset(bytes)
  const { data } = await api.post('/api/v1/site-assets/', { project_id: projectId, name: displayName.slice(0, 100), category })
  await uploadDirectToStorage(data.upload_url, file, 'model/gltf-binary', progress)
  const result = await api.post<SiteAsset>(`/api/v1/site-assets/${data.id}/ready`, prepared.dimensions)
  loaded.set(data.id, Promise.resolve(prepared.object))
  return result.data
}

export const SITE_ASSET_CATEGORIES = ['Other','Trees','Fences','Cabins','Context buildings','People','Road arrows','Equipment','Vehicles','Vegetation']
export function useSiteAssetInventory(projectId: string) {
  const [assets,setAssets] = useState<SiteAsset[]>([]), [error,setError] = useState('')
  const [revision,setRevision]=useState(0)
  useEffect(()=>{const refresh=()=>setRevision(n=>n+1);window.addEventListener('prosota-site-assets-changed',refresh);return()=>window.removeEventListener('prosota-site-assets-changed',refresh)},[])
  useEffect(()=>{let active=true; setAssets([]); setError(''); void api.get<SiteAsset[]>('/api/v1/site-assets/',{params:{project_id:projectId}}).then(r=>{if(active)setAssets(r.data)}).catch(()=>{if(active)setError('Could not load asset library')});return()=>{active=false}},[projectId,revision])
  return {assets,setAssets,error,setError}
}
