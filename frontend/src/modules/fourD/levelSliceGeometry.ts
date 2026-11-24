import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three'

type Corner = { weights: Vector3; height: number }

// Clip in world elevation while interpolating the source triangle's local attributes.
function clip(corners: Corner[], limit: number, lower: boolean): Corner[] {
  const kept: Corner[] = []
  for (let i = 0; i < corners.length; i++) {
    const a = corners[(i + corners.length - 1) % corners.length], b = corners[i]
    if ((a.height < limit && b.height > limit) || (a.height > limit && b.height < limit)) {
      const t = (limit - a.height) / (b.height - a.height)
      kept.push({ weights: a.weights.clone().lerp(b.weights, t), height: limit })
    }
    if (lower ? b.height >= limit : b.height <= limit) kept.push(b)
  }
  return kept
}

export function levelSliceGeometry(source: BufferGeometry, world: Matrix4, axis: 'y' | 'z', low: number, high: number) {
  const position = source.getAttribute('position')
  if (!position?.count) return null
  const heights = new Float64Array(position.count)
  const vertex = new Vector3()
  let min = Infinity, max = -Infinity
  for (let i = 0; i < position.count; i++) {
    const height = vertex.fromBufferAttribute(position, i).applyMatrix4(world)[axis]
    heights[i] = height
    min = Math.min(min, height)
    max = Math.max(max, height)
  }
  if (min >= high || max < low) return null
  if (min >= low && max <= high) return source.clone()

  const attributes = Object.entries(source.attributes).map(([name, attribute]) => ({
    name, attribute, values: [] as number[],
  }))
  const index = source.index
  const basis = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  const count = index?.count ?? position.count
  for (let i = 0; i + 2 < count; i += 3) {
    const a = index ? index.getX(i) : i
    const b = index ? index.getX(i + 1) : i + 1
    const c = index ? index.getX(i + 2) : i + 2
    if (Math.min(heights[a], heights[b], heights[c]) >= high || Math.max(heights[a], heights[b], heights[c]) < low) continue
    const ids = [a, b, c]
    const corners = ids.map((id, j) => ({ weights: basis[j], height: heights[id] }))
    const polygon = clip(clip(corners, low, true), high, false)
    for (let j = 1; j < polygon.length - 1; j++) {
      for (const { weights } of [polygon[0], polygon[j], polygon[j + 1]]) {
        for (const { attribute, values } of attributes) {
          for (let k = 0; k < attribute.itemSize; k++) {
            values.push(weights.x * attribute.getComponent(ids[0], k)
              + weights.y * attribute.getComponent(ids[1], k)
              + weights.z * attribute.getComponent(ids[2], k))
          }
        }
      }
    }
  }
  if (!attributes.find(a => a.name === 'position')?.values.length) return null
  const geometry = new BufferGeometry()
  for (const { name, attribute, values } of attributes) geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize))
  if (geometry.hasAttribute('normal')) geometry.normalizeNormals()
  return geometry
}
