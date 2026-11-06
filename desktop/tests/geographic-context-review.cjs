const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../..');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.whenReady().then(async()=>{
 let win,status=0;
 try{
  const data=JSON.parse(fs.readFileSync(path.join(repo,'outputs/kylemore-reconstruction/Kylemore.prosota-context.json'),'utf8'));
  const tree=fs.readFileSync(path.join(repo,'frontend/public/context/tree-small.glb')).toString('base64');
  const {outputFiles}=await require(path.join(repo,'frontend/node_modules/esbuild')).build({stdin:{resolveDir:path.join(repo,'frontend'),loader:'tsx',contents:`
import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {Canvas,useThree} from '@react-three/fiber';import {OrbitControls} from '@react-three/drei';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {api} from './src/lib/api';import {useSiteScene} from './src/modules/fourD/siteScene';import {GeographicContextPanel} from './src/modules/fourD/GeographicContextPanel';import {GeographicModel} from './src/modules/fourD/GeographicModel';
const source=${JSON.stringify(data)};
const tree=new GLTFLoader().parseAsync(Uint8Array.from(atob(${JSON.stringify(tree)}),c=>c.charCodeAt(0)).buffer,'');GLTFLoader.prototype.loadAsync=()=>tree;
let saved={revision:0,items:[]};window.saved=()=>saved;window.requests=[];window.blockRequest=false;window.failSave=false;
api.get=async()=>({data:structuredClone(saved)});
api.post=async(url,value)=>{window.requests.push(url);if(window.blockRequest)await new Promise(r=>window.finishRequest=r);return {data:url.endsWith('/open-map')?structuredClone(source):value}};
api.put=async(url,value)=>{if(window.failSave)throw Error('Save failed for review');saved={revision:saved.revision+1,items:structuredClone(value.items)};return {data:structuredClone(saved)}};
function Inspect(){window.r3f=useThree();return null} function App(){const [project,setProject]=useState('project-a');const state=useSiteScene(project);window.state=state;window.changeProject=setProject;
const current=state.draft||state.scene.items[0];const ctx={project_id:project,lat:53.330746,lon:-6.345527,scale:1,offset_x:0,offset_y:0,offset_z:0,offset_yaw_deg:0,label:'Kylemore',enabled:true};
return <div style={{display:'grid',gridTemplateColumns:'1fr 340px',height:'100vh'}}><div style={{position:'relative',background:'#edf0ea'}}><Canvas orthographic camera={{position:[180,-640,620],zoom:1.4,near:.1,far:2500,up:[0,0,1]}} shadows><Inspect/><color attach="background" args={['#edf0ea']}/><ambientLight intensity={1.8}/><directionalLight position={[-200,-300,500]} intensity={2.4} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-700} shadow-camera-right={700} shadow-camera-top={700} shadow-camera-bottom={-700}/>{current?.geographic&&<group position={[current.position.x,current.position.y,current.position.z]}><GeographicModel data={current.geographic} onLoaded={()=>{}}/></group>}<OrbitControls target={[100,-120,0]}/></Canvas><div style={{position:'absolute',left:14,bottom:14,color:'#283134',background:'#fff',padding:10}}>Native reconstruction UI check · © OpenStreetMap contributors · ODbL 1.0</div></div><div style={{overflowY:'auto',padding:14}}><h2>Site Context · review</h2><GeographicContextPanel ctx={ctx} state={state} upAxis="z" onHideTiles={()=>window.tilesHidden=true}/></div></div>}
window.mount=()=>{document.getElementById('root').innerHTML='';window.reactRoot=createRoot(document.getElementById('root'));window.reactRoot.render(<App/>)};window.mount();
`},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
  win=new BrowserWindow({width:1600,height:1050,useContentSize:true,show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true}});
  const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message)});
  await win.loadFile(path.join(repo,'desktop/ui/desktop-settings.html'));
  const run=s=>win.webContents.executeJavaScript(s),wait=()=>new Promise(r=>setTimeout(r,350));
  await run(`document.querySelectorAll('style,link[rel=stylesheet]').forEach(x=>x.remove());document.documentElement.className='dark';document.body.style='margin:0;background:#101a2e;color:#dae5f4';document.body.innerHTML='<div id="root"></div>';void 0`);
  const assets=path.join(repo,'desktop/dist/assets');await win.webContents.insertCSS(fs.readFileSync(path.join(assets,fs.readdirSync(assets).find(f=>f.endsWith('.css'))),'utf8'));
  await run(outputFiles[0].text);await wait();
  const click=async text=>{await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);await wait()};
  await click('Build 3D preview');assert.equal(await run('window.state.draft.geographic.features.length'),902);
  await run(`(()=>{const s=document.querySelector('[aria-label="Edit mapped feature"]');s.value=window.state.draft.geographic.features.find(f=>f.id.startsWith('way/51208075/')).id;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait();
  await run(`(()=>{const i=document.querySelector('fieldset input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'14');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait();
  assert.equal(await run(`window.state.draft.geographic.features.find(f=>f.id.startsWith('way/51208075/')).height`),14);
  await run('window.failSave=true');await click('Save reconstruction');assert.ok(await run('!!window.state.draft'));assert.ok((await run('document.body.innerText')).includes('Save failed for review'));
  await run('window.failSave=false');await click('Save reconstruction');assert.equal(await run('window.saved().items.length'),1);assert.equal(await run('window.tilesHidden'),true);
  await run('window.reactRoot.unmount();window.mount()');await wait();assert.equal(await run('window.state.scene.items[0].geographic.features.find(f=>f.id.startsWith("way/51208075/")).height'),14);
  await click('Edit Kylemore · reconstruction');assert.ok(await run('!!window.state.draft'));await click('Cancel');assert.equal(await run('window.state.draft'),null);
  await wait();console.log(await run('({size:window.r3f.size,render:window.r3f.gl.info.render})'));assert.ok(await run('window.r3f.gl.info.render.triangles>1000'));fs.writeFileSync(path.join(repo,'outputs/kylemore-reconstruction/native-editor-review.png'),(await win.webContents.capturePage()).toPNG());
  await run('window.blockRequest=true');await click('Build 3D preview');await run('window.changeProject("project-b")');await wait();await run('window.finishRequest()');await wait();assert.equal(await run('window.state.draft'),null);
  assert.deepEqual(errors,[]);console.log('PASS: native preview, edit, failed-save retention, save, remount/reload, cancellation, stale-project isolation, WebGL rendering');
 }catch(e){console.error(e);status=1}finally{win?.destroy();app.exit(status)}
});
