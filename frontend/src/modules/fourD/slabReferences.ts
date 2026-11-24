import {Vector2} from 'three'
import type {HostSource} from './constructionLayout'
import {readConstructionHost} from './constructionHost'
import type {SlabReference} from './enclosureOptions'

export interface ReferenceBay {
  key:string
  elevation:number
  a:[number,number]
  b:[number,number]
  status:'supported'|'review'|'gap'
  reason:string
  stairs:boolean
}

export function captureSlabReferences(sources:HostSource[],axis:'y'|'z'):SlabReference[] {
  if(!sources.length)throw Error('Select the floor slabs in the viewport or IFC tree.')
  const zero=new Vector2()
  return sources.map(source=>{
    if(source.ifcType&&!/^ifcslab/i.test(source.ifcType))throw Error('Select slabs only. '+source.name+' is a '+source.ifcType+'.')
    const host=readConstructionHost(source.name,source.object,axis,'slabTop')
    const offset=new Vector2(host.origin.x,host.origin.z)
    return {ref:source.backupRef??source.id,name:source.name,elevation:host.origin.y+host.height,
      rings:host.rings.map(r=>r.map(p=>p.clone().rotateAround(zero,host.angle).add(offset).toArray() as [number,number]))}
  })
}
