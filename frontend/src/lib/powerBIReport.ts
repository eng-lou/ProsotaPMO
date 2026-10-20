import JSZip from 'jszip'

const VISUAL = 'prosotaPowerBI06AB2DAB71384B63AC389556E181B50B'
const literal = (value: string) => ({ expr: { Literal: { Value: `'${value.split("'").join("''")}'` } } })

/** Package a local report snapshot; no project data is sent to Microsoft. */
export async function buildPowerBIReport(name: string, bytes: Uint8Array, template: ArrayBuffer): Promise<Blob> {
  if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('Power BI snapshots support IFC files up to 256 MB.')
  if (!new TextDecoder().decode(bytes.slice(0, 65536)).includes('ISO-10303-21;')) throw new Error('Expected an IFC STEP snapshot.')
  const zip = await JSZip.loadAsync(template)
  const compressed = new Uint8Array(await new Response(
    new Blob([bytes.slice().buffer]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer())
  let binary = ''
  for (let i = 0; i < compressed.length; i += 8192) binary += String.fromCharCode(...compressed.subarray(i, i + 8192))
  const data = btoa(binary)
  let found = false
  for (const [path, entry] of Object.entries(zip.files)) {
    if (path.split('/').includes('.pbi')) { zip.remove(path); continue }
    if (!path.endsWith('/visual.json')) continue
    const visual = JSON.parse(await entry.async('string'))
    if (visual.visual?.visualType !== VISUAL) continue
    visual.visual.objects = { ...visual.visual.objects, prosotaSnapshot: [{ properties: {
      data: literal(data), name: literal(name.slice(0, 200)),
    } }] }
    zip.file(path, JSON.stringify(visual))
    found = true
  }
  if (!found) throw new Error('The Power BI template is missing its visual.')
  for (const kind of ['Report', 'SemanticModel']) {
    const path = `Prosota.${kind}/.platform`
    const platform = JSON.parse(await zip.file(path)!.async('string'))
    platform.config.logicalId = crypto.randomUUID()
    platform.metadata.displayName = name.replace(/\.ifc$/i, '').slice(0, 100)
    zip.file(path, JSON.stringify(platform))
  }
  zip.file('START HERE.txt', 'Extract this entire ZIP into a folder, then open Prosota.pbip in Microsoft Power BI Desktop for Windows.\r\nEnable Power BI Project (.pbip) support in Desktop if prompted.\r\nThe Prosota visual and IFC snapshot are included. Keep the report folders together.\r\nThis report contains model and project data. Share it only with intended recipients.\r\nThis is a snapshot; export again to refresh it.\r\n')
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } })
}

export async function downloadPowerBITemplate(): Promise<ArrayBuffer> {
  const response = await fetch('/powerbi/prosota-template-1.2.0.zip')
  if (!response.ok) throw new Error('Could not download the Power BI template. Please retry.')
  return response.arrayBuffer()
}
