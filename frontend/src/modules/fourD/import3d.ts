import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { captureBaseline, captureOriginalMaterialsRecursive } from './elementBaseline'

// "Import 3D" (2026-07-10, per Maro) — GLTF/GLB, OBJ, FBX via three.js's own
// mature, stable loaders (already available through the `three` package
// installed last session) — no new dependency, unlike IFC (see ifcModel.ts).
export async function loadModel3DFile(file: File): Promise<THREE.Object3D> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const buffer = await file.arrayBuffer()
  const object = await parseModel3DFile(ext, buffer)
  // Whatever root-level position/rotation/scale the file itself carries
  // (usually identity, but not always) — captured here so TransformPanel.tsx's
  // hover-Backspace reset snaps back to that instead of a hardcoded 0/1
  // (2026-07-09, per Maro — see elementBaseline.ts's own header).
  captureBaseline(object)
  // Every mesh's own original material, not just the root's — a mesh-kind
  // import can contain many meshes with independent materials, unlike an
  // IFC group's own per-mesh capture at creation time — so clearing a
  // texture override later actually restores what the file itself carried
  // (2026-07-09, per Maro: "when i change the material and delete the
  // material, it doesn't actually go back to the default").
  captureOriginalMaterialsRecursive(object)
  return object
}

async function parseModel3DFile(ext: string | undefined, buffer: ArrayBuffer): Promise<THREE.Object3D> {
  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader()
    const gltf = await loader.parseAsync(buffer, '')
    return gltf.scene
  }
  if (ext === 'obj') {
    const loader = new OBJLoader()
    const text = new TextDecoder().decode(buffer)
    return loader.parse(text)
  }
  if (ext === 'fbx') {
    const loader = new FBXLoader()
    return loader.parse(buffer, '')
  }
  throw new Error(`Unsupported 3D file type: .${ext ?? '?'} — supported: .glb, .gltf, .obj, .fbx`)
}

// Frees GPU-side geometry/material/texture memory for an unloaded "Import
// 3D" object — mirrors ifcModel.ts's disposeIfcModel, minus the WASM model
// close (plain meshes have no IfcAPI handle to release).
export function disposeObject3D(object: THREE.Object3D) {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const mat of materials) {
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      mat.dispose()
    }
  })
}
