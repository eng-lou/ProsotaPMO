import * as THREE from 'three'

// Animation is instance data, not a reason to turn every IFC representation
// into a Mesh. Two texels per slot: world clip plane, then opacity. Zero normal
// disables clipping. Separate from surface/selection alpha and section planes.
type State = { texture: THREE.DataTexture; revision: number }
const states = new WeakMap<THREE.BatchedMesh, State>()
const patched = new WeakMap<THREE.Material, { compile: THREE.Material['onBeforeCompile']; uniform: { value: THREE.Texture } }>()
const mirrors = new WeakMap<THREE.BatchedMesh, { source: THREE.BatchedMesh; ids: Int32Array; revision: number }>()
const box = new THREE.Box3(), matrix = new THREE.Matrix4()

function patch(material: THREE.Material, state: State) {
  let binding = patched.get(material)
  if (!binding || binding.compile !== material.onBeforeCompile) {
    const previous = material.onBeforeCompile
    const key = material.customProgramCacheKey.call(material)
    const uniform = { value: state.texture as THREE.Texture }
    const compile: THREE.Material['onBeforeCompile'] = function (this: THREE.Material, shader, renderer) {
      previous.call(this, shader, renderer)
      shader.uniforms.prosotaAnimation = uniform
      // AO normal passes omit the common/alpha chunks used by colour passes.
      // Supply them too so clipped or faded solids cannot leave solid AO ghosts.
      if (!shader.fragmentShader.includes('#include <common>')) shader.fragmentShader = '#include <common>\n' + shader.fragmentShader
      if (!shader.fragmentShader.includes('#include <alphahash_pars_fragment>')) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n#include <alphahash_pars_fragment>')
      }
      if (!shader.fragmentShader.includes('#include <alphahash_fragment>')) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n#include <alphahash_fragment>')
      }
      if (material.userData.prosotaBatchEdges) shader.vertexShader = '#define PROSOTA_BATCH_EDGES\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        uniform sampler2D prosotaAnimation;
        varying vec4 vProsotaClip;
        varying vec3 vProsotaWorld;
        varying float vProsotaOpacity;
        #ifdef PROSOTA_BATCH_EDGES
        attribute float prosotaAnimationSlot;
        #endif`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vProsotaClip = vec4(0.0); vProsotaOpacity = 1.0; vProsotaWorld = vec3(0.0);
          #ifdef USE_BATCHING
          int prosotaSlot = int(getIndirectIndex(gl_DrawID)) * 2;
          #elif defined(PROSOTA_BATCH_EDGES)
          int prosotaSlot = int(prosotaAnimationSlot) * 2;
          #endif
          #if defined(USE_BATCHING) || defined(PROSOTA_BATCH_EDGES)
          int prosotaWidth = textureSize(prosotaAnimation, 0).x;
          vProsotaClip = texelFetch(prosotaAnimation, ivec2(prosotaSlot % prosotaWidth, prosotaSlot / prosotaWidth), 0);
          vProsotaOpacity = texelFetch(prosotaAnimation, ivec2((prosotaSlot+1) % prosotaWidth, (prosotaSlot+1) / prosotaWidth), 0).x;
          #ifdef USE_BATCHING
          vProsotaWorld = (modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz;
          #else
          vProsotaWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #endif
          #endif`)
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec4 vProsotaClip;
        varying vec3 vProsotaWorld;
        varying float vProsotaOpacity;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (dot(vProsotaWorld, vProsotaClip.xyz) + vProsotaClip.w < 0.0) discard;
          if (vProsotaOpacity <= 0.001) discard;`)
        .replace('#include <alphahash_fragment>', 'diffuseColor.a *= vProsotaOpacity;\n#include <alphahash_fragment>')
    }
    material.onBeforeCompile = compile
    material.customProgramCacheKey = () => key + '-batch-animation-v1'
    patched.set(material, binding = { compile, uniform })
    material.needsUpdate = true
  }
  binding.uniform.value = state.texture
  // Opaque batches use coverage fading, so one fading element never moves the
  // entire building into the blended pass or writes invisible depth. Existing
  // glass/surface passes retain their authored blending.
  const hash = !material.transparent
  if (material.alphaHash !== hash) { material.alphaHash = hash; material.needsUpdate = true }
}

export function ensureBatchAnimation(mesh: THREE.BatchedMesh): State {
  let state = states.get(mesh)
  if (state) return state
  const count = (mesh as THREE.BatchedMesh & { _maxInstanceCount: number })._maxInstanceCount
  const size = Math.max(2, Math.ceil(Math.sqrt(count * 2) / 2) * 2)
  const data = new Float32Array(size * size * 4)
  for (let i = 4; i < data.length; i += 8) data[i] = 1
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  states.set(mesh, state = { texture, revision: 0 })
  const addInstance = mesh.addInstance
  mesh.addInstance = function (geometryId) {
    const id = addInstance.call(this, geometryId)
    setBatchAnimation(mesh, id, 1)
    return id
  }
  const before = mesh.onBeforeRender, shadow = mesh.onBeforeShadow
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  const distance = new THREE.MeshDistanceMaterial()
  const oldDepth = mesh.customDepthMaterial, oldDistance = mesh.customDistanceMaterial
  if (!oldDepth) mesh.customDepthMaterial = depth
  if (!oldDistance) mesh.customDistanceMaterial = distance
  mesh.onBeforeRender = function (...args) {
    before.apply(this, args)
    syncBatchAnimationMirror(mesh)
    patch(args[4], state!)
  }
  mesh.onBeforeShadow = function (...args) {
    shadow.apply(this, args)
    syncBatchAnimationMirror(mesh)
    patch(args[5], state!)
  }
  const originalDispose = mesh.dispose
  mesh.dispose = function () {
    texture.dispose(); depth.dispose(); distance.dispose()
    mesh.onBeforeRender = before; mesh.onBeforeShadow = shadow
    if (mesh.customDepthMaterial === depth) mesh.customDepthMaterial = oldDepth
    if (mesh.customDistanceMaterial === distance) mesh.customDistanceMaterial = oldDistance
    states.delete(mesh); mirrors.delete(mesh)
    mesh.addInstance = addInstance
    mesh.dispose = originalDispose
    return originalDispose.call(mesh)
  }
  return state
}

export function setBatchAnimation(mesh: THREE.BatchedMesh, id: number, opacity: number, plane?: THREE.Plane | null) {
  const state = ensureBatchAnimation(mesh), data = state.texture.image.data as Float32Array, at = id * 8
  if (at < 0 || at + 7 >= data.length) return
  const values = [plane?.normal.x ?? 0, plane?.normal.y ?? 0, plane?.normal.z ?? 0, plane?.constant ?? 0, opacity]
  let changed = false
  for (let i = 0; i < values.length; i++) {
    const value = Math.fround(values[i])
    if (data[at + i] !== value) { data[at + i] = value; changed = true }
  }
  if (changed) { state.texture.needsUpdate = true; state.revision++ }
}

export function clearBatchAnimation(mesh: THREE.BatchedMesh, ids: Iterable<number>) {
  if (!states.has(mesh)) return
  for (const id of ids) setBatchAnimation(mesh, id, 1)
}

// Surface batches have compact slot numbers; preserve the explicit source-slot
// mapping instead of accidentally clipping the same-numbered different element.
export function bindBatchAnimationMirror(source: THREE.BatchedMesh, target: THREE.BatchedMesh, ids: Int32Array) {
  mirrors.set(target, { source, ids, revision: -1 })
  const before = target.onBeforeRender
  target.onBeforeRender = function (...args) {
    before.apply(this, args)
    if (states.has(source)) {
      syncBatchAnimationMirror(target)
      patch(args[4], states.get(target)!)
    }
  }
}

function syncBatchAnimationMirror(target: THREE.BatchedMesh) {
  const mirror = mirrors.get(target), source = mirror && states.get(mirror.source)
  if (!mirror || !source || mirror.revision === source.revision) return
  const state = ensureBatchAnimation(target), data = state.texture.image.data as Float32Array
  const sourceData = source.texture.image.data as Float32Array
  for (let i = 0; i < mirror.ids.length; i++) data.set(sourceData.subarray(mirror.ids[i] * 8, mirror.ids[i] * 8 + 8), i * 8)
  state.texture.needsUpdate = true; state.revision++; mirror.revision = source.revision
}

export function batchPieceWorldBounds(mesh: THREE.BatchedMesh, geometryId: number, restMatrix: THREE.Matrix4) {
  mesh.updateWorldMatrix(true, false)
  mesh.getBoundingBoxAt(geometryId, box)
  return box.clone().applyMatrix4(matrix.multiplyMatrices(mesh.matrixWorld, restMatrix))
}

export function batchAnimationRevision(mesh: THREE.BatchedMesh) { return states.get(mesh)?.revision ?? 0 }

export function bindBatchAnimationEdges(source: THREE.BatchedMesh, edges: THREE.InstancedMesh, ids: number[]) {
  edges.geometry.setAttribute('prosotaAnimationSlot', new THREE.InstancedBufferAttribute(new Float32Array(ids), 1))
  const before = edges.onBeforeRender
  const material = (edges.material as THREE.Material).clone()
  material.userData.prosotaBatchEdges = true
  edges.material = material
  edges.onBeforeRender = function (...args) {
    before.apply(this, args)
    const state = states.get(source)
    if (state) patch(args[4], state)
  }
}
