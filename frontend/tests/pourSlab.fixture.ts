import { ExtrudeGeometry, Mesh, MeshStandardMaterial, Path, Shape } from 'three'

// A 12 × 8 m floor, a 4 × 4 m shaft, and one triangle missing from the shaft lining.
export function openRevealSlab() {
  const shape = new Shape()
  shape.moveTo(-6,-4); shape.lineTo(6,-4); shape.lineTo(6,4); shape.lineTo(-6,4); shape.closePath()
  const hole = new Path()
  hole.moveTo(-2,-2); hole.lineTo(-2,2); hole.lineTo(2,2); hole.lineTo(2,-2); hole.closePath()
  shape.holes.push(hole)
  const geometry = new ExtrudeGeometry(shape,{depth:.3,bevelEnabled:false}).rotateX(Math.PI/2)
  const positions = geometry.getAttribute('position')
  const indices: number[] = []
  let missing = false
  for (let i = 0; i < positions.count; i += 3) {
    const tri = [i,i+1,i+2]
    if (!missing && tri.every(j => positions.getX(j) === 2)) missing = true
    else indices.push(...tri)
  }
  geometry.clearGroups()
  geometry.setIndex(indices)
  return new Mesh(geometry,new MeshStandardMaterial({color:0xaca9a2}))
}
