
const { app, session } = require('electron')
const fs=require('fs'),path=require('path'),crypto=require('crypto')
const desktop=path.resolve(__dirname,'..'),data=path.join(desktop,'.test-data','camera-'+crypto.randomBytes(4).toString('hex'))
const setPath=app.setPath.bind(app);app.setPath=(name,value)=>setPath(name,name==='userData'?data:value)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');app.on('browser-window-created',(_,w)=>w.showInactive())
let started=false
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest((d,done)=>done({cancel:d.url.startsWith('https:')})))
app.on('web-contents-created',(_,wc)=>wc.once('did-finish-load',async()=>{
 if(started)return;started=true;const pause=ms=>new Promise(r=>setTimeout(r,ms))
 const run=async code=>{console.log('RUN '+code.slice(0,150));const r=await wc.executeJavaScript('(async()=>{try{return {value:await ('+code+')}}catch(e){return {error:e.message}}})()');if(r.error)throw Error(r.error);return r.value}
 const click=text=>run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.click()})()`)


 try{
 await wc.executeJavaScript(fs.readFileSync(path.join(desktop,'../outputs/import-test-bundle.js'),'utf8'))

 await run(`(()=>{window.backhoeFiles=[]})()`)
 const folder='D:/UE Projects/New folder/Game/WSMGameStudio/HeavyMachinery/Backhoe/Meshes/equipment 2'
 for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.glb'))){
  const bytes=fs.readFileSync(path.join(folder,name)).toString('base64')
  await run(`backhoeFiles.push(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],${JSON.stringify(name)}))`)
 }
 const result=await run(`(async()=>{
 const T=ImportTest.THREE;const file=await ImportTest.convertSiteImportSet(backhoeFiles,{upAxis:'auto',unitScale:0,includeAnimation:false},'Backhoe 77 parts');
 const project=await fetch('/api/v1/projects/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Backhoe regression'})}).then(r=>r.json());
 localStorage.setItem('backhoe-project',project.id);
 const saved=await ImportTest.importSiteAsset(project.id,file,'Equipment',()=>{});
 const first=await ImportTest.loadSiteAsset(saved.id),second=await ImportTest.loadSiteAsset(saved.id);
 const nodes=ImportTest.equipmentNodes(first);const meshes=[...nodes].filter(([k,n])=>n.isMesh);
 if(meshes.length<70)throw Error('Parts lost: '+meshes.length);
 const filenames=new Set();first.traverse(n=>{if(n.userData.prosotaSourceFile)filenames.add(n.userData.prosotaSourceFile)});
 if(filenames.size!==77)throw Error('Source hierarchy lost: '+filenames.size);
 const def=ImportTest.emptyEquipment();def.controls=[{id:'lift',name:'Test lift',value:0,rest:0,keys:[]}];
 def.joints=[{id:'arm',name:'Test part',node:meshes[0][0],parent:null,control:'lift',kind:'hinge',pivot:[0,0,0],axis:[0,0,1],minimum:0,maximum:90,response:[[0,0],[1,1]]}];
 const r1=ImportTest.bindEquipment(first,def),r2=ImportTest.bindEquipment(second,def);
 const before=meshes[0][1].quaternion.clone();r1.evaluate(null,{lift:1});if(before.angleTo(meshes[0][1].quaternion)<.1)throw Error('Rig does not move');
 const secondPart=ImportTest.equipmentNodes(second).get(meshes[0][0]);if(secondPart.quaternion.angleTo(before)>.0001)throw Error('Instance poses leak');
 const parent=new T.Group();parent.add(first);const curve=ImportTest.buildPathCurve([{x:0,y:0,z:0},{x:10,y:0,z:0},{x:10,y:10,z:0}],false,'straight');
 const motion={speed:2,loop:false,orient:true,heading:0,animation_reference_speed:2};
 ImportTest.applySitePath(parent,curve,motion,1,'z',new T.Vector3());const a=meshes[0][1].getWorldPosition(new T.Vector3());
 ImportTest.applySitePath(parent,curve,motion,7,'z',new T.Vector3());r1.evaluate(null,{lift:.5});const b=meshes[0][1].getWorldPosition(new T.Vector3());if(a.distanceTo(b)<1)throw Error('Rig part does not follow path');
 r1.restore();r2.restore();
 const request=async(url,body)=>{const r=await fetch('/api/v1/'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()};
 await request('equipment-rigs/',{project_id:project.id,model_ref:'asset:'+saved.id,name:'Backhoe rig',definition:def});
 const item={id:crypto.randomUUID(),kind:'asset',asset_id:saved.id,name:'Backhoe',...saved.dimensions,up_axis:'z',position:{x:0,y:0,z:0}};
 const response=await fetch('/api/v1/site-scenes/'+project.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({command_id:crypto.randomUUID(),expected_revision:0,items:[item,{...item,id:crypto.randomUUID(),name:'Backhoe copy',position:{x:10,y:0,z:0}}]})});if(!response.ok)throw Error(await response.text());
 localStorage.setItem('prosota_4d_viewer_settings',JSON.stringify({renderMode:'flat',upAxis:'z'}));
 return {files:filenames.size,meshParts:meshes.length,dimensions:saved.dimensions,rigMotion:true,independentCopies:true,pathMotion:true,assetId:saved.id};
 })()`)
 wc.reload();await pause(2500);await run(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Backhoe regression')).click()`);await pause(1300);await run(`document.querySelector('a[href="/4d"]').click()`);await pause(6000);
 await click('Rigging');await pause(700);
 const options=await run(`[...document.querySelector('[aria-label="Equipment model"]').options].map(o=>({value:o.value,text:o.text}))`);
 if(options.filter(o=>o.value.startsWith('site:')).length!==2)throw Error('Placed copies missing from Rigging: '+JSON.stringify(options));
 await run(`(()=>{const s=document.querySelector('[aria-label="Equipment model"]');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(600);
 if(!(await run(`document.body.innerText`)).includes('Test part'))throw Error('Library rig did not load for placed asset');
 const errors=await run(`[...document.querySelectorAll('[role="status"]')].map(e=>e.innerText).filter(t=>/Missing|Ambiguous|Unsupported|Invalid/.test(t))`);if(errors.length)throw Error(errors.join(';'));
 await click('Save rig to asset library');await pause(900);
 await run(`(async()=>{const rigs=await fetch('/api/v1/equipment-rigs/?project_id='+localStorage.getItem('backhoe-project')).then(r=>r.json());if(!rigs.some(r=>r.model_ref.startsWith('asset:')&&r.version===2))throw Error('Library rig save button failed')})()`);
 await run(`[...document.querySelectorAll('summary')].find(e=>e.innerText==='Assemble separate imports').click()`);await click('Select all imports');await pause(200);await click('Assemble 2 imports');await pause(5000);
 await run(`(async()=>{const scene=await fetch('/api/v1/site-scenes/'+localStorage.getItem('backhoe-project')).then(r=>r.json());if(scene.items.length!==3||scene.items[2].operation_inputs.length!==2)throw Error('Separate-import assembly did not save to the site library');const assets=await fetch('/api/v1/site-assets/?project_id='+localStorage.getItem('backhoe-project')).then(r=>r.json());if(assets.length!==2)throw Error('Assembly missing from library')})()`);
 await click('Import 3D');await pause(500);
 wc.debugger.attach('1.3');const doc=await wc.debugger.sendCommand('DOM.getDocument');const node=await wc.debugger.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type="file"][accept*=".fbx"]'});
 await wc.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:node.nodeId,files:fs.readdirSync(folder).filter(n=>n.endsWith('.glb')).map(n=>path.join(folder,n))});wc.debugger.detach();await pause(500);
 await run(`(()=>{if(!document.body.innerText.includes('77 model files'))throw Error('Multi-file picker rejected backhoe')})()`);
 await click('Review import');await pause(4500);
 await run(`(()=>{if(!document.querySelector('[aria-label="Check imported materials"]'))throw Error('Multi-file review failed: '+document.body.innerText)})()`);
 fs.writeFileSync(path.join(desktop,'../outputs/backhoe-result.json'),JSON.stringify({passed:true,...result,libraryRigReload:true,panelInstances:true,multiFilePickerReview:true,separateAssemblySaved:true,libraryRigSaveButton:true}));
 fs.writeFileSync(path.join(desktop,'../outputs/backhoe-rig.png'),(await wc.capturePage()).toPNG());

 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'../outputs/backhoe-result.json'),JSON.stringify({passed:false,error:e.message}))}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')

