const { app, BrowserWindow } = require('electron')
const fs = require('fs'), path = require('path'), http = require('http')
const { build } = require('../../frontend/node_modules/esbuild')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const root = path.resolve(__dirname, '../..')
app.setPath('userData', path.join(root, 'desktop/.test-data/callouts'))
app.whenReady().then(async () => {
  let server, win
  try {
    const bundle = await build({ entryPoints: [path.join(__dirname, 'callouts.fixture.tsx')], bundle: true, write: false, format: 'iife', tsconfig: path.join(root, 'frontend/tsconfig.json'), nodePaths: [path.join(root, 'frontend/node_modules')], plugins: [{ name: 'media', setup(b) {
      b.onResolve({ filter: /^@\/lib\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const api = {}; export async function downloadLargeBlob(url){return window.mediaBlobs.get(url.split("/").at(-2))}' }))
    } }] })
    server = http.createServer((req, res) => { if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text) } else res.end('<body style="margin:0;background:#24364d;color:white;font-family:system-ui"><h2>Prosota callout checks</h2><div id="app" style="width:700px;height:420px"></div><div id="results" style="display:flex;gap:12px"></div><script src="/bundle.js"></script></body>') })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { backgroundThrottling: false } })
    win.webContents.on('console-message', e => { if (e.level === 'error') console.error(e.message) })
    win.showInactive()
    await win.loadURL('http://127.0.0.1:' + server.address().port)
    console.log(await win.webContents.executeJavaScript('run()'))
    fs.writeFileSync(path.join(root, 'outputs/callout-preview.png'), (await win.webContents.capturePage()).toPNG())
    const reference = await win.webContents.executeJavaScript('window.referencePng'); if (reference) fs.writeFileSync(path.join(root, 'outputs/sign-callout-reference.png'), Buffer.from(reference.split(',')[1], 'base64'))
    server.close(); app.exit(0)
  } catch (e) { console.error(e); if (win) fs.writeFileSync(path.join(root, 'outputs/callout-failure.png'), (await win.webContents.capturePage()).toPNG()); server?.close(); app.exit(1) }
})
