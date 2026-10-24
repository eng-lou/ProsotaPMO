const { test } = require('node:test')
const assert = require('node:assert/strict')
const { authenticate, validCallback } = require('../auth.cjs')
const { EventEmitter } = require('node:events')
const http = require('node:http')
const crypto = require('node:crypto')

test('browser sign-in completes loopback callback and PKCE exchange', async () => {
  const original = global.fetch
  let challenge, sentToBrowser, exchanged = false, prompts = 0
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {} }
    setMenu() {} async loadURL() {} isDestroyed() { return false } destroy() { this.emit('closed') }
  }
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://www.prosota.com/api/v1/desktop-auth/exchange')
    const data = JSON.parse(options.body)
    assert.equal(crypto.createHash('sha256').update(data.verifier).digest('base64url'), challenge)
    assert.equal(data.code, 'c'.repeat(43)); exchanged = true
    return { ok: true, status: 200, json: async () => ({ token: 't'.repeat(43), user: { sub: 'auth0|owner' } }) }
  }
  try {
    const config = { provider: 'off' }
    const user = await authenticate(config, () => {}, {
      dialog: { showMessageBox: async options => { if (prompts++) throw new Error(options.detail); return { response: 0 } } }, BrowserWindow: Window,
      shell: { openExternal: async target => {
        const url = new URL(target); sentToBrowser = url
        challenge = url.searchParams.get('challenge')
        const callback = new URL(url.searchParams.get('callback'))
        callback.search = new URLSearchParams({ state: url.searchParams.get('state'), code: 'c'.repeat(43) })
        await new Promise((resolve, reject) => {
          http.get(callback, response => { response.resume(); response.on('end', resolve) }).on('error', reject)
        })
      } },
    })
    assert.equal(sentToBrowser.origin, 'https://www.prosota.com')
    assert.equal(sentToBrowser.pathname, '/desktop-signin')
    assert.equal(user.sub, 'auth0|owner'); assert.equal(exchanged, true)
    assert.equal(config.desktopToken, 't'.repeat(43))
  } finally { global.fetch = original }
})
test('callback requires exact state, path and one-time code shape', () => {
  const code = 'a'.repeat(43), state = 'b'.repeat(43)
  assert.equal(validCallback(new URL(`http://127.0.0.1/callback?state=${state}&code=${code}`), state), true)
  for (const suffix of [`/callback?state=wrong&code=${code}`, `/other?state=${state}&code=${code}`, `/callback?state=${state}&code=bad`]) {
    assert.equal(validCallback(new URL('http://127.0.0.1' + suffix), state), false)
  }
})
test('approved saved session is checked online and retains workspace settings', async () => {
  const original = global.fetch
  const config = { desktopToken: 'a'.repeat(43), provider: 'off', googleMapsKey: 'keep' }
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ user: { sub: 'auth0|owner', name: 'Owner' } }) })
  try {
    const user = await authenticate(config, () => {}, {})
    assert.equal(user.sub, 'auth0|owner'); assert.equal(config.workspaceOwner, user.sub)
    assert.equal(config.googleMapsKey, 'keep')
  } finally { global.fetch = original }
})
test('denied or offline access never opens workspace', async () => {
  const original = global.fetch
  try {
    for (const status of [401, 403, 503]) {
      const config = { desktopToken: 'a'.repeat(43), workspaceOwner: 'auth0|owner' }
      global.fetch = async () => ({ ok: false, status })
      const user = await authenticate(config, () => {}, { dialog: { showMessageBox: async options => ({ response: options.cancelId }) } })
      assert.equal(user, null)
      if (status !== 503) assert.equal(config.desktopToken, undefined)
      assert.equal(config.workspaceOwner, 'auth0|owner')
    }
  } finally { global.fetch = original }
})
