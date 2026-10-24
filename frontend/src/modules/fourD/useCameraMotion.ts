import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls } from 'three-stdlib'
import { focalLengthFromFov, fovFromFocalLength, type CameraPose } from './cameras'
import { motionDuration, posePosition, poseTarget, sampleShot, sampleSequence, type MotionShot, type TargetResolver } from './cameraMotion'
import { markRenderActivity } from './IdleRenderDriver'

export function useCameraMotion(cameraRef: React.MutableRefObject<THREE.Camera | null>, controlsRef: React.MutableRefObject<OrbitControls | null>, dateOverride: React.MutableRefObject<Date | null>, resolveTarget?: TargetResolver) {
  const [active, setActive] = useState(false), [playing, setPlaying] = useState(false), [seconds, setSeconds] = useState(0)
  const state = useRef({ active: false, playing: false, reverse: false, seconds: 0, shots: [] as MotionShot[] })
  const resolver = useRef(resolveTarget); resolver.current = resolveTarget
  const original = useRef<{ pose: CameraPose; zoom: number } | null>(null)
  const readPose = (): CameraPose | null => {
    const camera = cameraRef.current, controls = controlsRef.current
    if (!camera || !controls) return null
    const position = camera.position, target = controls.target
    return { base_position_x: position.x, base_position_y: position.y, base_position_z: position.z, base_target_x: target.x, base_target_y: target.y, base_target_z: target.z,
      base_focal_length: focalLengthFromFov(camera instanceof THREE.PerspectiveCamera ? camera.fov : 35), base_clip_start: camera instanceof THREE.PerspectiveCamera ? camera.near : .1, base_clip_end: camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera ? camera.far : 10000 }
  }
  const applyPose = (pose: CameraPose) => {
    const camera = cameraRef.current, controls = controlsRef.current
    if (!camera || !controls) return
    camera.position.copy(posePosition(pose)); controls.target.copy(poseTarget(pose)); camera.lookAt(controls.target)
    if (camera instanceof THREE.PerspectiveCamera) { camera.fov = fovFromFocalLength(pose.base_focal_length); camera.near = pose.base_clip_start; camera.far = pose.base_clip_end; camera.updateProjectionMatrix() }
    if (camera instanceof THREE.OrthographicCamera) { camera.zoom = (camera.top - camera.bottom) / (2 * camera.position.distanceTo(controls.target) * Math.tan(fovFromFocalLength(pose.base_focal_length) * Math.PI / 360)); camera.updateProjectionMatrix() }
    // Clear residual orbit damping before the next frame.
    const damping = controls.enableDamping; controls.enableDamping = false; controls.update(); controls.enableDamping = damping
    camera.updateMatrixWorld(); markRenderActivity()
  }
  const applyAt = (time: number) => {
    const result = sampleSequence(state.current.shots, time, resolver.current)
    if (result) { dateOverride.current = result.date; applyPose(result.pose) }
    return result?.date ?? null
  }
  const pause = () => { state.current.playing = false; setPlaying(false) }
  const seek = (time: number) => { const t = Math.max(0, Math.min(time, motionDuration(state.current.shots))); state.current.seconds = t; setSeconds(t); applyAt(t) }
  const activate = (shots: MotionShot[]) => {
    if (!shots.length) return
    if (!original.current) { const pose = readPose(); if (pose) original.current = { pose, zoom: cameraRef.current instanceof THREE.OrthographicCamera ? cameraRef.current.zoom : 1 } }
    state.current.shots = shots; state.current.active = true; setActive(true); pause(); seek(0)
  }
  const beginFraming = (shot: MotionShot) => {
    activate([shot]); pause()
    state.current.active = false; setActive(false); dateOverride.current = null
    applyPose(sampleShot(shot, 0).pose)
  }
  const restore = () => {
    pause(); state.current.active = false; setActive(false); dateOverride.current = null
    if (original.current) { applyPose(original.current.pose); if (cameraRef.current instanceof THREE.OrthographicCamera) { cameraRef.current.zoom = original.current.zoom; cameraRef.current.updateProjectionMatrix() } }
    original.current = null
  }
  const play = (reverse = false) => {
    if (!state.current.shots.length) return
    const duration = motionDuration(state.current.shots)
    if (!reverse && state.current.seconds >= duration) seek(0)
    if (reverse && state.current.seconds <= 0) seek(duration)
    state.current.reverse = reverse; state.current.playing = true; setPlaying(true)
  }
  useEffect(() => {
    let frame = 0, last = performance.now(), published = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now
      if (state.current.playing) {
        const next = state.current.seconds + dt * (state.current.reverse ? -1 : 1), total = motionDuration(state.current.shots)
        state.current.seconds = Math.max(0, Math.min(next, total)); applyAt(state.current.seconds)
        if (now - published > 80 || next >= total || next <= 0) { setSeconds(state.current.seconds); published = now }
        if (next >= total || next <= 0) pause()
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); dateOverride.current = null }
  }, [])
  return { active, playing, seconds, state, readPose, activate, beginFraming, restore, pause, play, seek, applyAt }
}
export type CameraMotionController = ReturnType<typeof useCameraMotion>
