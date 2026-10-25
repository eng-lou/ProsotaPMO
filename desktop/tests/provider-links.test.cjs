const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { isProviderSetupLink } = require('../provider-links.cjs')

test('all displayed provider links can open from the packaged desktop', () => {
  const files = ['../ui/desktop-settings.html', '../../frontend/src/modules/fourD/SiteContextPanel.tsx']
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    const links = [...source.matchAll(/href="(https:\/\/[^\"]+)"/g)]
    assert.ok(links.length > 0)
    for (const [, url] of links) assert.equal(isProviderSetupLink(url), true, url)
  }
  const pkg = require('../package.json')
  assert.ok(pkg.build.files.includes('provider-links.cjs'))
})

test('external navigation cannot pass secrets, custom schemes or arbitrary destinations', () => {
  for (const url of [
    'https://platform.openai.com/api-keys?key=secret',
    'https://platform.openai.com/api-keys#secret',
    'https://platform.openai.com.evil.test/api-keys',
    'https://user:secret@platform.openai.com/api-keys',
    'http://platform.openai.com/api-keys', 'file:///C:/Windows',
    'javascript:alert(1)', 'https://example.com', undefined,
  ]) assert.equal(isProviderSetupLink(url), false)
})
