// Synthetic renderer only: does not connect to the running app or its project.
const {app,BrowserWindow}=require('electron');const fs=require('fs'),path=require('path');
const repo=path.resolve(__dirname,'../..');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true}});try{
 const {build}=require(path.join(repo,'frontend/node_modules/esbuild'));
 const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/realisticMaterials'; export * as THREE from 'three'",resolveDir:path.join(repo,'frontend'),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'TurfTest'});
 await win.loadURL('about:blank');await win.webContents.executeJavaScript(outputFiles[0].text);
 const result=await win.webContents.executeJavaScript(`(()=>{
 const T=TurfTest.THREE,renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1200,850);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;
 const errors=[];renderer.debug.onShaderError=(gl,p)=>errors.push(gl.getProgramInfoLog(p));
 const scene=new T.Scene();scene.background=new T.Color('#e6e6df');scene.add(new T.HemisphereLight(0xffffff,0x70705f,2));const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(2,8,4);scene.add(sun);
 const camera=new T.PerspectiveCamera(38,1200/850,.1,100);camera.position.set(0,5,9);camera.lookAt(0,0,0);
 ['moquette','moquette-checkered'].forEach((cls,i)=>{const source=new T.MeshStandardMaterial({color:'white'}),mat=TurfTest.getRealisticVariant(source,TurfTest.classIndexForKey('sample',undefined,{sample:cls}));const geo=new T.PlaneGeometry(3.4,4,45,45),p=geo.getAttribute('position');for(let j=0;j<p.count;j++)p.setZ(j,.28*Math.exp(-(p.getX(j)**2+p.getY(j)**2)*1.3));geo.computeVertexNormals();const mesh=new T.Mesh(geo,mat);mesh.rotation.x=-Math.PI/2;mesh.position.set((i-.5)*3.8,0,0);scene.add(mesh);const label=document.createElement('canvas');label.width=512;label.height=64;const ctx=label.getContext('2d');ctx.fillStyle='#18251a';ctx.font='bold 30px sans-serif';ctx.textAlign='center';ctx.fillText(cls==='moquette'?'Moquette turf':'Checkered moquette',256,42);const sprite=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(label),depthTest:false}));sprite.position.copy(mesh.position).add(new T.Vector3(0,.15,2.25));sprite.scale.set(3.6,.45,1);scene.add(sprite)});
 renderer.render(scene,camera);return {url:renderer.domElement.toDataURL(),errors,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};})()`);
 if(result.errors.length)throw Error(result.errors.join('\n'));
 fs.mkdirSync(path.join(repo,'outputs'),{recursive:true});fs.writeFileSync(path.join(repo,'outputs/turf-preview.png'),Buffer.from(result.url.split(',')[1],'base64'));console.log(JSON.stringify({calls:result.calls,triangles:result.triangles}));
 }catch(e){console.error(e);process.exitCode=1}finally{app.quit()}});
