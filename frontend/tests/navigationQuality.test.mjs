import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const source=readFileSync('src/modules/fourD/Viewport3D.tsx','utf8')
const start=source.indexOf('      useFrame(() => {',source.indexOf('const aoRef ='))
const body=source.slice(start+'      useFrame(() => {'.length,source.indexOf('      })',start))
const {outputFiles}=await build({stdin:{contents:`
import {shouldSimplifyNavigation} from './src/modules/fourD/navigationQuality';
export function update(env) {
 const {aoRef,composerRef,movingRef,simplify,boostQuality,offline,gl}=env;
 const isOfflineExportActive=()=>offline;
 ${body}
}`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm'})
const {update}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text+'\n//# sourceURL=navigation-quality-fixture.js').toString('base64'))

test('settled viewport keeps interactive quality; explicit non-draft capture boosts it',()=>{
 const expression=source.match(/const highQuality = ([^\r\n]+)/)[1]
 const highQuality=new Function('captureDprMultiplier','captureDraft',`return ${expression}`)
 assert.equal(highQuality(null,false),false,'releasing the mouse is not a capture')
 assert.equal(highQuality(null,true),false)
 assert.equal(highQuality(1,false),true)
 assert.equal(highQuality(2,false),true)
 assert.equal(highQuality(1,true),false,'draft export keeps interactive sample counts')
 assert.ok(!source.includes('setBoostQuality('),'navigation must not trigger a viewport React commit')
})

test('production AO frame bypasses only navigation AO and restores it for release, capture and settings changes',()=>{
 const ao={enabled:true},scenePass={enabled:true},tonePass={enabled:true}
 const composer={passes:[scenePass,ao,tonePass],inputBuffer:{width:800,height:600}}
 const env={aoRef:{current:ao},composerRef:{current:composer},movingRef:{current:{moving:false}},simplify:true,
   boostQuality:false,offline:false,gl:{domElement:{width:800,height:600},toneMapping:0,autoClear:true}}
 const frames=[]
 const render=()=>{update(env);frames.push(composer.passes.filter(pass=>pass.enabled))}
 render();env.movingRef.current.moving=true;render();render()
 assert.deepEqual(frames,[composer.passes,[scenePass,tonePass],[scenePass,tonePass]])
 env.boostQuality=true;render();assert.equal(ao.enabled,true,'capture keeps requested AO')
 env.boostQuality=false;env.offline=true;render();assert.equal(ao.enabled,true,'draft offline export also retains AO')
 env.offline=false;render();assert.equal(ao.enabled,false)
 env.simplify=false;render();assert.equal(ao.enabled,true,'turning simplification off during drag restores AO')
 env.simplify=true;env.movingRef.current.moving=false;render();assert.equal(ao.enabled,true,'release restores the same pass')
 assert.equal(env.aoRef.current,ao);assert.equal(env.composerRef.current,composer)
 assert.equal(env.gl.toneMapping,0);assert.equal(env.gl.autoClear,true)
 env.movingRef=undefined;render();assert.equal(ao.enabled,true,'disconnected comparison does not follow main drag')
})
