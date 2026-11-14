// OrbitControls emits start/end synchronously for EACH wheel event. Keep one
// navigation session through the wheel burst and residual camera damping.
export function createNavigationSession(onStart: () => void, onEnd: () => void, settleMs = 150) {
  let moving = false
  let held = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const finish = () => {
    cancel()
    held = false
    if (!moving) return
    moving = false
    onEnd()
  }
  const settle = () => { cancel(); timer = setTimeout(finish, settleMs) }
  return {
    start() {
      cancel(); held = true
      if (moving) return
      moving = true
      onStart()
    },
    end() { held = false; if (moving) settle() },
    change() { if (moving && !held) settle() },
    finish,
  }
}
