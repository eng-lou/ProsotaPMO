/** Preserve the rendered camera framing independently of print-layout resizing. */
export function captureClashPrintImage(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  if (!canvas.width || !canvas.height) return
  const source = canvas.toDataURL('image/png')
  image.width = canvas.width
  image.height = canvas.height
  image.src = source
}
