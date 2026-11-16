import React from 'react'
import { createRoot } from 'react-dom/client'
import { SafeCanvas } from '../../src/modules/fourD/SafeCanvas'
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(check: () => boolean) { for(let i=0;i<100;i++){if(check())return;await wait(50)}throw Error('Context fixture timed out') }
export async function run() {
  const host=document.createElement('div');host.style.cssText='height:300px;width:400px';document.body.append(host)
  const root=createRoot(host)
  const original=HTMLCanvasElement.prototype.getContext
  let mode='deny', created=0, attempts: WebGLContextAttributes[]=[]
  HTMLCanvasElement.prototype.getContext=function(type: string, options?: any): any {
    if(type==='webgl2') {
      attempts.push(options)
      if(mode==='deny'||(mode==='fallback'&&options?.antialias))return null
    }
    return original.call(this,type as any,options)
  } as typeof original
  try {
    const view=()=> <><button id="outside">Schedule remains available</button><SafeCanvas gl={{stencil:true,preserveDrawingBuffer:true,logarithmicDepthBuffer:true}} onCreated={({gl})=>{
      const attributes=gl.getContext().getContextAttributes()!
      if(!attributes.stencil||!attributes.preserveDrawingBuffer)throw Error('Required buffers lost')
      created++
    }}><mesh><boxGeometry/><meshBasicMaterial/></mesh></SafeCanvas></>
    root.render(view())
    await until(()=>!!host.querySelector('[role=alert]'))
    if(!host.querySelector('#outside'))throw Error('Failure escaped viewport')
    mode='fallback';attempts=[]
    Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Retry 3D view')!.click()
    await until(()=>created===1)
    if(!attempts.some(a=>a.antialias===false&&a.powerPreference==='default'))throw Error('Compatibility retry missing')
    if(host.querySelector('[role=alert]'))throw Error('Error did not clear')
    return {passed:true,checks:['context denial contained','workspace remains mounted','retry creates real R3F WebGL renderer','default GPU/no-AA fallback','stencil and capture buffers preserved']}
  } finally {root.unmount();HTMLCanvasElement.prototype.getContext=original;host.remove()}
}
