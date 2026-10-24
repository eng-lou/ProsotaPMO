import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/siteAssetMaterials'; export * as THREE from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {siteMaterialSlots,siteMaterialInfo,siteMaterialLook,primitiveMaterialInfo,primitiveMaterialKey,THREE}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('library material entries include textured leaves and scope unnamed slots to their import',()=>{
 const root=new THREE.Group(),leaf=new THREE.MeshStandardMaterial({map:new THREE.Texture(),alphaTest:.5,side:THREE.DoubleSide}),bark=new THREE.MeshStandardMaterial()
 leaf.name='Leaves';root.add(new THREE.Mesh(new THREE.BoxGeometry(),[leaf,bark]))
 const a=siteMaterialInfo(root,'a'),b=siteMaterialInfo(root,'b')
 assert.equal(a.entries.size,2);assert.equal([...a.entries.values()][0].label,'Leaves');assert.equal([...a.entries.values()][0].autoClass,null)
 assert.notEqual([...a.entries.keys()][0],[...b.entries.keys()][0])
 assert.deepEqual([...siteMaterialSlots(root.clone(),'a').values()],[...a.entries.keys()])
})
test('manual finish keeps cutouts; Original leaves authored maps and colour intact',()=>{
 const source=new THREE.MeshStandardMaterial({color:'#338844',map:new THREE.Texture(),alphaTest:.5,side:THREE.DoubleSide})
 const look=siteMaterialLook(source.clone(),'slot',{slot:'metal'},false)
 assert.notEqual(look,source);assert.equal(look.alphaTest,.5);assert.equal(look.map,source.map);assert.equal(look.side,THREE.DoubleSide)
 const original=source.clone();assert.equal(siteMaterialLook(original,'slot',{slot:'original'},false),original)
 assert.equal(original.color.getHexString(),'338844');assert.equal(original.map,source.map)
 const tinted=siteMaterialLook(source.clone(),'slot',{'colour:slot':'#ff0000'},false)
 assert.equal(tinted.color.getHexString(),'ff0000');assert.equal(source.color.getHexString(),'338844')
})

test('built-in shape slots are stable and isolated, including secondary materials',()=>{
 const a=primitiveMaterialInfo({id:'a',name:'Context building',kind:'context'})
 assert.equal(a.entries.size,1)
 assert.ok(a.entries.has(primitiveMaterialKey('a')))
 const renamed=primitiveMaterialInfo({id:'a',name:'Water basin',kind:'context'})
 assert.deepEqual([...a.entries.keys()],[...renamed.entries.keys()])
 const b=primitiveMaterialInfo({id:'b',name:'Context building',kind:'context'})
 assert.notEqual([...a.entries.keys()][0],[...b.entries.keys()][0])
 assert.equal(primitiveMaterialInfo({id:'c',name:'Cabin',kind:'cabin'}).entries.size,2)
 assert.equal(primitiveMaterialInfo({id:'t',name:'Tree',kind:'tree'}).entries.size,2)
 const source=new THREE.MeshStandardMaterial()
 const water=siteMaterialLook(source,primitiveMaterialKey('a'),{[primitiveMaterialKey('a')]:'water'},false)
 assert.equal(water.userData.realisticClass,14)
})
