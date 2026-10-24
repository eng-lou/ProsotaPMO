// Reopen the disposable UI-test workspace as an older version.
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const desktop = path.resolve(__dirname, '..')
const result = JSON.parse(fs.readFileSync(path.join(desktop, '.test-data/ui-result.json')))
if (!result.passed) throw Error('Run the UI smoke test first.')
const data = path.resolve(result.testData)
if (!data.startsWith(path.join(desktop, '.test-data') + path.sep)) throw Error('Invalid test workspace')
const originalSetPath = app.setPath.bind(app)
app.setPath = (key, value) => originalSetPath(key, key === 'userData' ? data : value)
app.whenReady().then(() => {
  const file = path.join(data, 'connections.encrypted')
  const settings = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
  settings.lastRunVersion = '0.1.0'
  fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(settings)))
})
app.on('web-contents-created', (_event, contents) => {
  contents.once('did-finish-load', async () => {
    try {
      const projects = await contents.executeJavaScript(`fetch('/api/v1/projects/').then(r=>r.json())`)
      if (!projects.some(p => p.name === 'Desktop UI smoke')) throw Error('Project did not survive update')
      const backups = fs.readdirSync(data + ' Backups').filter(name => name.endsWith('.prosota-backup'))
      if (!backups.length) throw Error('Upgrade did not create a recovery backup')
      const settings = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(data, 'connections.encrypted'))))
      if (settings.lastRunVersion !== require('../package.json').version) throw Error('Version was not recorded')
      fs.writeFileSync(path.join(desktop, '.test-data/upgrade-result.json'), JSON.stringify({ passed: true, data, backups }))
      console.log('PASS: new version backs up the old workspace before startup and preserves projects.')
    } catch (error) {
      fs.writeFileSync(path.join(desktop, '.test-data/upgrade-result.json'), JSON.stringify({ passed: false, error: error.message }))
      console.error(error)
    } finally { app.quit() }
  })
})
require('../auth.cjs').authenticate = async () => ({ sub: 'test|owner', name: 'UI test', email: 'test@example.invalid', is_super_user: true })
require('../main.cjs')
