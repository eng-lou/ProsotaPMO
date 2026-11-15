import {useEffect,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import * as THREE from 'three'
import {isOfflineExportActive} from './IdleRenderDriver'
import {registerContextGeometry, type ContextGeometryData} from './contextGeometry'

const cache=new WeakMap<THREE.BufferGeometry,Promise<THREE.BufferGeometry|null>>()
let queue=Promise.resolve()
export function contextDetailGeometry(source:THREE.BufferGeometry) {
  let pending=cache.get(source)
  if(pending)return pending
  const count=source.index?.count??source.getAttribute('position')?.count??0
  if(count<150000 || source.groups.length>0 || Object.keys(source.morphAttributes).length || Object.keys(source.attributes).some(name=>!['position','normal','uv'].includes(name)) || source.drawRange.start!==0 || source.drawRange.count!==Infinity || typeof Worker==='undefined')return Promise.resolve(null)
  pending=queue.then(()=>new Promise<THREE.BufferGeometry|null>(resolve=>{
    const worker=new Worker(new URL('./contextGeometry.worker.ts',import.meta.url),{type:'module'})
    const finish=(geometry:THREE.BufferGeometry|null)=>{worker.terminate();resolve(geometry)}
    worker.onerror=()=>finish(null)
    worker.onmessage=({data}:MessageEvent<ContextGeometryData>)=>{
      if(data.index.length>=count*.85 || !data.index.length){finish(null);return}
      const geometry=new THREE.BufferGeometry()
      geometry.setAttribute('position',new THREE.BufferAttribute(data.position,3))
      if(data.normal)geometry.setAttribute('normal',new THREE.BufferAttribute(data.normal,3))
      if(data.uv)geometry.setAttribute('uv',new THREE.BufferAttribute(data.uv,2))
      geometry.setIndex(new THREE.BufferAttribute(data.index,1))
      registerContextGeometry(geometry, source)
      geometry.boundingBox=source.boundingBox?.clone()??null;geometry.boundingSphere=source.boundingSphere?.clone()??null
      source.addEventListener('dispose',()=>geometry.dispose())
      finish(geometry)
    }
    const copy=(name:string)=>{
      const a=source.getAttribute(name)
      if(!a)return undefined
      // Accessors also handle interleaved and normalised imported attributes.
      const result=new Float32Array(a.count*a.itemSize)
      for(let i=0;i<a.count;i++)for(let k=0;k<a.itemSize;k++)result[i*a.itemSize+k]=a.getComponent(i,k)
      return result
    }
    const position=copy('position')!,normal=copy('normal'),uv=copy('uv')
    const index=source.index?new Uint32Array(source.index.array):Uint32Array.from({length:count},(_,i)=>i)
    worker.postMessage({position,normal,uv,index},[position.buffer,index.buffer,...(normal?[normal.buffer]:[]),...(uv?[uv.buffer]:[])])
  }))
  queue=pending.then(()=>{},()=>{})
  cache.set(source,pending);return pending
}

// Only scattered static assets opt in. IFC, rigged characters, selected assets
// and captures retain their source geometry. Visibility remains owned by the
// timeline/isolation system: LOD changes geometry, never object.visible.
export function useContextDetail(object:THREE.Object3D|null,enabled:boolean,fullDetail:boolean) {
  const invalidate=useThree(s=>s.invalidate)
  const entries=useRef<{mesh:THREE.Mesh;source:THREE.BufferGeometry;coarse:THREE.BufferGeometry|null}[]>([])
  const last=useRef('')
  useEffect(()=>{
    entries.current=[];last.current=''
    if(!object || !enabled || object.animations.length)return
    let active=true
    object.traverse(node=>{
      if(!(node instanceof THREE.Mesh) || (node as THREE.SkinnedMesh).isSkinnedMesh || (node as THREE.InstancedMesh).isInstancedMesh)return
      const source=node.geometry
      if(!source.boundingSphere)source.computeBoundingSphere()
      const entry={mesh:node,source,coarse:null as THREE.BufferGeometry|null};entries.current.push(entry)
      void contextDetailGeometry(source).then(coarse=>{if(active){entry.coarse=coarse;last.current='';invalidate()}}).catch(()=>{})
    })
    const owned=entries.current
    return()=>{active=false;for(const e of owned)e.mesh.geometry=e.source;entries.current=[]}
  },[object,enabled,invalidate])
  useFrame(({camera,size})=>{
    if(!object || !entries.current.length)return
    const exact=fullDetail||isOfflineExportActive()
    object.updateWorldMatrix(true,false)
    const key=`${exact}|${size.height}|${camera.projectionMatrix.elements}|${camera.matrixWorld.elements}|${object.matrixWorld.elements}`
    if(key===last.current)return
    last.current=key
    for(const entry of entries.current){
      const sphere=entry.source.boundingSphere
      if(!sphere||!entry.coarse)continue
      entry.mesh.updateWorldMatrix(true,false)
      const world=sphere.clone().applyMatrix4(entry.mesh.matrixWorld)
      const pixels=camera instanceof THREE.PerspectiveCamera
        ? world.radius*size.height/(2*Math.max(.001,camera.position.distanceTo(world.center))*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2))
        : camera instanceof THREE.OrthographicCamera?world.radius*size.height*camera.zoom/(camera.top-camera.bottom):Infinity
      // Hysteresis prevents switching repeatedly around the threshold.
      const threshold=entry.mesh.geometry===entry.coarse?65:50
      entry.mesh.geometry=!exact&&pixels<threshold?entry.coarse:entry.source
    }
  },-90)
}
