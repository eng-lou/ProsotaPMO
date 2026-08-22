import * as THREE from 'three'
import type { IfcModelHandle } from './ifcModel'
import { PointCloudIndex, type PointCloudData, parseXyzFile } from './pointCloud'
import { resolveMembersToElements, type ClashElementRef, type ClashSceneObject } from './sceneClash'
import { sampleMeshSurface } from './surfaceSampling'

// The client-side half of Progress Variance Detection (2026-08-20, per the
// approved plan, "Reality Captures: textured overlay + a precision
// point-cloud progress-variance engine") — mirrors sceneClash.ts's own
// split (pure geometry logic here, project/scene wiring in FourD.tsx) and
// reuses resolveMembersToElements from that same file as-is: Group A here
// is exactly the same "Collection resolves to whatever the viewport
// currently shows, IFC or mesh" concept Clash Detective's Group A already
// is, just tested against a point cloud's density instead of a second
// element group's own geometry.

// A module-level cache, not React state — the FULL (non-decimated)
// parsed point cloud for a SiteCapture (up to ~13.5M points for a real
// MatterPak scan) is exactly the precision source variance testing needs
// (see pointCloud.ts's own header: "visual decimation never affects
// Progress Variance precision"), but re-parsing a 500MB file on every
// "Run Test" click would make iterating on the density threshold (the one
// number the plan itself says needs real, repeated tuning) painfully
// slow. Keyed by site_capture_id, cleared only when that capture's own
// stored file could have changed (there's no re-upload-in-place path
// today — see site_capture.py's own docstring on why re-uploading is
// always a new capture, not an overwrite — so nothing currently needs to
// evict an entry, but clearPointCloudCache exists for the one case that
// does: the capture being deleted out from under an open session).
const fullCloudCache = new Map<string, PointCloudData>()

// xyz only (2026-08-20) — a kind='e57' SiteCapture has to be converted
// server-side first (site_capture.py's own POST .../convert, siteCaptures.ts's
// convertSiteCapture) before it's ever loadable here; see that endpoint's
// own header for why the conversion itself doesn't happen in the browser
// (a real 14.4GB, 105-scan export has no safe way to be held as one JS
// string in a browser tab's memory — confirmed directly against Maro's
// own file, not assumed).
export async function loadFullPointCloud(
  siteCaptureId: string, file: Blob, fileName: string,
  onProgress?: (bytesRead: number, totalBytes: number) => void,
): Promise<PointCloudData> {
  const cached = fullCloudCache.get(siteCaptureId)
  if (cached) return cached
  const cloud = await parseXyzFile(file instanceof File ? file : new File([file], fileName), onProgress)
  fullCloudCache.set(siteCaptureId, cloud)
  return cloud
}

export function isPointCloudLoaded(siteCaptureId: string): boolean {
  return fullCloudCache.has(siteCaptureId)
}

export function getCachedPointCloud(siteCaptureId: string): PointCloudData | null {
  return fullCloudCache.get(siteCaptureId) ?? null
}

// Lets a caller that already parsed a cloud in hand (FourD.tsx's own
// handleImportPointCloud, right after its own upload succeeds) seed the
// cache directly, instead of throwing that parse away and immediately
// re-downloading + re-parsing the same 500MB file it just uploaded.
export function setCachedPointCloud(siteCaptureId: string, cloud: PointCloudData) {
  fullCloudCache.set(siteCaptureId, cloud)
}

export function clearPointCloudCache(siteCaptureId?: string) {
  if (siteCaptureId) fullCloudCache.delete(siteCaptureId)
  else fullCloudCache.clear()
}

// Bakes the currently-loaded preview object's own matrixWorld (whatever
// the user has manually nudged into place with the Move gizmo — "only as
// good as manual alignment," see the plan's own disclosed limitation)
// into a fresh copy of the FULL cloud's raw positions — same "world-space,
// not local, so distances/queries are actually correct regardless of any
// scale/rotation the object carries" reasoning as sceneClash.ts's own
// buildWorldBVH. Hand-unrolled matrix math (no per-point THREE.Vector3
// allocation) — the difference between an instant "Run Test" and a
// perceptible one at 13.5M points.
function transformPositionsToWorld(positions: Float32Array, matrix: THREE.Matrix4): Float32Array {
  const e = matrix.elements
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
  }
  return out
}

