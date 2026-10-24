import * as THREE from 'three'

/** Capture a static, independent source in GLB's Y-up coordinates. Never mutate the live scene. */
export function arraySourceSnapshot(source: THREE.Object3D, upAxis: 'y'|'z', name: string, recenter = true) {
  source.updateWorldMatrix(true,true)
  const group=new THREE.Group();group.name=name
  const axis=new THREE.Matrix4().makeRotationX(upAxis==='z'?-Math.PI/2:0)
  source.traverse(node=>{
    const mesh=node as THREE.Mesh
    if(!mesh.isMesh || !mesh.geometry?.getAttribute('position'))return
    const stored=mesh.userData.standardMaterial
    const original=(stored && (Array.isArray(stored)?stored.every(m=>m?.isMaterial):stored.isMaterial) ? stored : mesh.material) as THREE.Material|THREE.Material[]
    const make=(matrix:THREE.Matrix4, tint?:THREE.Color)=>{
      const geometry=mesh.geometry.clone()
      // A single material ignores groups at render time. Preserve that behaviour
      // when downstream operations build material arrays (extrusions use group 1).
      if(!Array.isArray(original))geometry.clearGroups()
      if((mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences?.some(v=>v!==0)) {
        const positions=geometry.getAttribute('position'),point=new THREE.Vector3()
        for(let i=0;i<positions.count;i++){mesh.getVertexPosition(i,point);positions.setXYZ(i,point.x,point.y,point.z)}
        geometry.morphAttributes={};geometry.deleteAttribute('skinIndex');geometry.deleteAttribute('skinWeight');geometry.computeVertexNormals()
      }
      const transform=axis.clone().multiply(matrix)
      geometry.applyMatrix4(transform)
      if(transform.determinant()<0){
        if(!geometry.index)geometry.setIndex(Array.from({length:geometry.getAttribute('position').count},(_,i)=>i))
        const index=geometry.index!
        for(let i=0;i<index.count;i+=3){const a=index.getX(i);index.setX(i,index.getX(i+2));index.setX(i+2,a)}
      }
      const material=(mat:THREE.Material)=>{
        const result=mat.clone() as THREE.MeshStandardMaterial
        if(result.color && mat.userData.exportColour)result.color.set(mat.userData.exportColour)
        if(result.emissive && mat.userData.exportEmissive!==undefined){result.emissive.setHex(mat.userData.exportEmissive);result.emissiveIntensity=mat.userData.exportEmissiveIntensity}
        if(result.color && tint)result.color.multiply(mat.userData.exportInstanceColour?new THREE.Color(mat.userData.exportInstanceColour):tint)
        result.userData={};return result
      }
      const copy=new THREE.Mesh(geometry,Array.isArray(original)?original.map(material):material(original));copy.name=node.name;group.add(copy)
    }
    if((mesh as THREE.InstancedMesh).isInstancedMesh){
      const instanced=mesh as THREE.InstancedMesh
      for(let i=0;i<instanced.count;i++){const matrix=new THREE.Matrix4();instanced.getMatrixAt(i,matrix);const tint=instanced.instanceColor?new THREE.Color():undefined;if(tint)instanced.getColorAt(i,tint);make(mesh.matrixWorld.clone().multiply(matrix),tint)}
    }else make(mesh.matrixWorld)
  })
  if(!group.children.length)throw Error('This object has no mesh geometry to array')
  const box=new THREE.Box3().setFromObject(group),centre=box.getCenter(new THREE.Vector3())
  if (recenter) group.children.forEach(mesh=>(mesh as THREE.Mesh).geometry.translate(-centre.x,-box.min.y,-centre.z))
  return group
}
export function disposeArraySnapshot(group:THREE.Group) {
  group.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();for(const mat of Array.isArray(node.material)?node.material:[node.material])mat.dispose()}})
}
