import * as THREE from 'three'

/** A hose keeps its original surface and blends between its two mounting
 * frames. The supplied centreline is in the hose mesh's authored coordinates.
 * This is a visual flexible connection, not a pressure/length simulation. */
export function bindFlexiblePart(node: THREE.Mesh, curve: [number, number, number][], restMatrix: THREE.Matrix4) {
  const original = node.geometry, geometry = original.clone()
  node.geometry = geometry
  geometry.userData.prosotaFlexible = true
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal')
  const tangent = geometry.getAttribute('tangent')
  const saved = [position, normal, tangent].map(a => a ? Float32Array.from(a.array) : null)
  const points = curve.map(p => new THREE.Vector3(...p)), lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]))
  const total = lengths[lengths.length - 1], weights = new Float32Array(position.count)
  const p = new THREE.Vector3(), delta = new THREE.Vector3(), nearest = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i); let best = Infinity, progress = 0
    for (let k = 1; k < points.length; k++) {
      delta.subVectors(points[k], points[k - 1]); const segment = delta.lengthSq()
      if (segment < 1e-16) continue
      const t = THREE.MathUtils.clamp(nearest.subVectors(p, points[k - 1]).dot(delta) / segment, 0, 1)
      nearest.copy(points[k - 1]).addScaledVector(delta, t)
      const distance = nearest.distanceToSquared(p)
      if (distance < best) { best = distance; progress = (lengths[k - 1] + t * Math.sqrt(segment)) / total }
    }
    // Keep short coupling sections rigid; blend the flexible middle smoothly.
    const t = THREE.MathUtils.clamp((progress - .07) / .86, 0, 1)
    weights[i] = t * t * (3 - 2 * t)
  }
  const inverse = restMatrix.clone().invert(), a = new THREE.Vector3(), b = new THREE.Vector3()
  const dirty = () => {
    for (const attr of [position, normal, tangent]) if (attr) attr.needsUpdate = true
    geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  }
  return {
    update(baseDelta: THREE.Matrix4, tipDelta: THREE.Matrix4) {
      const first = inverse.clone().multiply(baseDelta).multiply(restMatrix)
      const last = inverse.clone().multiply(tipDelta).multiply(restMatrix)
      const n0 = new THREE.Matrix3().getNormalMatrix(first), n1 = new THREE.Matrix3().getNormalMatrix(last)
      for (let i = 0; i < position.count; i++) {
        a.fromArray(saved[0]!, i * 3); b.copy(a).applyMatrix4(last); a.applyMatrix4(first).lerp(b, weights[i]); position.setXYZ(i, a.x, a.y, a.z)
        if (normal) { a.fromArray(saved[1]!, i * 3); b.copy(a).applyMatrix3(n1); a.applyMatrix3(n0).lerp(b, weights[i]).normalize(); normal.setXYZ(i, a.x, a.y, a.z) }
        if (tangent) { a.fromArray(saved[2]!, i * 4); b.copy(a).transformDirection(last); a.transformDirection(first).lerp(b, weights[i]).normalize(); tangent.setXYZ(i, a.x, a.y, a.z) }
      }
      dirty()
    },
    restore() { [position, normal, tangent].forEach((attr, i) => { if (attr) attr.array.set(saved[i]!) }); dirty() },
    capture() { return [position, normal, tangent].map(attr => attr ? Float32Array.from(attr.array) : null) },
    resume(snapshot: (Float32Array | null)[]) { [position, normal, tangent].forEach((attr, i) => { if (attr) attr.array.set(snapshot[i]!) }); dirty() },
    dispose() { node.geometry = original; geometry.dispose() },
  }
}