// Per-chunk, not one flat pass (2026-08-21) — pointCloud.ts's own
// PointCloudData now splits a large cloud across multiple chunks so no
// single typed array ever nears the browser's ~2GB ArrayBuffer ceiling;
// transforming chunk-by-chunk keeps that guarantee for the world-space
// copy too, rather than re-flattening back into one oversized array here.
function transformCloudToWorld(cloud: PointCloudData, matrix: THREE.Matrix4): PointCloudData {
  return {
    count: cloud.count,
    chunks: cloud.chunks.map(chunk => ({
      positions: transformPositionsToWorld(chunk.positions, matrix),
      colors: chunk.colors,
      count: chunk.count,
    })),
  }
}

// Fixed, not exposed for tuning (2026-08-20) — unlike the coverage-percent
// threshold below (the one number that genuinely needs real per-project
// tuning), cellSize only affects query speed, never correctness:
// countPointsInBox/hasPointNear always visit every cell overlapping the
// query region regardless of how finely they're cut. 0.25m is a
// reasonable default at typical building-element scale and real MatterPak
// scan density (~13.5M points across a real building footprint).
const CELL_SIZE = 0.25
// Matches PointCloudIndex.countPointsInBox's own default cap — the
// diagnostic point_count field only needs "is there real density here,"
// never an exact count.
const DENSITY_QUERY_LIMIT = 50

// How far a surface sample point (surfaceSampling.ts, on the as-planned
// element's own face) can be from the nearest real scan point and still
// count as "built here" (2026-08-21). Matches the sampling spacing
// itself — loose enough to tolerate real as-built deviation and scan
// noise, tight enough that scaffolding/adjacent-structure points a
// couple of metres away don't falsely confirm an untouched face.
const HIT_RADIUS_M = 0.1

export interface VarianceElementResult {
  ref: ClashElementRef
  pointCount: number
  coveragePercent: number
  confirmedInScan: boolean
}

export type VarianceProgressCallback = (done: number, total: number) => void

export async function runProgressVarianceQuery(
  members: { source_kind: 'ifc' | 'mesh'; element_ref: string; element_label: string }[],
  sceneObjects: ClashSceneObject[],
  ifcHandles: IfcModelHandle[],
  fullCloud: PointCloudData,
  pointCloudObject: THREE.Object3D,
  minCoveragePercent: number,
  onProgress?: VarianceProgressCallback,
): Promise<VarianceElementResult[]> {
  pointCloudObject.updateWorldMatrix(true, false)
  const worldCloud = transformCloudToWorld(fullCloud, pointCloudObject.matrixWorld)
  const index = new PointCloudIndex(worldCloud, CELL_SIZE)

  const elements = await resolveMembersToElements(members, sceneObjects, ifcHandles)
  const results: VarianceElementResult[] = []
  const box = new THREE.Box3()

  let done = 0
  for (const el of elements) {
    box.makeEmpty()
    for (const mesh of el.meshes) {
      mesh.updateWorldMatrix(true, false)
      box.expandByObject(mesh)
    }
    // point_count stays as a coarse diagnostic (is there ANY density in
    // this element's whole bounding volume) — coveragePercent below is
    // the real signal now; see surfaceSampling.ts's own header for why a
    // single bounding-box count can't distinguish "10% poured" from
    // "90% poured."
    const pointCount = box.isEmpty() ? 0 : index.countPointsInBox(box, DENSITY_QUERY_LIMIT)

    const samples = box.isEmpty() ? [] : sampleMeshSurface(el.meshes)
    const hits = samples.reduce((n, s) => n + (index.hasPointNear(s.x, s.y, s.z, HIT_RADIUS_M) ? 1 : 0), 0)
    // An element with no samples at all (degenerate/empty geometry)
    // reads as 0% rather than NaN or 100% — "nothing to confirm" is not
    // the same as "confirmed."
    const coveragePercent = samples.length === 0 ? 0 : (hits / samples.length) * 100

    results.push({ ref: el.ref, pointCount, coveragePercent, confirmedInScan: coveragePercent >= minCoveragePercent })

    done += 1
    if (done % 25 === 0) {
      onProgress?.(done, elements.length)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  onProgress?.(elements.length, elements.length)
  return results
}
