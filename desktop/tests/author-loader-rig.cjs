const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path');
const out=path.resolve(__dirname,'../../outputs/backhoe-authoring');
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:true}});try{
await w.loadURL('about:blank');await w.webContents.executeJavaScript(fs.readFileSync(path.resolve(out,'../import-test-bundle.js'),'utf8'));
await w.webContents.executeJavaScript(`window.sourceBytes=Uint8Array.from(atob(${JSON.stringify(fs.readFileSync(path.join(out,'Backhoe.glb')).toString('base64'))}),c=>c.charCodeAt(0))`);
const result=await w.webContents.executeJavaScript(`(async()=>{
const T=ImportTest.THREE,parsed=await ImportTest.parseAsset(sourceBytes.buffer),root=parsed.object;root.scale.setScalar(1);root.updateMatrixWorld(true);
const parts=[...ImportTest.equipmentNodes(root)].filter(([k,n])=>n.isMesh).map(([k,n])=>n),groups={};
const group=(name,ids)=>{const g=new T.Group();g.name=name;root.add(g);for(const i of ids)g.attach(parts[i]);groups[name]=g;return g};
group('Front chassis',[0,1,2,3,13,14,15,16,34,37,62]);group('Lift arms',[28,63,81]);group('Bucket',[8,41,69,80]);group('Tilt rocker',[30,64,79,82]);group('Bucket link',[25]);
group('Lift cylinder barrels',[9,26,29]);group('Lift cylinder rods',[12,27]);group('Tilt cylinder barrels',[6,19,20,21,24,46,47]);group('Tilt cylinder rods',[7,22,23]);
group('Left steering barrel',[31]);group('Left steering rod',[32]);group('Right steering barrel',[35]);group('Right steering rod',[36]);group('Front wheels',[65,67]);group('Rear wheels',[66,68]);group('Link endpoint',[]);
const exported=await new ImportTest.GLTFExporter().parseAsync(root,{binary:true});
window.rigRoot=(await ImportTest.parseAsset(exported)).object;rigRoot.scale.setScalar(1);rigRoot.updateMatrixWorld(true);
const nodes=ImportTest.equipmentNodes(rigRoot),key=name=>{const entry=[...nodes].find(([k,n])=>n.name.replace(/_/g,'')===name.replace(/ /g,''));if(!entry)throw Error('Missing '+name+' in '+[...nodes.values()].map(n=>n.name).join(','));return entry[0]};
const def=ImportTest.emptyEquipment();
const control=(id,name,rest)=>def.controls.push({id,name,value:rest,rest,keys:[]});
control('steer','Steering',.5);control('lift','Loader lift',1);control('bucket','Bucket tilt',.5);control('wheels','Wheel rotation',0);
const axis=[Math.cos(Math.PI/9),0,-Math.sin(Math.PI/9)];
const pivot={steer:[.711,.831,.221],lift:[.349,2.494,-.7755],bucket:[-.594,4.229,-3.3665],rocker:[-.1705,4.041,-2.2025],linkTop:[-.3675,4.34,-2.743],linkBottom:[-.368,3.571,-3.071]};
const joint=(id,name,ctrl,parent,p,min,max,ax=axis,response=[[0,0],[1,1]])=>def.joints.push({id,name,node:key(name),parent,control:ctrl,kind:'hinge',pivot:p,axis:ax,minimum:min,maximum:max,response});
joint('steer','Front chassis','steer',null,pivot.steer,-25,25,[0,1,0]);
joint('lift','Lift arms','lift','steer',pivot.lift,-65,0);
joint('bucket','Bucket','bucket','lift',pivot.bucket,-30,30);
joint('front-wheels','Front wheels','wheels','steer',[.011,1.01,-1.703],0,360);
joint('rear-wheels','Rear wheels','wheels',null,[.711,1.01,2.216],0,360,[1,0,0]);
// Solve the bucket's rigid four-bar linkage at sampled control values.
const v=a=>new T.Vector3(...a),u=v(axis),rotate=(p,c,a)=>v(p).sub(v(c)).applyAxisAngle(u,a).add(v(c));
const a=v(pivot.rocker),b=v(pivot.linkTop),d=v(pivot.linkBottom),length=b.distanceTo(d),radius=b.distanceTo(a);
const samples=[];let previous=0;
for(let i=0;i<=100;i++){const t=i/100,tip=rotate(pivot.linkBottom,pivot.bucket,(t-.5)*Math.PI/3);let best=Infinity,angle=0;
 for(let j=-1500;j<=1500;j++){const angleNow=j*Math.PI/3000,p=rotate(pivot.linkTop,pivot.rocker,angleNow),error=Math.abs(p.distanceTo(tip)-length)+Math.abs(angleNow)*1e-8;if(error<best){best=error;angle=angleNow}}
 samples.push([t,angle*180/Math.PI]);}
const lo=Math.min(...samples.map(s=>s[1])),hi=Math.max(...samples.map(s=>s[1]));
joint('rocker','Tilt rocker','bucket','lift',pivot.rocker,lo,hi,axis,samples.map(([t,a])=>[t,(a-lo)/(hi-lo)]));
const local=(name,p)=>{const n=nodes.get(key(name));return n.worldToLocal(v(p)).toArray()};
const follower=(id,name,barrel,piston,base,tip,pa,pb)=>def.followers.push({id,name,barrel:key(barrel),piston:key(piston),base_node:base?key(base):'',tip_node:tip?key(tip):'',base_point:base?local(base,pa):pa,tip_point:tip?local(tip,pb):pb});
follower('lift-ram','Lift hydraulics','Lift cylinder barrels','Lift cylinder rods','Front chassis','Lift arms',[.5005,.856,-.3575],[.1665,2.931,-1.277]);
follower('tilt-ram','Bucket tilt hydraulics','Tilt cylinder barrels','Tilt cylinder rods','Lift arms','Tilt rocker',[.146,2.432,-1.3315],[.08,4.169,-1.5135]);
follower('bucket-link','Bucket connecting link','Bucket link','Link endpoint','Tilt rocker','Bucket',pivot.linkTop,pivot.linkBottom);
follower('left-steering','Left steering hydraulics','Left steering barrel','Left steering rod',null,'Front chassis',[.127,1.43,.961],[.076,1.43,.185]);
follower('right-steering','Right steering hydraulics','Right steering barrel','Right steering rod',null,'Front chassis',[1.286,1.43,.961],[1.166,1.43,-.212]);
ImportTest.validateEquipment(def,nodes);window.definition=def;window.bound=ImportTest.bindEquipment(rigRoot,def);
window.scene=new T.Scene();scene.background=new T.Color('#dce3eb');scene.add(rigRoot);scene.add(new T.HemisphereLight(0xffffff,0x555566,2));const light=new T.DirectionalLight(0xffffff,2);light.position.set(8,15,12);scene.add(light);
window.renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1000,750);window.camera=new T.PerspectiveCamera(35,1000/750,.01,200);camera.position.set(19,8,6);camera.lookAt(0,3,0);
window.pose=(values)=>{bound.evaluate(null,values);renderer.render(scene,camera);return renderer.domElement.toDataURL()};
return {bytes:Array.from(new Uint8Array(exported)),preset:{name:'Wheel loader - articulated rig',definition:def},parts:parts.length};
})()`);
fs.writeFileSync(path.join(out,'Backhoe-rigged-copy.glb'),Buffer.from(result.bytes));fs.writeFileSync(path.join(out,'Backhoe-equipment.json'),JSON.stringify(result.preset,null,2));
for(const [name,values] of Object.entries({rest:{},lowered:{lift:.25},dump:{lift:.25,bucket:1},steered:{steer:1,wheels:.2}})){const url=await w.webContents.executeJavaScript('pose('+JSON.stringify(values)+')');fs.writeFileSync(path.join(out,'rig-'+name+'.png'),Buffer.from(url.split(',')[1],'base64'));}
console.log('Authored '+result.parts+' parts, '+result.preset.definition.joints.length+' joints');
}catch(e){console.error(e)}finally{app.quit()}});
