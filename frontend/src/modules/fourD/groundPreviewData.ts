import { BufferAttribute, BufferGeometry, Group, Material, Mesh, MeshStandardMaterial } from 'three'
import type { GroundOptions, GroundPiece } from './groundFromObjects'

type Slot = { slot?:number; color:number; roughness:number }
type MeshData = {
  position:Float32Array; normal?:Float32Array; uv?:Float32Array; index?:Uint16Array|Uint32Array
  groups:BufferGeometry['groups']; range:BufferGeometry['drawRange']; materials:Slot[]; multi:boolean
}
export type GroundMeshData = MeshData[]
export interface GroundRequest {
  base:GroundMeshData|null; cuts:{id:string;name:string;rings:number[][][];top:number;bottom:number;meshes:GroundMeshData}[]
  phased:boolean; space:number; blind:number; options:GroundOptions; wasmPath:string
}
type PieceData = { phase?:GroundPiece['phase']; sourceId?:string; scene:GroundMeshData; anchor:number[]; label:string; hosts:number; sourceRefs?:string[] }
export type GroundMessage = { progress:string } | { error:string } | { pieces:PieceData[]; skipped:string[] }

// All inputs are independent, baked Y-up snapshots. Transfer only their geometry.
// Live textures stay on the UI thread and return to their original material slots.
export function packGroundMeshes(group:Group, transfer:ArrayBuffer[], originals?:Material[], geometryOnly=false):GroundMeshData {
  return group.children.map(node => {
    const {geometry:g,material} = node as Mesh
    function attribute(name:string) {
      const attr=g.getAttribute(name)
      if (!attr) return undefined
      let values:Float32Array
      if (attr instanceof BufferAttribute && attr.array instanceof Float32Array && !attr.normalized) values=attr.array
      else {
        values=new Float32Array(attr.count*attr.itemSize)
        for(let i=0;i<attr.count;i++)for(let j=0;j<attr.itemSize;j++)values[i*attr.itemSize+j]=attr.getComponent(i,j)
      }
      transfer.push(values.buffer as ArrayBuffer)
      return values
    }
    const index=g.index ? (g.index.array instanceof Uint16Array ? g.index.array : new Uint32Array(g.index.array)) : undefined
    if(index)transfer.push(index.buffer as ArrayBuffer)
    const multi=Array.isArray(material)
    const materials=(multi?material:[material]).map(mat=>{
      const m=mat as MeshStandardMaterial
      const saved=/^ground-slot-(\d+)$/.exec(m.name)
      const slot=originals ? originals.push(m.clone())-1 : saved?Number(saved[1]):undefined
      return {slot,color:m.color?.getHex()??0xffffff,roughness:m.roughness??1}
    })
    return {position:attribute('position')!,normal:geometryOnly?undefined:attribute('normal'),uv:geometryOnly?undefined:attribute('uv'),
      index,groups:g.groups,range:g.drawRange,materials,multi}
  })
}

export function unpackGroundMeshes(data:GroundMeshData, originals?:Material[]):Group {
  const group=new Group()
  for(const d of data){
    const geometry=new BufferGeometry().setAttribute('position',new BufferAttribute(d.position,3))
    if(d.normal)geometry.setAttribute('normal',new BufferAttribute(d.normal,3))
    if(d.uv)geometry.setAttribute('uv',new BufferAttribute(d.uv,2))
    if(d.index)geometry.setIndex(new BufferAttribute(d.index,1))
    geometry.groups=d.groups
    geometry.setDrawRange(d.range.start,d.range.count)
    const materials=d.materials.map(m=>{
      if(m.slot!==undefined && originals?.[m.slot])return originals[m.slot].clone()
      const material=new MeshStandardMaterial({color:m.color,roughness:m.roughness})
      if(m.slot!==undefined)material.name='ground-slot-'+m.slot
      return material
    })
    group.add(new Mesh(geometry,d.multi?materials:materials[0]))
  }
  return group
}
