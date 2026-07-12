import * as THREE from 'three'

// Displacement mapping (customTextures.ts's own header) moves *existing*
// vertices along their normal — on typical IFC/BREP geometry, a flat slab
// or wall face is just a handful of vertices (a plain box/plane), so there's
// almost nothing for it to visibly displace. This subdivides a mesh's
// geometry into more, smaller triangles first so displacement actually has
// vertices to push around (2026-07-11, per Maro, mindful it "may lag our
// platform if abused" — Apply to Linked, linkedMaterials.ts, can apply one
// displacement+subdivision choice to every element sharing a material at
// once, hundreds of columns simultaneously in this app's own real test
// file, so the cap here is enforced unconditionally inside this function
// itself, not just by whatever range TextureFields.tsx's own slider allows).
//
// Uniform *midpoint* subdivision, not Loop/Catmull-Clark smoothing — each
// triangle splits into 4 by adding a vertex at each edge's exact midpoint
// (linearly interpolated position/normal/uv), which keeps every vertex
// exactly on the original flat plane (a midpoint of two points on a plane is
// still on that plane) rather than rounding/smoothing the shape, which is
// wrong for architectural geometry that's supposed to stay flat and
// axis-aligned. Each triangle's own 3 new corner-adjacent vertices are
// duplicated per-triangle rather than deduplicated with neighbouring
// triangles at shared edges — deliberately: a full edge-sharing
// implementation needs a hash-map pass to find and reuse coincident
// midpoints, and for flat-shaded architectural faces the duplication costs
// only some extra (but fully bounded, see MAX_TRIANGLES_PER_MESH below)
// vertex data, not any visible seam or shading artefact — every vertex on
// the same flat face already shares the same normal either way.
const MAX_TRIANGLES_PER_MESH = 20_000

export function subdivideGeometry(geometry: THREE.BufferGeometry, requestedLevel: number): THREE.BufferGeometry {
  const index = geometry.index
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  // No subdivision requested, or geometry this function can't safely
  // process (non-indexed, or missing an attribute the box-projected-UV
  // fix normally always provides) — return the original unchanged rather
  // than guessing at a shape for missing data.
  if (requestedLevel <= 0 || !index || !normal || !uv) return geometry

  const baseTriangles = index.count / 3
  // Clamp the requested level down (never up) until the projected output —
  // triangle count grows 4x per pass — stays under the hard cap. A mesh
  // that's already dense (e.g. this file's own curved curtain-wall panels)
  // can clamp straight to 0 on the very first pass, which is correct:
  // already-detailed geometry doesn't need — and, per the cap, isn't
  // allowed — more.
  let level = requestedLevel
  while (level > 0 && baseTriangles * Math.pow(4, level) > MAX_TRIANGLES_PER_MESH) level--
  if (level <= 0) return geometry

  let positions = Array.from(position.array as ArrayLike<number>)
  let normals = Array.from(normal.array as ArrayLike<number>)
  let uvs = Array.from(uv.array as ArrayLike<number>)
  let indices = Array.from(index.array as ArrayLike<number>)

  for (let pass = 0; pass < level; pass++) {
    const nextPositions: number[] = []
    const nextNormals: number[] = []
    const nextUvs: number[] = []
    const nextIndices: number[] = []

    const copyVertex = (i: number): number => {
      const idx = nextPositions.length / 3
      nextPositions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      nextNormals.push(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2])
      nextUvs.push(uvs[i * 2], uvs[i * 2 + 1])
      return idx
    }
    const midpointVertex = (ia: number, ib: number): number => {
      const idx = nextPositions.length / 3
      for (let k = 0; k < 3; k++) nextPositions.push((positions[ia * 3 + k] + positions[ib * 3 + k]) / 2)
      const nx = normals[ia * 3] + normals[ib * 3]
      const ny = normals[ia * 3 + 1] + normals[ib * 3 + 1]
      const nz = normals[ia * 3 + 2] + normals[ib * 3 + 2]
      const len = Math.hypot(nx, ny, nz) || 1
      nextNormals.push(nx / len, ny / len, nz / len)
      nextUvs.push((uvs[ia * 2] + uvs[ib * 2]) / 2, (uvs[ia * 2 + 1] + uvs[ib * 2 + 1]) / 2)
      return idx
    }

    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2]
      const ia = copyVertex(a), ib = copyVertex(b), ic = copyVertex(c)
      const iab = midpointVertex(a, b)
      const ibc = midpointVertex(b, c)
      const ica = midpointVertex(c, a)
      nextIndices.push(ia, iab, ica, iab, ib, ibc, ica, ibc, ic, iab, ibc, ica)
    }

    positions = nextPositions; normals = nextNormals; uvs = nextUvs; indices = nextIndices
  }

  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  result.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3))
  result.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2))
  result.setIndex(indices)
  return result
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3
}

// Second, scene-wide layer of the same abuse-mindfulness (2026-07-11) — the
// per-mesh cap above bounds any *one* subdivided element, but Apply to
// Linked can turn "one element, subdivision level 3" into "every element
// sharing that material, subdivision level 3" in one click. Viewport3D.tsx's
// ModelObjects effect decrements a budget of this size, scene-wide, once
// per pass — any mesh that would push the running total over this line
// falls back to its own unsubdivided geometry instead (displacement still
// applies, just coarser), rather than letting the scene's total triangle
// count grow unbounded with however many elements happen to share one
// heavily-subdivided material.
export const MAX_TOTAL_SUBDIVIDED_TRIANGLES = 300_000
