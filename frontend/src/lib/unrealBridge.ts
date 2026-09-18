// The web<->UE message surface for the ProsotaUE hybrid desktop app
// (Prosota_Unreal_Hybrid_Scope_and_Implementation_Strategy.docx, section
// 5.2). This exact same Prosota Web build runs both standalone in a normal
// browser (window.ue is then simply absent) and embedded in Unreal's CEF
// browser panel (ProsotaWebHostWidget, ProsotaUE repo) — every function
// here is a safe no-op in the former case.
//
// UE -> web: ProsotaWebHostWidget::CallWebListener calls
// window.prosotaBridge.<name>(...) if defined, no-op otherwise. Registered
// once at app startup via installUnrealBridge(), independent of routing —
// Phase 0 (doc 11.1) only exercises onElementSelected/onSimulationDateChanged
// against placeholder cubes, so these just log for now; real handlers land
// once there's an actual native BIM viewport/activity selection to sync
// against (Phase 1+).
//
// Web -> UE: JS calls window.ue.ProsotaBridge.<Name>(...); UProsotaBridge
// (ProsotaUE repo) re-broadcasts each as a native delegate. Exact PascalCase
// names below match its UFUNCTION declarations — BindUObject exposes them
// as-is, not camelCased.
declare global {
  interface Window {
    ue?: {
      ProsotaBridge?: {
        OpenProject(projectId: string): void
        SelectActivity(activityId: string): void
        SetSimulationDate(isoDate: string): void
        SetSelection(elementIds: string[]): void
        SetViewMode(mode: string): void
      }
    }
    prosotaBridge?: {
      onElementSelected(elementId: string): void
      onSelectionChanged(elementIds: string[]): void
      onSimulationDateChanged(isoDate: string): void
      onSceneReady(projectId: string): void
      onBridgeError(errorCode: string, context: string): void
    }
  }
}

export function installUnrealBridge() {
  window.prosotaBridge = {
    onElementSelected: (elementId) => console.log('[UnrealBridge] onElementSelected', elementId),
    onSelectionChanged: (elementIds) => console.log('[UnrealBridge] onSelectionChanged', elementIds),
    onSimulationDateChanged: (isoDate) => console.log('[UnrealBridge] onSimulationDateChanged', isoDate),
    onSceneReady: (projectId) => console.log('[UnrealBridge] onSceneReady', projectId),
    onBridgeError: (errorCode, context) => console.error('[UnrealBridge] onBridgeError', errorCode, context),
  }
}

function withUnrealBridge(fn: (bridge: NonNullable<NonNullable<Window['ue']>['ProsotaBridge']>) => void) {
  const bridge = window.ue?.ProsotaBridge
  if (!bridge) {
    console.warn('[UnrealBridge] not running inside ProsotaUE, call ignored')
    return
  }
  fn(bridge)
}

export const unrealBridge = {
  openProject: (projectId: string) => withUnrealBridge((b) => b.OpenProject(projectId)),
  selectActivity: (activityId: string) => withUnrealBridge((b) => b.SelectActivity(activityId)),
  setSimulationDate: (isoDate: string) => withUnrealBridge((b) => b.SetSimulationDate(isoDate)),
  setSelection: (elementIds: string[]) => withUnrealBridge((b) => b.SetSelection(elementIds)),
  setViewMode: (mode: string) => withUnrealBridge((b) => b.SetViewMode(mode)),
}
