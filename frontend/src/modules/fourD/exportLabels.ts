import * as THREE from 'three'

// Registry of currently-visible drei <Html> overlay content that also
// needs to show up in Capture Image / Export Video (2026-07-30, per Maro:
// "the text boxes and texts dont show up in the captured renders. the
// leader lines show though and zones and path lines do show"). Root cause:
// every annotation/zone/path/measurement label
// (AnnotationMarker.tsx/ZoneGizmo.tsx/PathGizmo.tsx/MeasurementMarker.tsx)
// is a drei <Html> — a real DOM <div> CSS-positioned on top of the WebGL
// <canvas>, not actual Three.js scene geometry — while Viewport3D.tsx's
// handleCaptureImage/handleExportVideo only ever read pixels back off that
// canvas (rendererRef.current.domElement, via preserveDrawingBuffer). Real
// geometry (leader lines, zone fills/borders, path curves) is genuinely IN
// the WebGL framebuffer, so it captures fine; DOM overlays never are,
// regardless of drei's own `transform` prop (see AnnotationMarker.tsx etc
// — none of them set it, and it wouldn't matter for this either way).
//
// Fix: each of those components writes its own current-frame resolved
// world position + display content into this shared Map (AnnotationMarker/
// ZoneGizmo/PathGizmo do it inside their existing per-frame useFrame;
// MeasurementMarker — no useFrame at all today, its content is static —
// does it once via useEffect) instead of Viewport3D trying to
// independently re-derive the same Mode A/B animation math a second time,
// which would drift the moment either copy changed and not the other.
// exportOverlays.ts's own drawExportLabels then reads this same Map at
// capture time, projects each worldPos through the live camera, and draws
// a Canvas 2D equivalent — the exact same "cheap plain-Canvas2D drawing,
// no html2canvas dependency" discipline this file's own Gantt/Table/Cost
// overlays already use (see exportOverlays.ts's own header for why that
// was deliberately rejected there — the same reasoning applies here, more
// so, since Export Video needs this redrawn every single frame).
export type ExportLabelKind = 'annotation-box' | 'annotation-placemark' | 'zone-label' | 'path-label' | 'measurement-label'

export interface ExportLabel {
  kind: ExportLabelKind
  visible: boolean
  worldPos: THREE.Vector3
  text: string
  // null = no filled background (transparent), matching
  // Annotation.has_background's own off state.
  backgroundColor: string | null
  borderColor: string | null
  textColor: string
  fontSize: number
  borderRadius: number
  bold: boolean
  // Where worldPos maps to within the drawn box — mirrors each source
  // component's own CSS transform convention closely enough to read as
  // "the same label", not pixel-identical:
  // - 'bottom-left': AnnotationMarker.tsx's comment box (see that
  //   component's own 2026-07-30 header on why bottom-left is where its
  //   leader line actually touches it).
  // - 'bottom-center': PathGizmo.tsx's label (translateY(-140%) floats it
  //   above its anchor point).
  // - 'center': ZoneGizmo.tsx's label, MeasurementMarker.tsx's label, and
  //   AnnotationMarker.tsx's placemark pin (all plain `center` Html, no
  //   extra offset transform).
  anchor: 'bottom-left' | 'bottom-center' | 'center'
}

export type ExportLabelRegistry = Map<string, ExportLabel>

export function createExportLabelRegistry(): ExportLabelRegistry {
  return new Map()
}
