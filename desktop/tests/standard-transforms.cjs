
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
 await run(`(async()=>{
 const request=async(url,body,method='POST')=>{const r=await fetch('/api/v1/'+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(url+': '+await r.text());return r.json()};
 const project=await request('projects/',{name:'Path zone tests'});window.testProject=project.id;
 const saved=await request('site-scenes/'+project.id,{command_id:crypto.randomUUID(),expected_revision:0,items:[{id:crypto.randomUUID(),name:'Test cabin',kind:'cabin',up_axis:'z',position:{x:4,y:2,z:0},width:6,height:3,depth:2}]},'PUT');
 localStorage.setItem('prosota_4d_viewer_settings',JSON.stringify({renderMode:'realistic',upAxis:'z'}));
 })()`);
 wc.reload();await pause(2500);await run(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Path zone tests')).click()`);await pause(1800)
 await run(`document.querySelector('a[href="/4d"]').click()`);await pause(4000);await click('Site Tools');await pause(300);await click('Layout tools');await pause(300)
 await click('Test cabin');await pause(500);await click('Frame Selected');await pause(1000)
 await run(`(()=>{for(const text of ['Apply Transform','Snap to Surface','Edit Pivot','Pivot Rotation','Open Materials'])if(!document.body.innerText.toLowerCase().includes(text.toLowerCase()))throw Error('Missing shared control '+text)})()`)
 await click('Base');await pause(700);await click('Apply Transform');await pause(1000)
 await run(`(async()=>{const projects=await fetch('/api/v1/projects/').then(r=>r.json());const project=projects.find(p=>p.name==='Path zone tests');window.testProject=project.id;const scene=await fetch('/api/v1/site-scenes/'+project.id).then(r=>r.json());if(!scene.items[0].object_state)throw Error('Missing saved pivot/content');if(scene.items[0].position.x!==0)throw Error('Apply transform not saved');})()`)
 wc.reload();await pause(4500);await click('Site Tools');await pause(300);await click('Layout tools');await click('Test cabin');await pause(500);await click('Frame Selected');await pause(1000)
 await run(`(()=>{if(!document.body.innerText.includes('Edit Pivot'))throw Error('Shared panel missing after reload')})()`)
 fs.writeFileSync(path.join(desktop,'../outputs/standard-transforms.png'),(await wc.capturePage()).toPNG())
 console.log('PASS: cabin shared controls, pivot, apply transform persistence and reload')
 fs.writeFileSync(path.join(desktop,'.test-data/standard-transforms-result.json'),JSON.stringify({passed:true}))
 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'.test-data/standard-transforms-result.json'),JSON.stringify({passed:false,error:e.message}));fs.writeFileSync(path.join(desktop,'../outputs/standard-transforms-failure.png'),(await wc.capturePage()).toPNG())}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')

