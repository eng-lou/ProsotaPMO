const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const repo=path.resolve(__dirname,'../..'),out=path.join(repo,'outputs/backhoe-authoring')
app.whenReady().then(async()=>{let win,status=0;try{
 const asset=pathToFileURL(path.join(out,'Backhoe.glb')).href,preset=JSON.parse(fs.readFileSync(path.join(out,'Equipment-77-parts-rig.json'),'utf8'))
 const {outputFiles}=await require(path.join(repo,'frontend/node_modules/esbuild')).build({stdin:{resolveDir:path.join(repo,'frontend'),loader:'tsx',contents:`
import React,{useState,useCallback,useMemo} from 'react';import {createRoot} from 'react-dom/client';import {Canvas,useThree} from '@react-three/fiber';import * as T from 'three';
import {parseAsset} from './src/modules/fourD/siteAssets';import {equipmentNodes,bindEquipment,sampleEquipmentNode,setJointTravel,jointOffset} from './src/modules/fourD/equipmentRig';import {importEquipmentPreset} from './src/modules/fourD/equipmentPreset';import {fitSoilBucket} from './src/modules/fourD/EquipmentSoilSetup';import {bucketFrame} from './src/modules/fourD/soilSimulation';import {EquipmentPanel} from './src/modules/fourD/EquipmentPanel';import {EquipmentPlayback} from './src/modules/fourD/EquipmentPlayback';
window.ready=(async()=>{
 const {object:root}=await parseAsset(await(await fetch(${JSON.stringify(asset)})).arrayBuffer()),def=importEquipmentPreset(${JSON.stringify(preset.definition)},root),nodes=equipmentNodes(root),key=def.joints.find(j=>j.id==='bucket').node,bucket=nodes.get(key);
 root.scale.set(1,1,1);root.updateMatrixWorld(true);
 const runtime=bindEquipment(root,def),pickup={steer:.5,lift:.1,bucket:.2,wheels:0};runtime.evaluate(null,pickup);
 const fit=fitSoilBucket(bucket,'y'),start=new Date('2026-01-01T00:00:00Z'),date={current:start},source=fit.world.clone();source.y=0;
 const soil={enabled:true,show_guide:false,bucket_node:key,center:fit.center,size:fit.size,rotation:fit.rotation,capacity:fit.capacity,dump_angle:105,pour_seconds:1.5,source:source.toArray(),radius:2.5,height:1.6,up_axis:'y',start:start.toISOString(),end:new Date(+start+14000).toISOString(),duration_seconds:14,steps:240,color:'#806046'};
 const angle=values=>{const m=sampleEquipmentNode(root,def,key,values),v=new T.Vector3(0,1,0).transformDirection(m.multiply(bucketFrame(soil)));return T.MathUtils.radToDeg(Math.acos(T.MathUtils.clamp(v.y,-1,1)))};
 window.oldAngles=[0,.5,1].flatMap(lift=>[0,1].map(bucket=>({lift,bucket,angle:angle({...pickup,lift,bucket})})));runtime.restore();def.soil=soil;
 const objects=[{name:'site:loader',kind:'mesh',object:root}];let saved={id:'rig',project_id:'p',model_ref:'site:loader',name:'Wheel loader · original 77 parts',version:1,definition:def};window.saved=()=>saved;
 function Inspect(){window.r3f=useThree();return null}
 function App(){const [rig,setRig]=useState(saved),[draft,setDraft]=useState(null),[preview,setPreview]=useState(null),[visual,setVisual]=useState(null),[error,setError]=useState(null),rigs=useMemo(()=>[draft||rig],[draft,rig]);window.draft=()=>draft;window.error=error;
 const noop=useCallback(()=>{},[]),save=useCallback(async r=>{saved=structuredClone({...r,version:r.version+1});setRig(saved);return true},[]),seek=useCallback(d=>{date.current=d;window.r3f.invalidate()},[]);
 return <div style={{display:'grid',gridTemplateColumns:'1fr 380px',height:'100vh'}}><Canvas frameloop="demand" camera={{position:[-11,6,-13],fov:43}} onCreated={({camera})=>camera.lookAt(0,2,0)}><Inspect/><color attach="background" args={['#dce4e8']}/><hemisphereLight args={['#eaf5ff','#66634a',2]}/><directionalLight position={[-8,15,7]} intensity={3}/><primitive object={root}/><EquipmentPlayback rigs={rigs} objects={objects} dateRef={date} preview={preview} visual={visual} onError={setError} daysPerSecond={1/86400}/></Canvas><div style={{overflowY:'auto',background:'#101b2d',color:'#eee'}}><EquipmentPanel projectId="p" objects={objects} rigs={[rig]} busy={false} error={null} runtimeError={error} dateRef={date} onSave={save} onRemove={noop} onDraft={setDraft} onPreview={setPreview} onEditing={noop} onSeek={seek} onVisual={setVisual} upAxis="y" format={{scheduleStart:start,timeDisplayMode:'seconds',speedDaysPerSecond:1/86400,fps:30}}/></div></div>}
 window.mount=()=>{window.reactRoot=createRoot(document.getElementById('root'));window.reactRoot.render(<App/>)};window.mount();
})();`},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}})
 win=new BrowserWindow({show:false,width:1480,height:1050,webPreferences:{contextIsolation:true,offscreen:true}})
 await win.loadFile(path.join(repo,'desktop/ui/desktop-settings.html'));const run=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){console.error('Failed script:',s);console.error(await win.webContents.executeJavaScript('document.body.innerText'));throw e}},wait=()=>new Promise(r=>setTimeout(r,300))
 const css=fs.readdirSync(path.join(repo,'desktop/dist/assets')).filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(path.join(repo,'desktop/dist/assets',n),'utf8')).join('\n')
 await run(`document.head.innerHTML='';document.body.innerHTML='<div id="root"></div>';document.body.style.margin='0';(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(css+'\nhtml,body,#root{height:100%;max-width:none;font:13px Arial} [hidden]{display:none}')};document.head.append(style);document.documentElement.classList.add('dark')})()`)
 await run(outputFiles[0].text);await run('window.ready');await wait();console.log('Original bucket angles:',await run('window.oldAngles'))
 const click=async label=>{await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);await wait()}
 const input=async(label,value)=>{await run(`(()=>{const i=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(String(value))});i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait()}
 const select=async()=>{await run(`(()=>{const s=document.querySelector('[aria-label="Equipment model"]');s.value='site:loader';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait()}
 await select();await click('1 · Pick up');await input('Cycle Loader lift',.1);await input('Cycle Bucket tilt',.2);await click('Capture pickup pose')
 await click('2 · Carry');await input('Cycle Loader lift',1);await input('Cycle Bucket tilt',.2);await click('Capture carry pose')
 await click('3 · Tip');await input('Cycle Loader lift',.1);await click('Capture tip pose')
 assert.match(await run('document.body.textContent'),/pose captured/);assert.match(await run('document.querySelector("[role=alert]").textContent'),/pouring needs/)
 await click('Adjust bucket travel');assert.equal(await run(`document.querySelector('[aria-label="Setup moving part"]').value`),'bucket')
 await run(`(()=>{const s=document.querySelector('[aria-label="Setup moving part"]');s.value='lift';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait();await click('Animate');await click('Adjust bucket travel');assert.equal(await run(`document.querySelector('[aria-label="Setup moving part"]').value`),'bucket')
 await input('Setup pose',60);await click('Set 1 position');assert.match(await run('document.body.textContent'),/Position 1 applied/)
 const edited=await run('window.draft().definition');assert.equal(edited.controls.find(c=>c.id==='bucket').rest,.5);assert.equal(edited.joints.find(j=>j.id==='rocker').maximum,preset.definition.joints.find(j=>j.id==='rocker').maximum)
 await click('Animate');await click('Setup');assert.match(await run('document.body.textContent'),/1 = 60/);assert.equal(await run(`document.querySelector('[aria-label="Setup moving part"]').value`),'bucket')
 await click('Save rig & keys');assert.ok(await run('window.saved().definition.joints.find(j=>j.id==="bucket").maximum===60'))
 await click('Animate');await click('3 · Tip ⚠');await input('Cycle Loader lift',1);await input('Cycle Bucket tilt',1);await click('Capture tip pose')
 assert.equal(await run('document.querySelector("[role=alert]")?.textContent||null'),null)
 assert.ok(await run('document.body.textContent.includes("3 · Tip ✓")'));assert.equal(await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Create & save cycle").disabled'),false)
 fs.writeFileSync(path.join(out,'loader-tip-preview8.png'),(await win.webContents.capturePage()).toPNG())
 await click('Create & save cycle');assert.ok(await run('window.saved().definition.soil.cycle'));assert.equal(await run('window.error'),null)
 await run('window.reactRoot.unmount();window.mount()');await wait();await select();await click('Setup');assert.match(await run('document.body.textContent'),/1 = 60/);await click('Animate');assert.ok(await run('document.body.textContent.includes("3 · Tip ✓")'))
 console.log('PASS: real 77-part loader captures feedback, edits shared bucket range, persists through tabs/save/reload, and saves a validated dump cycle')
 }catch(e){console.error(e);status=1}finally{win?.destroy();app.exit(status)}})
