
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
 const bytes=fs.readFileSync('D:/BIM Assets/Kevin Walk.fbx').toString('base64')
 const result=await run(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0));const file=await ImportTest.convertSiteImport(new File([bytes],'Kevin Walk.fbx'),[],{upAxis:'auto',unitScale:0,includeAnimation:true});window.kevinFile=file;const project=await fetch('/api/v1/projects/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Kevin import regression'})}).then(r=>r.json());const saved=await ImportTest.importSiteAsset(project.id,file,'People',()=>{},'Kevin Walk.fbx');const downloaded=await fetch('/api/v1/site-assets/'+saved.id+'/download').then(r=>{if(!r.ok)throw Error('Download failed');return r.arrayBuffer()});const asset=await ImportTest.parseAsset(downloaded);let skins=0,morphMeshes=0;asset.object.traverse(n=>{if(n.isSkinnedMesh)skins++;if(n.morphTargetInfluences?.length)morphMeshes++});if(!asset.object.animations.length)throw Error('Animation clips missing');const snapshot=()=>{const state=[];asset.object.traverse(n=>{if(n.isBone)state.push(...n.position.toArray(),...n.quaternion.toArray());if(n.morphTargetInfluences)state.push(...n.morphTargetInfluences)});return JSON.stringify(state)};const mixer=new ImportTest.THREE.AnimationMixer(asset.object);mixer.clipAction(asset.object.animations[0]).play();mixer.setTime(0);const first=snapshot();mixer.setTime(.25);if(snapshot()===first)throw Error('Character animation does not move');if(saved.dimensions.height<1.5||saved.dimensions.height>2.1||saved.dimensions.height<saved.dimensions.depth)throw Error('Wrong source orientation or units: '+JSON.stringify(saved.dimensions));return {dimensions:saved.dimensions,size:file.size,clips:asset.object.animations.map(c=>({name:c.name,tracks:c.tracks.length,duration:c.duration})),skins,morphMeshes};})()`)
 console.log('PASS Kevin Walk FBX conversion and animated playback',JSON.stringify(result));fs.writeFileSync(path.join(desktop,'.test-data/kevin-import-result.json'),JSON.stringify({passed:true,...result}))
 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'.test-data/kevin-import-result.json'),JSON.stringify({passed:false,error:e.message}))}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')

