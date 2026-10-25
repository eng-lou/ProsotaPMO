const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { channelSettings } = require('./release-channel.cjs')
const settings = channelSettings(process.argv[2])
const result = spawnSync(process.execPath, [
  path.join(__dirname, 'node_modules/electron-builder/cli.js'), '--win', 'nsis', '--x64',
  `-c.appId=${settings.appId}`, `-c.productName=${settings.title}`,
  `-c.executableName=${settings.executableName}`,
  `-c.extraMetadata.releaseChannel=${settings.channel}`,
  `-c.directories.output=release/${settings.channel}`,
  `-c.nsis.artifactName=Prosota-Planner-${settings.channel === 'stable' ? 'Stable' : 'Preview'}-` + '${version}-Setup.${ext}',
], { cwd: __dirname, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
if (result.status === 0) {
  const version = require('./package.json').version
  const label = settings.channel === 'stable' ? 'Stable' : 'Preview'
  const folder = path.join(__dirname, 'release', settings.channel)
  const file = `Prosota-Planner-${label}-${version}-Setup.exe`
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, file))).digest('hex').toUpperCase()
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8', windowsHide: true })
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: __dirname, encoding: 'utf8', windowsHide: true })
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'desktop', 'frontend', 'backend/app', 'backend/tests', 'docs', '.github'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', windowsHide: true })
  fs.writeFileSync(path.join(folder, 'release-manifest.json'), JSON.stringify({
    product: 'Prosota Planner', version, channel: settings.channel, file, sha256,
    sourceRevision: revision.status === 0 ? revision.stdout?.trim() : undefined,
    sourceDirty: status.status !== 0 || !!status.stdout?.trim() || untracked.status !== 0 || !!untracked.stdout?.trim(),
    signature: 'NotSigned',
  }, null, 2) + '\n')
}
process.exit(result.status ?? 1)
