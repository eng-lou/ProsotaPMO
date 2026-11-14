import { materialScope } from './materialScope'
import * as T from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { GeographicContext, MapFeature, XY } from './geographicContext'
import { getRealisticVariant, REALISTIC_CLASSES, type RealisticMaterialMap } from './realisticMaterials'
import { buildingProfile, buildingSurfaces } from './geographicBuilding'
import { editableMapFeatures, geographicMaterialKey, type FeatureRange } from './geographicSelection'
import { applySiteSurfaceOpacity, siteMaterialLook } from './siteAssetMaterials'

// Canonical ENU (Z-up). Data owns footprints; procedural detail is explicitly an estimate.
// Batch by layer and material so a neighbourhood does not create thousands of draw calls.
const seedFor = (s: string) => [...s].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))|0,17) >>> 0
function random(seed: number) { return () => ((seed = Math.imul(seed,1664525)+1013904223 >>> 0) / 4294967296) }
export function pointInRing(p: XY, ring: XY[]) {
  let inside=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) { const a=ring[i],b=ring[j]; if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside }
  return inside
}
function inside(p: XY,f: MapFeature) { return pointInRing(p,f.points) && !f.holes.some(h=>pointInRing(p,h)) }
function shapeOf(f: Pick<MapFeature,'points'|'holes'>) {
  const shape = new T.Shape(f.points.map(p=>new T.Vector2(...p)))
  shape.holes = f.holes.map(h=>new T.Path(h.map(p=>new T.Vector2(...p))))
  return shape
}
function texture(style: string) {
  if(typeof document==='undefined')return null
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256
  const ctx=canvas.getContext('2d')!, rand=random(seedFor(style)), im=ctx.createImageData(256,256)
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const i=(y*256+x)*4, grain=(rand()-.5)*(style==='grass'?50:22)
    const broad=style==='grass'?16*Math.sin(x*.045+Math.sin(y*.048)*2)+9*Math.cos(y*.09+x*.06):0
    const seam=style==='roof' && x%32<2?-27:style==='paving' && (x%64<1||y%64<1)?-20:0
    const v=225+grain+broad+seam
    im.data[i]=v;im.data[i+1]=v;im.data[i+2]=v;im.data[i+3]=255
  }
  ctx.putImageData(im,0,0)
  const map=new T.CanvasTexture(canvas);map.wrapS=map.wrapT=T.RepeatWrapping;map.colorSpace=T.SRGBColorSpace;map.anisotropy=8;return map
}

