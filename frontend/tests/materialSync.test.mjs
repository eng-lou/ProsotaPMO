import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles}=await build({entryPoints:['src/modules/fourD/materialSync.ts'],bundle:true,write:false,format:'esm',platform:'browser'})
const {materialChanges,rebaseMaterials}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('offline edits include resets and explicit empty scoped values',()=>{
 assert.deepEqual(materialChanges({road:'asphalt',grass:'grass'}, {grass:'moquette',scoped:''}),{
 road:{before:'asphalt',after:null},grass:{before:'grass',after:'moquette'},scoped:{before:null,after:''}})
})
test('server acknowledgement preserves edits made while saving and merges unrelated remote edits',()=>{
 assert.deepEqual(rebaseMaterials({road:'asphalt',other:'soil'},{road:'asphalt'},{road:'gravel',new:'grass'}),{road:'gravel',other:'soil',new:'grass'})
 assert.deepEqual(rebaseMaterials({road:'asphalt'},{road:'asphalt'},{}),{})
})
test('migration chooses project finishes but retains edits made during initial loading',()=>{
 assert.deepEqual(rebaseMaterials({road:'asphalt'},{road:'soil'},{road:'soil'}),{road:'asphalt'})
 assert.deepEqual(rebaseMaterials({road:'asphalt'},{road:'soil'},{road:'gravel'}),{road:'gravel'})
})
