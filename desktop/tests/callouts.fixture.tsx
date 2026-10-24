import { calloutLayout, drawCallout } from '../../frontend/src/modules/fourD/calloutDrawing'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { Output, WebMOutputFormat, BufferTarget, CanvasSource } from 'mediabunny'
import { AnnotationMarker } from '../../frontend/src/modules/fourD/AnnotationMarker'
import { prepareExportLabels } from '../../frontend/src/modules/fourD/exportLabels'
import { DEFAULT_CALLOUT } from '../../frontend/src/modules/fourD/annotations'
import { prepareCalloutIcon } from '../../frontend/src/modules/fourD/calloutIconUpload'

const blobs = new Map(); (window as any).mediaBlobs = blobs
const ui = createRoot(document.getElementById('app')!)
const labels = { current: new Map() }, dateRef = { current: new Date('2026-01-01') }
const origin = new Date('2026-01-01')
const wait = (ms = 500) => new Promise(r => setTimeout(r, ms))
const check = (value: unknown, message: string) => { if (!value) throw Error(message) }
const annotation: any = { id: 'test', project_id: 'p', kind: 'comment', position_x: 0, position_y: 0, position_z: 0, text: 'SITE WELFARE', icon: 'worker', visible: true, has_background: true, background_color: '#08768d', background_opacity: 1, border_color: '#ffffff', thick_border: true, text_color: '#ffffff', font_size: 18, hide_closer_than: null, hide_farther_than: null, box_shape: 'rectangle', leader_offset_x: 0, leader_offset_y: 0, leader_offset_z: 0, leader_visible: false, animate: false, animation_loop: false, leader_dot_radius: .06, leader_color: '#ffffff', leader_rotation: 0, leader_scale: 1, placemark_scale: 1, placemark_rotation: 0, callout: { ...DEFAULT_CALLOUT } }
let end: Date | null = null
function render() { ui.render(<Canvas camera={{ position: [0, 0, 6] }}><AnnotationMarker annotation={{ ...annotation }} dateRef={dateRef} timelineStart={origin} timelineDaysPerSecond={1 / 86400} activities={[]} modelElementLinks={[]} animationProfiles={[]} elementKeyframes={[]} upAxis="y" animationStart={annotation.animate ? origin : null} animationEnd={end} leaderTargetObject={null} selected={false} onSelect={() => {}} onDragStart={() => {}} onDragMove={() => {}} onDragEnd={() => {}} onLeaderDragStart={() => {}} onLeaderDragMove={() => {}} onLeaderDragEnd={() => {}} exportLabelsRef={labels} /></Canvas>) }
async function frame(title: string) {
  await wait(); await prepareExportLabels(labels.current)
  const label = labels.current.get('test-box'); check(label, 'label registered')
  const canvas = document.createElement('canvas'); canvas.width = 280; canvas.height = 270
  const ctx = canvas.getContext('2d')!; const layout = calloutLayout(ctx, annotation); ctx.translate(layout.icon ? layout.anchorX + 10 : annotation.box_shape === 'circle' ? 140 : 10, layout.icon ? 120 : 250); label.paint(ctx, 1)
  const holder = document.createElement('div'); holder.textContent = title; holder.append(canvas); document.getElementById('results')!.append(holder)
  return canvas
}
(window as any).run = async () => {
  const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle fill="#ffad00" cx="40" cy="40" r="35"/><text x="40" y="50" text-anchor="middle" font-size="30">A1</text></svg>'], 'badge.svg', { type: 'image/svg+xml' })
  const png = await prepareCalloutIcon(svg); check(png.type === 'image/png', 'SVG converted'); blobs.set('image', png)
  annotation.callout = { ...DEFAULT_CALLOUT, mode: 'icon_text', media_id: 'image', width: 32 }; render(); await frame('SVG icon + text')
  const measure = document.createElement('canvas').getContext('2d')!
  const horizontal = calloutLayout(measure, annotation)
  check(horizontal.lines.length === 1 && horizontal.width > 200 && horizontal.height < 80, 'narrow stored width must not stack icon label')
  check(horizontal.anchorX === horizontal.width && horizontal.anchorY === horizontal.height / 2, 'leader attaches to diamond right tip')
  const empty = calloutLayout(measure, { ...annotation, text: '' })
  check(empty.lines.length === 0 && empty.labelWidth === 0, 'blank label must not show (empty)')
  const live = document.querySelector('#app canvas[aria-label="SITE WELFARE"]') as HTMLCanvasElement
  check(live && Math.abs(parseFloat(live.style.width) - horizontal.width) < .01, 'live layout matches painter')
  check(Math.abs(parseFloat(live.parentElement!.style.transform.slice(10)) + horizontal.anchorX) < .01, 'live leader uses same diamond anchor as export')
  annotation.box_shape = 'circle'; annotation.callout = { ...DEFAULT_CALLOUT, mode: 'image', media_id: 'image', width: 160 }; render()
  const still = await frame('Circle still')
  check(still.getContext('2d')!.getImageData(61, 91, 1, 1).data[3] === 0, 'circle corner must be transparent')
  check(still.getContext('2d')!.getImageData(140, 170, 1, 1).data[3] > 0, 'circle centre missing')
  annotation.box_shape = 'rectangle'; annotation.callout = { ...DEFAULT_CALLOUT, mode: 'icon', symbol: '01' }; render(); await frame('Number badge')
  const sourceCanvas = document.createElement('canvas'); sourceCanvas.width = 64; sourceCanvas.height = 64
  const target = new BufferTarget(), output = new Output({ format: new WebMOutputFormat(), target })
  const source = new CanvasSource(sourceCanvas, { codec: 'vp9', bitrate: 1000000 }); output.addVideoTrack(source, { frameRate: 10 }); await output.start()
  for (let i = 0; i < 20; i++) { const ctx = sourceCanvas.getContext('2d')!; ctx.fillStyle = i < 10 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 64, 64); await source.add(i / 10, .1) }
  await output.finalize(); blobs.set('video', new Blob([target.buffer!], { type: 'video/webm' }))
  annotation.callout = { ...DEFAULT_CALLOUT, mode: 'video', media_id: 'video', width: 160, height: 120, loop: false }; render()
  dateRef.current = new Date(origin.getTime() + 200); const red = await frame('Video 0.2s')
  dateRef.current = new Date(origin.getTime() + 1400); const blue = await frame('Video 1.4s')
  const pixel = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(80, 200, 1, 1).data
  check(pixel(red)[0] > 180 && pixel(red)[2] < 50, 'first video frame red')
  check(pixel(blue)[2] > 180 && pixel(blue)[0] < 50, 'seeked video frame blue')
  dateRef.current = new Date(origin.getTime() + 200); const reverse = await frame('Reverse scrub'); check(pixel(reverse)[0] > 180, 'reverse seek')
  annotation.animate = true; end = new Date(origin.getTime() + 2000); dateRef.current = new Date(origin.getTime() - 100); render(); await wait(); check(!labels.current.get('test-box').visible, 'pre-reveal hidden')
  dateRef.current = new Date(origin.getTime() + 1000); await wait(); check(Math.abs(labels.current.get('test-box').opacity - .5) < .01, 'whole-callout reveal fades')
  annotation.animate = false; annotation.callout = { ...DEFAULT_CALLOUT, mode: 'icon_text', media_id: 'image' }; render(); await wait()
  const helmet = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path fill="white" d="M10 34C10 20 18 12 28 10V6h8v4c10 2 18 10 18 24h4v8H6v-8h4zm5 12h34c-2 10-8 15-17 15s-15-5-17-15z"/></svg>'], 'helmet.svg', { type: 'image/svg+xml' })
  blobs.set('helmet', await prepareCalloutIcon(helmet))
  annotation.text = 'WORKERS ROUTE'; annotation.background_color = '#eba326'; annotation.border_color = '#eba326'; annotation.thick_border = false; annotation.font_size = 20; annotation.leader_visible = true; annotation.box_shape = 'rectangle'; annotation.callout = { ...DEFAULT_CALLOUT, mode: 'icon_text', media_id: 'helmet', width: 32 }; render(); await wait(); await prepareExportLabels(labels.current)
  const reference = document.createElement('canvas'); reference.width = 540; reference.height = 150
  const rc = reference.getContext('2d')!; rc.fillStyle = '#444444'; rc.fillRect(0,0,540,150)
  const layout = calloutLayout(rc, annotation), anchor = layout.width + 25
  rc.strokeStyle = '#ffffff'; rc.lineWidth = 2; rc.beginPath(); rc.moveTo(anchor,65); rc.lineTo(anchor+45,65); rc.lineTo(anchor+80,100); rc.stroke()
  rc.save(); rc.translate(anchor,65); labels.current.get('test-box').paint(rc,1); rc.restore()
  ;(window as any).referencePng = reference.toDataURL('image/png')
  return 'CALLOUT_TESTS_PASSED: horizontal sign, diamond anchor, empty label, live/export parity,  SVG, number badge, shapes, alpha, decoded video export, reverse scrub, reveal'
}
