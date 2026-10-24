// Decode locally; fetching data: URLs is intentionally blocked by the desktop CSP.
export function dataUriToBlob(uri:string):Blob {
 const comma=uri.indexOf(',');if(!uri.startsWith('data:') || comma<0)throw Error('Invalid embedded texture')
 const header=uri.slice(0,comma),payload=uri.slice(comma+1)
 const binary=header.includes(';base64')?atob(payload):decodeURIComponent(payload)
 return new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:header.slice(5).split(';')[0] || 'application/octet-stream'})
}
