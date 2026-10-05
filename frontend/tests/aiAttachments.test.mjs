import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/aiAttachments.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'attachment-transport-stubs', setup(b) {
    b.onResolve({ filter: /^@\/lib\/(aiAssistant|directUpload)$/ }, args => ({ path: args.path, namespace: 'stub' }))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path.endsWith('aiAssistant')
      ? `export async function presignAttachment(name, type) { globalThis.attachmentCalls.push(['presign', name, type]); return {storage_key: 'ai-attachments/id.' + name.split('.').pop(), upload_url: 'https://storage.invalid/upload'} }`
      : `export async function uploadDirectToStorage(url, file, type) { globalThis.attachmentCalls.push(['upload', file.name, type]); }` }))
  } }],
})
const { prepareAttachment, POE_ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)

for (const [name, suppliedType, expectedType] of [
  ['report.pdf', '', 'application/pdf'],
  ['REPORT.PDF', 'application/octet-stream', 'application/pdf'],
  ['brief.docx', '', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['brief.DOC', 'application/octet-stream', 'application/msword'],
]) test(`uploads ${name} with canonical MIME and persistent document identity`, async () => {
  globalThis.attachmentCalls = []
  const result = await prepareAttachment(new File(['fixture'], name, { type: suppliedType }))
  assert.equal(result.kind, 'document')
  assert.equal(result.block.title, name)
  assert.equal(result.block._poeAttachmentName, name)
  assert.equal(result.block.source.type, 'storage_key')
  assert.deepEqual(globalThis.attachmentCalls, [['presign', name, expectedType], ['upload', name, expectedType]])
})
test('size and unsupported files fail before upload', async () => {
  globalThis.attachmentCalls = []
  await assert.rejects(prepareAttachment({ name: 'large.pdf', size: MAX_ATTACHMENT_BYTES + 1, type: '' }), /too large/)
  await assert.rejects(prepareAttachment(new File(['x'], 'binary.exe')), /unsupported file type/)
  assert.deepEqual(globalThis.attachmentCalls, [])
})
test('picker includes PDF and both Word extensions', () => {
  for (const extension of ['.pdf', '.doc', '.docx']) assert.ok(POE_ATTACHMENT_ACCEPT.split(',').includes(extension))
})
