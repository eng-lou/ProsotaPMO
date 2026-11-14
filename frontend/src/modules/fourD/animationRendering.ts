import * as THREE from 'three'

// Three r169 copies clipping and alpha maps to shadow passes, but not opacity
// or alphaHash. Read the actual draw-group material, including render variants.
const bound = new WeakSet<THREE.Mesh>()
const shadowOpacityBindings = new WeakMap<THREE.Material, { value: number; compile: THREE.Material['onBeforeCompile'] }>()
function setShadowOpacity(pass: THREE.Material, opacity: number) {
  let binding = shadowOpacityBindings.get(pass)
  // Recompose if another feature has replaced the shader hook since last draw.
  if (!binding || binding.compile !== pass.onBeforeCompile) {
    const previous = pass.onBeforeCompile
    const key = pass.customProgramCacheKey.call(pass)
    const uniform = { value: opacity, compile: previous }
    const compile: THREE.Material['onBeforeCompile'] = function (this: THREE.Material, shader, renderer) {
      previous.call(this, shader, renderer)
      shader.uniforms.prosotaShadowOpacity = uniform
      if (shader.fragmentShader.includes('uniform float prosotaShadowOpacity;')) return
      shader.fragmentShader = 'uniform float prosotaShadowOpacity;\n' + shader.fragmentShader
      // Packed depth and distance shaders both initialise alpha to 1 and do
      // not consume Material.opacity. Apply it after texture/cutout masks.
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphahash_fragment>',
        'diffuseColor.a *= prosotaShadowOpacity;\n#include <alphahash_fragment>')
    }
    uniform.compile = compile
    pass.onBeforeCompile = compile
    pass.customProgramCacheKey = () => key + '-animation-shadow-opacity-v1'
    shadowOpacityBindings.set(pass, uniform)
    binding = uniform
    pass.needsUpdate = true
  }
  binding.value = opacity
}
export function bindAnimationShadows(mesh: THREE.Mesh) {
  if (bound.has(mesh)) return
  bound.add(mesh)
  // Never mutate Three's shared default shadow material: an unrelated mesh
  // drawn next would inherit the previous animated object's hashed opacity.
  const depth = mesh.customDepthMaterial ? null : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  const distance = mesh.customDistanceMaterial ? null : new THREE.MeshDistanceMaterial()
  if (depth) { depth.userData.prosotaAnimationShadow = true; mesh.customDepthMaterial = depth }
  if (distance) { distance.userData.prosotaAnimationShadow = true; mesh.customDistanceMaterial = distance }
  const before = mesh.onBeforeShadow
  mesh.onBeforeShadow = function (...args) {
    before.apply(this, args)
    const pass = args[5], group = args[6]
    const slot = (group as unknown as { materialIndex?: number } | null)?.materialIndex ?? 0
    const source = Array.isArray(this.material) ? this.material[slot] : this.material
    if (!source) return
    const hashed = source.alphaHash || source.opacity < 1
    if (pass.alphaHash !== hashed) { pass.alphaHash = hashed; pass.needsUpdate = true }
    pass.opacity = source.opacity
    setShadowOpacity(pass, source.opacity)
  }
  const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const dispose = () => {
    for (const source of sources) source.removeEventListener('dispose', dispose)
    if (depth) { if (mesh.customDepthMaterial === depth) mesh.customDepthMaterial = undefined; depth.dispose() }
    if (distance) { if (mesh.customDistanceMaterial === distance) mesh.customDistanceMaterial = undefined; distance.dispose() }
    mesh.onBeforeShadow = before
    bound.delete(mesh)
  }
  for (const source of sources) source.addEventListener('dispose', dispose)
}

// Restore all render state when scrubbing backwards, not just opacity. A
// transparent pass must not occlude the touching surface behind it.
export function applyAnimationOpacity(material: THREE.Material, opacity: number) {
  const base = material.userData.animationSurface ??= {
    depthWrite: material.depthWrite, visible: material.visible,
  }
  const alpha = opacity * (material.userData.surfaceBaseOpacity ?? 1)
  const transparent = alpha < 1 || material.userData.surfaceBlend === true
  const changed = material.transparent !== transparent
  material.opacity = alpha
  material.transparent = transparent
  material.depthWrite = transparent ? false : (material.userData.surfaceDepthWrite ?? base.depthWrite)
  material.visible = alpha > 0 && (material.userData.surfaceVisible ?? base.visible)
  if (changed) material.needsUpdate = true
}
