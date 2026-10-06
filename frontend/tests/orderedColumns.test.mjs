import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {readFileSync, unlinkSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const out = fileURLToPath(new URL(`.columns-${process.pid}.cjs`, import.meta.url))
await build({entryPoints:[fileURLToPath(new URL('../src/components/OrderedColumns.tsx',import.meta.url))],outfile:out,bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic'})
const {OrderedColumns, reconcileColumnOrder} = require(out)
unlinkSync(out)
const {createElement:h} = require('react')
const {renderToStaticMarkup} = require('react-dom/server')
test('custom field can move after code with headers, cells and widths aligned', () => {
  const sourceKeys = ['selection','code','activity','udf:p6']
  const order = ['selection','code','udf:p6','activity']
  for (const tag of ['td','th','col']) {
    const children = [h(tag,{key:'s','data-id':'selection'}), false, h(tag,{key:'c','data-id':'code'}), h(tag,{key:'a','data-id':'activity'}), [h(tag,{key:'u','data-id':'udf:p6'})]]
    const html = renderToStaticMarkup(h(OrderedColumns,{sourceKeys,order}, children))
    assert.deepEqual([...html.matchAll(/data-id="([^"]+)"/g)].map(m=>m[1]), order)
  }
})
test('saved order tolerates hidden, deleted, duplicate and newly added columns', () => {
  assert.deepEqual(reconcileColumnOrder(['code','udf:p6','activity','code','deleted'], ['code','activity','udf:p6','new']), ['code','udf:p6','activity','new'])
})
test('schedule headers, widths and row cells use the same source column sequence', () => {
  const path = fileURLToPath(new URL('../src/modules/scheduling/Scheduling.tsx',import.meta.url))
  const text = readFileSync(path,'utf8')
  const ast = ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const sequences = []
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast)==='OrderedColumns') {
      const keys = []
      for (const child of node.children) {
        if (ts.isJsxText(child)) continue
        const t = child.getText(ast)
        const match = t.match(/^\{isColumnVisible\('([^']+)'\)/)
        if (match) keys.push(match[1])
        else if (t.includes('visibleUdfDefinitions.map')) keys.push('udfs')
        else if (t.startsWith('<')) keys.push(keys.length===0 ? 'selection' : 'activity')
      }
      sequences.push(keys)
    }
    ts.forEachChild(node,visit)
  }
  visit(ast)
  assert.equal(sequences.length,3)
  assert.deepEqual(sequences[1],sequences[0])
  assert.deepEqual(sequences[2],sequences[0])
})
