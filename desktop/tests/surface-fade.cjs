const assert = require('node:assert/strict')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { build } = require('../../frontend/node_modules/esbuild')

const frontend = path.resolve(__dirname, '../../frontend')
app.setPath('userData', path.resolve(__dirname, '../.test-data/surface-fade-qa'))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  let status = 0
  try {
    const { outputFiles } = await build({
      entryPoints: [path.join(__dirname, 'surface-fade.fixture.ts')],
      tsconfig: path.join(frontend, 'tsconfig.json'),
      nodePaths: [path.join(frontend, 'node_modules')],
      bundle: true, write: false, format: 'iife', globalName: 'fadeTest',
    })
    await window.loadURL('about:blank')
    const results = await window.webContents.executeJavaScript(outputFiles[0].text + '\nfadeTest.measure()')
    for (const result of results) {
      console.log(result)
      assert.equal(result.backgroundLeaks, 0, 'Solid soil must keep the framebuffer opaque')
      assert.ok(result.transitionLevels > 20, 'The edge must include a gradual alpha transition')
      assert.ok(result.maxChannelError < 4, 'The edge colour must blend gravel with the underlying soil')
      assert.equal(result.centreAlpha, 255)
      assert.equal(result.outsideAlpha, 0)
    }
  } catch (error) {
    console.error(error)
    status = 1
  } finally {
    window.destroy()
    app.exit(status)
  }
})
