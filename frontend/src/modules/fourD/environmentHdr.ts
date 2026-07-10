// "Upload a HDR of mine" (2026-07-11, per Maro) — lets the viewport's
// default environment map (see Viewport3D.tsx's own header on why one's
// needed at all — GLTFLoader's default material is fully metallic and
// needs reflected environment light to not look flat gray) be swapped for
// a user-supplied .hdr/.exr instead of always fetching drei's CDN preset.
// Not persisted to localStorage like the rest of viewerSettings.ts — an HDR
// is easily several MB as base64 text, well past what's reasonable to keep
// in browser storage — so like every other 4D import (import3d.ts,
// ifcModel.ts) it's session-only: re-upload next time.
//
// drei's useEnvironment only recognises a file's HDR/EXR format from its
// URL string (see @react-three/drei/core/useEnvironment.js's getLoader) —
// a plain blob: URL has no extension and fails that check, so this reads
// the file as a data: URL and rewrites its MIME prefix to application/hdr
// or application/exr, the exact prefixes useEnvironment special-cases.
export async function loadCustomEnvironment(file: File): Promise<{ name: string; url: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const mime = ext === 'hdr' ? 'application/hdr' : ext === 'exr' ? 'application/exr' : null
  if (!mime) throw new Error(`Unsupported environment file type: .${ext ?? '?'} — supported: .hdr, .exr`)

  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
  const base64 = raw.slice(raw.indexOf(',') + 1)
  return { name: file.name, url: `data:${mime};base64,${base64}` }
}
