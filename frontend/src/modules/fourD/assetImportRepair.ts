// Repair only information supplied by the user; never infer an opacity mask from colour.
export function readAssetGlb(bytes: ArrayBuffer) {
  const v = new DataView(bytes)
  if (bytes.byteLength < 28 || bytes.byteLength > 512 * 1024 * 1024 || v.getUint32(0, true) !== 0x46546c67 || v.getUint32(4, true) !== 2 || v.getUint32(8, true) !== bytes.byteLength) throw Error('Choose a self-contained GLB under 512 MB')
  const n = v.getUint32(12, true), end = 20 + n
  if (v.getUint32(16, true) !== 0x4e4f534a || end + 8 > bytes.byteLength || v.getUint32(end + 4, true) !== 0x004e4942 || end + 8 + v.getUint32(end, true) !== bytes.byteLength) throw Error('Invalid GLB chunks')
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, n)))
  if ([...(json.buffers || []), ...(json.images || [])].some(e => e.uri) || json.extensionsRequired?.length) throw Error('Use an embedded, uncompressed GLB without required extensions')
  return { json, binary: new Uint8Array(bytes.slice(end + 8)) }
}

export function inspectAssetMaterials(bytes: ArrayBuffer) {
  const { json } = readAssetGlb(bytes)
  return (json.materials || []).map((m: any, index: number) => ({
    index, name: m.name || `Material ${index + 1}`,
    invisible: (m.alphaMode === 'MASK' || m.alphaMode === 'BLEND') && m.pbrMetallicRoughness?.baseColorFactor?.[3] === 0,
    textured: m.pbrMetallicRoughness?.baseColorTexture !== undefined,
    cutout: m.alphaMode === 'MASK',
  })) as { index: number; name: string; invisible: boolean; textured: boolean; cutout: boolean }[]
}

export function embedAssetCutout(bytes: ArrayBuffer, materialIndex: number, png: Uint8Array) {
  const { json, binary } = readAssetGlb(bytes)
  const m = json.materials?.[materialIndex]
  if (!m) throw Error('Material no longer exists')
  const pbr = m.pbrMetallicRoughness ||= {}
  const previous = pbr.baseColorTexture
  const texture = previous ? json.textures[previous.index] : {}
  // Separate UV transforms cannot be guessed; preserve the colour texture coordinates.
  const offset = Math.ceil(binary.length / 4) * 4
  const payload = new Uint8Array(Math.ceil((offset + png.length) / 4) * 4)
  payload.set(binary); payload.set(png, offset)
  json.bufferViews ||= []; json.images ||= []; json.textures ||= []
  const view = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length }) - 1
  const image = json.images.push({ bufferView: view, mimeType: 'image/png', name: `${m.name || 'Material'} cutout` }) - 1
  const index = json.textures.push({ ...(texture.sampler !== undefined ? { sampler: texture.sampler } : {}), source: image }) - 1
  pbr.baseColorTexture = { ...previous, index }
  if (pbr.baseColorFactor) pbr.baseColorFactor[3] = 1
  m.alphaMode = 'MASK'; m.alphaCutoff = .5
  json.buffers[0].byteLength = payload.length
  return writeAssetGlb(json, payload)
}

function writeAssetGlb(json: any, binary: Uint8Array) {
  const encoded = new TextEncoder().encode(JSON.stringify(json)), n = Math.ceil(encoded.length / 4) * 4
  const result = new ArrayBuffer(28 + n + binary.length), v = new DataView(result), out = new Uint8Array(result)
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, result.byteLength, true)
  v.setUint32(12, n, true); v.setUint32(16, 0x4e4f534a, true)
  out.fill(32, 20, 20 + n); out.set(encoded, 20)
  v.setUint32(20 + n, binary.length, true); v.setUint32(24 + n, 0x004e4942, true); out.set(binary, 28 + n)
  return result
}

export function restoreAssetOpacity(bytes: ArrayBuffer, index: number) {
  const { json, binary } = readAssetGlb(bytes)
  const m = json.materials?.[index]
  if (!m?.pbrMetallicRoughness?.baseColorFactor) throw Error('No opacity factor to restore')
  m.pbrMetallicRoughness.baseColorFactor[3] = 1
  return writeAssetGlb(json, binary)
}

export async function applyAssetOpacityMask(bytes: ArrayBuffer, index: number, file: File) {
  if (file.size > 20 * 1024 * 1024) throw Error('Opacity image must be under 20 MB')
  const { json, binary } = readAssetGlb(bytes), m = json.materials[index]
  const info = m?.pbrMetallicRoughness?.baseColorTexture
  if (!info) throw Error('This material has no colour texture. Bake its Blender material before importing.')
  const source = json.images[json.textures[info.index].source], view = json.bufferViews[source.bufferView]
  const colour = await createImageBitmap(new Blob([binary.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)], { type: source.mimeType }))
  let mask: ImageBitmap | undefined
  try {
    mask = await createImageBitmap(file)
    if (colour.width * colour.height > 16_777_216) throw Error('Texture exceeds 16 megapixels')
    if (mask.width !== colour.width || mask.height !== colour.height) throw Error('Choose an opacity mask with the same dimensions and layout as the colour texture')
    const canvas = document.createElement('canvas'); canvas.width = colour.width; canvas.height = colour.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(colour, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(mask, 0, 0)
    const opacity = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 3] = Math.round((opacity[i] + opacity[i + 1] + opacity[i + 2]) / 3)
    ctx.putImageData(pixels, 0, 0)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('Could not embed opacity')), 'image/png'))
    return embedAssetCutout(bytes, index, new Uint8Array(await png.arrayBuffer()))
  } finally { colour.close(); mask?.close() }
}
