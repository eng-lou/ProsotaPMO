import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const { outputFiles } = await build({ stdin: { contents: `export * from './src/modules/fourD/cameraMotion'; export * as THREE from 'three'`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', plugins: [{name:'api',setup(b){b.onResolve({filter:/^@\/lib\/api$/},()=>({path:'api',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const api = {}'}))}}] })
const { pauseDetailVisibility, linkedDetailVisible, sequencePosition, sampleShot, sampleSequence, motionDuration, autoFrame, DEFAULT_MOTION, posePosition, trackPose, THREE } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const pose = {base_position_x:10,base_position_y:0,base_position_z:4,base_target_x:0,base_target_y:0,base_target_z:0,base_focal_length:35,base_clip_start:.1,base_clip_end:10000}
const shot = {id:'a',name:'Orbit',settings:{...DEFAULT_MOTION,easing:'linear'},target:[0,0,0],radius:2,upAxis:'z',start:pose,end:null,startOffset:[0,0,0],endOffset:[0,0,0],stage:'fixed',dateStart:'2026-01-01T00:00:00Z',dateEnd:'2026-04-01T00:00:00Z',blend:0}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`)
test('orbit preserves radius and height with a frozen target through every sample',()=>{for(let t=0;t<=10;t+=.1){const p=posePosition(sampleShot(shot,t).pose);near(Math.hypot(p.x,p.y),10);near(p.z,4)}near(sampleShot(shot,10).pose.base_position_x,-10)})
test('full orbit closes, reverse matches endpoints, pan stays in place',()=>{const full={...shot,settings:{...shot.settings,angle:360}};near(sampleShot(full,10).pose.base_position_x,10);const rev={...shot,settings:{...shot.settings,reverse:true}};assert.deepEqual(sampleShot(rev,0).pose,sampleShot(shot,10).pose);assert.deepEqual(posePosition(sampleShot({...shot,settings:{...shot.settings,kind:'pan'}},5).pose).toArray(),[10,0,4])})
test('camera seconds are separate from construction dates and scrubbing deterministic',()=>{assert.equal(sampleShot(shot,9).date.getTime(),Date.parse(shot.dateStart));const progress={...shot,stage:'progress'};near(sampleShot(progress,5).date.getTime(),(Date.parse(shot.dateStart)+Date.parse(shot.dateEnd))/2);const a=sampleShot(progress,3);sampleShot(progress,9);assert.deepEqual(sampleShot(progress,3),a)})
test('sequence cuts and blends sample the exact shot boundaries',()=>{const next={...shot,id:'b',start:{...pose,base_position_x:20},settings:{...shot.settings,kind:'hold'}};assert.equal(motionDuration([shot,next]),20);assert.deepEqual(sampleSequence([shot,next],10),sampleShot(next,0));const blended={...next,blend:2};assert.equal(motionDuration([shot,blended]),22);near(sampleSequence([shot,blended],11).pose.base_position_x,5);assert.deepEqual(sampleSequence([shot,blended],12),sampleShot(next,0));assert.deepEqual(sampleSequence([shot,blended],100),sampleShot(next,10))})
test('auto frame accounts for narrow aspect; explicit offsets and flyover height survive',()=>{const wide=autoFrame(pose,[0,0,0],4,2,'wide'),narrow=autoFrame(pose,[0,0,0],4,.5,'wide');assert.ok(posePosition(narrow).length()>posePosition(wide).length());const moved={...shot,settings:{...shot.settings,kind:'flyover',offset:7},endOffset:[0,0,3]};near(sampleShot(moved,0).pose.base_position_z,11);near(sampleShot(moved,10).pose.base_position_z,14)})

test('signed angles turn opposite ways from the same start',()=>{for(const kind of ['orbit','pan','tilt']) {const a={...shot,settings:{...shot.settings,kind,angle:90}},b={...a,settings:{...a.settings,angle:-90}};assert.deepEqual(sampleShot(a,0),sampleShot(b,0));const endA=sampleShot(a,10).pose,endB=sampleShot(b,10).pose;assert.notDeepEqual(endA,endB);if(kind==='orbit'){near(endA.base_position_y,-endB.base_position_y);near(endA.base_position_x,endB.base_position_x)}}})

test('hold keeps position and aim fixed even with unequal helper offsets and reverse playback',()=>{
 for(const reverse of [false,true]){
  const fixed={...shot,settings:{...shot.settings,kind:'hold',reverse},startOffset:[1,2,3],endOffset:[9,8,7]};
  for(const t of [0,1,5,10])assert.deepEqual(sampleShot(fixed,t).pose,sampleShot(fixed,0).pose)
 }
})

test('moving target modes preserve relative framing, follow turns and retain missing target fallback',()=>{
 const tracked={...shot,tracking:{objectId:'kevin',position:[0,0,0],rotation:[0,0,0,1]}};
 const live={position:new THREE.Vector3(4,5,0),rotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2)};
 const translate=trackPose({...tracked,followMode:'translate'},pose,()=>live);
 assert.deepEqual(posePosition(translate).toArray(),[14,5,4]);
 const aligned=trackPose({...tracked,followMode:'aligned'},pose,()=>live);
 near(aligned.base_position_x,4);near(aligned.base_position_y,15);near(aligned.base_position_z,4);
 const aim=trackPose({...tracked,followMode:'aim'},pose,()=>live);
 assert.deepEqual(posePosition(aim).toArray(),[10,0,4]);near(aim.base_target_x,4);near(aim.base_target_y,5);
 assert.deepEqual(trackPose({...tracked,followMode:'fixed'},pose,()=>live),pose);
 assert.deepEqual(trackPose({...tracked,followMode:'aligned'},pose,()=>null),pose);
})


test('inserted shot pauses hold camera and date, resume and reverse-seek deterministically',()=>{
 const moving={...shot,stage:'progress',pauses:[{id:'hold',phase:'shot',at:4,duration:3,details:[],actors:'freeze'}]};
 assert.equal(motionDuration([moving]),13);
 for(const t of [4,5,6.99])assert.deepEqual(sampleSequence([moving],t),sampleShot(moving,4));
 assert.deepEqual(sampleSequence([moving],8),sampleShot(moving,5));
 assert.deepEqual(sampleSequence([moving],5),sampleShot(moving,4));
 assert.equal(sequencePosition([moving],6).actorSeconds,4);
 assert.equal(sequencePosition([moving],8).actorSeconds,5);
 assert.equal(sequencePosition([moving],7).pause,null);
 assert.equal(sequencePosition([moving],100).actorSeconds,10);
});
test('incoming transition pauses freeze the interpolated view and date then complete the transition',()=>{
 const next={...shot,id:'b',blend:4,dateStart:'2026-05-01T00:00:00Z',pauses:[{id:'cut',phase:'transition',at:2,duration:5,details:['annotation:a'],actors:'continue'}]};
 assert.equal(motionDuration([shot,next]),29);
 const expected=sampleSequence([shot,{...next,pauses:[]}],12);
 for(const t of [12,14,16.99])assert.deepEqual(sampleSequence([shot,next],t),expected);
 assert.equal(sequencePosition([shot,next],14).phase,'transition');
 assert.equal(sequencePosition([shot,next],14).actorSeconds,14);
 assert.deepEqual(sampleSequence([shot,next],19),sampleShot(next,0));
});
test('multiple holds, endpoints and zero-length transitions do not distort original movement',()=>{
 const pauses=[{id:'a',phase:'shot',at:0,duration:2,details:[]},{id:'b',phase:'shot',at:10,duration:3,details:[]},{id:'ignored',phase:'transition',at:0,duration:9,details:[]}];
 const s={...shot,pauses};assert.equal(motionDuration([s]),15);
 assert.deepEqual(sampleSequence([s],1),sampleShot(s,0));
 assert.deepEqual(sampleSequence([s],14),sampleShot(s,10));
 assert.equal(sequencePosition([s],15).pause,null);
});

test('pause details hide outside their pause and activity intersection ends exactly at finish',()=>{
 const controlled=new Set(['annotation:a']),pause={details:['annotation:a'],onlyLinked:true};
 assert.equal(pauseDetailVisibility('annotation:a',true,controlled,pause,[[10,20]],15),true);
 assert.equal(pauseDetailVisibility('annotation:a',true,controlled,pause,[[10,20]],20),false);
 assert.equal(pauseDetailVisibility('annotation:a',true,controlled,null,[[10,20]],15),false);
 assert.equal(pauseDetailVisibility('annotation:a',false,controlled,pause,[[10,20]],15),undefined);
 assert.equal(pauseDetailVisibility('path:untouched',true,controlled,pause,[],15),undefined);
 assert.equal(pauseDetailVisibility('annotation:a',true,controlled,{...pause,onlyLinked:false},[],20),true);
 assert.equal(linkedDetailVisible([{startMs:10,finishMs:20}],10),true);
 assert.equal(linkedDetailVisible([{startMs:10,finishMs:20}],20),false);
});
