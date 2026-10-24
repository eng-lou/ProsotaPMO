import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {build} from 'esbuild'
const {outputFiles}=await build({entryPoints:['src/modules/fourD/fbxSourceSettings.ts'],bundle:true,write:false,format:'esm'})
const {fbxSourceSettings}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('reads actual Kevin source axis and units',{skip:!existsSync('D:/BIM Assets/Kevin Walk.fbx')},()=>{
 const b=readFileSync('D:/BIM Assets/Kevin Walk.fbx')
 assert.deepEqual(fbxSourceSettings(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),{upAxis:'z',unitScale:.01})
})
test('ASCII FBX metadata',()=>{
 const b=new TextEncoder().encode('GlobalSettings: { Properties70: {\n P: "UpAxis", "int", "Integer", "",1\n P: "UnitScaleFactor", "double", "Number", "",100\n }}')
 assert.deepEqual(fbxSourceSettings(b.buffer),{upAxis:'y',unitScale:1})
})
