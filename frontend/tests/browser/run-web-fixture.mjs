// Isolated real Chromium/WebGL checks. No application login or saved project is
// touched. CHROME_PATH can point at a local Chrome/Chromium executable.
import {spawn} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
const suite=process.argv[2]||'batch',port=15329,debug=15330
const profile=mkdtempSync(path.join(tmpdir(),'prosota-web-fixture-'))
const children=[]
let ws
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function waitFor(url){for(let i=0;i<120;i++){try{const r=await fetch(url);if(r.ok)return r}catch{}await pause(250)}throw Error('Could not start '+url)}
try {
  children.push(spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{windowsHide:true,stdio:'ignore'}))
  await waitFor(`http://127.0.0.1:${port}/tests/browser/index.html`)
  const chrome=process.env.CHROME_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome')
  // Software rendering makes this a correctness/draw-count test, not a GPU FPS benchmark.
  children.push(spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-first-run',`--user-data-dir=${profile}`,`--remote-debugging-port=${debug}`,'about:blank'],{windowsHide:true,stdio:'ignore'}))
  const targets=await (await waitFor(`http://127.0.0.1:${debug}/json`)).json()
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  let serial=0;const pending=new Map()
  ws.onclose=()=>{for(const request of pending.values())request.reject(Error('Fixture browser closed'));pending.clear()}
  ws.onmessage=({data})=>{const value=JSON.parse(data);if(value.id){const request=pending.get(value.id);pending.delete(value.id);value.error?request.reject(value.error):request.resolve(value.result)}}
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/index.html?suite=${suite}`})
  let result
  for(let i=0;i<240;i++){
    const value=await send('Runtime.evaluate',{expression:'window.testResult',returnByValue:true})
    result=value.result?.value;if(result)break;await pause(500)
  }
  if(!result)throw Error('Fixture timed out')
  console.log(JSON.stringify({suite,...result}));process.exitCode=result.passed?0:1
  await send('Browser.close').catch(()=>{})
} catch(error){console.error(error);process.exitCode=1}
finally {
 ws?.close()
 for(const child of children)child.kill()
 // Delete only this run's mkdtemp directory, never a user's browser profile.
 if(path.dirname(profile)===path.resolve(tmpdir()) && path.basename(profile).startsWith('prosota-web-fixture-')) {
  for(let i=0;i<8;i++){try{rmSync(profile,{recursive:true,force:true});break}catch{await pause(250)}}
 }
}
