
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

 await run('seekKevin(0)'); await pause(500);
 await click('Camera Presets'); await pause(700);
 await run(`(()=>{window.cameraProps=()=>{for(const el of document.querySelectorAll('*')){let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];for(let n=0;f&&n<40;n++,f=f.return){const p=f.memoizedProps;if(p?.controller?.activate&&p.resolveTarget)return p}}throw Error('Camera panel missing')};const p=cameraProps(),pose=p.controller.readPose();window.hold={id:'test-hold',name:'Fixed / Hold',settings:{kind:'hold',duration:10,amount:1,angle:90,reverse:false,easing:'smooth',shotSize:'wide',alignment:'center',lookAt:true,startView:'current'},target:[pose.base_target_x,pose.base_target_y,pose.base_target_z],radius:2,upAxis:'z',start:pose,end:null,startOffset:[0,0,0],endOffset:[2,0,0],stage:'fixed',dateStart:new Date().toISOString(),dateEnd:new Date().toISOString(),blend:0};p.onChange(hold)})()`);await pause(300);
 await click('Preview shot');await pause(300);
 await run('(()=>{cameraProps().controller.pause(); cameraProps().controller.seek(0)})()');await pause(400);
 const start=await run(`({position:kevin.getWorldPosition(kevin.position.clone()).toArray(),bones:boneState(),pose:cameraProps().controller.readPose()})`);
 await run('cameraProps().controller.seek(3)');await pause(500);
 const end=await run(`({position:kevin.getWorldPosition(kevin.position.clone()).toArray(),bones:boneState(),pose:cameraProps().controller.readPose()})`);
 if(JSON.stringify(start.position)===JSON.stringify(end.position)||start.bones===end.bones)throw Error('Camera preview froze Kevin');
 for(const k of Object.keys(start.pose))if(Math.abs(start.pose[k]-end.pose[k])>1e-6)throw Error('Hold camera drifted: '+k);
 await run('cameraProps().controller.play()');await pause(1200);await run('cameraProps().controller.pause()');
 const playing=await run(`({position:kevin.getWorldPosition(kevin.position.clone()).toArray(),bones:boneState()})`);
 if(JSON.stringify(playing.position)===JSON.stringify(end.position)||playing.bones===end.bones)throw Error('Live preview did not animate Kevin');
 await run('cameraProps().controller.seek(0)');await pause(400);
 const reset=await run(`({position:kevin.getWorldPosition(kevin.position.clone()).toArray(),bones:boneState()})`);
 if(JSON.stringify(reset.position)!==JSON.stringify(start.position)||reset.bones!==start.bones)throw Error('Preview reset is nondeterministic');
 await run('(()=>{cameraProps().controller.restore(); seekKevin(3)})()');await pause(500);
 const restored=await run(`kevin.getWorldPosition(kevin.position.clone()).toArray()`);
 if(JSON.stringify(restored)!==JSON.stringify(end.position))throw Error('Camera and timeline actor clocks disagree');

 await run(`cameraProps().onSave('Camera regression pan',{version:1,shots:[{...hold,id:crypto.randomUUID(),name:'Pan',settings:{...hold.settings,kind:'pan'},endOffset:[0,0,0]}]})`);await pause(700);
 await run(`(()=>{const p=cameraProps();p.onOpenCamera(p.cameras.filter(c=>c.name==='Camera regression pan').at(-1).id)})()`);await pause(700);
 await run(`(()=>{const p=cameraProps();p.onChange(hold);p.controller.activate([hold]);p.controller.play()})()`);await pause(700);
 await run(`(()=>{const c=cameraProps().controller;c.pause();if(c.state.current.shots[0].settings.kind!=='hold')throw Error('Saved Pan replaced Hold preview');c.seek(3)})()`);await pause(400);
 const savedView=await run(`({position:kevin.getWorldPosition(kevin.position.clone()).toArray(),pose:cameraProps().controller.readPose()})`);
 if(JSON.stringify(savedView.position)!==JSON.stringify(end.position))throw Error('Saved camera view froze actor');
 for(const k of Object.keys(start.pose))if(Math.abs(start.pose[k]-savedView.pose[k])>1e-6)throw Error('Saved camera overrides Hold pose');
 await run('seekKevin(5)');await pause(400);
 await run(`(()=>{const c=cameraProps().controller;if(c.state.current.shots[0].settings.kind!=='pan'||Math.abs(c.state.current.seconds-5)>.01)throw Error('Timeline failed to resume saved Pan')})()`);

 await run('(()=>{cameraProps().controller.restore();seekKevin(0)})()');await pause(400);
 await run(`(async()=>{const p=cameraProps(),target=await p.resolveTarget('selection');if(!target.tracking)throw Error('Kevin target binding absent');window.tracked={...hold,...target,followMode:'aligned'};p.onChange(tracked);p.controller.activate([tracked])})()`);await pause(400);
 await run(`(()=>{window.relativeCamera=()=>{kevin.updateWorldMatrix(true,false);const q=kevin.getWorldQuaternion(new ImportTest.THREE.Quaternion()).invert();return kevin.__r3f.root.getState().camera.position.clone().sub(kevin.getWorldPosition(new ImportTest.THREE.Vector3())).applyQuaternion(q).toArray()}})()`);
 const relative0=await run('relativeCamera()');
 await run('cameraProps().controller.seek(6)');await pause(600);
 const relative6=await run('relativeCamera()');
 if(relative0.some((v,i)=>Math.abs(v-relative6[i])>1e-5))throw Error('Camera failed to follow Kevin through turn: '+JSON.stringify({relative0,relative6}));
 await run('cameraProps().controller.seek(0)');await pause(400);
 await click('Adjust framing');await pause(400);
 await run(`(()=>{const state=kevin.__r3f.root.getState();if(!state.controls.enabled)throw Error('Manual camera controls remain locked')})()`);
 const beforeZoom=await run('cameraProps().controller.readPose()');
 const point=await run(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
 wc.sendInputEvent({type:'mouseWheel',...point,deltaY:180,deltaX:0,canScroll:true});await pause(700);
 const afterZoom=await run('cameraProps().controller.readPose()');
 if(JSON.stringify(beforeZoom)===JSON.stringify(afterZoom))throw Error('Manual wheel zoom did not move camera');
 await click('Use this framing');await pause(300);
 await run(`(()=>{const s=cameraProps().shot;if(s.settings.startView!=='current'||s.settings.lookAt!==false)throw Error('Custom framing not captured')})()`);
 await run(`(()=>{const select=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='frames'));select.value='frames';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(400);
 await run(`(()=>{if(!document.body.innerText.includes('Duration (frames)'))throw Error('Camera duration did not adopt frames');const p=cameraProps();if(p.format.timeDisplayMode!=='frames')throw Error('Camera timing format disconnected')})()`);
 await run(`cameraProps().onSave('Tracked Kevin',{version:1,shots:[cameraProps().shot]})`);await pause(600);
 await run(`(async()=>{const cameras=await fetch('/api/v1/cameras/?project_id='+localStorage.getItem('kevin-path-project')).then(r=>r.json());const saved=cameras.filter(c=>c.name==='Tracked Kevin').at(-1);if(!saved||saved.motion.shots[0].tracking.objectId!==tracked.tracking.objectId||saved.motion.shots[0].followMode!=='aligned')throw Error('Tracking settings did not persist: '+JSON.stringify(cameras.map(c=>c.name)))})()`);

 await run(`(async()=>{const scene=await fetch('/api/v1/site-scenes/'+localStorage.getItem('kevin-path-project')).then(r=>r.json());const start=scene.items.find(i=>i.path_motion).path_motion.start;window.held={...tracked,actorClock:'construction',stage:'fixed',dateStart:start,dateEnd:new Date(Date.parse(start)+10*86400000*cameraProps().format.speedDaysPerSecond).toISOString()};cameraProps().controller.activate([held])})()`);await pause(400);
 const held0=await run('kevin.getWorldPosition(kevin.position.clone()).toArray()');
 await run('cameraProps().controller.seek(6)');await pause(400);
 const held6=await run('kevin.getWorldPosition(kevin.position.clone()).toArray()');
 if(JSON.stringify(held0)!==JSON.stringify(held6))throw Error('Construction Hold failed to freeze path');
 await run(`(()=>{cameraProps().controller.activate([{...held,stage:'progress'}]);cameraProps().controller.seek(3)})()`);await pause(400);
 const progress=await run('kevin.getWorldPosition(kevin.position.clone()).toArray()');
 if(JSON.stringify(progress)===JSON.stringify(held0))throw Error('Construction Advance failed to move path');
 fs.writeFileSync(path.join(desktop,'../outputs/kevin-tracking-result.json'),JSON.stringify({passed:true,start:start.position,end:end.position,playing:playing.position,holdPose:start.pose,resetPassed:true,restorePassed:true,savedCameraPreviewPassed:true,timelineHandoverPassed:true,trackingPassed:true,manualWheelFramingPassed:true,framesPassed:true,trackingSaved:true,constructionHoldAndAdvancePassed:true}));
 }catch(e){console.error(e);fs.writeFileSync(path.join(desktop,'../outputs/kevin-tracking-result.json'),JSON.stringify({passed:false,error:e.message}));}finally{app.quit()}
}))
require('../auth.cjs').authenticate=async()=>({sub:'test|owner',name:'Camera test',email:'test@example.invalid',is_super_user:true});require('../main.cjs')
