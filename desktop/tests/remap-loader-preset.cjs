const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path');
const out=path.resolve(__dirname,'../../outputs/backhoe-authoring');
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:true}});try{
await w.loadURL('about:blank');await w.webContents.executeJavaScript(fs.readFileSync(path.resolve(out,'../import-test-bundle.js'),'utf8'));
const bytes=fs.readFileSync(path.join(out,'Backhoe-rigged-copy.glb')).toString('base64');
const preset=JSON.parse(fs.readFileSync(path.join(out,'Backhoe-equipment.json')));
// The backend accepts at most 100 response samples. Preserve both endpoints.
for(const joint of preset.definition.joints){
 const samples=joint.response;
 if(samples?.length>100)joint.response=Array.from({length:100},(_,i)=>samples[Math.round(i*(samples.length-1)/99)]);
}
const result=await w.webContents.executeJavaScript(`(async()=>{
 const T=ImportTest.THREE,parsed=await ImportTest.parseAsset(Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0)).buffer);
 const outer=parsed.object;outer.scale.setScalar(1);outer.updateMatrixWorld(true);
 let root=outer;outer.traverse(n=>{if(n.userData.siteAssetRigRoot)root=n});
 const before=ImportTest.equipmentNodes(outer),after=ImportTest.equipmentNodes(root),preset=${JSON.stringify(preset)};
 const remap=key=>{if(!key)return '';const node=before.get(key),entry=[...after].find(([k,n])=>n===node);if(!entry)throw Error('Cannot map '+key);return entry[0]};
 const point=p=>root.worldToLocal(outer.localToWorld(new T.Vector3(...p))).toArray();
 for(const j of preset.definition.joints){j.node=remap(j.node);j.pivot=point(j.pivot);if(j.members)j.members=j.members.map(remap)}
 for(const f of preset.definition.followers){if(!f.base_node)f.base_point=point(f.base_point);if(!f.tip_node)f.tip_point=point(f.tip_point);for(const k of ['barrel','piston','base_node','tip_node'])f[k]=remap(f[k])}
 ImportTest.validateEquipment(preset.definition,after);
 const bound=ImportTest.bindEquipment(root,preset.definition);bound.evaluate(null,{lift:.25,bucket:1,steer:1,wheels:.2});
 return preset;
})()`);
fs.writeFileSync(path.join(out,'Backhoe-equipment-imported.json'),JSON.stringify(result,null,2));console.log('Validated imported-root preset: '+result.definition.joints.map(j=>j.node).join(', '));
}catch(e){console.error(e);process.exitCode=1}finally{app.quit()}});
