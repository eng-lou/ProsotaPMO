const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../..');
run(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
async function run(config){await app.whenReady();let win;try{
 const {outputFiles}=await require(path.join(repo,'frontend/node_modules/esbuild')).build({stdin:{contents:`export {api} from './src/lib/api';export {convertSiteImport} from './src/modules/fourD/convertSiteImport';export {importSiteAsset,downloadSiteAssetBytes,parseAsset} from './src/modules/fourD/siteAssets';export {addAssetMotion} from './src/modules/fourD/importAssetMotion';export * as THREE from 'three';`,resolveDir:path.join(repo,'frontend')},bundle:true,write:false,format:'iife',globalName:'MotionTest',define:{'import.meta.env':'{}'}});
 session.defaultSession.webRequest.onBeforeSendHeaders((details,callback)=>{if(details.url.startsWith(config.origin+'/'))details.requestHeaders['X-Prosota-Desktop']=config.token;callback({requestHeaders:details.requestHeaders})});
 win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true}});await win.loadURL(config.origin+'/desktop-settings.html');
 await win.webContents.executeJavaScript(outputFiles[0].text);
 const folder=config.folder;
 const names=['Worker F-0014.fbx','Worker F-0014 welding animation.fbx'];
 const files=names.map(name=>({name,data:fs.readFileSync(path.join(folder,name)).toString('base64')}));
 await win.webContents.executeJavaScript(`window.testFiles=${JSON.stringify(files)}`);
 const result=await win.webContents.executeJavaScript(`(async()=>{const t=MotionTest;t.api.interceptors.response.use(r=>r,e=>{throw new Error(JSON.stringify({url:e.config?.url,status:e.response?.status,data:e.response?.data}))});const files=testFiles.map(f=>new File([Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))],f.name));const project={id:${JSON.stringify(config.projectId)}};const results=[];for(const source of files){const converted=await t.convertSiteImport(source,[],{upAxis:'auto',unitScale:0,includeAnimation:false});const original=await t.importSiteAsset(project.id,converted,'People',()=>{});const downloaded=await t.downloadSiteAssetBytes(original.id);const motion=await t.addAssetMotion(downloaded,files[1]);const saved=await t.importSiteAsset(project.id,motion.file,'People',()=>{});const restored=await t.parseAsset(await t.downloadSiteAssetBytes(saved.id));const clip=restored.object.animations[motion.firstClip];if(!clip||clip.duration<10)throw Error('Motion did not survive storage');const mixer=new t.THREE.AnimationMixer(restored.object);mixer.clipAction(clip).play();mixer.setTime(2);const snapshot=()=>{const a=[];restored.object.traverse(n=>{if(n.isBone)a.push(...n.quaternion.toArray())});return a};const before=snapshot();mixer.setTime(7);const after=snapshot();if(!before.some((v,i)=>Math.abs(v-after[i])>.0001))throw Error('Motion is not advancing');results.push({source:source.name,duration:clip.duration,tracks:clip.tracks.length,downloadSaveReload:true});await t.api.delete('/api/v1/site-assets/'+original.id);await t.api.delete('/api/v1/site-assets/'+saved.id)}return results})()`);
 assert.equal(result.length,2);console.log('PASS packaged renderer motion workflow '+JSON.stringify(result));
}catch(e){console.error(e.message);process.exitCode=1}finally{win?.destroy();app.quit()}}





