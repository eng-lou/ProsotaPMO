import test from 'node:test'
import assert from 'node:assert/strict'
import {File} from 'node:buffer'
import {build} from 'esbuild'

const {outputFiles}=await build({entryPoints:['src/modules/fourD/importGeometryCheck.ts'],bundle:true,write:false,format:'esm'})
const {gltfSceneHasGeometry,checkImportGeometry}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const empty={asset:{version:'2.0'},scene:0,scenes:[{name:'Scene'}]}
const populated={...empty,scenes:[{nodes:[0]}],nodes:[{children:[1]},{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{count:3}]}
function glb(json,name='scene.glb'){
 const text=Buffer.from(JSON.stringify(json)),length=Math.ceil(text.length/4)*4,bytes=Buffer.alloc(20+length,32)
 bytes.writeUInt32LE(0x46546c67);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(length,12);bytes.writeUInt32LE(0x4e4f534a,16);text.copy(bytes,20)
 return new File([bytes],name)
}
test('accept nested geometry and inspect only the selected scene',()=>{
 assert.equal(gltfSceneHasGeometry(populated),true)
 assert.equal(gltfSceneHasGeometry({...populated,scene:1,scenes:[{nodes:[0]},{}]}),false)
 assert.equal(gltfSceneHasGeometry({...populated,accessors:[{count:0}]}),false)
})
test('stop an incomplete multi-file assembly with file names and counts',async()=>{
 await assert.rejects(checkImportGeometry([glb(populated,'Ground.glb'),glb(empty,'Building.glb'),glb(empty,'Road.glb')]),/2 of 3.*Building.glb; Road.glb.*Current Frame/)
})
test('check JSON glTF and do not mistake unused mesh definitions for geometry',async()=>{
 await checkImportGeometry([new File([JSON.stringify(populated)],'campus.gltf')])
 await assert.rejects(checkImportGeometry([glb({...populated,scenes:[{}]})]),/no mesh geometry/)
})
test('reject malformed GLBs by filename and leave FBX/OBJ checks to their loaders',async()=>{
 await assert.rejects(checkImportGeometry([new File(['broken'],'Bad.glb')]),/Bad.glb: Invalid GLB header/)
 const bytes=new Uint8Array(await glb(populated).arrayBuffer());new DataView(bytes.buffer).setUint32(12,0xffffffff,true)
 await assert.rejects(checkImportGeometry([new File([bytes],'Length.glb')]),/Length.glb: Invalid GLB metadata/)
 await checkImportGeometry([new File(['loader handles this'],'worker.fbx'),new File(['v 0 0 0'],'part.obj')])
})
test('stop cyclic empty node hierarchies and limit huge-batch error text',async()=>{
 assert.equal(gltfSceneHasGeometry({...empty,scenes:[{nodes:[0]}],nodes:[{children:[1]},{children:[0]}]}),false)
 await assert.rejects(checkImportGeometry(Array.from({length:1001},(_,i)=>glb(empty,`Part-${i}.glb`))),/1001 of 1001.*and 998 more/)
})
