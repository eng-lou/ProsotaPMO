// Rasterise SVG icons once, so captures and saved projects use exactly the
// same portable pixels. SVG code is never inserted into the app DOM.
export async function prepareCalloutIcon(file: File): Promise<File> {
  if (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml') return file
  if (file.size > 2 * 1024 * 1024) throw Error('Choose an SVG icon under 2 MB.')
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw Error('Invalid SVG icon.')
  const externalCss = (value: string) => /@import/i.test(value) || [...value.matchAll(/url\(([^)]*)\)/gi)].some(match => !match[1].trim().replace(/^['"]|['"]$/g, '').startsWith('#'))
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    if (['script', 'foreignObject', 'iframe', 'image', 'animate', 'animateTransform', 'set'].includes(element.localName)) {
      element.remove(); continue
    }
    if (element.localName === 'style' && externalCss(element.textContent || '')) { element.remove(); continue }
    for (const attr of Array.from(element.attributes)) {
      if (/^on/i.test(attr.name) || /(?:href|src)$/i.test(attr.name) && !attr.value.startsWith('#') || externalCss(attr.value)) element.removeAttribute(attr.name)
    }
  }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }))
  try {
    const image = new Image(); image.src = url; await image.decode()
    const canvas = document.createElement('canvas'), size = Math.max(image.naturalWidth, image.naturalHeight, 1)
    canvas.width = Math.max(1, Math.round(image.naturalWidth / size * 512))
    canvas.height = Math.max(1, Math.round(image.naturalHeight / size * 512))
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw Error('Could not prepare SVG icon')
    return new File([png], file.name.replace(/\.svg$/i, '.png'), { type: 'image/png' })
  } finally { URL.revokeObjectURL(url) }
}
