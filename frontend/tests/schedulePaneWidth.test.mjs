import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const out=fileURLToPath(new URL(`.pane-${process.pid}.cjs`,import.meta.url))
await build({entryPoints:[fileURLToPath(new URL('../src/modules/scheduling/schedulePaneWidth.ts',import.meta.url))],outfile:out,bundle:true,platform:'node',format:'cjs',packages:'external'})
const {clampScheduleTableWidth:clamp}=createRequire(import.meta.url)(out)
unlinkSync(out)
test('oversized saved table leaves room for timeline and divider in actual container',()=>{
  for(const container of [600,1000,1730]) assert.equal(container-clamp(2300,container)-6,240)
})
test('narrow containers never overflow and retain half for timeline',()=>{
  for(const width of [0,6,100,300,480]){const left=clamp(700,width);assert.ok(left>=0);assert.ok(left<=Math.max(0,width-6)/2)}
})
test('invalid saved widths recover and valid user widths survive wider layouts',()=>{
  for(const bad of [NaN,Infinity,-1,0])assert.equal(clamp(bad,1400),700)
  assert.equal(clamp(900,1800),900)
  assert.equal(clamp(900,900),654)
  assert.equal(clamp(900,1800),900)
})
