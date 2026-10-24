const { app, BrowserWindow, Menu, ipcMain, safeStorage, dialog, shell, session } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const { updateSettings, publicSettings } = require('./settings.cjs')
const { createReport } = require('./powerbi.cjs')
const { authenticate, request: authRequest } = require('./auth.cjs')

app.setName('Prosota Desktop Preview')
app.setAppUserModelId('com.prosota.desktop.preview')
app.setPath('userData', path.join(app.getPath('appData'), 'Prosota Desktop Preview'))
if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(start).catch(async () => {
  dialog.showErrorBox('Prosota Desktop could not start', 'The local services could not start. Check backend.log and postgres.log in the desktop data folder. Your saved projects have not been removed.')
  app.quit()
})

let child, mainWindow, settingsWindow, origin, token, config, signedInUser, authenticating = true, quitting = false, maintaining = false
const dataDir = app.getPath('userData')
const secretFile = path.join(dataDir, 'connections.encrypted')

function save(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.')
  fs.writeFileSync(secretFile + '.tmp', safeStorage.encryptString(JSON.stringify(value)))
  fs.renameSync(secretFile + '.tmp', secretFile)
}
function trustedSettings(event) {
  if (!settingsWindow || event.sender !== settingsWindow.webContents ||
      event.senderFrame !== settingsWindow.webContents.mainFrame ||
      event.senderFrame.url !== `${origin}/desktop-settings.html`) throw new Error('Invalid settings request')
}
function trustedMain(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== origin) throw new Error('Invalid desktop request')
}
async function maintain(action) {
  if (maintaining) throw new Error('A workspace operation is already running.')
  const selection = action === 'backup'
    ? await dialog.showSaveDialog(settingsWindow, { title: 'Create portable backup',
      defaultPath: `Prosota-${new Date().toISOString().slice(0, 10)}.prosota-backup`,
      filters: [{ name: 'Prosota backup', extensions: ['prosota-backup'] }] })
    : await dialog.showOpenDialog(settingsWindow, { title: 'Restore a trusted Prosota backup',
      properties: ['openFile'], filters: [{ name: 'Prosota backup', extensions: ['prosota-backup'] }] })
  const filename = selection.filePath || selection.filePaths?.[0]
  if (selection.canceled || !filename) return 'Cancelled.'
  const answer = await dialog.showMessageBox(settingsWindow, {
    type: 'question', buttons: [action === 'backup' ? 'Back up and restart' : 'Restore and restart', 'Cancel'],
    defaultId: 1, cancelId: 1,
    message: action === 'backup' ? 'Save your current edits before continuing.' : 'Replace this workspace with the selected backup?',
    detail: action === 'backup' ? 'Prosota will pause local services, create the backup, then restart.'
      : 'Only restore backups you trust. The current workspace is retained in a recovery folder. API keys stay unchanged. Unsaved edits will be lost.',
  })
  if (answer.response !== 0) return 'Cancelled.'
  maintaining = true
  mainWindow.hide()
  try {
    const stopped = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local services did not stop. Restart before trying again.')), 60000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    child.stdin.end()
    await stopped
    const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'runtime')
    const log = fs.openSync(path.join(dataDir, 'maintenance.log'), 'a')
    const job = spawn(path.join(resources, 'backend', 'prosota-backend.exe'), [], {
      cwd: dataDir, windowsHide: true, stdio: ['pipe', log, log],
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: process.env.SystemRoot + '\\System32' },
    })
    fs.closeSync(log)
    await new Promise((resolve, reject) => {
      job.on('error', reject)
      job.stdin.on('error', reject)
      job.on('exit', code => code === 0 ? resolve() : reject(new Error('Workspace operation failed. See maintenance.log. The original workspace is retained.')))
      job.stdin.end(JSON.stringify({ dataDir, dbPassword: config.dbPassword,
        postgresDir: path.join(resources, 'postgres'), maintenance: action, backupPath: filename }) + '\n')
    })
    await dialog.showMessageBox(settingsWindow, { message: action === 'backup' ? 'Backup created.' : 'Workspace restored.', detail: 'Prosota will now restart.' })
  } catch (error) {
    await dialog.showMessageBox(settingsWindow, { type: 'error', message: error.message, detail: 'Prosota will restart using the available workspace.' })
  } finally {
    app.relaunch()
    app.quit()
  }
  return 'Restarting…'
}
async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}
function makeWindow(options) {
  const win = new BrowserWindow({ icon: path.join(__dirname, 'assets/prosota.ico'), ...options, webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
    sandbox: true, nodeIntegration: false, webSecurity: true,
  } })
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Existing report/print flows create a blank or local blob window.
    if (url === 'about:blank' || (url.startsWith('blob:') && new URL(url).origin === origin)) {
      return { action: 'allow', overrideBrowserWindowOptions: { icon: path.join(__dirname, 'assets/prosota.ico'), webPreferences: {
        contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      } } }
    }
    return { action: 'deny' }
  })
  win.webContents.on('did-create-window', childWindow => {
    childWindow.webContents.on('will-navigate', (event, url) => {
      if (url !== 'about:blank' && new URL(url).origin !== origin) event.preventDefault()
    })
    childWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
  return win
}
function openSettings() {
  if (settingsWindow) return settingsWindow.focus()
  settingsWindow = makeWindow({ width: 690, height: 840, parent: mainWindow, title: 'Prosota Desktop · Settings' })
  settingsWindow.on('closed', () => { settingsWindow = null })
  settingsWindow.loadURL(`${origin}/desktop-settings.html`)
}
async function start() {
  fs.mkdirSync(dataDir, { recursive: true })
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption unavailable')
  config = fs.existsSync(secretFile)
    ? JSON.parse(safeStorage.decryptString(fs.readFileSync(secretFile)))
    : { provider: 'off', model: '', dbPassword: crypto.randomBytes(32).toString('hex') }
  signedInUser = await authenticate(config, save, { dialog, shell, BrowserWindow })
  if (!signedInUser) { app.quit(); return }
  authenticating = false
  ipcMain.handle('desktop:identity', event => { trustedMain(event); return signedInUser })
  ipcMain.handle('desktop:logout', async event => {
    trustedMain(event)
    const oldToken = config.desktopToken
    delete config.desktopToken
    save(config)
    await authRequest('logout', { token: oldToken }).catch(() => {})
    app.relaunch(); app.quit()
  })
  const port = config.apiPort || await unusedPort()
  config.apiPort = port
  save(config)
  origin = `http://127.0.0.1:${port}`
  token = crypto.randomBytes(32).toString('hex')
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  // Authenticate local requests in the main process. The renderer never gets
  // the session secret, Windows APIs, filesystem APIs or stored provider keys.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (new URL(details.url).origin === origin) details.requestHeaders['X-Prosota-Desktop'] = token
    callback({ requestHeaders: details.requestHeaders })
  })
  const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'runtime')
  const executable = path.join(resources, 'backend', 'prosota-backend.exe')
  const version = require('./package.json').version
  if (config.lastRunVersion !== version && fs.existsSync(path.join(dataDir, 'database', 'PG_VERSION'))) {
    // Back up BEFORE a new build can migrate the database. Never prune these
    // recovery snapshots automatically.
    const backupPath = path.join(path.dirname(dataDir), path.basename(dataDir) + ' Backups',
      `before-${version}-${Date.now()}.prosota-backup`)
    const backupLog = fs.openSync(path.join(dataDir, 'maintenance.log'), 'a')
    const backupJob = spawn(executable, [], { cwd: dataDir, windowsHide: true, stdio: ['pipe', backupLog, backupLog],
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP,
        TMP: process.env.TMP, PATH: process.env.SystemRoot + '\\System32' } })
    fs.closeSync(backupLog)
    await new Promise((resolve, reject) => {
      backupJob.on('error', reject)
      backupJob.stdin.on('error', reject)
      backupJob.on('exit', code => code === 0 ? resolve() : reject(new Error('Pre-update backup failed')))
      backupJob.stdin.end(JSON.stringify({ dataDir, dbPassword: config.dbPassword,
        postgresDir: path.join(resources, 'postgres'), maintenance: 'backup', backupPath }) + '\n')
    })
  }
  const log = fs.openSync(path.join(dataDir, 'backend.log'), 'a')
  child = spawn(executable, [], {
    cwd: dataDir, windowsHide: true, stdio: ['pipe', log, log],
    // Do not inherit development/production API keys or connection settings.
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: process.env.SystemRoot + '\\System32',
      USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA },
  })
  fs.closeSync(log)
  let failed = false
  child.on('error', () => { failed = true })
  child.on('exit', () => {
    failed = true
    if (mainWindow && !quitting && !maintaining) {
      dialog.showErrorBox('Local service stopped', 'Close and reopen Prosota Desktop to reconnect. See backend.log for details.')
      app.quit()
    }
  })
  child.stdin.on('error', () => { failed = true })
  child.stdin.write(JSON.stringify({
    port, origin, token, dataDir, dbPassword: config.dbPassword, ai: config,
    identity: signedInUser,
    postgresDir: path.join(resources, 'postgres'),
    uiDir: app.isPackaged ? path.join(resources, 'ui') : path.join(__dirname, 'dist'),
  }) + '\n')
  let ready = false
  for (let attempt = 0; attempt < 240 && !failed; attempt++) {
    try {
      const response = await fetch(`${origin}/health`, {
        headers: { 'X-Prosota-Desktop': token }, signal: AbortSignal.timeout(1000),
      })
      if (response.ok) { ready = true; break }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!ready) throw new Error('Local backend startup failed')
  config.lastRunVersion = version
  save(config)
  ipcMain.handle('desktop:open-settings', event => { trustedMain(event); openSettings() })
  ipcMain.handle('desktop:backup', event => { trustedSettings(event); return maintain('backup') })
  ipcMain.handle('desktop:restore', event => { trustedSettings(event); return maintain('restore') })
  ipcMain.handle('desktop:powerbi', async (event, name, bytes) => {
    trustedMain(event)
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error('Invalid IFC payload')
    const template = app.isPackaged ? path.join(process.resourcesPath, 'powerbi-template') : path.join(__dirname, 'powerbi-template')
    const report = createReport(template, path.join(dataDir, 'Power BI reports'), name, bytes)
    const error = await shell.openPath(report)
    if (error) {
      shell.showItemInFolder(report)
      throw new Error('Report prepared. Install Power BI Desktop with PBIP support, then open Prosota.pbip from the folder shown.')
    }
    return report
  })
  ipcMain.handle('desktop:settings', event => { trustedSettings(event); return publicSettings(config) })
  ipcMain.handle('desktop:save-settings', async (event, input) => {
    trustedSettings(event)
    const updated = updateSettings(config, input)
    const response = await fetch(`${origin}/desktop-config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Prosota-Desktop': token },
      body: JSON.stringify(updated), signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error('The local service could not update the connection.')
    save(updated)
    config = updated
    return publicSettings(config)
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Prosota Desktop', submenu: [
      { label: 'Settings…', click: openSettings },
      { label: 'Open local data folder', click: () => shell.openPath(dataDir) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]))
  mainWindow = makeWindow({ width: 1440, height: 940, title: 'Prosota Desktop Preview · Local workspace' })
  mainWindow.webContents.on('page-title-updated', event => event.preventDefault())
  await mainWindow.loadURL(origin)
  mainWindow.on('closed', () => { mainWindow = null })
}
app.on('second-instance', () => { if (mainWindow) { mainWindow.restore(); mainWindow.focus() } })
app.on('window-all-closed', () => { if (!authenticating) app.quit() })
app.on('before-quit', event => {
  if (!child || child.exitCode !== null || quitting) return
  event.preventDefault()
  quitting = true
  child.once('exit', () => app.quit())
  child.stdin.end()
})
