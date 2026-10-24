
const { app, session } = require('electron')
const fs=require('fs'),path=require('path'),crypto=require('crypto')
const desktop=path.resolve(__dirname,'..'),data=path.join(desktop,'.test-data','kevin-path-regression')
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
 const exists=await run(`localStorage.getItem('kevin-path-project')`)
 if(!exists){
 const bytes=fs.readFileSync('D:/BIM Assets/Kevin Walk.fbx').toString('base64')
 await run(`(async()=>{const request=async(url,body,method='POST')=>{const r=await fetch('/api/v1/'+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()};const bytes=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0));const file=await ImportTest.convertSiteImport(new File([bytes],'Kevin Walk.fbx'),[],{upAxis:'auto',unitScale:0,includeAnimation:true});const project=await request('projects/',{name:'Kevin path regression'});const saved=await ImportTest.importSiteAsset(project.id,file,'People',()=>{},'Kevin Walk.fbx');console.log('Kevin dimensions',saved.dimensions);if(saved.dimensions.height<1||saved.dimensions.height>2.5)throw Error('Kevin has wrong metre scale: '+JSON.stringify(saved.dimensions));const path=await request('paths/',{project_id:project.id,name:'Walking route',curve_mode:'curved',points:[{x:0,y:0,z:0},{x:10,y:0,z:0},{x:14,y:8,z:0}]});const id=crypto.randomUUID();await request('site-scenes/'+project.id,{command_id:crypto.randomUUID(),expected_revision:0,items:[{id,name:'Kevin Walk',kind:'asset',asset_id:saved.id,up_axis:'z',position:{x:0,y:0,z:0},width:saved.dimensions.width,height:saved.dimensions.height,depth:saved.dimensions.depth}]},'PUT');localStorage.setItem('kevin-path-project',project.id);localStorage.setItem('kevin-path-item',id);localStorage.setItem('prosota_4d_viewer_settings',JSON.stringify({renderMode:'realistic',upAxis:'z'}));})()`)
 }
 await run(`(async()=>{const id=localStorage.getItem('kevin-path-project'),scene=await fetch('/api/v1/site-scenes/'+id).then(r=>r.json());const items=scene.items.filter(i=>i.kind==='asset').map(({layout,...i})=>({...i,position:{x:0,y:0,z:0},path_motion:null,rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},object_state:null}));items.push({id:crypto.randomUUID(),name:'Raised snap slab',kind:'context',up_axis:'z',position:{x:7,y:0,z:0},width:40,depth:40,height:3});const r=await fetch('/api/v1/site-scenes/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({command_id:crypto.randomUUID(),expected_revision:scene.revision,items})});if(!r.ok)throw Error(await r.text())})()`);
 wc.reload();await pause(2500);await run(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Kevin path regression')).click()`);await pause(1500);await run(`document.querySelector('a[href="/4d"]').click()`);await pause(8000)
 await click('Site Tools');await pause(300);await click('Layout tools');await pause(400);await click('Kevin Walk');await pause(1500);await click('Frame Selected');await pause(600)
 await run(`(()=>{window.findKevin=()=>{for(const el of document.querySelectorAll('*')){let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];for(let n=0;f&&n<40;n++,f=f.return){const p=f.memoizedProps;if(p?.object?.isObject3D && p?.onModeChange){return p.object}}}throw Error('Selected transform object not found')};window.kevin=window.findKevin();window.restRotation=kevin.quaternion.clone();window.restScale=kevin.scale.clone();})()`)
 await run(`(()=>{const buttons=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Paths');buttons.at(-1).click()})()`);await pause(350);await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Paths'&&b.className.includes('font-bold'));b?.click()})()`);await pause(350)
 await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Bind selected (Kevin'));if(!b)throw Error('Kevin cannot bind');b.click()})()`);await pause(1300)
 await run(`(()=>{if(!document.body.innerText.includes('Following: Kevin Walk'))throw Error('Binding absent');if(kevin.quaternion.angleTo(restRotation)>1e-6||kevin.scale.distanceTo(restScale)>1e-6)throw Error('Binding changed transform');})()`)
 await click('Animation Timeline');await pause(700)
 await run(`(()=>{const select=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='seconds'));if(!select)throw Error('Timeline unit selector missing');select.value='seconds';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(300)
 await run(`(()=>{window.seekKevin=seconds=>{const input=document.querySelector('input[title="Elapsed seconds from schedule start, at the current speed"]');if(!input)throw Error('Timeline seek missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(seconds));input.dispatchEvent(new Event('input',{bubbles:true}));};window.boneState=()=>{const a=[];kevin.traverse(n=>{if(n.isBone)a.push(...n.quaternion.toArray(),...n.position.toArray())});return JSON.stringify(a)};seekKevin(0)})()`);await pause(450)
 const initial=await run(`({position:kevin.getWorldPosition(kevin.position.clone()).toArray(),bones:boneState()})`)
 await run(`seekKevin(3)`);await pause(500)
 const moved=await run(`({position:kevin.getWorldPosition(kevin.position.clone()).toArray(),bones:boneState()})`)
 if(JSON.stringify(initial.position)===JSON.stringify(moved.position)||initial.bones===moved.bones)throw Error('Path or clip failed to advance')
 await pause(600);if(await run(`boneState()`)!==moved.bones)throw Error('Walk continues while timeline paused')
 // Use the same component callback as the numeric rotation control, then verify persisted state.
 await run(`(()=>{for(const el of document.querySelectorAll('input')){let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];for(let n=0;f&&n<30;n++,f=f.return){const p=f.memoizedProps;if(p?.axisLabel==='Z' && p.suffix==='°' && p.onChange){p.onChange(p.value+90);window.correctedRotation=kevin.quaternion.clone();return}}}throw Error('Transform commit callback missing')})()`);await pause(1000)
 await run(`seekKevin(6)`);await pause(500)
 await run(`(()=>{if(kevin.quaternion.angleTo(correctedRotation)>1e-6)throw Error('Rotation correction overwritten');if(kevin.scale.distanceTo(restScale)>1e-6)throw Error('Scale changed');})()`)
 // Exercise the actual TransformControls objectChange / Snap to Surface handler.
 await click('Move');await click('Snap to Surface');await pause(400)
 await wc.executeJavaScript(fs.readFileSync(path.join(desktop,'../outputs/import-test-bundle.js'),'utf8'))
 await run(`(()=>{let scene=kevin;while(scene.parent)scene=scene.parent;window.kevinControls=null;scene.traverse(n=>{if(n.object===kevin&&n._listeners?.objectChange?.length&&n.mode==='translate')kevinControls=n});if(!kevinControls)throw Error('Live transform controls not found');kevin.position.x+=.1;kevin.updateWorldMatrix(true,true);kevinControls.dispatchEvent({type:'objectChange'});})()`);await pause(1600)
 const snapped=await run(`(()=>{kevin.updateWorldMatrix(true,true);const b=new ImportTest.THREE.Box3().setFromObject(kevin,true);if(Math.abs(b.min.z-3)>.03)throw Error('Feet not on raised slab: '+b.min.z);return {position:kevin.position.toArray(),base:b.min.z}})()`)
 await run(`seekKevin(3)`);await pause(700);await run(`seekKevin(6)`);await pause(700)
 await run(`(()=>{const b=new ImportTest.THREE.Box3().setFromObject(kevin,true);if(Math.abs(b.min.z-3)>.03)throw Error('Surface offset lost after scrubbing: '+b.min.z)})()`)
 await click('Frame Selected');await pause(700);await wc.executeJavaScript(fs.readFileSync(path.join(desktop,'../outputs/import-test-bundle.js'),'utf8'))
 await run(`(()=>{const b=new ImportTest.THREE.Box3().setFromObject(kevin,true),c=b.getCenter(new ImportTest.THREE.Vector3()),state=kevin.__r3f.root.getState();state.camera.position.copy(c).add(new ImportTest.THREE.Vector3(4,-6,3));state.camera.up.set(0,0,1);state.camera.lookAt(c);if(state.controls?.target){state.controls.target.copy(c);state.controls.update()}state.invalidate()})()`);await pause(500)
 fs.writeFileSync(path.join(desktop,'../outputs/kevin-path.png'),(await wc.capturePage()).toPNG())

 await run(`(()=>{window.profile={calls:{},ms:{},frames:[]};const wrap=(o,k)=>{const fn=o[k];o[k]=function(...a){const t=performance.now();try{return fn.apply(this,a)}finally{profile.calls[k]=(profile.calls[k]||0)+1;profile.ms[k]=(profile.ms[k]||0)+performance.now()-t}}};kevin.traverse(n=>{if(n.isMesh){for(const k of ['raycast','computeBoundingSphere','computeBoundingBox'])if(n[k])wrap(n,k)}});let last=performance.now();window.profiling=true;const frame=t=>{if(!profiling)return;profile.frames.push(t-last);last=t;requestAnimationFrame(frame)};requestAnimationFrame(frame);const play=[...document.querySelectorAll('button')].find(b=>/Play/.test(b.innerText)&&!b.innerText.includes('camera'));play?.click()})()`)
 const point=await run(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
 wc.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1})
 for(let i=0;i<60;i++){wc.sendInputEvent({type:'mouseMove',x:point.x+Math.round(60*Math.sin(i/15)),y:point.y+Math.round(30*Math.cos(i/15)),modifiers:['leftButtonDown']});await pause(25)}
 wc.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await pause(500)
 const profile=await run(`(()=>{profiling=false;return profile})()`);fs.writeFileSync(path.join(desktop,'../outputs/kevin-orbit-profile.json'),JSON.stringify(profile));console.log('PROFILE',JSON.stringify(profile))

 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'.test-data/kevin-path-result.json'),JSON.stringify({passed:false,error:e.message}));fs.writeFileSync(path.join(desktop,'../outputs/kevin-path-failure.png'),(await wc.capturePage()).toPNG());fs.writeFileSync(path.join(desktop,'../outputs/kevin-path-failure.txt'),await wc.executeJavaScript('document.body.innerText'))}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')
