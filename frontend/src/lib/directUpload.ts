// Direct-to-R2 upload helper (2026-08-23) — see backend/app/services/
// object_storage.py's own header for the full "why" (Vercel Functions hard-
// cap request bodies at 4.5MB; the presigned url this PUTs to sends the
// file's own bytes straight to Cloudflare R2, never through our own
// backend at all). A plain XMLHttpRequest, not `@/lib/api`'s shared axios
// instance — that instance's own request interceptor (AuthTokenProvider.tsx)
// attaches this app's Auth0 Bearer token to every request, which must never
// be sent to R2 (a third-party origin that wouldn't understand it anyway,
// and there's no reason to hand it a token that isn't its own); the
// presigned url's own signature is the only auth this request needs. Raw
// XHR rather than fetch() specifically for upload progress — fetch has no
// cross-browser-reliable upload progress event, XHR's `upload.onprogress`
// does.
export function uploadDirectToStorage(
  url: string, file: Blob, contentType: string, onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    if (onProgress) {
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload to storage failed (HTTP ${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload to storage failed — check your connection'))
    xhr.send(file)
  })
}
