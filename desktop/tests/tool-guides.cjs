const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'../..');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.whenReady().then(async()=>{let win;try{
 const {outputFiles}=await require(path.join(repo,'frontend/node_modules/esbuild')).build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ElementLinkFields} from './src/modules/fourD/ElementLinkFields';import {ToolVisualGuide,VISUAL_GUIDES} from './src/modules/fourD/ToolVisualGuide';window.guideTestRoot=createRoot(document.getElementById('root'));window.guideModes=VISUAL_GUIDES;window.mount=(mode='fixed')=>guideTestRoot.render(<div className="grid grid-cols-3 gap-3">{Object.keys(VISUAL_GUIDES).map(topic=><section key={topic}><ToolVisualGuide topic={topic} mode={topic==='camera'?mode:undefined}/></section>)}</div>);window.mountLinks=()=>guideTestRoot.render(<div style={{width:300}}><ToolVisualGuide topic="links"/><ElementLinkFields activities={[{id:'a',code:'T-0001',task_name:'New activity'},{id:'b',code:'T-0002',task_name:'Other activity'}]} links={[{id:'link',activity_id:'a',animation_profile_id:'remove'}]} animationProfiles={[{id:'remove',name:'Remove X'}]} onAssignProfile={(...args)=>window.assigned=args} onLink={()=>{}} onUnlink={()=>{}}/></div>);mount();`,resolveDir:path.join(repo,'frontend'),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
 win=new BrowserWindow({width:1030,height:1100,show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false}});
 await win.loadFile(path.join(repo,'desktop/ui/desktop-settings.html'));
 const run=s=>win.webContents.executeJavaScript(s),wait=()=>new Promise(r=>setTimeout(r,120));
 await run(`document.querySelectorAll('style,link[rel=stylesheet]').forEach(e=>e.remove());document.documentElement.className='dark';document.body.style='background:#101a2e;color:#dae5f4;margin:16px';document.body.innerHTML='<main id="root"></main>';window.frameCount=0;const originalRAF=window.requestAnimationFrame;window.requestAnimationFrame=cb=>{window.frameCount++;return originalRAF(cb)};void 0;`);
 const assets=path.join(repo,'desktop/dist/assets');await win.webContents.insertCSS(fs.readFileSync(path.join(assets,fs.readdirSync(assets).find(f=>f.endsWith('.css'))),'utf8'));
 await run(outputFiles[0].text);await wait();
 assert.equal(await run('document.querySelectorAll("details").length'),7);
 assert.equal(await run('document.querySelectorAll("svg").length'),0,'Closed guides do not render examples');
 assert.equal(await run('frameCount'),0,'Closed guides do not animate');
 await run('document.querySelectorAll("details").forEach(d=>d.open=true)');await wait();
 assert.equal(await run('document.querySelectorAll("svg").length'),7);
 assert.equal(await run('frameCount'),0,'Open guides are static by default');
 for(const topic of await run('Object.keys(guideModes).filter(t=>t!=="links")')){
  for(const name of await run(`guideModes[${JSON.stringify(topic)}].examples.map(e=>e.name)`)){
   await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith(${JSON.stringify(name)})).click()`);await wait();
  }
 }
 await run(`mount('aligned')`);await wait();
 assert.equal(await run(`document.querySelectorAll('section')[5].querySelector('button[aria-pressed="true"]').textContent`),'Follow headingCurrent setting');
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Play example').click()`);await wait();
 assert.ok(await run('frameCount>0'));
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Play example').click()`);await wait();
 assert.equal(await run(`Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='Pause example').length`),1,'Only one example plays');
 await run('document.querySelectorAll("details").forEach(d=>d.open=false)');await wait();
 const stopped=await run('frameCount');await wait();assert.equal(await run('frameCount'),stopped,'Closing stops animation');
 await run('document.querySelectorAll("details").forEach(d=>d.open=true)');await wait();
 assert.equal(await run(`Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='Pause example').length`),0,'Reopening stays paused');
 fs.mkdirSync(path.join(repo,'outputs'),{recursive:true});fs.writeFileSync(path.join(repo,'outputs/tool-guides.png'),(await win.webContents.capturePage()).toPNG());
 await run('mountLinks()');await wait();
 assert.equal(await run('document.querySelectorAll("select").length'),1,'Only the existing link profile is initially visible');
 await run(`document.querySelector('select').value='';document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}));`);await wait();
 assert.deepEqual(await run('window.assigned'),['link',null],'Existing profile assignment still works');
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Link another activity')).click()`);await wait();
 assert.equal(await run('document.querySelectorAll("select").length'),2,'New profile appears only after Add');
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cancel new link').click()`);await wait();
 assert.equal(await run('document.querySelectorAll("select").length'),1);
 await run('document.querySelector("details").open=true');await wait();
 await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
 fs.writeFileSync(path.join(repo,'outputs/activity-link-guide.png'),(await win.webContents.capturePage()).toPNG());
 console.log('PASS: single existing profile, separate new-link controls, assignment callback; seven guides, all example choices, current setting sync, static default, exclusive playback, stop on close');
 }catch(e){console.error(e);process.exitCode=1}finally{win?.destroy();app.quit()}});

