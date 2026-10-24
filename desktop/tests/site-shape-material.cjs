
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
 const r=await fetch('/api/v1/projects/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Shape material tests'})});const project=await r.json();
 const scene=await fetch('/api/v1/site-scenes/'+project.id).then(r=>r.json());
 const item={id:crypto.randomUUID(),name:'Test water shape',kind:'context',up_axis:'z',position:{x:0,y:0,z:0},width:10,depth:10,height:.15,color:'#94a3b8'};
 const saved=await fetch('/api/v1/site-scenes/'+project.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({command_id:crypto.randomUUID(),expected_revision:scene.revision,items:[item]})});if(!saved.ok)throw Error(await saved.text());
 localStorage.setItem('prosota_4d_viewer_settings',JSON.stringify({renderMode:'realistic',upAxis:'z'}));
 })()`);
 wc.reload();await pause(2500);await run(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Shape material tests')).click()`);await pause(1800)
 await run(`document.querySelector('a[href="/4d"]').click()`);await pause(3500);await click('Open panel');await pause(300)
 await run(`(()=>{const select=[...document.querySelectorAll('select')].find(s=>s.getAttribute('aria-label')?.includes('Finish for Test water shape'));if(!select)throw Error('Context material missing');select.value='water';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(800)
 await run(`(()=>{const select=[...document.querySelectorAll('select')].find(s=>s.getAttribute('aria-label')?.includes('Finish for Test water shape'));if(select.value!=='water')throw Error('Water mapping did not apply')})()`)
 wc.reload();await pause(3500);await click('Open panel');await pause(300)
 await run(`(()=>{const select=[...document.querySelectorAll('select')].find(s=>s.getAttribute('aria-label')?.includes('Finish for Test water shape'));if(select?.value!=='water')throw Error('Water mapping not restored after reload')})()`)
 fs.writeFileSync(path.join(desktop,'../outputs/site-shape-water.png'),(await wc.capturePage()).toPNG())
 console.log('PASS: built-in context shape listed, Water applied, mapping retained after reload')
 fs.writeFileSync(path.join(desktop,'.test-data/site-shape-material-result.json'),JSON.stringify({passed:true}))
 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'.test-data/site-shape-material-result.json'),JSON.stringify({passed:false,error:e.message}));fs.writeFileSync(path.join(desktop,'../outputs/site-shape-material-failure.png'),(await wc.capturePage()).toPNG())}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')
