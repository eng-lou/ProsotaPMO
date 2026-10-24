const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { gzipSync } = require('node:zlib')

function createReport(template, outputRoot, name, bytes) {
  const buffer = Buffer.from(bytes)
  if (!buffer.length || buffer.length > 256 * 1024 * 1024) throw new Error('Power BI snapshots support IFC files up to 256 MB in this preview.')
  if (!buffer.subarray(0, 65536).toString('utf8').includes('ISO-10303-21;')) throw new Error('Expected an IFC STEP snapshot.')
  // Unique export folders preserve edited reports and previous snapshots.
  const folder = path.join(outputRoot, crypto.randomUUID())
  fs.mkdirSync(folder, { recursive: true })
  fs.cpSync(template, folder, { recursive: true, filter: source => !source.split(path.sep).some(p => p === '.pbi' || p === '.git') })
  const pages = path.join(folder, 'Prosota.Report', 'definition', 'pages')
  let found = false
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.name === 'visual.json') {
        const visual = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (visual.visual?.visualType !== 'prosotaPowerBI06AB2DAB71384B63AC389556E181B50B') continue
        const literal = value => ({ expr: { Literal: { Value: "'" + value.replaceAll("'", "''") + "'" } } })
        visual.visual.objects = { ...visual.visual.objects, prosotaSnapshot: [{ properties: {
          data: literal(gzipSync(buffer).toString('base64')),
          name: literal(String(name).slice(0, 200)),
        } }] }
        fs.writeFileSync(file, JSON.stringify(visual))
        found = true
      }
    }
  }
  visit(pages)
  if (!found) throw new Error('The bundled Prosota Power BI report is missing its visual.')
  for (const kind of ['Report', 'SemanticModel']) {
    const platformFile = path.join(folder, `Prosota.${kind}`, '.platform')
    const platform = JSON.parse(fs.readFileSync(platformFile, 'utf8'))
    platform.config.logicalId = crypto.randomUUID()
    platform.metadata.displayName = String(name).replace(/\.ifc$/i, '').slice(0, 100)
    fs.writeFileSync(platformFile, JSON.stringify(platform, null, 2))
  }
  return path.join(folder, 'Prosota.pbip')
}
module.exports = { createReport }
