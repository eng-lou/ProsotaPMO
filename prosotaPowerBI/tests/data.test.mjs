import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdir,rm} from 'node:fs/promises';
await mkdir('preview',{recursive:true});
await build({stdin:{contents:"export * from './src/charts';export * from './src/stepText';export * from './src/types';export * from './src/profile';export * from './src/bindings';export * from './src/generated/animation';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:'preview/test.cjs'});
const {periods,phase,readStepTextProperties,decodeStepString,parseTask,total,readProfile,readTable,computeAppliedAnimationStateAt}=createRequire(import.meta.url)('../preview/test.cjs');await rm('preview/test.cjs');
const task={id:'t',start:'2026-10-01T00:00:00Z',finish:'2026-10-11T00:00:00Z',bac:100,ac:0};
test('missing financial values stay missing and incomplete totals are not presented as complete',()=>{const t=parseTask(task);assert.equal(t.actual,0);assert.equal(t.earned,null);assert.equal(total([t],'earned'),null);assert.equal(total([t,{...t,budget:null}],'budget'),null);assert.equal(parseTask({...task,finish:'bad'}),null);});
test('repeated element rows count task totals once and reject conflicting activity totals',()=>{const roles=['taskId','start','finish','budget','elementGuid'];const table={columns:roles.map(r=>({roles:{[r]:true}})),rows:[['t',task.start,task.finish,100,'a'],['t',task.start,task.finish,100,'b']]};const result=readTable(table);assert.equal(result.tasks.length,1);assert.equal(total(result.tasks,'budget'),100);assert.equal(result.links.length,2);table.rows[1][3]=200;assert.throws(()=>readTable(table),/conflicting/);});
test('profiles preserve explicit null colours and validate malformed transforms',()=>{assert.equal(readProfile({color_from:null}).color_from,null);assert.equal(readProfile({}).color_from,'#22c55e');assert.throws(()=>readProfile({axis:'w'}));assert.throws(()=>readProfile({distance:Infinity}));});
test('real Prosota playback yields start, intermediate and finish states',()=>{const link={startMs:0,finishMs:1000,axis:'z',profile:readProfile({})};assert.equal(computeAppliedAnimationStateAt(link,new Date(0),'z').opacity,0);assert.equal(computeAppliedAnimationStateAt(link,new Date(500),'z').opacity,.5);assert.equal(computeAppliedAnimationStateAt(link,new Date(1000),'z').opacity,1);});

test('large STEP link lists are read intact, including quoted names and Unicode escapes',()=>{
 const records=Array.from({length:3000},(_,i)=>({activity_id:'task',element_ref:String(i),label:"Builder's wall"}));
 const json=JSON.stringify(records).replaceAll("'","''");
 const text=`#42=IFCPROPERTYSINGLEVALUE('links',$,IFCTEXT('${json}'),$);`;
 assert.deepEqual(JSON.parse(readStepTextProperties(text).get(42)),records);
 assert.equal(decodeStepString("Builder''s \\X2\\00E9\\X0\\"),"Builder's é");
});

test('time phasing preserves budgets across weekly/monthly boundaries and keeps missing values missing',()=>{
 const start=Date.parse('2026-10-03'),finish=Date.parse('2027-02-19');
 for(const mode of ['weeks','months']){const bins=periods(start,finish,mode),a=[{start,finish,value:1234.56}];
 assert.ok(Math.abs(phase(a,bins).reduce((a,b)=>a+b,0)-1234.56)<1e-9);
 assert.equal(phase(a,bins,true).at(-1),1234.56);
 assert.ok(phase([{start,finish,value:null}],bins).every(v=>v===null));}
});
test('milestone amounts occur in exactly one period and long schedules retain their final budget',()=>{
 const start=Date.parse('2026-10-05'),finish=Date.parse('2100-10-05');
 const bins=periods(start,finish,'weeks');assert.ok(bins.length<=600);
 assert.equal(phase([{start:finish,finish,value:50}],bins).reduce((a,b)=>a+b,0),50);
 const short=periods(start,start+86400000*14,'weeks');assert.equal(phase([{start,finish:start,value:50}],short).filter(v=>v===50).length,1);
});
