// Local asset regression. Reads both GLBs; writes a new preset, never edits either model.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url')
const repo=path.resolve(__dirname,'../..'),out=path.join(repo,'outputs/backhoe-authoring')
app.whenReady().then(async()=>{let win,status=0;try{
 const source=pathToFileURL(path.join(out,'Backhoe-rigged-copy.glb')).href
 const target=pathToFileURL(process.env.PROSOTA_LOADER_TEST_ASSET||path.join(out,'Backhoe.glb')).href
 const preset=JSON.parse(fs.readFileSync('D:/BIM Assets/Wheel_loader_-_articulated_rig-equipment.json','utf8'))
 const {outputFiles}=await require(path.join(repo,'frontend/node_modules/esbuild')).build({stdin:{resolveDir:path.join(repo,'frontend'),loader:'ts',contents:`
import * as T from 'three';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';import {parseAsset} from './src/modules/fourD/siteAssets';import {equipmentNodes,bindEquipment,validateEquipment} from './src/modules/fourD/equipmentRig';import {importEquipmentPreset} from './src/modules/fourD/equipmentPreset';
window.ready=(async()=>{
 const src=(await new GLTFLoader().loadAsync(${JSON.stringify(source)})).scene.children[0],asset=await parseAsset(await (await fetch(${JSON.stringify(target)})).arrayBuffer()),outer=asset.object;
 const roots=[...equipmentNodes(outer).values()].filter(n=>n.children.length===77);if(roots.length!==1)throw Error('Expected one 77-part assembly');const dst=roots[0];
 const matrices=root=>{root.updateWorldMatrix(true,true);const result=new Map([['',new T.Matrix4()]]);for(const [key,n] of equipmentNodes(root)){if(key)result.set(key,result.get(key.slice(0,key.lastIndexOf('/'))).clone().multiply(n.matrix))}return result};
 const sm=matrices(src),tm=matrices(dst),sn=equipmentNodes(src),tn=equipmentNodes(dst);
 const signature=n=>{let h=2166136261;for(const a of [n.geometry.getAttribute('position')?.array,n.geometry.index?.array]){if(!a)continue;for(const v of new Uint8Array(a.buffer,a.byteOffset,a.byteLength))h=Math.imul(h^v,16777619)}return n.geometry.getAttribute('position').count+':'+(h>>>0)};
 const meshRows=nodes=>[...nodes].filter(([k,n])=>n.isMesh).map(([key,n])=>({key,name:n.name,signature:signature(n)}));
 const a=meshRows(sn),b=meshRows(tn),mapping=new Map();let basis;
 for(const x of a){let matches=b.filter(y=>y.signature===x.signature);if(matches.length>1)matches=matches.filter(y=>y.name===x.name);if(matches.length!==1)throw Error('Ambiguous source part '+x.name);mapping.set(x.key,matches[0].key);const m=tm.get(matches[0].key).clone().multiply(sm.get(x.key).clone().invert());if(!basis)basis=m;else if(m.elements.some((v,i)=>Math.abs(v-basis.elements[i])>1e-6))throw Error('Parts have a different rest pose: '+x.name)}
 if(new Set(mapping.values()).size!==83||a.length!==83||b.length!==83)throw Error('Expected a one-to-one match for all 83 meshes');
 const original=${JSON.stringify(preset.definition)},def=structuredClone(original),groupParts=key=>a.filter(x=>x.key===key||x.key.startsWith(key+'/')).map(x=>mapping.get(x.key));
 const primary=new Map();
 for(const j of def.joints){const old=j.node,parts=groupParts(old);if(!parts.length)throw Error('Empty joint '+old);parts.sort((a,b)=>{const volume=k=>{const g=tn.get(k).geometry;g.computeBoundingBox();const v=g.boundingBox.getSize(new T.Vector3());return v.x*v.y*v.z};return volume(b)-volume(a)});j.node=parts[0];j.members=parts.slice(1);primary.set(old,j.node);j.pivot=new T.Vector3(...j.pivot).applyMatrix4(basis).toArray();j.axis=new T.Vector3(...j.axis).transformDirection(basis).toArray()}
 const attachment=(key,p)=>{const node=key?primary.get(key):'';if(key&&!node)throw Error('Unknown attachment '+key);return {node,point:new T.Vector3(...p).applyMatrix4(sm.get(key)).applyMatrix4(basis).applyMatrix4(tm.get(node).clone().invert()).toArray()}};
 def.followers=[];
 for(const f of original.followers){const base=attachment(f.base_node,f.base_point),tip=attachment(f.tip_node,f.tip_point);for(const [role,key,from,to] of [['barrel',f.barrel,base,tip],['piston',f.piston,tip,base]]){for(const [i,part] of groupParts(key).entries())def.followers.push({id:f.id+'-'+role+'-'+i,name:f.name+' · '+tn.get(part).name,barrel:part,piston:'',base_node:from.node,tip_node:to.node,base_point:from.point,tip_point:to.point})}}
 delete def.soil;def.controls.forEach(c=>{c.keys=[];c.value=c.rest});validateEquipment(def,tn);
 const expected=bindEquipment(src,original),actual=bindEquipment(dst,def);let maxError=0;
 const poses=[{},...original.controls.flatMap(c=>[0,.25,.5,.75,1].map(v=>({[c.id]:v}))),{steer:0,lift:0,bucket:1,wheels:.7},{steer:1,lift:.25,bucket:0,wheels:.3}];
 for(const pose of poses){expected.evaluate(null,pose);actual.evaluate(null,pose);const s=matrices(src),t=matrices(dst);for(const [sk,tk] of mapping){const e=basis.clone().multiply(s.get(sk));for(let i=0;i<16;i++)maxError=Math.max(maxError,Math.abs(e.elements[i]-t.get(tk).elements[i]))}}
 expected.restore();actual.restore();if(maxError>1e-6)throw Error('Pose mismatch '+maxError);
 const adapted=importEquipmentPreset(def,outer),roundtrip=JSON.parse(JSON.stringify(adapted));validateEquipment(roundtrip,equipmentNodes(outer.clone(true)));const runtime=bindEquipment(outer,roundtrip);runtime.evaluate(null,{lift:.2,bucket:.8,steer:.6});runtime.restore();window.testObject=outer;window.testPreset=def;
 window.result={preset:{name:'Wheel loader · original 77 parts',definition:def},meshes:mapping.size,poses:poses.length,maxError,followers:def.followers.length,jointParts:def.joints.map(j=>({name:j.name,node:j.node,members:j.members.length})),originalUnchanged:sn.size===equipmentNodes(src).size&&tn.size===equipmentNodes(dst).size};
 // Render the repaired original with the same lighting as the established rig review.
 outer.scale.set(1,1,1);const scene=new T.Scene();scene.background=new T.Color('#dce4e8');scene.add(outer);scene.add(new T.HemisphereLight('#eaf5ff','#66634a',2));const sun=new T.DirectionalLight('#fff4df',3);sun.position.set(-8,15,7);scene.add(sun);
 const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1200,850);document.body.style.margin='0';document.body.appendChild(renderer.domElement);const camera=new T.PerspectiveCamera(43,1200/850,.1,200);camera.position.set(-10,7,-12);camera.lookAt(0,1.8,0);window.draw=pose=>{runtime.evaluate(null,pose);renderer.render(scene,camera)};window.draw({lift:.25,bucket:.7,steer:.65});
})();`},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}})
 win=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{contextIsolation:true,offscreen:true}});await win.loadFile(path.join(repo,'desktop/ui/desktop-settings.html'));await win.webContents.executeJavaScript("document.body.innerHTML='';void 0");await win.webContents.executeJavaScript(outputFiles[0].text);await win.webContents.executeJavaScript('window.ready');const result=await win.webContents.executeJavaScript('window.result');assert.ok(result.originalUnchanged);assert.ok(result.maxError<1e-6);fs.writeFileSync(path.join(out,'Equipment-77-parts-rig.json'),JSON.stringify(result.preset,null,2));delete result.preset;fs.writeFileSync(path.join(out,'Equipment-77-parts-review.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,'Equipment-77-parts-repaired.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(result));console.log('PASS: all original meshes match the calibrated rig through combined poses and roundtrip')
 const ui=await require(path.join(repo,'frontend/node_modules/esbuild')).build({stdin:{resolveDir:path.join(repo,'frontend'),loader:'tsx',contents:`
import React,{useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';import {EquipmentPanel} from './src/modules/fourD/EquipmentPanel';
const objects=[{name:'site:equipment',label:'Equipment.glb',kind:'mesh',object:window.testObject}],date={current:new Date('2026-01-01T00:00:00Z')};let saved=null;
function App(){const [rig,setRig]=useState(saved),save=useCallback(async r=>{saved=JSON.parse(JSON.stringify({...r,id:'saved-rig',version:r.version+1}));window.savedRig=saved;setRig(saved);return true},[]),noop=useCallback(()=>{},[]),draft=useCallback(r=>{window.draftRig=r},[]),preview=useCallback(p=>{window.previewRig=p},[]);return <EquipmentPanel projectId="p" objects={objects} rigs={rig?[rig]:[]} busy={false} error={null} runtimeError={null} dateRef={date} onSave={save} onRemove={noop} onDraft={draft} onPreview={preview} onEditing={noop} onSeek={noop}/>}
window.mountPanel=()=>{window.panel=createRoot(document.getElementById('root'));window.panel.render(<App/>)};window.mountPanel();
`},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}})
 const run=s=>win.webContents.executeJavaScript(s),wait=()=>new Promise(r=>setTimeout(r,250))
 await run("document.body.innerHTML='<div id=\"root\"></div>';void 0");await run(ui.outputFiles[0].text);await wait()
 const select=()=>run(`(()=>{const s=document.querySelector('[aria-label="Equipment model"]');s.value='site:equipment';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
 const button=label=>run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`)
 const upload=d=>run(`(()=>{const f=document.querySelector('input[type=file]'),dt=new DataTransfer();dt.items.add(new File([JSON.stringify(${d})],'preset.json',{type:'application/json'}));f.files=dt.files;f.dispatchEvent(new Event('change',{bubbles:true}))})()`)
 await select();await wait();await button('Create equipment rig');await wait()
 await upload(JSON.stringify(preset));await wait();assert.match(await run("document.body.innerText"),/Preset not imported/);assert.equal(await run('window.draftRig.definition.joints.length'),0)
 await upload('{name:"Wheel loader · original 77 parts",definition:window.testPreset}');await wait();assert.equal(await run('window.draftRig.definition.joints.length'),6);assert.equal(await run("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Animate').getAttribute('aria-pressed')"),'true')
 await button('Save rig & keys');await wait();assert.equal(await run('window.savedRig.definition.followers.length'),20)
 await run('window.panel.unmount();window.mountPanel()');await wait();await select();await wait();await button('Animate');await wait();assert.equal(await run("document.querySelectorAll('[aria-label=\"Control name\"]').length"),4)
 console.log('PASS: actual panel rejects old preset, imports replacement, opens controls and retains rig after save/remount')
 }catch(e){console.error(e);status=1}finally{win?.destroy();app.exit(status)}})
