// A minimal multi-file container (2026-09-30, per Maro: save textured OBJ
// sets so they survive a refresh). A textured OBJ is an .obj + .mtl + many
// texture images, but Model3DFile stores exactly one file per row — so the
// set is packed into one blob and stored as an ordinary mesh Model3DFile.
// No backend change, and no zip library needed for something this simple.
//
// Layout: MAGIC, then a 4-byte little-endian header length, then a UTF-8
// JSON header [{name, size}, ...], then each file's bytes back to back.
// Restore tells a bundle apart from a plain model file by MAGIC, which no
// OBJ/GLB/FBX/GLTF file starts with. (It may also be gzipped on top, like
// any model — lib/fileCache.ts unpacks that first.)

const MAGIC = new TextEncoder().encode('PROSOTA-BUNDLE-1\n')

export async function packBundle(files: File[]): Promise<Blob> {
  const header = new TextEncoder().encode(JSON.stringify(files.map(f => ({ name: f.name, size: f.size }))))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, header.length, true)
  return new Blob([MAGIC, len, header, ...files])
}

export async function isBundle(blob: Blob): Promise<boolean> {
  if (blob.size < MAGIC.length + 4) return false
  const head = new Uint8Array(await blob.slice(0, MAGIC.length).arrayBuffer())
  return head.every((b, i) => b === MAGIC[i])
}

export async function unpackBundle(blob: Blob): Promise<File[]> {
  let offset = MAGIC.length
  const headerLen = new DataView(await blob.slice(offset, offset + 4).arrayBuffer()).getUint32(0, true)
  offset += 4
  const entries = JSON.parse(await blob.slice(offset, offset + headerLen).text()) as { name: string; size: number }[]
  offset += headerLen
  const files: File[] = []
  for (const { name, size } of entries) {
    files.push(new File([blob.slice(offset, offset + size)], name))
    offset += size
  }
  if (offset !== blob.size) throw new Error('Corrupt model bundle (size mismatch)')
  return files
}
