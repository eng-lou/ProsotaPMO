import { useFrame } from '@react-three/fiber'
import { type Group } from 'three'
import type { MutableRefObject } from 'react'
import type { SiteItem } from './siteScene'
import { attachmentNode } from './workerActions'
import { applyAttachmentTransform, suspendAttachmentTransform } from './attachmentTransform'

export function SiteAttachments({items,roots,dateRef}:{items:SiteItem[];roots:MutableRefObject<Map<string,Group>>;dateRef:MutableRefObject<Date|null>}){
  // Registered after the equipment playback and actors: their anchors are current.
  useFrame(()=>{
    const date=dateRef.current?.getTime()??NaN,done=new Set<string>()
    const apply=(item:SiteItem,visiting=new Set<string>())=>{
      if(done.has(item.id)||visiting.has(item.id))return
      visiting.add(item.id)
      const object=roots.current.get(item.id),motion=object?.parent
      if(!object||!motion)return
      // The simulator sets ownership before other animation systems run.
      // Avoid changing its pose or visibility, including outside this interval.
      if(object.userData.simulatorOwnsPose){suspendAttachmentTransform(object);done.add(item.id);return}
      motion.visible=true
      const a=item.attachment
      if(!a){applyAttachmentTransform(object,item,null);done.add(item.id);return}
      const parentItem=items.find(i=>i.id===a.parent_id)
      if(parentItem)apply(parentItem,visiting)
      const active=date>=Date.parse(a.start)&&date<Date.parse(a.end)
      motion.visible=active||!a.only_during
      if(!active){applyAttachmentTransform(object,item,null);done.add(item.id);return}
      const parent=roots.current.get(a.parent_id),anchor=parent&&attachmentNode(parent,a.node)
      if(!anchor){applyAttachmentTransform(object,item,null);done.add(item.id);return}
      for(let n:typeof anchor|null=anchor;n;n=n.parent)if(!n.visible){motion.visible=false;break}
      applyAttachmentTransform(object,item,anchor);done.add(item.id)
    }
    items.forEach(i=>apply(i))
  })
  return null
}
