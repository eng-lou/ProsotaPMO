import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {build} from 'esbuild'

const source=readFileSync('src/modules/fourD/Viewport3D.tsx','utf8').replace(/\r\n/g,'\n')
const start=source.indexOf('function EmbeddedAnimationLoop(')
const component=source.slice(start,source.indexOf('\n}\n',start)+2)
const {outputFiles}=await build({stdin:{contents:`
import * as THREE from 'three'; export {THREE};
let wakeCount=0;const callbacks=[];
const useRef=current=>({current}),useEffect=effect=>effect(),useFrame=fn=>callbacks.push(fn);
const markRenderActivity=()=>wakeCount++;
${component}
export function make(objects,animWindows,timelineDateRef) {
 callbacks.length=0;wakeCount=0;
 EmbeddedAnimationLoop({objects,animWindows,timelineDateRef});
 return {frame:delta=>callbacks.forEach(fn=>fn(null,delta)),wakes:()=>wakeCount};
}`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'})
const m=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text+'\n//# sourceURL=embedded-animation-fixture.js').toString('base64'))

test('only active visible imported animation keeps the viewport awake',()=>{
 const root=new m.THREE.Group(),parent=new m.THREE.Group();parent.add(root)
 root.animations=[new m.THREE.AnimationClip('move',2,[new m.THREE.NumberKeyframeTrack('.position[x]',[0,2],[0,2])])]
 const date={current:new Date('2026-11-01')},windows=new Map([['model',{start:new Date('2026-11-02'),end:new Date('2026-11-05')}]])
 const runtime=m.make([{id:'id',name:'model',object:root}],windows,date)
 runtime.frame(.1);assert.equal(runtime.wakes(),0);assert.equal(root.position.x,0)
 date.current=new Date('2026-11-03');runtime.frame(.1)
 assert.equal(runtime.wakes(),1);assert.ok(root.position.x>0)
 const position=root.position.x
 parent.visible=false;runtime.frame(.1)
 assert.equal(runtime.wakes(),1);assert.ok(root.position.x>position,'hidden clip time still advances on idle frames')
 parent.visible=true;runtime.frame(.1)
 assert.equal(runtime.wakes(),2);assert.ok(root.position.x>position)
 date.current=new Date('2026-11-06');runtime.frame(.1);assert.equal(runtime.wakes(),2)
 windows.clear();runtime.frame(.1);assert.equal(runtime.wakes(),3,'unbound looping animation remains live')
})
