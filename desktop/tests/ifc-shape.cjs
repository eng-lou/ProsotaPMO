
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
 await run(`(async()=>{const r=await fetch('/api/v1/projects/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'IFC selection regression'})});if(!r.ok)throw Error(await r.text());localStorage.setItem('prosota_4d_viewer_settings',JSON.stringify({renderMode:'realistic',upAxis:'z'}))})()`)
 wc.reload();await pause(2500);await run(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('IFC selection regression')).click()`);await pause(1500);await run(`document.querySelector('a[href="/4d"]').click()`);await pause(3000)
 const ifc=fs.readFileSync(path.join(__dirname,'fixtures/wall.ifc'),'utf8')
 await run(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(ifc)}],'Selection-wall.ifc'));const input=document.querySelector('input[accept=".ifc"]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(6000)
 await click('Select All');await pause(300);await click('Frame Selected');await pause(600);await click('Deselect All');await pause(300)
 const bounds=await run(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`)
 const x=Math.round(bounds.x+bounds.width/2),y=Math.round(bounds.y+bounds.height/2)
 wc.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await pause(800)
 await run(`(()=>{if(!document.body.textContent.includes('Selected element (in'))throw Error('Viewport IFC selection did not expose element transforms');if(!document.body.innerText.includes('Edit Pivot'))throw Error('Pivot controls missing')})()`)
 await click('Open Materials');await pause(800)
 await run(`(()=>{const text=document.body.innerText;if(text.includes('Showing the 0 materials'))throw Error('Selected IFC has no material mapping');if(!text.includes('Showing the 1 material'))throw Error('Expected selected IFC material');const editor=document.querySelector('[data-testid="custom-material-editor"]');if(!editor.innerText.includes('Base Color'))throw Error('Element material controls missing')})()`)

 await run(`(()=>{const select=document.querySelector('select[aria-label^="Finish for"]');if(!select)throw Error('Assigned finish selector absent');if(select.getBoundingClientRect().bottom>window.innerHeight)throw Error('Assigned finish is buried below the visible panel');select.value='original';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(300)
 await click('Deselect All');await pause(200)
 const b2=await run(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+r.width*.7,y:r.y+r.height*.4}})()`)
 wc.sendInputEvent({type:'mouseDown',x:Math.round(b2.x),y:Math.round(b2.y),button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',x:Math.round(b2.x),y:Math.round(b2.y),button:'left',clickCount:1});await pause(500)
 await run(`(()=>{const select=document.querySelector('select[aria-label^="Finish for"]');if(select?.value!=='original')throw Error('Viewport reselect lost assigned material');})()`)

 wc.sendInputEvent({type:'mouseDown',x:Math.round(b2.x),y:Math.round(b2.y),button:'left',clickCount:1,modifiers:['control']});wc.sendInputEvent({type:'mouseUp',x:Math.round(b2.x),y:Math.round(b2.y),button:'left',clickCount:1,modifiers:['control']});await pause(400)
 await run(`(()=>{if(document.body.textContent.includes('Selected element (in'))throw Error('Ctrl-click did not toggle IFC selection off')})()`)

 // Use the selected IFC wall as a copied solid; source file must remain byte-identical.
 wc.sendInputEvent({type:'mouseDown',x:Math.round(b2.x),y:Math.round(b2.y),button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',x:Math.round(b2.x),y:Math.round(b2.y),button:'left',clickCount:1});await pause(300);
 await run(`(async()=>{const projects=await fetch('/api/v1/projects/').then(r=>r.json());const project=projects.find(p=>p.name==='IFC selection regression');window.shapeIfcProject=project.id;const files=await fetch('/api/v1/model3d-files/?project_id='+project.id).then(r=>r.json());window.shapeIfcFile=files.find(f=>f.kind==='ifc');window.shapeIfcBefore=await fetch('/api/v1/model3d-files/'+shapeIfcFile.id+'/download').then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(b=>Array.from(new Uint8Array(b)).join(','))})()`);
 await click('Site Tools');await pause(300);await run(`[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Site Tools').at(-1).click()`);await pause(250);await click('Layout tools');await pause(300);
 await run(`[...document.querySelectorAll('summary')].find(e=>e.innerText==='Shape operations').click()`);await click('Use selected as base');await pause(250);
 await run(`(()=>{const s=[...document.querySelectorAll('label')].find(e=>e.textContent.startsWith('Operation')).querySelector('select');s.value='terrain';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(200);await click('Preview operation');await pause(700);
 await run(`(()=>{if(!document.querySelector('[aria-label="Shape operation preview"]'))throw Error('IFC selected solid preview failed: '+[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent).join(';'))})()`);
 await click('Create results');await pause(2500);
 await run(`(async()=>{const scene=await fetch('/api/v1/site-scenes/'+shapeIfcProject).then(r=>r.json());if(scene.items.length!==1)throw Error('IFC copy not saved');if(!scene.items[0].operation_inputs[0].startsWith('file:'))throw Error('IFC backup reference is not persistent');const hash=await fetch('/api/v1/model3d-files/'+shapeIfcFile.id+'/download').then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(b=>Array.from(new Uint8Array(b)).join(','));if(hash!==shapeIfcBefore)throw Error('Source IFC file changed')})()`);
 fs.writeFileSync(path.join(desktop,'../outputs/ifc-shape.png'),(await wc.capturePage()).toPNG())
 console.log('PASS: actual IFC viewport click exposes element transform and assigned material')
 fs.writeFileSync(path.join(desktop,'../outputs/ifc-shape-result.json'),JSON.stringify({passed:true}))
 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'../outputs/ifc-shape-result.json'),JSON.stringify({passed:false,error:e.message}));fs.writeFileSync(path.join(desktop,'../outputs/ifc-selection-failure.png'),(await wc.capturePage()).toPNG())}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')

