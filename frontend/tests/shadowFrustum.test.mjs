import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const { outputFiles } = await build({ stdin: { contents: "export * from './src/modules/fourD/shadowFrustum'; export * as T from 'three'", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm' })
const { fitSunShadow, T } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
function lightAt(center) {
 const light = new T.DirectionalLight()
 light.target.position.copy(center)
 light.position.copy(center).add(new T.Vector3(150,240,100).normalize().multiplyScalar(300))
 return light
}
test('close shadow footprint follows off-centre focus for both world up axes',()=>{
 for (const focus of [new T.Vector3(75,0,30),new T.Vector3(75,30,0)]) {
  const light=lightAt(new T.Vector3())
  fitSunShadow(light,focus,10,100,300)
  const p=focus.clone().project(light.shadow.camera)
  assert.ok(Math.abs(p.x)<1e-6 && Math.abs(p.y)<1e-6)
  assert.ok(p.z>=-1 && p.z<=1)
 }
})
test('zoom retains full scene depth and panning invalidates the shadow map key',()=>{
 const center=new T.Vector3(1000,2000,3000), light=lightAt(center)
 const wide=fitSunShadow(light,center,200,100,300),far=light.shadow.camera.far
 const close=fitSunShadow(light,center,5,100,300)
 assert.equal(light.shadow.camera.far,far)
 assert.notEqual(wide,close)
 const away=center.clone().sub(light.position.clone().sub(center).normalize().multiplyScalar(90))
 assert.ok(Math.abs(away.project(light.shadow.camera).z)<=1,'far-side caster remains in shadow depth range')
 assert.notEqual(fitSunShadow(light,center.clone().add(new T.Vector3(30,0,0)),5,100,300),close)
})
