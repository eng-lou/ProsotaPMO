/** Check the scene that GLTFLoader will load, rather than unused mesh definitions. */
export function gltfSceneHasGeometry(json: any): boolean {
  const pending: number[] = [...(json.scenes?.[json.scene ?? 0]?.nodes || [])]
  const visited = new Set<number>()
  while (pending.length) {
    const index = pending.pop()!
    if (visited.has(index)) continue
    visited.add(index)
    const node = json.nodes?.[index]
    if (!node) continue
    if (json.meshes?.[node.mesh]?.primitives?.some((p: any) =>
      json.accessors?.[p.attributes?.POSITION]?.count > 0)) return true
    pending.push(...(node.children || []))
  }
  return false
}

async function modelJson(file: File) {
  if (/\.gltf$/i.test(file.name)) return JSON.parse(await file.text())
  // Read metadata only: large texture/geometry buffers need not be loaded twice.
  const header = await file.slice(0, 20).arrayBuffer()
  const view = new DataView(header)
  if (header.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== file.size ||
      view.getUint32(16, true) !== 0x4e4f534a) throw Error('Invalid GLB header.')
  const length = view.getUint32(12, true)
  if (length > file.size - 20) throw Error('Invalid GLB metadata length.')
  return JSON.parse(await file.slice(20, 20 + length).text())
}

export const EMPTY_MODEL_HELP = 'Re-export from the intended visible frame in Blender with Current Frame enabled. Check the selected objects and visibility filters.'

/** Reject incomplete assemblies before conversion, material review or upload. */
export async function checkImportGeometry(files: File[]): Promise<void> {
  const empty: string[] = []
  for (const file of files) {
    if (!/\.(glb|gltf)$/i.test(file.name)) continue
    try {
      if (!gltfSceneHasGeometry(await modelJson(file))) empty.push(file.name)
    } catch (error) {
      throw Error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!empty.length) return
  const examples = empty.slice(0, 3).join('; ') + (empty.length > 3 ? `; and ${empty.length - 3} more` : '')
  throw Error(`${empty.length} of ${files.length} model files contain no mesh geometry in their exported scene: ${examples}. Import stopped to avoid an incomplete model. ${EMPTY_MODEL_HELP}`)
}
