import * as THREE from 'three'
export interface RevisionMesh { vertices: number[]; faces: number[] }
export interface RevisionGeometry { before: RevisionMesh | null; after: RevisionMesh | null }

// Both versions share one frame and scale; displacement must remain visible.
export function revisionScene(data: RevisionGeometry) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#111c30')
  const bounds = new THREE.Box3()
  const meshes: THREE.Mesh[] = []
  for (const [key, color] of [['before', '#f59b76'], ['after', '#66d9b0']] as const) {
    const source = data[key]
    if (!source?.vertices.length) continue
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.vertices, 3))
    geometry.setIndex(source.faces)
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    bounds.union(geometry.boundingBox!)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: .85,
      transparent: true, opacity: .65, depthWrite: false, wireframe: key === 'before' && !!data.after }))
    mesh.name = key
    meshes.push(mesh)
    scene.add(mesh)
  }
  const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3())
  meshes.forEach(m => m.position.sub(center))
  const radius = bounds.isEmpty() ? 1 : Math.max(bounds.getSize(new THREE.Vector3()).length(), .01)
  const camera = new THREE.PerspectiveCamera(35, 2, radius / 1000, radius * 50)
  camera.up.set(0, 0, 1)
  camera.position.set(radius, -radius, radius * .75)
  camera.lookAt(0, 0, 0)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 2))
  const light = new THREE.DirectionalLight(0xffffff, 2)
  light.position.set(radius, -radius, radius * 2)
  scene.add(light)
  return { scene, camera, meshes, dispose: () => meshes.forEach(m => { m.geometry.dispose(); (m.material as THREE.Material).dispose() }) }
}

export function revisionImage(data: RevisionGeometry): string {
  const view = revisionScene(data)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  try {
    renderer.setSize(720, 360)
    renderer.render(view.scene, view.camera)
    return renderer.domElement.toDataURL('image/png')
  } finally { view.dispose(); renderer.dispose(); renderer.forceContextLoss() }
}
