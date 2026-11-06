const {app,BrowserWindow}=require('electron')
const path=require('node:path'),assert=require('node:assert/strict')
const repo=path.resolve(__dirname,'../..')
app.whenReady().then(async()=>{
 let win,status=0
 try {
  const {outputFiles}=await require(path.join(repo,'frontend/node_modules/esbuild')).build({stdin:{resolveDir:path.join(repo,'frontend'),loader:'tsx',contents:`
import React,{useState,useRef,useMemo} from 'react';import {createRoot} from 'react-dom/client';
import {SiteContextPanel} from './src/modules/fourD/SiteContextPanel';import {createSiteContextUpdates} from './src/modules/fourD/siteContextUpdates';
const planes=[[1,0,0,10],[-1,0,0,10],[0,1,0,10],[0,-1,0,10],[0,0,1,10],[0,0,-1,10]];
let saved={project_id:'p',enabled:true,view_isolation:planes,lat:53,lon:-6,offset_x:0,offset_y:0,offset_z:0,offset_yaw_deg:0,scale:1,elevation:0,label:'Test',cutout_zone_id:null,cutout_active:false};
function App(){const [ctx,setCtx]=useState(saved);const ref=useRef(ctx);ref.current=ctx;window.current=ctx;
const update=useMemo(()=>createSiteContextUpdates(()=>ref.current,()=> 'p',async value=>{await new Promise(r=>setTimeout(r,10));saved=structuredClone(value);return saved},value=>{ref.current=value;setCtx(value)}),[]);
const state={ready:true,busy:false,scene:{items:[]},setDraft:()=>{},setSelected:()=>{}};
return <SiteContextPanel ctx={ctx} sceneState={state} upAxis="z" zones={[]} apiKey="test-key" error={null} onSaveApiKey={async()=>{}} onUpdate={patch=>update('p',patch)} onIsolateView={()=>update('p',{view_isolation:planes})}/>}
window.mount=()=>{window.root=createRoot(document.getElementById('root'));window.root.render(<App/>)};window.mount();
`},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}})
  win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,offscreen:true}})
  await win.loadFile(path.join(repo,'desktop/ui/desktop-settings.html'))
  const run=s=>win.webContents.executeJavaScript(s),wait=()=>new Promise(r=>setTimeout(r,100))
  await run(`document.body.innerHTML='<div id="root"></div>';void 0`);await run(outputFiles[0].text);await wait()
  const click=async label=>{await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);await wait()}
  await click('Hide isolated tiles');assert.equal(await run('window.current.enabled'),false);assert.equal(await run('window.current.view_isolation.length'),6)
  await run('window.root.unmount();window.mount()');await wait()
  await click('Show isolated tiles');assert.equal(await run('window.current.enabled'),true);assert.equal(await run('window.current.view_isolation.length'),6)
  await click('Hide isolated tiles')
  await run(`Array.from(document.querySelectorAll('label')).find(e=>e.textContent.includes('Show isolated Google tiles')).querySelector('input').click()`);await wait()
  assert.equal(await run('window.current.enabled'),true);assert.equal(await run('window.current.view_isolation.length'),6)
  await click('Clear isolation / show all');assert.equal(await run('window.current.view_isolation'),null)
  console.log('PASS: panel hide/show, reopen, top checkbox restore the saved region; explicit clear resets it')
 }catch(e){console.error(e);status=1}finally{win?.destroy();app.exit(status)}
})
