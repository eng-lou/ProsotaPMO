import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/modules/fourD/workerActions';export * from './src/modules/fourD/attachmentTransform';export * from './src/modules/fourD/sitePathMotion';export * as T from 'three'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm'})
const {WorkerActionPlayer,validateActions,sampleWorkerAction,attachmentNode,attachmentWorld,applyAttachmentTransform,captureAttachmentTransform,suspendAttachmentTransform,routeStopForAction,sampleSitePath,T}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const epoch=Date.parse('2026-10-29T00:00:00Z'),date=s=>new Date(epoch+s*1000).toISOString(),days=1/86400
const action={id:'work',name:'Work',start:date(5),end:date(12),clip:1,speed:1,loop:true,blend:0}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`)
test('action seeks, loops, holds, transitions and reloads independently of playback history',()=>{
 const root=new T.Group(),bone=new T.Bone();bone.name='Hand';root.add(bone)
 root.animations=[new T.AnimationClip('Idle',2,[new T.VectorKeyframeTrack('Hand.position',[0,2],[0,0,0,0,0,0])]),new T.AnimationClip('Work',2,[new T.VectorKeyframeTrack('Hand.position',[0,2],[0,0,0,4,0,0])])]
 const player=new WorkerActionPlayer(root),seek=(s,seq=[action])=>{player.evaluate(seq,epoch+s*1000,days,0,0);return bone.position.x}
 near(seek(6),2);near(seek(8),2);near(seek(4),0);near(seek(12),0);near(seek(6),2)
 near(seek(10,[{...action,loop:false}]),4)
 near(seek(5.5,[{...action,blend:1}]),.5)
 const saved=JSON.parse(JSON.stringify([action]));player.dispose()
 const restored=new WorkerActionPlayer(root);restored.evaluate(saved,epoch+6000,days,0,0);near(bone.position.x,2)
 restored.evaluate([{...action,clip:0}],epoch+7000,days,0,99);near(bone.position.x,0);restored.dispose()
})
test('overlap and invalid clips reject; changing display pace preserves stored dates',()=>{
 assert.throws(()=>validateActions([action,{...action,id:'next',start:date(10)}]),/overlap/)
 assert.throws(()=>validateActions([action],1),/missing clip/)
 assert.throws(()=>validateActions([{...action,end:date(5)}]),/finish/)
 assert.equal(validateActions([action,{...action,id:'next',start:date(12),end:date(13)}]).length,2)
 near(sampleWorkerAction([action],epoch+6000,days).time,1)
 near(sampleWorkerAction([action],epoch+6000,days*2).time,.5)
})
test('route pause is deterministic and repeated clicks do not keep extending the route',()=>{
 const curve=new T.LineCurve3(new T.Vector3(),new T.Vector3(20,0,0)),motion={path_id:'route',start:date(0),speed:1,animation_reference_speed:1,loop:false,orient:true,heading:0}
 const paused=routeStopForAction(motion,curve,action,days)
 near(sampleSitePath(curve,paused,6,'y',days).point.x,5)
 near(sampleSitePath(curve,paused,11,'y',days).point.x,5)
 near(sampleSitePath(curve,paused,14,'y',days).point.x,7)
 assert.deepEqual(routeStopForAction(paused,curve,action,days),paused)
 assert.throws(()=>routeStopForAction(motion,curve,{...action,start:date(21),end:date(23)},days),/within/)
})
test('bone attachments use metre offsets under FBX scale, follow animated anchors and reject ambiguous names',()=>{
 const root=new T.Group(),bone=new T.Bone();root.scale.setScalar(.01);bone.name='Hand';bone.position.set(100,0,0);root.add(bone)
 const a={parent_id:'worker',node:'Hand',position:{x:0,y:.1,z:0},rotation:{x:0,y:0,z:90}}
 assert.equal(attachmentNode(root,'Hand'),bone)
 const p=new T.Vector3().setFromMatrixPosition(attachmentWorld(bone,a));near(p.x,1);near(p.y,.1)
 bone.rotation.z=Math.PI/2;const second=new T.Vector3().setFromMatrixPosition(attachmentWorld(bone,a));near(second.x,.9);near(second.y,0)
 const duplicate=new T.Bone();duplicate.name='Hand';root.add(duplicate);assert.equal(attachmentNode(root,'Hand'),null)
})

test('attachment gizmo edits survive frames, save as grip offsets and restore the original placement on release',()=>{
 const scene=new T.Group(),worker=new T.Group(),hand=new T.Bone(),motion=new T.Group(),tool=new T.Group()
 scene.add(worker,motion);worker.scale.setScalar(.01);worker.rotation.z=.3;worker.add(hand);hand.position.set(100,80,0);hand.rotation.x=.4;motion.add(tool)
 const item={position:{x:8,y:2,z:-4},rotation:{x:.1,y:.2,z:.3},scale:{x:1,y:1,z:1},attachment:{parent_id:'worker',node:'Hand',start:date(2),end:date(7),position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},only_during:false}}
 applyAttachmentTransform(tool,item,hand)
 tool.position.set(.2,-.1,.05);tool.rotation.set(.4,.6,-.3);tool.scale.setScalar(1.2)
 const edited=tool.matrixWorld.clone();tool.updateWorldMatrix(true,false);edited.copy(tool.matrixWorld)
 for(let i=0;i<5;i++)applyAttachmentTransform(tool,item,hand)
 tool.matrixWorld.elements.forEach((v,i)=>near(v,edited.elements[i]))
 const patch=captureAttachmentTransform(item,tool)
 assert.deepEqual(patch.attachment.position,{x:.2,y:-.1,z:.05});assert.equal(patch.position,undefined);assert.equal(patch.rotation,undefined)
 const saved=JSON.parse(JSON.stringify({...item,...patch}));applyAttachmentTransform(tool,saved,hand)
 tool.matrixWorld.elements.forEach((v,i)=>near(v,edited.elements[i]))
 hand.rotation.y=.8;applyAttachmentTransform(tool,saved,hand)
 const expected=attachmentWorld(hand,saved.attachment).scale(tool.scale)
 tool.matrixWorld.elements.forEach((v,i)=>near(v,expected.elements[i]))
 motion.position.set(0,0,0);motion.quaternion.identity();motion.scale.setScalar(1);applyAttachmentTransform(tool,saved,null)
 assert.deepEqual(tool.position.toArray(),[8,2,-4]);near(tool.rotation.y,.2);assert.equal(captureAttachmentTransform(saved,tool),null)
 applyAttachmentTransform(tool,saved,hand);tool.matrixWorld.elements.forEach((v,i)=>near(v,expected.elements[i]))
 const fresh=new T.Group(),freshMotion=new T.Group();scene.add(freshMotion);freshMotion.add(fresh);fresh.scale.setScalar(1.2)
 applyAttachmentTransform(fresh,saved,hand);fresh.matrixWorld.elements.forEach((v,i)=>near(v,expected.elements[i]))
})

test('Simulator ownership suspends attachment editing and restores the saved grip when it ends',()=>{
 const scene=new T.Group(),motion=new T.Group(),tool=new T.Group(),hand=new T.Bone()
 scene.add(motion,hand);motion.add(tool);hand.position.set(1,2,3)
 const item={position:{x:8,y:2,z:-4},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},attachment:{parent_id:'worker',node:'Hand',position:{x:.2,y:.1,z:0},rotation:{x:10,y:0,z:0}}}
 applyAttachmentTransform(tool,item,hand)
 suspendAttachmentTransform(tool)
 tool.position.set(4,5,6);tool.rotation.set(.4,.5,.6)
 assert.equal(captureAttachmentTransform(item,tool),null)
 applyAttachmentTransform(tool,item,null)
 assert.deepEqual(tool.position.toArray(),[4,5,6])
 applyAttachmentTransform(tool,item,hand)
 const expected=attachmentWorld(hand,item.attachment)
 tool.matrixWorld.elements.forEach((v,i)=>near(v,expected.elements[i]))
})
