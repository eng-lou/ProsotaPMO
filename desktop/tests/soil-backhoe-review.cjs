const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict')
const repo=path.resolve(__dirname,'../..')
app.whenReady().then(async()=>{let win,status=0;try{
 const asset=pathToFileURL(path.join(repo,'outputs/backhoe-authoring/Backhoe-rigged-copy.glb')).href
 const definition=JSON.parse(fs.readFileSync(path.join(repo,'outputs/backhoe-authoring/Backhoe-equipment-imported.json'))).definition
 const {outputFiles}=await require(path.join(repo,'frontend/node_modules/esbuild')).build({stdin:{resolveDir:path.join(repo,'frontend'),loader:'ts',contents:`
import * as T from 'three';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';import {bindEquipment,equipmentNodes} from './src/modules/fourD/equipmentRig';import {createSoilPlayback} from './src/modules/fourD/soilPlayback';import {fitSoilBucket} from './src/modules/fourD/EquipmentSoilSetup';
window.ready=(async()=>{
 const model=(await new GLTFLoader().loadAsync(${JSON.stringify(asset)})).scene,def=${JSON.stringify(definition)},scene=new T.Scene();scene.background=new T.Color('#dce4e8');scene.add(model);
 const box=new T.Box3().setFromObject(model);model.position.y=-box.min.y;model.updateMatrixWorld(true);
 const nodes=equipmentNodes(model),map=k=>!k?'':nodes.has(k)?k:[...nodes.keys()].find(n=>n.endsWith(k.slice(k.lastIndexOf('/'))));
 for(const j of def.joints){j.node=map(j.node);if(j.members)j.members=j.members.map(map)}for(const f of def.followers)for(const key of ['barrel','piston','base_node','tip_node'])f[key]=map(f[key]);
 const start=Date.parse('2026-01-01T00:00:00Z'),tracks={lift:[[0,.1],[2,.1],[5,1],[12,1]],bucket:[[0,.2],[6,.2],[8,1],[12,1]]};
 for(const c of def.controls)c.keys=(tracks[c.id]||[[0,c.rest],[12,c.rest]]).map(([sec,value])=>({date:new Date(start+sec*1000).toISOString(),value,interpolation:'smooth'}));
 const runtime=bindEquipment(model,def),key=def.joints.find(j=>j.id==='bucket').node,bucket=nodes.get(key);runtime.evaluate(start);
 const fit=fitSoilBucket(bucket,'y'),center=fit.world.clone();center.y=0;
 const s={enabled:true,show_guide:false,bucket_node:key,center:fit.center,size:fit.size,rotation:fit.rotation,capacity:Math.min(1,fit.capacity),dump_angle:95,pour_seconds:1.5,source:center.toArray(),radius:2.3,height:Math.max(1,fit.world.y+.2),up_axis:'y',start:new Date(start).toISOString(),end:new Date(start+12000).toISOString(),duration_seconds:12,steps:600,color:'#796044'};
 const view=createSoilPlayback(s,time=>{runtime.evaluate(time);return bucket.matrixWorld.clone()},bucket);scene.add(view.group);
 const ground=new T.Mesh(new T.PlaneGeometry(40,40),new T.MeshStandardMaterial({color:'#bfc1b7',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.02;ground.receiveShadow=true;scene.add(ground);
 scene.add(new T.HemisphereLight('#eaf5ff','#66634a',2));const sun=new T.DirectionalLight('#fff4df',3);sun.position.set(-8,15,7);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12});scene.add(sun);
 model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});
 const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1300,900);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
 const camera=new T.PerspectiveCamera(43,1300/900,.1,200);camera.position.set(-12,10,-14);camera.lookAt(0,1.8,0);
 window.draw=sec=>{runtime.evaluate(start+sec*1000);const state=view.update(start+sec*1000,bucket.matrixWorld);renderer.render(scene,camera);return {fill:state.fill,deposited:state.deposited,inAir:state.inAir}};
 window.result={capacity:s.capacity,maxFill:Math.max(...view.bake.frames.map(f=>f.fill)),deposited:view.bake.frames.at(-1).deposited,falls:view.bake.falls.length};window.draw(0);
})();`},bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}})
 win=new BrowserWindow({show:false,width:1300,height:900,webPreferences:{contextIsolation:true,offscreen:true}})
 await win.loadFile(path.join(repo,'desktop/ui/desktop-settings.html'));await win.webContents.executeJavaScript(`document.head.innerHTML='';document.body.innerHTML='';document.body.style.margin='0';void 0`)
 await win.webContents.executeJavaScript(outputFiles[0].text);await win.webContents.executeJavaScript('window.ready')
 const result=await win.webContents.executeJavaScript('window.result');console.log(JSON.stringify(result));assert.ok(result.maxFill>.01);assert.ok(result.deposited>.01)
 for(const sec of [0,4,8,12]){await win.webContents.executeJavaScript(`window.draw(${sec})`);fs.writeFileSync(path.join(repo,`outputs/soil-backhoe-${sec}.png`),(await win.webContents.capturePage()).toPNG())}
 console.log('PASS: original backhoe rig and calibration scoop and deposit soil')
}catch(e){console.error(e);status=1}finally{win?.destroy();app.exit(status)}})
