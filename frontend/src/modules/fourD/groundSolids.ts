import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from 'three'
import type { IfcAPI } from 'web-ifc'
import { checkSolid } from './shapeBoolean'

export interface GroundSolid { vertices: Float32Array; bounds: Box3 }

export function groundSolid(vertices: Float32Array): GroundSolid {
  return { vertices, bounds: new Box3().setFromArray(vertices) }
}

export function readGroundSolid(geometry: BufferGeometry) {
  const pos = geometry.getAttribute('position'), index = geometry.index
  const start = geometry.drawRange.start
  const count = Math.min(geometry.drawRange.count, (index?.count ?? pos.count) - start)
  const vertices = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const j = index ? index.getX(start + i) : start + i
    vertices.set([pos.getX(j), pos.getY(j), pos.getZ(j)], i * 3)
  }
  return groundSolid(vertices)
}

export function solidGeometry(s: GroundSolid) {
  return new BufferGeometry().setAttribute('position', new BufferAttribute(s.vertices, 3))
}

function append(a: GroundSolid, b: GroundSolid) {
  const vertices = new Float32Array(a.vertices.length + b.vertices.length)
  vertices.set(a.vertices); vertices.set(b.vertices, a.vertices.length)
  return { vertices, bounds: a.bounds.clone().union(b.bounds) }
}

type NativeVector = { size():number; get(i:number):number; push_back(n:number):void; delete():void }

// web-ifc's modelling operator takes expanded XYZ triangles. Its result uses an
// indexed XYZ buffer (unlike GetGeometry, which interleaves positions and normals).
export class GroundBooleans {
  constructor(private api: IfcAPI) {}

  private evaluate(a: GroundSolid, b: GroundSolid, operation: 'UNION'|'DIFFERENCE') {
    const op = this.api.CreateBooleanOperator()
    const resources: {delete(): void}[] = [op]
    try {
      const vector = (s: GroundSolid) => {
        const v: NativeVector = new this.api.wasmModule.DoubleVector()
        resources.push(v)
        for (const value of s.vertices) v.push_back(value)
        return v
      }
      op.SetValues(vector(a), operation)
      op.SetSecond(vector(b))
      const {fvertexData: pos, indexData: index} = op.GetBuffers() as {fvertexData: NativeVector; indexData: NativeVector}
      resources.push(pos, index)
      const vertices = new Float32Array(index.size() * 3)
      for (let i = 0; i < index.size(); i++) {
        const offset = index.get(i) * 3
        for (let j = 0; j < 3; j++) vertices[i*3+j] = pos.get(offset+j)
      }
      return groundSolid(vertices)
    } finally { for (const resource of resources.reverse()) resource.delete() }
  }

  union(parts: GroundSolid[]): GroundSolid {
    if (!parts.length) return groundSolid(new Float32Array())
    if (parts.length === 1) return parts[0]
    const bounds = new Box3()
    for (const p of parts) bounds.union(p.bounds)
    const size = bounds.getSize(new Vector3())
    const axis = size.x >= size.z && size.x >= size.y ? 'x' : size.z >= size.y ? 'z' : 'y'
    parts.sort((a,b) => (a.bounds.min[axis]+a.bounds.max[axis]) - (b.bounds.min[axis]+b.bounds.max[axis]))
    const mid = Math.floor(parts.length/2)
    const a = this.union(parts.slice(0,mid)), b = this.union(parts.slice(mid))
    return a.bounds.intersectsBox(b.bounds) ? this.evaluate(a,b,'UNION') : append(a,b)
  }

  subtract(a: GroundSolid, b: GroundSolid) {
    return a.bounds.intersectsBox(b.bounds) ? this.evaluate(a,b,'DIFFERENCE') : a
  }

  intersect(a: GroundSolid, b: GroundSolid) {
    if (!a.bounds.intersectsBox(b.bounds)) return groundSolid(new Float32Array())
    // This WASM interface implements UNION and DIFFERENCE.
    return this.subtract(a, this.subtract(a,b))
  }

  source(group: Group, name: string) {
    const parts = group.children.map(n => readGroundSolid((n as Mesh).geometry))
    const validate = (s: GroundSolid) => {
      const geo = solidGeometry(s)
      try { checkSolid(geo) } finally { geo.dispose() }
    }
    try {
      // A glTF may store material faces of one shell as separate primitives.
      if (parts.length > 1 && parts.some(p => { try { validate(p); return false } catch { return true } })) {
        const shell = parts.reduce(append)
        validate(shell)
        return shell
      }
      for (const part of parts) validate(part)
      return this.union(parts)
    } catch (e) {
      throw Error(name + ' — ' + (e instanceof Error ? e.message : String(e)))
    }
  }
}
