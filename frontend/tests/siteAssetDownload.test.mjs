import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({entryPoints:['src/modules/fourD/siteAssets.ts'],bundle:true,write:false,format:'esm',plugins:[{name:'asset-service',setup(b){b.onLoad({filter:/[\\/]lib[\\/]api\.ts$/},()=>({contents:`export const api={get:async()=>({data:globalThis.assetDownloadFixture.response})};export async function downloadLargeBlob(url,external){globalThis.assetDownloadFixture.calls.push({url,external});return new Blob([globalThis.assetDownloadFixture.bytes])}`,loader:'ts'}))}}]})
const {downloadSiteAssetBytes}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('legacy binary and HTML responses never become a download of the app homepage',async()=>{
 for(const response of ['glTF binary data','<!doctype html>',{},null,{download_url:''}]){globalThis.assetDownloadFixture={response,calls:[]};await assert.rejects(downloadSiteAssetBytes('asset'),/invalid download response/);assert.equal(globalThis.assetDownloadFixture.calls.length,0)}
})
test('signed URL contract fetches and validates the saved GLB',async()=>{
 const bytes=new ArrayBuffer(24),v=new DataView(bytes);[0x46546c67,2,24,4,0x4e4f534a].forEach((n,i)=>v.setUint32(i*4,n,true));new Uint8Array(bytes,20).set(new TextEncoder().encode('{}  '));globalThis.assetDownloadFixture={response:{download_url:'https://storage.example/asset'},calls:[],bytes};assert.equal((await downloadSiteAssetBytes('asset')).byteLength,24);assert.deepEqual(globalThis.assetDownloadFixture.calls,[{url:'https://storage.example/asset',external:true}])
})
