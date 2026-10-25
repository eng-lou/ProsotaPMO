const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path');
const repo=path.resolve(__dirname,'../..');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.whenReady().then(async()=>{let win;try{
 const {build}=require(path.join(repo,'frontend/node_modules/esbuild'));
 const {outputFiles}=await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {AnimationProfileEditor} from './src/modules/fourD/AnimationProfileEditor'; import {AnimationProfilePanel} from './src/modules/fourD/AnimationProfilePanel'; import {DEFAULT_ANIMATION_CONFIG} from './src/modules/fourD/animationDefaults'; window.mount=(edit=false)=>{window.profileTestRoot??=createRoot(document.getElementById('root')); window.profileTestRoot.render(edit?<AnimationProfileEditor name="Grow test" config={{...DEFAULT_ANIMATION_CONFIG,transform_kind:'grow',trigger:'on_start'}} onSave={(name,config)=>window.saved={name,config}} onCancel={()=>{}} saveLabel="Save Profile" speedDaysPerSecond={7} fps={30}/>:<AnimationProfilePanel profiles={[]} loading={false} onCreate={async()=>{}} onUpdate={()=>{}} onDelete={()=>{}}/>)}; mount();`,resolveDir:path.join(repo,'frontend'),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
 win=new BrowserWindow({width:380,height:1050,show:false,webPreferences:{contextIsolation:true}});
 win.webContents.on('console-message', (...args)=>console.log('renderer',...args.slice(1,3))); await win.loadFile(path.join(repo,'desktop/ui/desktop-settings.html'));
 const css=fs.readFileSync(path.join(repo,'desktop/dist/assets',fs.readdirSync(path.join(repo,'desktop/dist/assets')).find(f=>f.endsWith('.css'))),'utf8');
 await win.webContents.executeJavaScript(`document.documentElement.className='dark'; document.body.style='background:#101a2e;color:#dae5f4;margin:0';document.body.innerHTML='<main id="root" style="width:320px;margin:auto"></main>';`);
 await win.webContents.insertCSS(css);await win.webContents.executeJavaScript(outputFiles[0].text);await new Promise(r=>setTimeout(r,400));
 fs.writeFileSync(path.join(repo,'outputs/profile-library.png'),(await win.webContents.capturePage()).toPNG());
 const cards=await win.webContents.executeJavaScript(`document.querySelectorAll('button[title^="Preview and customise"]').length`);if(cards<25)throw Error('Missing preset cards');
 await win.webContents.executeJavaScript('mount(true)');await new Promise(r=>setTimeout(r,200));
 const result=await win.webContents.executeJavaScript(`(()=>{const select=document.querySelector('[aria-label="Transition duration units"]');select.value='seconds';select.dispatchEvent(new Event('change',{bubbles:true}));return document.body.innerText})()`);
 if(!result.includes('Grow / reveal'))throw Error('Grow option missing');
 await new Promise(r=>setTimeout(r,100));
 fs.writeFileSync(path.join(repo,'outputs/profile-editor.png'),(await win.webContents.capturePage()).toPNG());
 await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save Profile').click()`);
 await win.webContents.executeJavaScript(`(()=>{const select=document.querySelector('[aria-label="Geometry action"]');select.value='remove';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await new Promise(r=>setTimeout(r,100));
 await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save Profile').click()`);
 const saved=await win.webContents.executeJavaScript('window.saved');
 if(saved.config.grow_mode!=='remove'||saved.config.opacity_from!==1||saved.config.opacity_to!==1)throw Error('Remove selection did not preserve opaque clipping');
if(saved.config.transform_kind!=='grow'||saved.config.duration_frames!==null)throw Error('Unit display changed saved config');
 console.log('PASS: library cards, Grow editing, unit switch, Remove selection and save preserve recipe');
 }catch(e){console.error(e);process.exitCode=1}finally{win?.destroy();app.quit()}})

