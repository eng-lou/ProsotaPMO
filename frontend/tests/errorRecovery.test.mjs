import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
test('crash recovery cannot erase project materials or browser data',()=>{
 const source=readFileSync('src/components/ErrorBoundary.tsx','utf8')
 assert.doesNotMatch(source,/removeItem|localStorage\.clear|sessionStorage\.clear|resetSavedViewSettings/)
 assert.doesNotMatch(source,/Reset saved view settings/)
 assert.match(source,/window\.location\.reload\(\)/)
})
