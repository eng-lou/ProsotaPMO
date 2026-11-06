import * as T from 'three'
import type { SiteContext } from './siteContext'
export interface ReconstructionArea {width:number;depth:number;east:number;north:number;serial:number;error?:string}
export function planArea(camera:T.Camera,ctx:SiteContext,upAxis:'y'|'z'):ReconstructionArea{
  const vertical=new T.Vector3(0,upAxis==='y'?1:0,upAxis==='z'?1:0)
  if(!(camera instanceof T.OrthographicCamera)||camera.getWorldDirection(new T.Vector3()).dot(vertical)>-.9999)throw Error('Set plan view first, then pan and zoom to the reconstruction area.')
  const offset=new T.Vector3(ctx.offset_x,ctx.offset_y,ctx.offset_z),plane=new T.Plane().setFromNormalAndCoplanarPoint(vertical,offset),points:T.Vector3[]=[]
  camera.updateMatrixWorld(true)
  for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(x,y),camera);const p=ray.ray.intersectPlane(plane,new T.Vector3());if(!p)throw Error('The plan frame does not intersect site ground.');p.sub(offset).applyAxisAngle(vertical,-ctx.offset_yaw_deg*Math.PI/180).divideScalar(ctx.scale);points.push(new T.Vector3(p.x,upAxis==='z'?p.y:-p.z,0))}
  const box=new T.Box3().setFromPoints(points),size=box.getSize(new T.Vector3()),centre=box.getCenter(new T.Vector3())
  if(Math.min(size.x,size.y)<100||Math.max(size.x,size.y)>1500)throw Error('Pan/zoom to an area between 100 and 1,500 metres on each side, then use the plan frame again.')
  return {width:Math.ceil(size.x),depth:Math.ceil(size.y),east:centre.x,north:centre.y,serial:Date.now()}
}
