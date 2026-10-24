
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
 const points=[{x:0,y:0,z:0},{x:20,y:0,z:0},{x:20,y:15,z:0},{x:0,y:15,z:0}];
 const path=await request('paths/',{project_id:project.id,name:'Pool boundary',points,closed:true,curve_mode:'straight'});
 if(path.curve_mode!=='straight')throw Error('Path mode not persisted');
 const common={up_axis:'z',position:{x:0,y:0,z:0},path_id:path.id,points,closed:true,curve_mode:'straight'};
 const items=[{...common,id:crypto.randomUUID(),name:'Water footprint',kind:'shape',height:.3,finish:'water',tag:'Water'},
 {...common,id:crypto.randomUUID(),name:'Edge trees',kind:'array',placement_kind:'tree',spacing:7,width:1,depth:1,height:2},
 {...common,id:crypto.randomUUID(),name:'Scattered people',kind:'scatter',placement_kind:'person',spacing:2,count:12,seed:42,width:.5,depth:.3,height:1.7},
 {...common,id:crypto.randomUUID(),name:'Fitted fence',kind:'fence',height:1,module_length:2,panel_fit:'trim'}];
 for(const item of items){const preview=await request('site-scenes/'+project.id+'/preview',item);if(!preview.layout)throw Error('No generated layout');}
 const saved=await request('site-scenes/'+project.id,{command_id:crypto.randomUUID(),expected_revision:0,items},'PUT');
 if(saved.items[0].layout.footprint.length!==4||saved.items[2].layout.count!==12)throw Error('Bad generated geometry');
 const loaded=await fetch('/api/v1/site-scenes/'+project.id).then(r=>r.json());const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;if(JSON.stringify(canonical(loaded))!==JSON.stringify(canonical(saved)))throw Error('Reload changed generated geometry');
 localStorage.setItem('prosota_4d_viewer_settings',JSON.stringify({renderMode:'realistic',upAxis:'z'}));
 })()`);
 wc.reload();await pause(2500);await run(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Path zone tests')).click()`);await pause(1800)
 await run(`document.querySelector('a[href="/4d"]').click()`);await pause(4000);await click('Site Tools');await pause(300);await click('Layout tools');await pause(300)
 await run(`(()=>{for(const text of ['Closed shape / water','Objects along path','Scatter in zone','Water footprint','Edge trees','Scattered people'])if(!document.body.innerText.includes(text))throw Error('Missing layout UI '+text)})()`)
 await click('+ Closed shape / water');await pause(200)
 await run(`(()=>{const labels=[...document.querySelectorAll('label')];for(const text of ['Source path','Or source zone','Height / thickness','Surface','Tag'])if(!labels.some(l=>l.innerText.includes(text)))throw Error('Missing shape field '+text)})()`)
 await click('Cancel');await click('Select All');await click('Frame Selected');await pause(1200)
 fs.writeFileSync(path.join(desktop,'../outputs/path-zone-layout.png'),(await wc.capturePage()).toPNG())
 console.log('PASS: path mode, shape/water, array, seeded scatter, fitted fence, preview, persistence and layout UI')
 fs.writeFileSync(path.join(desktop,'.test-data/path-zone-layout-result.json'),JSON.stringify({passed:true}))
 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'.test-data/path-zone-layout-result.json'),JSON.stringify({passed:false,error:e.message}));fs.writeFileSync(path.join(desktop,'../outputs/path-zone-layout-failure.png'),(await wc.capturePage()).toPNG())}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')
