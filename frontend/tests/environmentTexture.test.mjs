import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { DataTexture, FloatType, HalfFloatType, RGBAFormat, EquirectangularReflectionMapping } from 'three'
import { EXRExporter } from 'three/examples/jsm/exporters/EXRExporter.js'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/modules/fourD/environmentTexture.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm',
})
const { readEnvironmentTexture } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

test('decodes uploaded HDR and EXR into environment textures with local file access alone', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('URL loading disabled') })
  const hdr = new File(['#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n',
    Uint8Array.of(128, 64, 32, 129, 32, 64, 128, 129)], 'Panorama.HDR')
  const source = new DataTexture(Float32Array.of(1, 0, 0, 1, 0, 0, 1, 1), 2, 1, RGBAFormat, FloatType)
  const exr = new File([await new EXRExporter().parse(source, { compression: 0 })], 'Panorama.EXR')
  for (const file of [hdr, exr]) {
    const texture = await readEnvironmentTexture(file)
    assert.equal(texture.name, file.name)
    assert.equal(texture.type, HalfFloatType)
    assert.equal(texture.mapping, EquirectangularReflectionMapping)
    assert.equal(texture.flipY, file === hdr)
    assert.equal(texture.image.width, 2)
    assert.equal(texture.image.height, 1)
    assert.ok(texture.image.data[0] > texture.image.data[2])
    assert.ok(texture.image.data[4] < texture.image.data[6])
    texture.dispose()
  }
  source.dispose()
})

test('unreadable files report the filename and reason before replacing a saved environment', async () => {
  await assert.rejects(readEnvironmentTexture(new File(['not a panorama'], 'broken.hdr')), /Could not open broken\.hdr\. .+/)
  await assert.rejects(readEnvironmentTexture(new File([], 'empty.exr')), /Could not open empty\.exr\. .+/)
})
