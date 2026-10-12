import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const { outputFiles } = await build({ stdin: { contents: "export {parseCoordinate,parseCoordinatePair} from './src/modules/fourD/siteContext'", resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' }, plugins: [{ name: 'stub-api', setup(build) { build.onResolve({ filter: /^@\/lib\/api$/ }, () => ({ path: 'api', namespace: 'stub' })); build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const api = {}' })) } }], bundle: true, write: false, format: 'esm', platform: 'node' })
const { parseCoordinate, parseCoordinatePair } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

test('decimal degrees with degree symbols and hemispheres survive parsing', () => {
  assert.equal(parseCoordinate('53.2907° N', 'lat'), 53.2907)
  assert.equal(parseCoordinate(' 53.2907°\u00a0s ', 'lat'), -53.2907)
  assert.equal(parseCoordinate('0.442758 W', 'lon'), -0.442758)
  assert.equal(parseCoordinate('+53.2907°', 'lat'), 53.2907)
  assert.equal(parseCoordinate('-0.442758', 'lon'), -0.442758)
  assert.equal(parseCoordinate('51°21\'30.86"N', 'lat'), 51.358572)
})
test('pairs support decimal degrees and existing DMS in either order', () => {
  assert.deepEqual(parseCoordinatePair('53.2907° N, 2.5° W'), {lat:53.2907,lon:-2.5})
  assert.deepEqual(parseCoordinatePair('0°26\'33.93"E 51°21\'30.86"N'), {lat:51.358572,lon:0.442758})
})
test('invalid coordinates never silently become a different valid location', () => {
  for (const raw of ['', 'NaN', '91° N', '51°60\'0"N', '-53° N', '53.2907° N junk', '53 N 2 W', '53 E']) {
    assert.equal(parseCoordinate(raw, 'lat'), null, raw)
  }
  assert.equal(parseCoordinate('181', 'lon'), null)
  assert.equal(parseCoordinatePair('junk 53 N 2 W'), null)
  assert.equal(parseCoordinatePair('53 N 2 N'), null)
  assert.equal(parseCoordinatePair('91 N 2 W'), null)
})
