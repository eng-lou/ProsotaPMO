const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const cloud = 'https://www.prosota.com'
async function request(endpoint, body) {
  const response = await fetch(`${cloud}/api/v1/desktop-auth/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000), redirect: 'error',
  })
  if (!response.ok) {
    const error = new Error(response.status === 403 ? 'Your account is not approved. Sign in to request access.'
      : response.status === 401 ? 'Your sign-in has expired.' : 'Prosota sign-in is unavailable. Please try again shortly.')
    error.status = response.status
    throw error
  }
  return response.status === 204 ? null : response.json()
}
function validCallback(url, state) {
  return url.pathname === '/callback' && url.searchParams.get('state') === state &&
    /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code') || '')
}
async function browserSignIn(shell, BrowserWindow) {
  const state = crypto.randomBytes(32).toString('base64url')
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  let server, window, timeout
  try {
    const code = await new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1')
        if (req.method !== 'GET' || !validCallback(url, state)) {
          res.writeHead(400); res.end('Invalid sign-in request.'); return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer' })
        res.end('<title>Prosota Planner Desktop</title><h2>Returning to Prosota Planner Desktop…</h2><p>You can close this browser tab.</p>')
        resolve(url.searchParams.get('code'))
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', async () => {
        try {
          const url = new URL('/desktop-signin', cloud)
          url.search = new URLSearchParams({ callback: `http://127.0.0.1:${server.address().port}/callback`, state, challenge })
          window = new BrowserWindow({ icon: path.join(__dirname, 'assets/prosota.ico'), width: 490, height: 280, resizable: false, title: 'Prosota Planner Desktop · Sign in',
            webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
          window.setMenu(null)
          window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
          window.webContents.on('will-navigate', event => event.preventDefault())
          window.on('closed', () => reject(new Error('Sign-in cancelled.')))
          await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><body style="font:16px system-ui;padding:30px;color:#18243c"><h2>Finish signing in</h2><p>Continue in your browser. If you need approval, submit your access request there.</p><p>Close this window to cancel.</p></body>'))
          await shell.openExternal(url.href)
        } catch (error) { reject(error) }
      })
      timeout = setTimeout(() => reject(new Error('Sign-in timed out. Please try again.')), 10 * 60 * 1000)
    })
    return await request('exchange', { code, verifier })
  } finally {
    clearTimeout(timeout); server?.close()
    if (window && !window.isDestroyed()) window.destroy()
  }
}
async function authenticate(config, save, electron) {
  let message = 'Sign in with your Prosota account. Google and other enabled sign-in options open securely in your browser.'
  for (;;) {
    if (config.desktopToken) {
      try {
        const result = await request('session', { token: config.desktopToken })
        if (!config.workspaceOwner || config.workspaceOwner === result.user.sub) {
          config.workspaceOwner = result.user.sub; save(config); return result.user
        }
        delete config.desktopToken; save(config)
        message = 'This local workspace belongs to another account. Use its original account or a separate Windows user profile.'
      } catch (error) {
        message = error.status ? error.message : 'An internet connection is needed to verify access. Your local projects are safe. Retry when connected.'
        if ([401, 403].includes(error.status)) { delete config.desktopToken; save(config) }
      }
    }
    const answer = await electron.dialog.showMessageBox({ title: 'Prosota Planner Desktop', type: 'info',
      message: 'Welcome to Prosota Planner', detail: message,
      buttons: config.desktopToken ? ['Retry', 'Sign in again', 'Exit'] : ['Sign in / Request access', 'Exit'],
      defaultId: 0, cancelId: config.desktopToken ? 2 : 1 })
    if (answer.response === (config.desktopToken ? 2 : 1)) return null
    if (config.desktopToken && answer.response === 0) continue
    try {
      const result = await browserSignIn(electron.shell, electron.BrowserWindow)
      if (config.workspaceOwner && config.workspaceOwner !== result.user.sub) {
        await request('logout', { token: result.token }).catch(() => {})
        message = 'This workspace belongs to another account. Sign in with its original account or use a separate Windows user profile.'
        continue
      }
      config.desktopToken = result.token; config.workspaceOwner = result.user.sub
      save(config); return result.user
    } catch (error) { message = error.message || 'Could not sign in. Please try again.' }
  }
}
module.exports = { authenticate, request, validCallback }
