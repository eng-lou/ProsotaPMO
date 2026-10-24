import { ANNOTATION_ICONS, DEFAULT_CALLOUT, type Annotation } from './annotations'

export function calloutLayout(ctx: CanvasRenderingContext2D, annotation: Annotation) {
  const c = { ...DEFAULT_CALLOUT, ...annotation.callout }
  const media = c.mode === 'image' || c.mode === 'video'
  const circle = annotation.box_shape === 'circle'
  const icon = c.mode === 'icon' || c.mode === 'icon_text'
  const text = c.mode === 'icon' || media ? '' : c.mode === 'icon_text' ? annotation.text.trim() : annotation.text || '(empty)'
  const iconSize = Math.max(28, annotation.font_size * 1.7)
  ctx.font = `${annotation.font_size}px system-ui, sans-serif`
  // Icon callouts are a sign and a separate diamond badge, not a narrow
  // text box with an inline glyph. Media width/shape must not squeeze text.
  if (icon) {
    ctx.font = `600 ${annotation.font_size}px system-ui, sans-serif`
    const lines = text ? text.split('\n') : []
    const labelWidth = lines.length ? Math.max(...lines.map(line => ctx.measureText(line).width)) + 20 : 0
    const labelHeight = lines.length ? lines.length * annotation.font_size * 1.25 + 12 : 0
    const badgeSize = Math.max(44, iconSize * 1.6)
    const gap = labelWidth ? Math.max(20, annotation.font_size * 1.3) : 0
    const width = labelWidth + gap + badgeSize, height = Math.max(badgeSize, labelHeight)
    return { c, media, circle: false, icon, iconSize, text, lines, width, height,
      labelWidth, labelHeight, badgeSize, gap, anchorX: width, anchorY: height / 2 }
  }
  const maxText = circle ? c.width * .65 - (icon ? iconSize + 8 : 0) : Math.max(20, c.width - 20 - (icon ? iconSize + 8 : 0))
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (line && ctx.measureText(line + word).width > maxText) { lines.push(line.trimEnd()); line = '' }
      if (!line && !word.trim()) continue
      for (const char of word) {
        if (line && ctx.measureText(line + char).width > maxText) { lines.push(line); line = '' }
        line += char
      }
    }
    lines.push(line)
  }
  const textWidth = Math.max(0, ...lines.map(line => ctx.measureText(line).width))
  const width = circle || media ? c.width : Math.max(icon ? iconSize + 20 : 80, textWidth + 20 + (icon ? iconSize + 8 : 0))
  const height = circle ? c.width : media ? c.height : Math.max(icon ? iconSize + 16 : 0, lines.length * annotation.font_size * 1.25 + 16)
  return { c, media, circle, icon, iconSize, text, lines, width, height, labelWidth: 0, labelHeight: 0, badgeSize: 0, gap: 0, anchorX: circle ? width / 2 : 0, anchorY: height }
}

function fitImage(ctx: CanvasRenderingContext2D, source: HTMLImageElement | HTMLVideoElement, x: number, y: number, width: number, height: number, fit: 'cover' | 'contain') {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  if (!sw || !sh) return
  const scale = fit === 'cover' ? Math.max(width / sw, height / sh) : Math.min(width / sw, height / sh)
  ctx.drawImage(source, x + (width - sw * scale) / 2, y + (height - sh * scale) / 2, sw * scale, sh * scale)
}

// One painter for the live callout and the capture/video compositor.
export function drawCallout(ctx: CanvasRenderingContext2D, a: Annotation, source: HTMLImageElement | HTMLVideoElement | null, error = '', selected = false) {
  const l = calloutLayout(ctx, a), { c, width: w, height: h } = l
  ctx.save()
  const border = a.thick_border ? 3 : 1
  if (l.icon) {
    const badgeX = l.labelWidth + l.gap, cy = h / 2
    // The connector is behind both filled shapes. The scene leader attaches
    // to the right tip of the diamond (anchorX/anchorY).
    if (l.labelWidth && a.leader_visible) {
      ctx.beginPath(); ctx.moveTo(l.labelWidth, cy); ctx.lineTo(badgeX, cy)
      ctx.strokeStyle = a.leader_color; ctx.lineWidth = border; ctx.stroke()
    }
    const fillAndStroke = () => {
      if (a.has_background) { ctx.save(); ctx.globalAlpha *= a.background_opacity; ctx.fillStyle = a.background_color; ctx.fill(); ctx.restore() }
      ctx.strokeStyle = selected ? '#0ea5e9' : a.border_color; ctx.lineWidth = border; ctx.stroke()
    }
    if (l.labelWidth) {
      ctx.beginPath(); ctx.rect(border / 2, (h - l.labelHeight) / 2, l.labelWidth - border, l.labelHeight)
      fillAndStroke()
      ctx.font = `600 ${a.font_size}px system-ui, sans-serif`; ctx.fillStyle = a.text_color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      l.lines.forEach((line, i) => ctx.fillText(line, 10, cy + (i - (l.lines.length - 1) / 2) * a.font_size * 1.25))
    }
    const r = (l.badgeSize - border) / 2, cx = badgeX + l.badgeSize / 2
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath()
    fillAndStroke()
    const symbolSize = l.badgeSize * .5
    if (source && !error) fitImage(ctx, source, cx - symbolSize / 2, cy - symbolSize / 2, symbolSize, symbolSize, 'contain')
    else { ctx.font = `600 ${symbolSize * .85}px system-ui`; ctx.fillStyle = a.text_color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.symbol || ANNOTATION_ICONS[a.icon], cx, cy, symbolSize) }
    ctx.restore()
    return l
  }
  ctx.beginPath()
  if (l.circle) ctx.arc(w / 2, h / 2, (w - border) / 2, 0, Math.PI * 2)
  else ctx.roundRect(border / 2, border / 2, w - border, h - border, a.box_shape === 'rectangle' ? 0 : Math.min(14, h / 2))
  ctx.save(); ctx.clip()
  if (a.has_background) { ctx.save(); ctx.globalAlpha *= a.background_opacity; ctx.fillStyle = a.background_color; ctx.fillRect(0, 0, w, h); ctx.restore() }
  if (l.media && source && !error) fitImage(ctx, source, 0, 0, w, h, c.fit)
  ctx.fillStyle = a.text_color
  ctx.textBaseline = 'middle'
  if (l.media && (!source || error)) {
    ctx.font = '12px system-ui'; ctx.textAlign = 'center'
    ctx.fillText(error ? 'Media unavailable — replace file' : c.media_id ? 'Loading media…' : 'Choose an image or video', w / 2, h / 2, w - 24)
  }
  if (l.text) {
    ctx.font = `${a.font_size}px system-ui, sans-serif`
    ctx.textAlign = l.circle ? 'center' : 'left'
    const x = l.circle ? w / 2 : 10
    l.lines.forEach((line, i) => ctx.fillText(line, x, h / 2 + (i - (l.lines.length - 1) / 2) * a.font_size * 1.25))
  }
  ctx.restore()
  ctx.strokeStyle = selected ? '#0ea5e9' : a.border_color; ctx.lineWidth = border; ctx.stroke()
  ctx.restore()
  return l
}
