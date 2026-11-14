import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/animationRendering';export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {applyAnimationOpacity,bindAnimationShadows,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('removal and reverse scrubbing restore depth, visibility and imported opacity',()=>{
 const mat=new T.MeshStandardMaterial()
 for(const alpha of [1,.75,.5,0,.5,1]){
  applyAnimationOpacity(mat,alpha)
  assert.equal(mat.visible,alpha>0)
  assert.equal(mat.depthWrite,alpha===1)
  assert.equal(mat.opacity,alpha)
 }
 mat.userData.surfaceBaseOpacity=.4
 applyAnimationOpacity(mat,.5);assert.equal(mat.opacity,.2);assert.equal(mat.depthWrite,false)
 mat.userData.surfaceVisible=false
 applyAnimationOpacity(mat,1);assert.equal(mat.visible,false,'guide-only surfaces stay hidden')
})
test('shadow draws use current group opacity and mask without leaking between groups',()=>{
 const leaf=new T.MeshStandardMaterial({alphaHash:true,opacity:.25})
 const trunk=new T.MeshStandardMaterial()
 const mesh=new T.Mesh(new T.BoxGeometry(),[leaf,trunk]),pass=new T.MeshDepthMaterial()
 let calls=0;mesh.onBeforeShadow=()=>calls++
 bindAnimationShadows(mesh);bindAnimationShadows(mesh)
 for(const [slot,alpha,hash] of [[0,.25,true],[1,1,false],[0,.25,true]]){
  mesh.onBeforeShadow(null,mesh,null,null,mesh.geometry,pass,{materialIndex:slot})
  assert.equal(pass.opacity,alpha);assert.equal(pass.alphaHash,hash)
 }
 assert.equal(calls,3)
})

test('packed depth and point shadows consume live opacity after authored masks',()=>{
 const mat=new T.MeshStandardMaterial({opacity:.5}),mesh=new T.Mesh(new T.BoxGeometry(),mat)
 bindAnimationShadows(mesh)
 for(const pass of [mesh.customDepthMaterial,mesh.customDistanceMaterial]){
  pass.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <alphahash_fragment>','diffuseColor.a *= 0.8;\n#include <alphahash_fragment>')}
  mesh.onBeforeShadow(null,mesh,null,null,mesh.geometry,pass,null)
  const shader={uniforms:{},fragmentShader:'void main(){vec4 diffuseColor=vec4(1.0);\n#include <alphahash_fragment>\n}'}
  pass.onBeforeCompile(shader,null)
  assert.match(shader.fragmentShader,/diffuseColor.a \*= 0.8;/)
  assert.match(shader.fragmentShader,/diffuseColor.a \*= prosotaShadowOpacity;/)
  assert.equal(shader.uniforms.prosotaShadowOpacity.value,.5)
  mat.opacity=.1
  mesh.onBeforeShadow(null,mesh,null,null,mesh.geometry,pass,null)
  assert.equal(shader.uniforms.prosotaShadowOpacity.value,.1)
  mat.opacity=.5
 }
})
