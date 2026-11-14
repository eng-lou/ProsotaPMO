import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const { outputFiles } = await build({ stdin: { contents: "export * from './src/modules/projects/projectTransfer'", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', plugins: [{ name: 'api-stub', setup(b) { b.onResolve({ filter: /^@\/lib\/api$/ }, () => ({ path: 'api', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const api = {}' })) } }] })
const { inspectProjectPackage, verifyProjectFiles, readProjectFolder } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
const sample = () => ({ format: 'prosota-project', version: 1, records: { projects: [{ name: 'Tower' }], activities: [{ code: 'T-4' }] }, files: [{ key: 'model3d/fort.ifc', path: 'files/00000', size: 1024 }] })

test('accepts a native project and checks every source file before upload', () => {
  const data = inspectProjectPackage(sample())
  verifyProjectFiles(data, new Map([['files/00000', { size: 1024 }]]))
  assert.throws(() => verifyProjectFiles(data, new Map()), /incomplete/)
  assert.throws(() => verifyProjectFiles(data, new Map([['files/00000', { size: 20 }]])), /changed/)
})
test('rejects wrong formats, unsupported versions, paths and duplicate entries', () => {
  for (const data of [{ format: 'prosota-desktop-backup' }, { ...sample(), version: 2 }, { ...sample(), files: [{ path: '../private', size: 3 }] }, { ...sample(), files: [...sample().files, ...sample().files] }]) {
    assert.throws(() => inspectProjectPackage(data))
  }
})
test('finds the manifest and resolves paths relative to its folder', () => {
  const manifest = { name: 'project.prosota.json', webkitRelativePath: 'Tower/project.prosota.json', size: 200 }
  const model = { name: '00000', webkitRelativePath: 'Tower/files/00000', size: 1024 }
  const result = readProjectFolder([manifest, model])
  assert.equal(result.manifest, manifest)
  assert.equal(result.byPath.get('files/00000'), model)
  assert.throws(() => readProjectFolder([model]), /containing/)
  assert.throws(() => readProjectFolder([manifest, { ...manifest, webkitRelativePath: 'Another/project.prosota.json' }]), /one exported project/)
})
