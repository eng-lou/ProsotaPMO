
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
 await run(`fetch('/api/v1/projects/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Whole app review'})}).then(r=>{if(!r.ok)throw Error('Create project failed');return r.json()})`)
 wc.reload();await pause(2500);await run(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Whole app review')).click()`);await pause(1500)
 const errors=[];wc.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message)})
 for(const route of ['/dashboard','/scheduling','/risks','/costs','/icd','/4d','/dashboard']){
 await run(`(()=>{const a=document.querySelector('a[href="${route}"]');if(!a)throw Error('Navigation missing ${route}');a.click()})()`);await pause(2200)
 const text=await run(`document.body.innerText`);if(text.length<150||/Something went wrong|Unexpected Application Error/.test(text))throw Error('Screen failed '+route)
 console.log('PASS route '+route)
 }
 const unexpected=errors.filter(e=>!e.includes('Electron Security Warning'))
 if(unexpected.length)throw Error(unexpected.join('\n'))
 fs.writeFileSync(path.join(desktop,'.test-data/review-routes-result.json'),JSON.stringify({passed:true,routes:7}))
 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'.test-data/review-routes-result.json'),JSON.stringify({passed:false,error:e.message}))}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')