export function buildGeographicContext(data: GeographicContext, treeTemplate?: T.Object3D | null, options: {itemId?:string;mapping?:RealisticMaterialMap;assets?:Map<string,T.Object3D>;solidOnly?:boolean} = {}) {
  const root=new T.Group();root.name='Open geographic context';root.userData.attribution=data.attribution
  const mats=new Map<string,T.MeshStandardMaterial>(), maps=new Map<string,T.Texture|null>()
  const batches=new Map<string,{layer:string,mat:T.Material,geos:T.BufferGeometry[];ranges:FeatureRange[];count:number}>()
  let currentFeature:MapFeature|undefined
  const overrides=new Map<string,T.Material>()
  const detailed=data.detail==='detailed'
  let detailCount=0
  const mat=(name:string,color:string,style='',metalness=0)=>{
    const key=name+color
    if(!mats.has(key)){
      if(style&&!maps.has(style))maps.set(style,texture(style))
      const source=new T.MeshStandardMaterial({color,roughness:name==='glass'?.3:.88,metalness,map:maps.get(style)||null})
      const m=style==='grass' ? getRealisticVariant(source,15,source.color.clone(),false) as T.MeshStandardMaterial : source
      if(m!==source)source.dispose()
      m.name=name;mats.set(key,m)
    } return mats.get(key)!
  }
  const add=(layer:string,g:T.BufferGeometry,m:T.Material,surface=m.name)=>{
    if(currentFeature){
      const family=currentFeature.kind!=='building'?'surface':surface.startsWith('wall:')?'walls':surface
      const key=geographicMaterialKey(options.itemId||'',currentFeature.kind,family)
      const authored=currentFeature.replacement?currentFeature.surfaces?.[surface]:currentFeature.surfaces?.[surface] || currentFeature.surfaces?.[family] || currentFeature.surfaces?.surface
      const mapping = options.mapping && materialScope(options.mapping, 'feature:' + currentFeature.id)
      const cache = JSON.stringify([m.uuid, key, authored, mapping?.[key], mapping?.['colour:' + key], mapping?.['texture:' + key], mapping?.['opacity:' + key]])
      if((authored || mapping?.[key] || mapping?.['colour:' + key] || mapping?.['opacity:' + key]) && m instanceof T.MeshStandardMaterial){
        if(!overrides.has(cache)){let next=m.clone();applySiteSurfaceOpacity(next,key,mapping ?? {});if(authored?.color)next.color.set(authored.color)
          if(authored?.finish && authored.finish!=='original'){const variant=getRealisticVariant(next,REALISTIC_CLASSES.indexOf(authored.finish)+1,next.color.clone(),false) as T.MeshStandardMaterial;next.dispose();next=variant}
          else if(!authored&&mapping)next=siteMaterialLook(next,key,mapping,false)
          overrides.set(cache,next)}m=overrides.get(cache)!
      }
    }
    let geo=g.index?g.toNonIndexed():g;if(geo!==g)g.dispose()
    for(const k of Object.keys(geo.attributes))if(!['position','normal','uv'].includes(k))geo.deleteAttribute(k)
    if(!geo.attributes.normal)geo.computeVertexNormals()
    if(!geo.attributes.uv)geo.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(geo.attributes.position.count*2),2))
    const key=layer+m.uuid;if(!batches.has(key))batches.set(key,{layer,mat:m,geos:[],ranges:[],count:0});const batch=batches.get(key)!;batch.geos.push(geo);if(currentFeature)batch.ranges.push({featureId:currentFeature.id,surface,start:batch.count,count:geo.attributes.position.count});batch.count+=geo.attributes.position.count
  }
  const box=(layer:string,x:number,y:number,z:number,w:number,d:number,h:number,m:T.Material,angle=0)=>{
    if(layer!=='base' && ++detailCount>20000)return
    const g=new T.BoxGeometry(w,d,h);g.rotateZ(angle);g.translate(x,y,z+h/2);add(layer,g,m)
  }
  const surface=(f:Pick<MapFeature,'points'|'holes'>,z:number,layer:string,m:T.Material,scale=5)=>{
    const g=new T.ShapeGeometry(shapeOf(f)),p=g.attributes.position,u=g.attributes.uv
    for(let i=0;i<p.count;i++){u.setXY(i,p.getX(i)/scale,p.getY(i)/scale);p.setZ(i,z)}add(layer,g,m)
  }
  const line=(ps:XY[],width:number,z:number,layer:string,m:T.Material)=>{
    if(ps.length<2)return
    const verts:number[]=[],uv:number[]=[];let distance=0
    const edges=ps.slice(1).map((p,i)=>{const a=ps[i],len=Math.hypot(p[0]-a[0],p[1]-a[1])||1;return {n:[-(p[1]-a[1])/len,(p[0]-a[0])/len] as XY,len}})
    const ends=ps.map((p,i)=>{
      const a=edges[Math.max(0,i-1)].n,b=edges[Math.min(i,edges.length-1)].n
      const n=new T.Vector2(a[0]+b[0],a[1]+b[1]).normalize();const d=Math.max(.35,n.x*b[0]+n.y*b[1]);return [p[0]+n.x*width/2/d,p[1]+n.y*width/2/d,p[0]-n.x*width/2/d,p[1]-n.y*width/2/d]
    })
    for(let i=0;i<ps.length-1;i++){
      const a=ends[i],b=ends[i+1],dist=edges[i].len
      for(const [x,y,u,v] of [[a[0],a[1],0,distance],[a[2],a[3],width,distance],[b[0],b[1],0,distance+dist],[b[0],b[1],0,distance+dist],[a[2],a[3],width,distance],[b[2],b[3],width,distance+dist]]){verts.push(x,y,z);uv.push(u/4,v/4)}distance+=dist
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));add(layer,g,m)
  }
  const base=mat('ground','#e0dfd6'),kerb=mat('kerb','#eeeae0'),walk=mat('walk','#d7d6cc','paving'),paint=mat('paint','#f4f1e6')
  if(!options.solidOnly)box('base',0,0,-1.3,data.width,data.depth,1.3,base)
  const hidden=new Set(data.hidden_layers),features=editableMapFeatures(data).filter(f=>!f.hidden&&!hidden.has(f.kind)&&!(f.id.includes('~tree-')&&(hidden.has('wood')||data.features.find(w=>w.id===f.id.split('~tree-')[0])?.hidden)))
  const nativeFeatures=features.filter(f=>!f.replacement)
  const roads=nativeFeatures.filter(f=>f.kind==='road')
  // Land-use parcels under detailed surfaces; parking-bay detail is an estimate.
  for(const f of nativeFeatures.filter(f=>['paving','grass','wood','water'].includes(f.kind)).sort((a,b)=>a.kind==='paving'?-1:b.kind==='paving'?1:0)){
    currentFeature=f
    const turf=f.kind==='grass'||f.kind==='wood'
    const color=f.color
    surface(f,turf?.075:f.kind==='water'?.025:f.category==='estimated_parking'?.04:.02,f.kind,mat(f.kind,color,turf?'grass':'paving'),turf?9:4)
  }
  const junctions=roads.flatMap(f=>[f.points[0],f.points[f.points.length-1]])
  for(const f of roads){
    currentFeature=f
    const foot=['footway','path','cycleway','steps','pedestrian'].includes(f.category),w=f.width
    if(!foot&&!['service','parking_aisle','estimated_parking_aisle'].includes(f.category)){line(f.points,w+2.6,.085,'road',walk);line(f.points,w+.35,.105,'road',kerb)}
    line(f.points,w,foot?.12:.125,'road',mat(foot?'walk':'asphalt',f.color,foot?'paving':'asphalt'))
    if(['parking_aisle','estimated_parking_aisle'].includes(f.category)&&detailed){
      for(let i=1;i<f.points.length;i++){
        const a=f.points[i-1],b=f.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<12)continue
        const dx=(b[0]-a[0])/len,dy=(b[1]-a[1])/len
        for(let s=3;s<len-3;s+=2.6)for(const side of [-1,1]){
          const x=a[0]+dx*s-dy*side*(w/2+2.4),y=a[1]+dy*s+dx*side*(w/2+2.4)
          box('road',x,y,.14,.10,4.5,.012,paint,Math.atan2(dy,dx))
        }
      }
    }
    if(!foot&&w>=6&&detailed){let total=0;for(let i=1;i<f.points.length;i++){
      const a=f.points[i-1],b=f.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue
      const dx=(b[0]-a[0])/len,dy=(b[1]-a[1])/len
      for(let s=(8-total%8)%8;s<len-3;s+=8){const x=a[0]+dx*s,y=a[1]+dy*s;if(junctions.some(p=>Math.hypot(p[0]-x,p[1]-y)<w*.85))continue
        box('road',x+dx*1.5,y+dy*1.5,.135,3,.13,.012,paint,Math.atan2(dy,dx))}total+=len
    }}
  }
  for(const f of nativeFeatures.filter(f=>f.kind==='rail')){
    currentFeature=f
    line(f.points,3.2,.13,'rail',mat('ballast','#aaa799','asphalt'))
    for(let i=1;i<f.points.length;i++){
      const a=f.points[i-1],b=f.points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.01)continue
      for(const off of [-.72,.72])line([[a[0]-dy/len*off,a[1]+dx/len*off],[b[0]-dy/len*off,b[1]+dx/len*off]],.08,.17,'rail',mat('steel','#a9aaa3','',.4))
      if(detailed)for(let s=0;s<len;s+=1.4)box('rail',a[0]+dx*s/len,a[1]+dy*s/len,.14,.2,2.5,.05,mat('sleepers','#7e7f75'),Math.atan2(dy,dx))
    }
  }
  for(const f of nativeFeatures.filter(f=>f.kind==='building')){
    currentFeature=f
    const {h,industrial,eave,angle,axis,normal,lo,hi,ulo,uhi,bays,bay,level}=buildingProfile(f)
    const wall=mat('walls',f.color,'paving')
    for(const part of buildingSurfaces(f))add('building',part.geometry,part.surface==='roof'?mat('roof',f.roof_color,'roof',.15):wall,part.surface)
    if(options.solidOnly)continue
    // Vertical gable closure and slim gutter/parapet. The mapped footprint is never replaced by a box.
    for(let i=0;i<f.points.length;i++){
      const a=f.points[i],b=f.points[(i+1)%f.points.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.2)continue
      const edgeAngle=Math.atan2(b[1]-a[1],b[0]-a[0]);box('building',(a[0]+b[0])/2,(a[1]+b[1])/2,eave+.14,len,.18,.18,mat('trim','#e3e1d8'),edgeAngle)
      if(!detailed||len<3.4||eave<2.8)continue
      // Thin double-sided boxes prevent face winding/clockwise footprint issues at window reveals.
      const count=Math.min(80,Math.floor(len/(industrial?7:3.6))),floors=industrial?1:Math.min(25,Math.max(1,Math.floor(eave/3.2)))
      for(let n=0;n<count;n++)for(let floor=0;floor<floors;floor++){
        const t=(n+.5)/count,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t
        const door=industrial&&n%3===1,z=door?.2:industrial?eave*.5:floor*3.2+1.2,w=door?3.2:industrial?2.5:1.5,wh=door?Math.min(4,eave-.5):industrial?1.1:1.45
        box('building',x,y,z,w+.18,.15,wh+.16,mat('reveal','#e3e0d6'),edgeAngle)
        box('building',x,y,z+.08,w,.19,wh,mat(door?'shutter':'glass',door?'#a2aba6':'#566e75',door?'roof':'',door?.35:.35),edgeAngle)
        if(!door)box('building',x,y,z+.08,.06,.21,wh,mat('mullion','#bfc8c5'),edgeAngle)
      }
    }
    if(industrial&&detailed){
      for(let u=ulo+5;u<uhi-3;u+=8)for(let b=0;b<bays;b++){
        const v=lo+(b+.28)*bay,quad:XY[]=[[-1.6,-.55],[1.6,-.55],[1.6,.55],[-1.6,.55]].map(([du,dv])=>[axis[0]*(u+du)+normal[0]*(v+dv),axis[1]*(u+du)+normal[1]*(v+dv)])
        if(!quad.every(p=>inside(p,f)))continue
        const vs=quad.flatMap(p=>[p[0],p[1],level(p)+.035]),sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(vs,3));sg.setIndex([0,1,2,0,2,3]);add('building',sg,mat('skylights','#8da4a5','',.25))
      }
    }else if(f.roof==='flat'&&detailed&&uhi-ulo>15&&hi-lo>12){
      for(let n=0;n<2;n++){const u=ulo+(uhi-ulo)*(.35+n*.25),v=lo+(hi-lo)*.5,p:XY=[axis[0]*u+normal[0]*v,axis[1]*u+normal[1]*v];if(inside(p,f))box('building',p[0],p[1],h+.2,2.2,3,1.1,mat('roof plant','#a1aaa6'),angle)}
    }
  }
  currentFeature=undefined
  const trees=options.solidOnly?[]:nativeFeatures.filter(f=>f.kind==='tree').map(f=>({id:f.id,point:f.points[0],height:f.height_basis==='estimated'?6+random(seedFor(f.id))()*3:f.height,seed:seedFor(f.id)}))
  if(trees.length && treeTemplate){
    treeTemplate.updateMatrixWorld(true)
    const b=new T.Box3().setFromObject(treeTemplate),size=b.getSize(new T.Vector3()),center=b.getCenter(new T.Vector3())
    const treeKey = geographicMaterialKey(options.itemId || '', 'tree', 'surface')
    const groups = new Map<string, {mapping: typeof options.mapping; trees: typeof trees}>()
    for (const tree of trees) {
      const mapping = options.mapping && materialScope(options.mapping, 'feature:' + tree.id)
      const look = JSON.stringify([mapping?.[treeKey], mapping?.['colour:' + treeKey], mapping?.['texture:' + treeKey], mapping?.['opacity:' + treeKey]])
      const group = groups.get(look)
      if (group) group.trees.push(tree)
      else groups.set(look, {mapping, trees: [tree]})
    }
    treeTemplate.traverse(o=>{if(!(o instanceof T.Mesh))return
      const geo=o.geometry.clone().applyMatrix4(o.matrixWorld).translate(-center.x,-b.min.y,-center.z)
      geo.rotateX(Math.PI/2);geo.scale(1/size.y,1/size.y,1/size.y)
      for (const {mapping, trees: group} of groups.values()) {
        const copy=(material:T.Material)=>{const value=material.clone();if(mapping && value instanceof T.MeshStandardMaterial)applySiteSurfaceOpacity(value,treeKey,mapping);return mapping&&value instanceof T.MeshStandardMaterial?siteMaterialLook(value,treeKey,mapping,false):value}
        const m=Array.isArray(o.material)?o.material.map(copy):copy(o.material),inst=new T.InstancedMesh(geo,m,group.length)
        for(const material of Array.isArray(m)?m:[m])if(material instanceof T.MeshStandardMaterial && material.alphaTest>0){material.alphaToCoverage=true;material.transparent=material.opacity<1;material.depthWrite=material.opacity>=1;material.emissiveMap=material.map;material.emissive.set('#a6b78a');material.emissiveIntensity=.35}
        inst.userData.featureInstances=group.map(t=>t.id);inst.name='tree · Poly Haven';group.forEach((t,i)=>{const rand=random(t.seed),height=t.height;inst.setMatrixAt(i,new T.Matrix4().compose(new T.Vector3(t.point[0],t.point[1],.14),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),rand()*Math.PI*2),new T.Vector3(height,height,height)));inst.setColorAt(i,new T.Color().setHSL(.23+rand()*.05,.13+rand()*.1,.72+rand()*.15))});inst.castShadow=inst.receiveShadow=true;inst.computeBoundingSphere();root.add(inst)
      }
    })
  }
  // Imported replacements are baked at their own static pose and batched by material.
  for(const f of features.filter(f=>f.replacement)){
    const r=f.replacement!,source=options.assets?.get(r.asset_id);if(!source)continue
    currentFeature=f;source.updateMatrixWorld(true)
    const slots=new Map<T.Material,number>();source.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(!slots.has(m))slots.set(m,slots.size)})
    let annotatedShell=false;source.traverse(o=>{if(o.userData.prosotaSurface==='bottom')annotatedShell=true})
    const transform=new T.Matrix4().compose(new T.Vector3(...r.anchor),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),r.yaw*Math.PI/180),new T.Vector3(1,1,1)).multiply(new T.Matrix4().makeRotationX(Math.PI/2)).multiply(new T.Matrix4().makeScale(r.width,r.height,r.depth))
    source.traverse(node=>{if(!(node instanceof T.Mesh))return
      if(options.solidOnly&&annotatedShell&&!/^(roof|bottom|wall:)/.test(node.userData.prosotaSurface||''))return
      const geo=node.geometry,materials=Array.isArray(node.material)?node.material:[node.material]
      for(const group of geo.groups.length?geo.groups:[{start:0,count:geo.index?.count||geo.attributes.position.count,materialIndex:0}]){
        const g=new T.BufferGeometry(),vertices:number[]=[],uv:number[]=[],point=new T.Vector3()
        for(let n=group.start;n<group.start+group.count;n++){const i=geo.index?geo.index.getX(n):n;node.getVertexPosition(i,point);point.applyMatrix4(node.matrixWorld).applyMatrix4(transform);vertices.push(...point.toArray());uv.push(geo.attributes.uv?.getX(i)||0,geo.attributes.uv?.getY(i)||0)}
        g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2))
        const original=materials[group.materialIndex||0],key='asset:'+original.uuid
        if(!overrides.has(key))overrides.set(key,original.clone());add(f.kind,g,overrides.get(key)!,'material:'+slots.get(original))
      }
    })
  }
  for(const batch of batches.values()){
    const geo=mergeGeometries(batch.geos);batch.geos.forEach(g=>g.dispose());if(!geo)continue
    const mesh=new T.Mesh(geo,batch.mat);mesh.userData.featureRanges=batch.ranges;mesh.name=batch.layer+' · '+batch.mat.name;mesh.castShadow=batch.layer==='building';mesh.receiveShadow=true;root.add(mesh)
  }
  // Bake finite study boundary into all geometry using render clipping; content stays independent of live tiles.
  const planes=[new T.Plane(new T.Vector3(1,0,0),data.width/2),new T.Plane(new T.Vector3(-1,0,0),data.width/2),new T.Plane(new T.Vector3(0,1,0),data.depth/2),new T.Plane(new T.Vector3(0,-1,0),data.depth/2)]
  root.userData.studyPlanes=planes
  root.userData.mapFeatureCount=data.features.length
  return root
}

export function disposeGeographicContext(root:T.Object3D){
  const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>()
  root.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}})
  geometries.forEach(g=>g.dispose());materials.forEach(m=>{for(const value of Object.values(m))if(value instanceof T.CanvasTexture)textures.add(value);m.dispose()});textures.forEach(t=>t.dispose())
}
