import * as THREE from 'three'

// Progress Variance's own "how much of this element is actually built"
// signal (2026-08-21) — countPointsInBox (pointCloud.ts) answers "is
// there real density anywhere in this element's whole bounding box,"
// which a single stray point cluster near one corner satisfies for an
// otherwise-untouched wall. Sampling points across the element's own
// surface and checking each one individually against the scan (via
// PointCloudIndex.hasPointNear) is what actually distinguishes "10%
// poured" from "90% poured."

export interface SurfaceSample {
  x: number
  y: number
  z: number
}

// One sample roughly every `spacing` metres of surface area — coarser
// than the point cloud's own resolution (a real scan is typically far
// denser than 10cm), fine enough to resolve "half this wall is poured"
// without sampling so densely that a single "Run Test" click has to
// issue millions of proximity queries.
const DEFAULT_SPACING_M = 0.1

// Uniform random point on a triangle (standard sqrt(r1) barycentric
// technique — see e.g. Osada et al., "Shape Distributions," 2002) rather
// than a fixed grid across each triangle — a fixed grid would need
// per-triangle orientation handling to stay isotropic; random sampling
// is isotropic for free and, at the sample counts a single building
// element needs (tens to low hundreds), is dense enough that its own
// coverage-percent estimate doesn't meaningfully vary run-to-run.
function samplePointInTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3) {
  const r1 = Math.random()
  const r2 = Math.random()
  const sqrtR1 = Math.sqrt(r1)
  const u = 1 - sqrtR1
  const v = sqrtR1 * (1 - r2)
  const w = sqrtR1 * r2
  out.set(
    a.x * u + b.x * v + c.x * w,
    a.y * u + b.y * v + c.y * w,
    a.z * u + b.z * v + c.z * w,
  )
}

// Samples world-space points across a set of meshes' own triangles,
// area-weighted so a large flat face gets proportionally more samples
// than a small bevel/detail triangle — necessary because IFC element
// meshes are often triangulated very unevenly (one big face split into a
// couple of triangles, plus many tiny ones at corners/openings); a fixed
// "N samples per triangle" would over-sample fine detail and under-
// sample the flat faces that actually carry the coverage signal.
export function sampleMeshSurface(meshes: THREE.Mesh[], spacing = DEFAULT_SPACING_M): SurfaceSample[] {
  const samples: SurfaceSample[] = []
  const areaPerSample = spacing * spacing
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3()
  const triangle = new THREE.Triangle()

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    const geometry = mesh.geometry
    const position = geometry.attributes.position
    if (!position) continue
    const index = geometry.index

    const triangleCount = index ? index.count / 3 : position.count / 3
    for (let t = 0; t < triangleCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
      a.fromBufferAttribute(position, i0).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(position, i1).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(position, i2).applyMatrix4(mesh.matrixWorld)

      triangle.set(a, b, c)
      const area = triangle.getArea()
      if (area <= 0) continue

      // At least 1 sample per triangle so a small-but-real face isn't
      // silently skipped; fractional remainders round probabilistically
      // (e.g. an area worth 2.4 samples becomes 2 samples 60% of the
      // time, 3 the other 40%) so many small triangles average out to
      // the right overall density instead of every one rounding down.
      const expected = area / areaPerSample
      const sampleCount = Math.floor(expected) + (Math.random() < expected - Math.floor(expected) ? 1 : 0)
      for (let s = 0; s < Math.max(1, sampleCount); s++) {
        samplePointInTriangle(a, b, c, p)
        samples.push({ x: p.x, y: p.y, z: p.z })
      }
    }
  }

  return samples
}
