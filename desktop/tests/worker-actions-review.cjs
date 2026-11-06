const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');const repo=path.resolve(__dirname,'../..');
app.whenReady().then(async()=>{let win;let status=0;try{
 const built=await require(path.join(repo,'frontend/node_modules/esbuild')).build({entryPoints:[path.join(__dirname,'worker-actions-fixture.tsx')],nodePaths:[path.join(repo,'frontend/node_modules')],tsconfig:path.join(repo,'frontend/tsconfig.json'),bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}})
 win=new BrowserWindow({show:false,width:1400,height:950,webPreferences:{offscreen:true}});win.webContents.on('console-message',(_,level,message)=>{if(level>=2)console.log(message)});const run=s=>win.webContents.executeJavaScript(s);await win.loadFile(path.join(repo,'desktop/ui/desktop-settings.html'))
 await run(`document.head.innerHTML='<style>html,body,#root{height:100vh;margin:0;max-width:none;font:13px Arial}button,select{padding:4px;border:1px solid #bccbda;border-radius:4px}label{display:block}p{margin:8px 0}</style>';document.body.innerHTML='<div id="root"></div>';void 0`)
 const css=fs.readdirSync(path.join(repo,'desktop/dist/assets')).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(repo,'desktop/dist/assets',f),'utf8')).join('\n');await run(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s)})()`)
 await run(built.outputFiles[0].text)
 const files=['outputs/worker-actions/ready/worker-m-0026-684918-Actions.glb','outputs/worker-actions/ready/worker-f-0012-684925-Actions.glb','D:/BIM Assets/Prosota Assets/Construction Props/SM_Jackhammer_01a.glb'].map(f=>({name:path.basename(f),bytes:fs.readFileSync(path.isAbsolute(f)?f:path.join(repo,f)).toString('base64')}))
 console.log('dimensions',await run(`setupWorkers(${JSON.stringify(files)})`));const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(4500)
 const at=async s=>{await run(`seek(${s})`);await wait(250);return run('workerStatus()')},snap=async name=>fs.writeFileSync(path.join(repo,'outputs/worker-actions/'+name+'.png'),(await win.webContents.capturePage()).toPNG())
 const mid=await at(4);assert.equal(mid.length,3);assert.ok(mid[0].bone);assert.ok(mid[2].visible);mid[2].p.forEach((v,i)=>assert.ok(Math.abs(v-mid[0].bone[i])<1e-5,'tool must follow animated hand'))
 await snap('actions-ui');const later=await at(5);assert.deepEqual(later[0].p,mid[0].p);assert.notDeepEqual(later[0].bone,mid[0].bone)
 await run('toggle()');await wait(200);assert.deepEqual(await run('workerStatus()'),later);await run('toggle()');await wait(200)
 const reverse=await at(4);assert.deepEqual(reverse,mid)
 await run('reload()');await wait(2000);const reopened=await run('workerStatus()');reopened.forEach((s,i)=>{s.p.forEach((v,j)=>assert.ok(Math.abs(v-mid[i].p[j])<1e-5));s.bone?.forEach((v,j)=>assert.ok(Math.abs(v-mid[i].bone[j])<1e-5))})
 const before=await at(1),after=await at(8);assert.equal(before[2].visible,false);assert.equal(after[2].visible,false);assert.ok(before[0].p[0]<mid[0].p[0]);assert.ok(after[0].p[0]>mid[0].p[0]);await snap('actions-walk')
 await at(4);await run(`document.querySelector('select[aria-label="Time display"]').value='frames';document.querySelector('select[aria-label="Time display"]').dispatchEvent(new Event('change',{bubbles:true}));void 0`);await wait(100);assert.ok(await run(`Array.from(document.querySelectorAll('input')).some(i=>i.value==='60')`));
 await run(`select('item2')`);await wait(400);await snap('attachment-ui');assert.ok(await run(`document.body.textContent.includes('Use right hand')`));
 // Exercise the rendered TransformControls with real pointer input, not a direct transform assignment.
 const original=await run('JSON.stringify(data[2].position)');
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Move attached tool').click()`);await wait(300);
 const handle=await run('gizmoHandle()'),beforeDrag=await run('workerStatus()[2]');
 const input=(type,x,y,extra={})=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),...extra});
 input('mouseMove',handle.x,handle.y);input('mouseDown',handle.x,handle.y,{button:'left',clickCount:1});
 for(let i=1;i<=10;i++){input('mouseMove',handle.x+6*i,handle.y,{button:'left'});await wait(35)}
 input('mouseUp',handle.x+60,handle.y,{button:'left',clickCount:1});await wait(600);
 const afterDrag=await run('workerStatus()[2]');assert.notDeepEqual(afterDrag.p,beforeDrag.p,'viewport arrow must move the attached tool');
 assert.equal(await run('JSON.stringify(data[2].position)'),original,'drag must not change outside-interval placement');
 const attachmentAfter=await run('JSON.stringify(data[2].attachment)');assert.notEqual(await run('data[2].attachment.position.x'),0);
 await wait(400);assert.deepEqual(await run('workerStatus()[2]'),afterDrag,'playback must not cancel the edit');
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Rotate attached tool').click()`);await wait(300);
 const ring=await run('gizmoHandle()');input('mouseMove',ring.x,ring.y);input('mouseDown',ring.x,ring.y,{button:'left',clickCount:1});
 for(let i=1;i<=10;i++){input('mouseMove',ring.x,ring.y-4*i,{button:'left'});await wait(35)}
 input('mouseUp',ring.x,ring.y-40,{button:'left',clickCount:1});await wait(600);
 const rotated=await run('workerStatus()[2]');assert.notDeepEqual(rotated.q,afterDrag.q,'viewport rotation ring must turn the attached tool');
 assert.notEqual(await run('JSON.stringify(data[2].attachment)'),attachmentAfter);
 await run('toggle()');await wait(200);assert.deepEqual(await run('workerStatus()[2]'),rotated);await run('toggle()');await wait(200);
 await run('reload()');await wait(2000);const loaded=await run('workerStatus()[2]');loaded.p.forEach((v,i)=>assert.ok(Math.abs(v-rotated.p[i])<1e-5));loaded.q.forEach((v,i)=>assert.ok(Math.abs(v-rotated.q[i])<1e-5));
 await at(5);const moved=await run('workerStatus()[2]');assert.notDeepEqual(moved.p,rotated.p);await at(4);const returned=await run('workerStatus()[2]');returned.p.forEach((v,i)=>assert.ok(Math.abs(v-rotated.p[i])<1e-5));
 await snap('attachment-gizmo-edited');await at(8);assert.equal(await run('JSON.stringify(data[2].position)'),original);await at(4);
 console.log('PASS: real gizmo translation and rotation, attachment offset persistence, original placement preserved, close/reopen and reverse playback');
 fs.writeFileSync(path.join(repo,'outputs/worker-actions/scene-fixture.json'),await run('saved'));console.log('PASS: real male/female clips, timed route pause, animated hand attachment, panel close, scene reload, reverse seek, before/after release and frames UI')
 }catch(e){status=1;console.error(e)}finally{win?.destroy();app.exit(status)}})
