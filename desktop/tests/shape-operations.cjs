
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
 const click=text=>run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)});if(!b || b.disabled)throw Error('Missing/disabled button '+${JSON.stringify(text)});b.click()})()`)


 try{
 await run(`(async()=>{const request=async(url,body,method='POST')=>{const r=await fetch('/api/v1/'+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()};const project=await request('projects/',{name:'Shape operations regression'});localStorage.setItem('shape-project',project.id);const points=[{x:0,y:0,z:0},{x:10,y:0,z:0},{x:10,y:10,z:0},{x:0,y:10,z:0}];const path=await request('paths/',{project_id:project.id,name:'Ground boundary',curve_mode:'straight',closed:true,points});await request('site-scenes/'+project.id,{command_id:crypto.randomUUID(),expected_revision:0,items:[{id:crypto.randomUUID(),name:'Ground',kind:'shape',path_id:path.id,points,closed:true,height:4,up_axis:'z',position:{x:0,y:0,z:0}},{id:crypto.randomUUID(),name:'Dig cutter',kind:'context',width:4,depth:4,height:6,up_axis:'z',position:{x:5,y:5,z:1}}]},'PUT');localStorage.setItem('prosota_4d_viewer_settings',JSON.stringify({renderMode:'realistic',upAxis:'z'}))})()`);
 wc.reload();await pause(2500);await run(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Shape operations regression')).click()`);await pause(1300);await run(`document.querySelector('a[href="/4d"]').click()`);await pause(3000);
 await click('Site Tools');await pause(300);await click('Layout tools');await pause(400);
 await run(`(()=>{[...document.querySelectorAll('summary')].find(e=>e.innerText==='Shape operations').click();window.shapeSelect=(label,text)=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith(label));const s=l?.querySelector('select');if(!s)throw Error('Missing '+label);s.value=[...s.options].find(o=>o.text===text).value;s.dispatchEvent(new Event('change',{bubbles:true}))};window.sceneData=()=>fetch('/api/v1/site-scenes/'+localStorage.getItem('shape-project')).then(r=>r.json());shapeSelect('Base solid','Ground')})()`);await pause(200);
 await run(`shapeSelect('Cutter / second solid','Dig cutter')`);await pause(200);await click('Preview operation');await pause(1200);
 await run(`(()=>{if(!document.querySelector('[aria-label="Shape operation preview"]'))throw Error('No boolean preview: '+document.body.innerText)})()`);
 await run(`document.querySelector('[aria-label="Shape operation preview"]').scrollIntoView({block:'center'})`);await pause(250);
 fs.writeFileSync(path.join(desktop,'../outputs/shape-preview.png'),(await wc.capturePage()).toPNG());
 await click('Create results');await pause(3000);
 const created=await run('sceneData()');if(created.items.length!==4)throw Error('Expected 2 retained inputs and 2 results: '+JSON.stringify(created));
 const resultIds=created.items.slice(2).map(i=>i.id);
 await click(created.items[2].name);await pause(500);
 await run(`(()=>{if(!document.body.innerText.includes('Edit Pivot'))throw Error('Result has no shared transforms')})()`);
 await click('Open Materials');await pause(600);
 await run(`(()=>{if(document.body.innerText.includes('Showing the 0 materials'))throw Error('Result materials missing')})()`);
 await run(`(()=>{document.querySelector('button[title^="Ctrl+Z:"]')?.click()})()`);await pause(1600);
 const undone=await run('sceneData()');if(undone.items.length!==2)throw Error('Undo failed');
 await run(`(()=>{document.querySelector('button[title^="Ctrl+Shift+Z"]')?.click()})()`);await pause(1800);
 if((await run('sceneData()')).items.length!==4)throw Error('Redo failed');
 await run(`[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Site Tools').at(-1).click()`);await pause(350);
 await run(`shapeSelect('Operation','Terrain · subdivide / raise / lower / simplify')`);await pause(200);
 await run(`shapeSelect('Base solid','Ground')`);await pause(200);await click('Preview operation');await pause(600);
 for(let i=0;i<3;i++){await click('Subdivide ×4');await pause(150)}
 // Native click in terrain preview; then apply a local brush.
 await run(`document.querySelector('[aria-label="Shape operation preview"]').scrollIntoView({block:'center'})`);await pause(300);
 const point=await run(`(()=>{const r=document.querySelector('[aria-label="Shape operation preview"] canvas').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
 wc.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await pause(400);
 await click('Raise area');await pause(400);
 await run(`(()=>{const alert=document.querySelector('[role="alert"]');if(alert)throw Error(alert.textContent)})()`);
 await click('Undo shape edit');await pause(150);await click('Lower area');await pause(250);
 await click('Create results');await pause(2500);
 if((await run('sceneData()')).items.length!==5)throw Error('Sculpted terrain failed to save');
 wc.reload();await pause(6500);
 if((await run(`fetch('/api/v1/site-scenes/'+localStorage.getItem('shape-project')).then(r=>r.json())`)).items.length!==5)throw Error('Results missing on reload');
 fs.writeFileSync(path.join(desktop,'../outputs/shape-result.json'),JSON.stringify({passed:true,booleanSaved:true,transformMaterials:true,undoRedo:true,terrainNativePick:true,terrainSaved:true,reload:true,resultIds}));
 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'../outputs/shape-result.json'),JSON.stringify({passed:false,error:e.message}));fs.writeFileSync(path.join(desktop,'../outputs/shape-failure.txt'),await wc.executeJavaScript('document.body.innerText'));fs.writeFileSync(path.join(desktop,'../outputs/shape-failure.png'),(await wc.capturePage()).toPNG())}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Shape test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')
