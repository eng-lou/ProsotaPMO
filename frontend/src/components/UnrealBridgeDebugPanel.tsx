import { useEffect, useState } from 'react'
import { unrealBridge } from '../lib/unrealBridge'

// Throwaway Phase 0 test harness for the ProsotaUE bridge (see
// unrealBridge.ts) — proves SelectActivity reaches UE against the 3
// placeholder cubes (BP_ProsotaBridgeTest, ProsotaUE repo). Only ever
// renders inside the Unreal embed (window.ue is otherwise absent), so it's
// inert in every normal deploy. Remove once real Activity Table wiring
// replaces it.
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

  if (!bridgeReady) return null

  return (
    <div style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 9999, display: 'flex', gap: 4 }}>
      {['cube-1', 'cube-2', 'cube-3'].map((id) => (
        <button
          key={id}
          onClick={() => unrealBridge.selectActivity(id)}
          style={{ padding: '4px 8px', fontSize: 12, background: '#222', color: '#fff', border: '1px solid #555' }}
        >
          Select {id}
        </button>
      ))}
    </div>
  )
}
