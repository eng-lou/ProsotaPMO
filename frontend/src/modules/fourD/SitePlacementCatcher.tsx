import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { PathPoint } from './paths'

export function SitePlacementCatcher({ active, upAxis, elevation, onMove, onPlace }: {
  active: boolean; upAxis: 'y' | 'z'; elevation: number
  onMove(point: PathPoint): void; onPlace(point: PathPoint): void
}) {
  const { camera, scene, gl } = useThree()
  const current = useRef({ active, upAxis, elevation, onMove, onPlace })
  current.current = { active, upAxis, elevation, onMove, onPlace }
  useEffect(() => {
    const canvas = gl.domElement, ray = new THREE.Raycaster()
    let down: { x: number; y: number; id: number } | null = null, suppressClick = false
    const pick = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
      const hit = ray.intersectObjects(scene.children, true).find(hit => {
        if (!(hit.object instanceof THREE.Mesh)) return false
        for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
          if (!node.visible || node.userData.isSitePreview || node.userData.isPathGizmo || node.userData.isZoneGizmo || node.userData.isMeasurementGizmo || node.type.includes('TransformControls')) return false
        }
        return true
      })
      const plane = new THREE.Plane(new THREE.Vector3(0, current.current.upAxis === 'y' ? 1 : 0, current.current.upAxis === 'z' ? 1 : 0), -current.current.elevation)
      const point = hit?.point || ray.ray.intersectPlane(plane, new THREE.Vector3())
      return point ? { x: point.x, y: point.y, z: point.z } : null
    }
    const start = (event: PointerEvent) => {
      if (!current.current.active || event.button !== 0) return
      event.stopImmediatePropagation(); event.preventDefault(); suppressClick = true
      down = { x: event.clientX, y: event.clientY, id: event.pointerId }
      canvas.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (!current.current.active || event.buttons) return
      const point = pick(event); if (point) current.current.onMove(point)
    }
    const finish = (event: PointerEvent) => {
      if (!down || event.pointerId !== down.id) return
      const start = down; down = null
      event.stopImmediatePropagation(); event.preventDefault()
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      if (!current.current.active || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
      const point = pick(event); if (point) current.current.onPlace(point)
    }
    const click = (event: MouseEvent) => { if (suppressClick || current.current.active) { event.stopImmediatePropagation(); event.preventDefault(); suppressClick = false } }
    const cancel = () => { down = null }
    canvas.addEventListener('pointerdown', start, true); canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', finish, true); canvas.addEventListener('pointercancel', cancel)
    canvas.addEventListener('click', click, true)
    return () => {
      canvas.removeEventListener('pointerdown', start, true); canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', finish, true); canvas.removeEventListener('pointercancel', cancel)
      canvas.removeEventListener('click', click, true)
    }
  }, [camera, scene, gl])
  return null
}
