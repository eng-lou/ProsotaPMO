import { useEffect, useState } from 'react'
import { unrealBridge } from '../lib/unrealBridge'

// Started as a throwaway Phase 0 test harness for the ProsotaUE bridge (see
// unrealBridge.ts) — originally proved SelectActivity reached UE against 3
// placeholder cubes (BP_ProsotaBridgeTest, ProsotaUE repo). That Blueprint
// is gone now (superseded by the real native BIM level), so the cube
// buttons/keys were dead weight calling into actors that no longer exist —
// replaced (2026-09-19) with the one thing this panel's "keyboard fallback"
// approach is now actually needed for: switching the Unreal shell into its
// native BIM viewport. Still only ever renders inside the Unreal embed
// (window.ue is otherwise absent), so it's inert in every normal deploy.
export function UnrealBridgeDebugPanel() {
  // window.ue.ProsotaBridge is bound via BindUObject in
  // ProsotaWebHostWidget::HandleLoadCompleted, a CEF load-lifecycle callback
  // that isn't guaranteed to fire before this component's first render —
  // polling avoids a race that would otherwise hide the panel permanently
  // even once the bridge becomes available moments later.
  const [bridgeReady, setBridgeReady] = useState(false)

  useEffect(() => {
    if (bridgeReady) return
    const interval = setInterval(() => {
      if (window.ue?.ProsotaBridge) {
        setBridgeReady(true)
        clearInterval(interval)
      }
    }, 500)
    return () => clearInterval(interval)
  }, [bridgeReady])

  // Keyboard fallback: mouse clicks inside the CEF panel need real pixel
  // coordinates that aren't reliably discoverable from outside the browser,
  // while a keypress just routes to whatever currently has focus, same as
  // the rest of Unreal's own input handling. This is also the ONLY way this
  // works at all, not just a fallback for it — AProsotaShellPlayerController
  // (ProsotaUE repo) runs FInputModeUIOnly while this page has focus, which
  // hands 100% of keyboard input to the browser and never reaches Unreal's
  // own native PlayerController::InputComponent bindings; confirmed the hard
  // way (2026-09-19) when a native "2" key binding silently did nothing.
  useEffect(() => {
    if (!bridgeReady) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === '2') unrealBridge.setViewMode('native')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [bridgeReady])

  if (!bridgeReady) return null

  return (
    <div style={{ position: 'fixed', bottom: 8, left: 8, zIndex: 2147483647, display: 'flex', gap: 4, opacity: 0.6 }}>
      <button
        onClick={() => unrealBridge.setViewMode('native')}
        style={{ padding: '3px 6px', fontSize: 10, background: '#222', color: '#fff', border: '1px solid #555', borderRadius: 3 }}
      >
        Switch to native BIM view
      </button>
    </div>
  )
}
