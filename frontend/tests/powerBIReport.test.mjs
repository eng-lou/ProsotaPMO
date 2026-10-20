import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { build } from 'esbuild'
import JSZip from 'jszip'

const { outputFiles } = await build({
  entryPoints: ['src/lib/powerBIReport.ts'], bundle: true, write: false,
  platform: 'browser', format: 'esm',
})
const { buildPowerBIReport } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const template = await readFile('public/powerbi/prosota-template-1.2.0.zip')
test('web report preserves complete IFC snapshot and includes the installed visual without local caches', async () => {
  const bytes = new TextEncoder().encode("ISO-10303-21;\nDATA;\n/* model, schedule and resource snapshot */\nENDSEC;")
  const blob = await buildPowerBIReport("Owner's model.ifc", bytes, template)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.ok(zip.file('Prosota.pbip'))
  assert.ok(zip.file('START HERE.txt'))
  assert.equal(Object.keys(zip.files).some(p => p.includes('/.pbi/')), false)
  const visualPath = Object.keys(zip.files).find(p => p.endsWith('/visual.json'))
  const visual = JSON.parse(await zip.file(visualPath).async('string')).visual
  const snapshot = visual.objects.prosotaSnapshot[0].properties
  const payload = snapshot.data.expr.Literal.Value.slice(1, -1)
  assert.deepEqual(gunzipSync(Buffer.from(payload, 'base64')), Buffer.from(bytes))
  assert.equal(snapshot.name.expr.Literal.Value, "'Owner''s model.ifc'")
  assert.ok(zip.file(`Prosota.Report/CustomVisuals/${visual.visualType}/resources/${visual.visualType}.pbiviz.json`))
  const original = await JSZip.loadAsync(template)
  const path = 'Prosota.Report/.platform'
  assert.notEqual(JSON.parse(await zip.file(path).async('string')).config.logicalId,
    JSON.parse(await original.file(path).async('string')).config.logicalId)
})
test('invalid IFC and a template without the visual are rejected', async () => {
  await assert.rejects(buildPowerBIReport('bad.ifc', new Uint8Array([1]), template), /IFC STEP/)
  const empty = await new JSZip().generateAsync({ type: 'uint8array' })
  await assert.rejects(buildPowerBIReport('test.ifc', new TextEncoder().encode('ISO-10303-21;'), empty), /missing its visual/)
})
