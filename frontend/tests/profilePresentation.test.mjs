import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
const {outputFiles}=await build({stdin:{contents:`export * from './src/modules/fourD/profilePresentation'; export {computeAppliedAnimationStateAt} from './src/modules/fourD/timelinePlayback'; export {DEFAULT_ANIMATION_CONFIG} from './src/modules/fourD/animationDefaults'`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'})
const m=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
test('duration entry round-trips days, seconds and frames without changing stored calendar windows',()=>{
 for(const speed of [1,7,30])for(const fps of [24,30,60])for(const unit of ['days','seconds','frames'])for(const days of [.001,1,2.5])assert.ok(Math.abs(m.durationDays(m.durationValue(days,unit,speed,fps),unit,speed,fps)-days)<1e-10)
})
test('preview matches production evaluator for every movement, trigger and stagger phase',()=>{
 for(const kind of ['none','translate','scale','grow','rotate','pop','spiral','fall'])for(const trigger of ['over_duration','on_start','on_finish'])for(const p of [0,.1,.5,.9,1]){
 const config={...m.DEFAULT_ANIMATION_CONFIG,transform_kind:kind,trigger,duration_frames:2.5,stagger:.5}
 assert.deepEqual(m.previewProfile(config,p,.7),m.computeAppliedAnimationStateAt({startMs:0,finishMs:5*86400000,profile:config,staggerFraction:.7},new Date(p*5*86400000),'y'))
 }
})
test('families separate growth from movement and finish recipes from arrivals',()=>{
 assert.equal(m.profileFamily({...m.DEFAULT_ANIMATION_CONFIG,transform_kind:'grow'}),'Scale / Grow')
 assert.equal(m.profileFamily({...m.DEFAULT_ANIMATION_CONFIG,trigger:'on_finish'}),'Demolish')
})

test('remove keeps existing solid, turns it red during work and leaves nothing after finish',()=>{
 const profile={...m.DEFAULT_ANIMATION_CONFIG,transform_kind:'grow',grow_mode:'remove',opacity_from:1,opacity_to:1,color_from:'#c53522',color_to:null}
 const at=p=>m.computeAppliedAnimationStateAt({startMs:86400000,finishMs:3*86400000,profile},new Date((1+2*p)*86400000),'y')
 assert.equal(at(-.1).growProgress,1);assert.equal(at(-.1).opacity,1);assert.equal(at(-.1).color,null)
 assert.equal(at(0).growProgress,1);assert.equal(at(.5).growProgress,.5);assert.equal(at(.5).color,'#c53522');assert.equal(at(.5).opacity,1)
 assert.equal(at(1).growProgress,0);assert.equal(at(1).opacity,0);assert.equal(at(1.2).opacity,0)
})
test('explicit reveal/remove are chronological for every trigger and stagger position',()=>{
 for(const trigger of ['over_duration','on_start','on_finish'])for(const fraction of [0,.5,1]){
 const base={...m.DEFAULT_ANIMATION_CONFIG,transform_kind:'grow',trigger,opacity_from:1,opacity_to:1,stagger:.5,duration_frames:1}
 for(const mode of ['reveal','remove']){
 const values=[0,.25,.5,.75,1].map(p=>m.previewProfile({...base,grow_mode:mode},p,fraction).growProgress)
 assert.equal(values[0],mode==='remove'?1:0);assert.equal(values.at(-1),mode==='remove'?0:1)
 for(let i=1;i<values.length;i++) assert.ok(mode==='remove'?values[i]<=values[i-1]:values[i]>=values[i-1])
 }
 }
})
test('legacy growth and finish-trigger opacity remain unchanged',()=>{
 const c={...m.DEFAULT_ANIMATION_CONFIG,transform_kind:'grow',trigger:'on_finish',duration_frames:1}
 assert.equal(m.previewProfile(c,0).growProgress,1);assert.equal(m.previewProfile(c,1).growProgress,0)
 assert.equal(m.previewProfile(c,0).opacity,1);assert.equal(m.previewProfile(c,1).opacity,0)
 assert.deepEqual(m.previewProfile(c,.75),m.previewProfile({...c,grow_mode:null},.75))
})
