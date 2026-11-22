import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const source = fileURLToPath(new URL('../src/modules/fourD/siteObjectSelection.ts', import.meta.url))
const { outputFiles } = await build({ entryPoints: [source], write: false, format: 'esm' })
const { changeSiteSelection, removeSitePlacements } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

test('additive site selections preserve other viewport objects', () => {
  const selection = new Set(['model-1', 'site:a'])
  const range = changeSiteSelection(selection, ['b', 'c'], 'add')
  assert.deepEqual([...range], ['model-1', 'site:a', 'site:b', 'site:c'])
  assert.deepEqual([...changeSiteSelection(range, ['a', 'd'], 'toggle')], ['model-1', 'site:b', 'site:c', 'site:d'])
  assert.deepEqual([...changeSiteSelection(range, ['a', 'b', 'c'], 'subtract')], ['model-1'])
  assert.deepEqual([...changeSiteSelection(range, ['b'], 'replace')], ['site:b'])
  assert.deepEqual([...selection], ['model-1', 'site:a'])
})

test('a batch removes only its placements, preserving the order and data of every survivor', () => {
  const items = [{id:'ground', locked:true}, {id:'a', name:'Copy'}, {id:'tower', material:'steel'}, {id:'b', name:'Copy'}]
  const result = removeSitePlacements(items, new Set(['a', 'b']))
  assert.deepEqual(result, [items[0], items[2]])
  assert.equal(result[1], items[2])
  assert.equal(items.length, 4)
})

test('a stale or newly locked batch is rejected in full', () => {
  const items = [{id:'a'}, {id:'b', locked:true}]
  for (const ids of [[], ['a', 'gone'], ['a', 'b']]) {
    assert.throws(() => removeSitePlacements(items, new Set(ids)), /selection|selected/i)
  }
  assert.equal(items.length, 2)
})
