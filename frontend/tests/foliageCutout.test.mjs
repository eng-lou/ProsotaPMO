import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {readFileSync} from 'node:fs'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/siteAssetMaterials';export * from './src/modules/fourD/materialScope';export * as THREE from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {removeBorderBackground,applySiteTextureCutout,editMaterialFields,materialScope,THREE}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('array repair inherits to instances, preserves leaf opacity and leaves other arrays alone',()=>{
 const key='site|beech|1',mapping=editMaterialFields({},[['site:array']],{['cutout:'+key]:'texture'})
 const inherited=materialScope(materialScope(mapping,'site:array'),'instance:4')
 const leaf=new THREE.MeshStandardMaterial({map:new THREE.Texture(),opacity:1})
 applySiteTextureCutout(leaf,key,inherited)
 assert.equal(leaf.alphaHash,true);assert.equal(leaf.opacity,1);assert.equal(leaf.transparent,false)
 const other=new THREE.MeshStandardMaterial({map:new THREE.Texture()})
 applySiteTextureCutout(other,key,materialScope(mapping,'site:other'))
 assert.equal(other.alphaHash,false)
})
test('async timeline bindings wake the demand renderer before waiting for interaction',()=>{
 const source=readFileSync('src/modules/fourD/Viewport3D.tsx','utf8')
 const commit=source.slice(source.indexOf('batchVisibilityTargetsRef.current = [...batchVisibilityByKey.values()]'))
 assert.match(commit.slice(0,500),/batchFrameGate.invalidate\(\)[\s\S]*individualFrameGate.invalidate\(\)[\s\S]*invalidateTimeline\(\)/)
})

test('background cutout removes border colour but preserves an enclosed matching leaf pixel',()=>{
 const pixels=new Uint8ClampedArray(5*5*4)
 for(let i=0;i<25;i++)pixels.set([120,144,92,255],i*4)
 for(let y=1;y<4;y++)for(let x=1;x<4;x++)pixels.set([0,65,0,255],(y*5+x)*4)
 pixels.set([120,144,92,255],12*4)
 removeBorderBackground(pixels,5,5)
 assert.equal(pixels[3],0)
 assert.equal(pixels[12*4+3],255)
 assert.equal(pixels[6*4+3],255)
})
