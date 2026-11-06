import { Euler, Matrix4, MathUtils, Quaternion, Vector3, type Object3D } from 'three'
import type { SiteItem } from './siteScene'

const applied = new WeakMap<Object3D, string>()
const unit = new Vector3(1, 1, 1)

/** Another animation system temporarily owns the object. Do not restore over
 * its pose, but reapply the saved grip when attachment playback resumes. */
export function suspendAttachmentTransform(object:Object3D){
  applied.delete(object)
  delete object.userData.siteAttachmentActive
}

/** Keep the editable object in the anchor's metre-based coordinate frame.
 * Moving the parent each frame must not cancel a gizmo edit on its child. */
export function applyAttachmentTransform(object:Object3D,item:SiteItem,anchor:Object3D|null){
  const motion=object.parent
  if(!motion)return
  const a=item.attachment
  if(!a||!anchor){
    if(applied.has(object)){
      object.position.set(item.position.x,item.position.y,item.position.z)
      object.rotation.set(item.rotation?.x||0,item.rotation?.y||0,item.rotation?.z||0)
      object.updateMatrix()
      applied.delete(object)
    }
    delete object.userData.siteAttachmentActive
    return
  }
  const signature=JSON.stringify([a.parent_id,a.node,a.position,a.rotation])
  if(applied.get(object)!==signature){
    object.position.set(a.position.x,a.position.y,a.position.z)
    object.quaternion.setFromEuler(new Euler(MathUtils.degToRad(a.rotation.x),MathUtils.degToRad(a.rotation.y),MathUtils.degToRad(a.rotation.z)))
    object.updateMatrix()
    applied.set(object,signature)
  }
  anchor.updateWorldMatrix(true,false)
  const p=new Vector3(),q=new Quaternion()
  anchor.matrixWorld.decompose(p,q,new Vector3())
  motion.parent?.updateWorldMatrix(true,false)
  const frame=new Matrix4().copy(motion.parent?.matrixWorld||new Matrix4()).invert().multiply(new Matrix4().compose(p,q,unit))
  frame.decompose(motion.position,motion.quaternion,motion.scale)
  motion.updateWorldMatrix(true,true)
  object.userData.siteAttachmentActive=true
}

/** Used by both the viewport gizmo and the numeric transform panel. */
export function captureAttachmentTransform(item:SiteItem,object:Object3D){
  if(!item.attachment||!object.userData.siteAttachmentActive)return null
  const rotation=new Euler().setFromQuaternion(object.quaternion,'XYZ')
  return {
    attachment:{...item.attachment,position:{x:object.position.x,y:object.position.y,z:object.position.z},
      rotation:{x:MathUtils.radToDeg(rotation.x),y:MathUtils.radToDeg(rotation.y),z:MathUtils.radToDeg(rotation.z)}},
    scale:{x:object.scale.x,y:object.scale.y,z:object.scale.z},
  }
}
