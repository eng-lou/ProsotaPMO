import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import * as THREE from 'three'
const { outputFiles } = await build({ entryPoints: ['src/modules/fourD/measurementGeometry.ts'], bundle: true, write: false, format: 'esm' })
const { pathLengthMetres, measureFacePatch, findSnapPoint } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('length sums every segment in 3D and converts units once', () => {
  assert.equal(pathLengthMetres([{ x: 0, y: 0, z: 0 }, { x: 3000, y: 4000, z: 0 }, { x: 3000, y: 4000, z: 12000 }], .001), 17)
})
test('double-sided duplicate triangles retain the boundary and count the face only once', () => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 2,0,0, 2,2,0, 0,2,0], 3))
  g.setIndex([0,1,2, 0,2,3, 2,1,0, 3,2,0])
  const patch = measureFacePatch(new THREE.Mesh(g), 2, 1)
  assert.equal(patch.areaMetres, 4)
  assert.equal(patch.outlinePointsScene.length, 4)
  assert.equal(patch.holeLoopsScene.length, 0)
})
test('non-indexed imported faces work and degenerate surfaces do not produce invalid saves', () => {
  const g = new THREE.PlaneGeometry(2, 3).toNonIndexed()
  const patch = measureFacePatch(new THREE.Mesh(g), 0, 1)
  assert.equal(patch.areaMetres, 6)
  assert.equal(patch.outlinePointsScene.length, 4)
  g.getAttribute('position').array.fill(0)
  assert.equal(measureFacePatch(new THREE.Mesh(g), 0, 1), null)
})
test('openings remain excluded from measured area', () => {
  const shape = new THREE.Shape()
  shape.moveTo(0,0); shape.lineTo(4,0); shape.lineTo(4,4); shape.lineTo(0,4); shape.closePath()
  const hole = new THREE.Path()
  hole.moveTo(1,1); hole.lineTo(1,3); hole.lineTo(3,3); hole.lineTo(3,1); hole.closePath()
  shape.holes.push(hole)
  const patch = measureFacePatch(new THREE.Mesh(new THREE.ShapeGeometry(shape)), 0, 1)
  assert.equal(patch.areaMetres, 12)
  assert.equal(patch.holeLoopsScene.length, 1)
})

test('a non-indexed site instance measures and snaps at its actual placement', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 3).toNonIndexed())
  const matrix = new THREE.Matrix4().makeScale(2, 3, 1).setPosition(10, 20, 0)
  const patch = measureFacePatch(mesh, 0, 1, matrix)
  assert.equal(patch.areaMetres, 36)
  assert.ok(patch.outlinePointsScene.every(p => p.x >= 8 && p.y >= 15.5))
  const camera = new THREE.OrthographicCamera(0, 30, 30, 0, .1, 50)
  camera.position.z = 10
  camera.updateMatrixWorld()
  assert.deepEqual(findSnapPoint(mesh, camera, {x: 80, y: 55}, 300, 300, matrix), {x: 8, y: 24.5, z: 0})
})
