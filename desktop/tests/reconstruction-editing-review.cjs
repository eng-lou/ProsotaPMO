const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../..');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.whenReady().then(async()=>{
 let win,status=0;
 try{
  const tree=fs.readFileSync(path.join(repo,'frontend/public/context/tree-small.glb')).toString('base64');
  const {outputFiles}=await require(path.join(repo,'frontend/node_modules/esbuild')).build({stdin:{resolveDir:path.join(repo,'frontend'),loader:'tsx',contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Canvas,useThree} from '@react-three/fiber';import {OrbitControls} from '@react-three/drei';import * as T from 'three';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {api} from './src/lib/api';import {useSiteScene} from './src/modules/fourD/siteScene';import {GeographicModel} from './src/modules/fourD/GeographicModel';import {GeographicWorkbench} from './src/modules/fourD/GeographicWorkbench';import {buildGeographicContext,disposeGeographicContext} from './src/modules/fourD/geographicGeometry';import {geographicSnapshot,disposeSnapshot} from './src/modules/fourD/geographicExport';import {parseAsset} from './src/modules/fourD/siteAssets';
const feature={id:'way/1',kind:'building',name:'Workshop',category:'industrial',height:9,height_basis:'estimated',roof:'industrial',roof_basis:'estimated',color:'#c8c9ca',roof_color:'#829198',width:6,hidden:false,points:[[-20,-14],[20,-14],[20,14],[-20,14]],holes:[]};
const data={version:1,source:'OpenStreetMap',attribution:'© OpenStreetMap contributors · ODbL 1.0',source_date:'2026-10-26',lat:53.33,lon:-6.34,width:100,depth:100,features:[feature,{...feature,id:'node/2',name:'Tree 2',kind:'tree',points:[[30,20]],holes:[],height:8},{...feature,id:'node/3',name:'Tree 3',kind:'tree',points:[[36,20]],holes:[],height:9}],hidden_layers:[],detail:'detailed'};
const item={id:'geo',name:'Editing review',kind:'geographic',geographic:data,generator_version:1,up_axis:'z',position:{x:0,y:0,z:0},width:1,depth:1,height:1,scale:{x:1,y:1,z:1},rotation:{x:0,y:0,z:0},yaw:0,color:'#fff',locked:false,activity_id:null,path_id:null,points:[],closed:false,module_length:2,gate_start:0,gate_width:0};
const treeURL='data:model/gltf-binary;base64,${tree}';const treePromise=new GLTFLoader().parseAsync(Uint8Array.from(atob('${tree}'),c=>c.charCodeAt(0)).buffer,'');GLTFLoader.prototype.loadAsync=()=>treePromise;
let saved={revision:1,items:[item]};window.saved=()=>saved;const assets=[{id:'oak',name:'Imported oak',category:'Trees',status:'ready',dimensions:{width:4,depth:4,height:8}}];
api.get=async url=>({data:url.includes('/download')?{download_url:treeURL}:url.includes('site-assets')?assets:structuredClone(saved)});
api.put=async(url,value)=>{saved={revision:saved.revision+1,items:structuredClone(value.items)};return {data:structuredClone(saved)}};
api.post=async(url,value)=>({data:url.endsWith('/open-map')?{...data,features:data.features.map(f=>({...f,height:5}))}:value});
function Inspect(){window.r3f=useThree();return null}function App(){const state=useSiteScene('project-a');window.state=state;const current=state.draft||state.scene.items[0];return <div style={{display:'grid',gridTemplateColumns:'1fr 400px',height:'100vh'}}><div><Canvas orthographic camera={{position:[80,-90,85],zoom:7,near:.1,far:1000,up:[0,0,1]}}><Inspect/><color attach="background" args={['#e1e7e9']}/><ambientLight intensity={2}/><directionalLight position={[20,-30,80]} intensity={3}/>{current&&<GeographicModel itemId="geo" data={current.geographic} onLoaded={()=>{}} selected={state.detailSelection?.featureId} onSelect={(featureId,surface)=>{state.setSelected('geo');state.setDetailSelection({itemId:'geo',featureId,surface})}}/>}<OrbitControls/></Canvas></div><div style={{overflowY:'auto',padding:12}}>{state.scene.items[0]&&<GeographicWorkbench item={state.scene.items[0]} state={state} source={window.r3f?.scene} projectId="project-a" assets={assets}/>}</div></div>}
window.mount=()=>{document.getElementById('root').innerHTML='';window.reactRoot=createRoot(document.getElementById('root'));window.reactRoot.render(<App/>)};window.mount();
window.roundTrip=async()=>{
 const authored={...data,features:[{...feature,surfaces:{'wall:0:1':{finish:'original',color:'#ff0000'}}}]},source=buildGeographicContext(authored),snapshot=geographicSnapshot(source,authored,new Set(['way/1']),true);
 const bytes=await new GLTFExporter().parseAsync(snapshot.root,{binary:true});const parsed=await new GLTFLoader().parseAsync(bytes,'');let ids=[],surfaces=[];parsed.scene.traverse(o=>{if(o.userData.prosotaFeatureId)ids.push(o.userData.prosotaFeatureId);if(o.userData.prosotaSurface)surfaces.push(o.userData.prosotaSurface)});
 const asset=await parseAsset(bytes),replacement={asset_id:'roundtrip',...asset.dimensions,anchor:snapshot.anchor.toArray(),yaw:0},returned=buildGeographicContext({...authored,features:[{...authored.features[0],replacement}]},null,{assets:new Map([['roundtrip',asset.object]])});
 const beforeFeature=geographicSnapshot(source,authored,new Set(['way/1'])),afterFeature=geographicSnapshot(returned,authored,new Set(['way/1']));
 const initial=new T.Box3().setFromObject(beforeFeature.root),final=new T.Box3().setFromObject(afterFeature.root);const drift=initial.min.distanceTo(final.min)+initial.max.distanceTo(final.max);disposeSnapshot(beforeFeature.root);disposeSnapshot(afterFeature.root);disposeGeographicContext(source);disposeSnapshot(snapshot.root);disposeGeographicContext(returned);return {ids,surfaces,drift,bytes:bytes.byteLength};
};
`},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
  win=new BrowserWindow({width:1500,height:1050,useContentSize:true,show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true}});
  const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message)});
  await win.loadFile(path.join(repo,'desktop/ui/desktop-settings.html'));
  const run=s=>win.webContents.executeJavaScript(s),wait=()=>new Promise(r=>setTimeout(r,350));
  await run(`document.querySelectorAll('style,link[rel=stylesheet]').forEach(x=>x.remove());document.body.style='margin:0;background:#101a2e;color:#dae5f4';document.documentElement.className='dark';document.body.innerHTML='<div id="root"></div>';void 0`);
  const assets=path.join(repo,'desktop/dist/assets');await win.webContents.insertCSS(fs.readFileSync(path.join(assets,fs.readdirSync(assets).find(f=>f.endsWith('.css'))),'utf8'));
  await run(outputFiles[0].text);await wait();
  const click=async text=>{await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);await wait()};
  await run(`window.state.setSelected('geo');window.state.setDetailSelection({itemId:'geo',featureId:'way/1',surface:'wall:0:1'})`);await wait();
  await run(`(()=>{const i=document.querySelector('[aria-label="Surface tint"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'#ff0000');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait();
  assert.equal(await run(`window.state.draft.geographic.features[0].surfaces['wall:0:1'].color`),'#ff0000');await click('Save changes');
  await run('window.reactRoot.unmount();window.mount()');await wait();assert.equal(await run(`window.saved().items[0].geographic.features[0].surfaces['wall:0:1'].color`),'#ff0000');
  await run(`window.state.setSelected('geo');window.state.setDetailSelection({itemId:'geo',featureId:'node/2'})`);await wait();
  await run(`(()=>{const s=document.querySelector('[aria-label="Replacement asset"]');s.value='oak';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait();await click('Replace 1');
  assert.equal(await run(`window.saved().items[0].geographic.features.find(f=>f.id==='node/2').replacement.asset_id`),'oak');assert.equal(await run(`window.saved().items[0].geographic.features.find(f=>f.id==='node/3').replacement??null`),null);
  await click('Regenerate preview');assert.equal(await run(`window.state.draft.geographic.features[0].surfaces['wall:0:1'].color`),'#ff0000');assert.equal(await run(`window.state.draft.geographic.features.find(f=>f.id==='node/2').replacement.asset_id`),'oak');await click('Save changes');
  const roundTrip=await run('window.roundTrip()');assert.deepEqual(roundTrip.ids,['way/1']);assert.ok(roundTrip.surfaces.includes('roof'));assert.ok(roundTrip.surfaces.includes('wall:0:1'));assert.ok(roundTrip.drift<.0001,JSON.stringify(roundTrip));assert.ok(roundTrip.bytes>1000);
  await wait();fs.writeFileSync(path.join(repo,'outputs/kylemore-reconstruction/editing-review.png'),(await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[]);console.log('PASS: native wall tint, save/remount, single imported-tree replacement, preservation during regeneration, structured GLB export/reimport and world alignment',roundTrip);
 }catch(e){console.error(e);status=1}finally{win?.destroy();app.exit(status)}
});
