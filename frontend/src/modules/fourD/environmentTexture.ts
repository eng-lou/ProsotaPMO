import {
  DataTexture, EquirectangularReflectionMapping, LinearFilter, LinearSRGBColorSpace, RedFormat, RGBAFormat,
} from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'

// Read the chosen file directly. Fetching a base64 data URL for these bytes is
// blocked by Desktop's connection policy and duplicates large panoramas in memory.
export async function readEnvironmentTexture(file: File): Promise<DataTexture> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'hdr' && extension !== 'exr') throw new Error('Choose a Radiance HDR or OpenEXR file.')
  try {
    const bytes = await file.arrayBuffer()
    const loader = extension === 'hdr' ? new RGBELoader() : new EXRLoader()
    const { data, width, height, format, type, colorSpace } = loader.parse(bytes)
    if (!width || !height || data?.length !== width * height * (format === RedFormat ? 1 : 4)) {
      throw new Error('Image data is incomplete.')
    }
    const texture = new DataTexture(data, width, height, format ?? RGBAFormat, type)
    texture.name = file.name
    texture.mapping = EquirectangularReflectionMapping
    texture.colorSpace = colorSpace ?? LinearSRGBColorSpace
    texture.minFilter = texture.magFilter = LinearFilter
    texture.flipY = extension === 'hdr'
    texture.needsUpdate = true
    return texture
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).replace(/^THREE\.\w+Loader:\s*/, '')
    throw new Error(`Could not open ${file.name}. ${detail}`)
  }
}
