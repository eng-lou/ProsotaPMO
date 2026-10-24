
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
 const json=async(url,body)=>{const r=await fetch('/api/v1/'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()};
 const project=await json('projects/',{name:'Camera motion tests'});
 const pose={base_position_x:12,base_position_y:10,base_position_z:8,base_target_x:0,base_target_y:0,base_target_z:0,base_focal_length:35,base_clip_start:.1,base_clip_end:10000};
 const shot={id:'first',name:'Orbit test',settings:{kind:'orbit',duration:2,amount:1,angle:-90,reverse:false,easing:'smooth',shotSize:'wide',alignment:'center',lookAt:true,startView:'current'},target:[0,0,0],radius:3,upAxis:'z',start:pose,end:null,startOffset:[0,0,0],endOffset:[0,0,0],stage:'fixed',dateStart:'2026-01-01T00:00:00Z',dateEnd:'2026-04-01T00:00:00Z',blend:0};
 await json('cameras/',{project_id:project.id,name:'Stored orbit',...pose,motion:{version:1,shots:[shot,{...shot,id:"second",name:"Hold test",settings:{...shot.settings,kind:"hold",duration:1},blend:.5}]}});
 localStorage.setItem('prosota_4d_timeline_display_mode','seconds');
 })()`)
 wc.reload();await pause(2500);await run(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Camera motion tests')).click()`);await pause(1800)
 await run(`document.querySelector('a[href="/4d"]').click()`);await pause(2500)
 await click('Cameras');await pause(200)
 await run(`[...document.querySelectorAll('span')].find(s=>s.textContent==='Stored orbit').click()`);await pause(500)
 await click('Animation Timeline');await pause(300)
 const track='[aria-label="Camera motion track: Stored orbit"] button'
 await run(`document.querySelector(${JSON.stringify(track)}).click()`);await pause(300)
 await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Play')&&!b.closest('section')&&!b.innerText.includes('camera'));if(!b)throw Error('Timeline Play missing');b.click()})()`);await pause(650)
 const time=()=>run(`Number(document.querySelector('input[aria-label="Camera preview time"]').value)`)
 const moving=await time();if(moving<.1||moving>1.9)throw Error('Timeline failed to advance camera: '+moving)
 await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Pause')&&!b.closest('section'));if(!b)throw Error('Timeline Pause missing');b.click()})()`);await pause(150)
 const stopped=await time();await pause(250);if(Math.abs(stopped-await time())>.02)throw Error('Camera did not pause')
 await run(`document.querySelector(${JSON.stringify(track)}).click()`);await pause(200);if(await time()>.01)throw Error('Camera did not seek')
 await run(`document.querySelector('[aria-label="Camera motion track: Stored orbit"] button[title="Seek to 2.5s"]').click()`);await pause(200)
 if(Math.abs(await time()-2.5)>.01)throw Error('Second shot seek ignores transition duration')
 console.log('PASS: persisted preset, camera-only timeline range/track, timeline Play/Pause/seek')
 fs.writeFileSync(path.join(desktop,'../outputs/camera-timeline.png'),(await wc.capturePage()).toPNG())
 fs.writeFileSync(path.join(desktop,'.test-data/camera-motion-result.json'),JSON.stringify({passed:true,moving,stopped}))
 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'.test-data/camera-motion-result.json'),JSON.stringify({passed:false,error:e.message}));fs.writeFileSync(path.join(desktop,'../outputs/camera-motion-app-failure.png'),(await wc.capturePage()).toPNG())}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')
