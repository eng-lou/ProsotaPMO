import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/customMaterial';export * as THREE from 'three'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {THREE,applyCustomMaterial,captureMaterialChannels,matchingObjectChannels}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('all custom PBR slots and opacity apply without mutating authored material',()=>{
 const authored=new THREE.MeshStandardMaterial({color:'#123456'}),textures={}
 for(const slot of ['map','metalnessMap','roughnessMap','normalMap','aoMap','displacementMap'])textures[slot]={texture:new THREE.Texture(),name:slot,dataUri:slot}
 const material=applyCustomMaterial(authored.clone(),textures,.4)
 for(const slot of Object.keys(textures))assert.equal(material[slot],textures[slot].texture)
 assert.equal(material.opacity,.4);assert.equal(material.transparent,true);assert.equal(authored.map,null)
 assert.equal(applyCustomMaterial(authored.clone(),undefined).color.getHexString(),'123456')
})
test('linked channels use authored appearances or matching uploads, not highlight tint',()=>{
 const objects=['a','b','c'].map((id,i)=>{const material=new THREE.MeshStandardMaterial({color:i<2?'red':'blue'});captureMaterialChannels(material);material.color.set('yellow');return {id,object:new THREE.Mesh(new THREE.BoxGeometry(),material)}})
 assert.deepEqual(matchingObjectChannels('a','map',objects,{}),['a','b'])
 const value={texture:new THREE.Texture(),name:'red.png',dataUri:'same'}
 assert.deepEqual(matchingObjectChannels('a','map',objects,{a:{map:value},c:{map:value}}),['a','c'])
})
