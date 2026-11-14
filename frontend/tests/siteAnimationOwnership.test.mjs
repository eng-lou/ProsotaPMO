import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/useSiteAnimation'; export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',plugins:[{name:'hooks',setup(b){
 b.onResolve({filter:/^(react|@react-three\/fiber)$/},args=>({path:args.path,namespace:'hooks'}))
 b.onLoad({filter:/.*/,namespace:'hooks'},args=>({contents:args.path==='react'?'export const useRef=value=>({current:value})':'export const useFrame=fn=>globalThis.animationFrame=fn; export const useThree=selector=>selector({gl:{}})'}))
}}]})
const {useSiteAnimation,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('scatter children do not overwrite parent fade or recompile its material',()=>{
 const root=new T.Group(),material=new T.MeshStandardMaterial({opacity:.25,transparent:true})
 root.add(new T.Mesh(new T.BoxGeometry(),material))
 useSiteAnimation({current:root},new T.Vector3(),[],false,{current:new Date()},false,()=>true,true)
 const version=material.version
 for(let i=0;i<60;i++)globalThis.animationFrame()
 assert.equal(material.opacity,.25)
 assert.equal(material.transparent,true)
 assert.equal(material.version,version)
 delete globalThis.animationFrame
})
