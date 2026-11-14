import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const source = readFileSync('src/modules/scheduling/ActivityForm.tsx', 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf('  const commitValues = async ')
const body = source.slice(start, source.indexOf('\n  const setAndCommit', start))
const { outputFiles } = await build({ stdin: { contents: `
export function make(onSubmit, state) {
 const pendingValues={current:new Set()},saveRevision={current:0},embedded=true,activity={},calendarLookup={};
 const reassessmentNote='',hasTriggerChangesFor=()=>false,toFormValues=()=>({task_name:'Original'});
 const axios={isAxiosError:e=>!!e?.isAxiosError};
 const setSubmitting=v=>state.submitting=v,setSaveError=v=>state.error=v,setSavedValues=v=>state.saved=v;
 ${body}
 return commitValues;
}`, loader: 'ts', resolveDir: process.cwd() }, write: false, bundle: true, platform: 'node', format: 'esm' })
const { make } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

test('autosave reports a failed save, retains the draft, and supports retry', async () => {
 const state={},draft={task_name:'New name'};let fail=true,calls=0
 const save=make(async values=>{calls++;assert.equal(values,draft);if(fail)throw Error('Network Error')},state)
 await save(draft)
 assert.equal(state.submitting,false);assert.match(state.error,/could not be confirmed/);assert.equal(state.saved,undefined)
 fail=false;await save(draft)
 assert.equal(calls,2);assert.equal(state.error,null);assert.equal(state.saved,JSON.stringify(draft))
})

test('duplicate blur/Enter saves are ignored and cancelled conflicts are not labelled saved', async () => {
 const state={};let done,calls=0
 const save=make(()=>{calls++;return new Promise(resolve=>done=resolve)},state)
 const first=save({task_name:'Changed'});await save({task_name:'Changed'})
 assert.equal(calls,1);assert.equal(state.submitting,true)
 done(false);await first
 assert.match(state.error,/cancelled/);assert.equal(state.saved,undefined);assert.equal(state.submitting,false)
})

test('an older completion cannot hide the latest validation failure', async () => {
 const state={};let complete
 const save=make(values=>values.task_name==='First'?new Promise(resolve=>complete=resolve):Promise.reject({isAxiosError:true,response:{data:{detail:'Duration must be positive'}}}),state)
 const first=save({task_name:'First'});await save({task_name:'Second'})
 complete();await first
 assert.equal(state.error,'Duration must be positive');assert.equal(state.saved,undefined)
})
