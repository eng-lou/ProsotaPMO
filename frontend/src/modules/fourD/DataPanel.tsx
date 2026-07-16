import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'
import type { IfcModelHandle } from './ifcModel'
import { IfcDataPanel } from './IfcDataPanel'
import { MeshDataPanel, type MeshImportItem } from './MeshDataPanel'
import type { ModelElementLink, ModelElementLinkSourceKind } from './modelElementLinks'
import type { IfcUnitDisplay } from './ifcUnitDisplay'

export type DataPanelTab = 'ifc' | '3d'

interface Props {
  open: boolean
  onToggle: () => void
  activeTab: DataPanelTab
  onTabChange: (tab: DataPanelTab) => void
  ifcHandles: IfcModelHandle[]
  activeObjectId: string | null
  selectedExpressId: number | null
  selectedExpressIds: Set<number>
  onSelectExpressId: (expressID: number | null, additive?: boolean, objectId?: string) => void
  // Select by Type / Select by Storey (2026-07-11) — see IfcDataPanel.tsx's
  // own onSelectMany doc comment; just passed straight through, this panel
  // doesn't otherwise touch bulk selection.
  onSelectMany: (expressIDs: number[], additive: boolean, objectId: string) => void
  onUnloadIfc: (id: string) => void
  meshImports: MeshImportItem[]
  hiddenIds: Set<string>
  onToggleMeshVisible: (id: string) => void
  onUnloadMesh: (id: string) => void
  selectedObjectIds: Set<string>
  onSelectObject: (id: string | null, additive?: boolean) => void
  // Unit toggle for IfcDataPanel's Spatial Decomposition list — see
  // FourD.tsx's own ifcUnitDisplay state for why it's owned there and just
  // passed through here (2026-07-11, per Maro: "rewire units").
  unitDisplay: IfcUnitDisplay
  onUnitDisplayChange: (value: IfcUnitDisplay) => void
  activities: Activity[]
  modelElementLinks: ModelElementLink[]
  animationProfiles: AnimationProfile[]
  onLinkElement: (sourceKind: ModelElementLinkSourceKind, elementRef: string, elementLabel: string, activityId: string) => void
  onUnlinkElement: (linkId: string) => void
  onAssignProfile: (linkId: string, profileId: string | null) => void
}

// Far-right panel (2026-07-11, per Maro: "two contextual side panels one for
// ifc and one for 3d") — one w-72 slot, tabbed between IFC Data (spatial
// structure/properties, IfcDataPanel.tsx) and 3D Data (list of plain
// GLTF/OBJ/FBX imports with visibility + unload, MeshDataPanel.tsx). Owns
// the shared chrome (width/border/tab bar); the two panels are content-only.
// Per-object texture editing used to live in the 3D Data tab but moved to
// the left "3D View Properties" panel (2026-07-11, per Maro — see
// TextureFields.tsx), so this panel no longer threads customTextures
// through at all.
//
// Section Box (2026-07-09) briefly lived here as a third tab, but Maro
// asked for it to be dockable like Animation Profiles instead ("make
// section contextual like profiles, i can fit in the profile panel or
// dock on each side") — it now lives in SideDock.tsx alongside
// AnimationProfilePanel, not fixed to this panel's own IFC/3D split.
//
// Collapsible (2026-07-11, per Maro: "hideable like the left one") — same
// open/collapsed-strip pattern as PropertiesPanel.tsx, mirrored to the
// right edge (border-l instead of border-r, ◂/▸ swapped since expanding
// this panel grows leftward instead of rightward).
//
// activities/modelElementLinks/onLink.../onUnlink... just pass through to
// both tabs' own Activity Link sections (ElementLinkFields.tsx) — this
// panel doesn't otherwise touch linking itself.
export function DataPanel({
  open, onToggle, activeTab, onTabChange, ifcHandles, activeObjectId, selectedExpressId, selectedExpressIds, onSelectExpressId, onSelectMany, onUnloadIfc,
  meshImports, hiddenIds, onToggleMeshVisible, onUnloadMesh, selectedObjectIds, onSelectObject, unitDisplay, onUnitDisplayChange,
  activities, modelElementLinks, animationProfiles, onLinkElement, onUnlinkElement, onAssignProfile,
}: Props) {
  if (!open) {
    return (
      <button
        onClick={onToggle}
        title="Show IFC/3D Data"
        className="w-6 shrink-0 flex items-start justify-center pt-3 bg-white border-l border-gray-200 text-gray-400 hover:text-gray-600"
      >
        ◂
      </button>
    )
  }

  // Selects "the whole model," never one specific element (2026-07-09 fix,
  // per Maro: checking the box, or clicking a spatial-container tree node,
  // kept leaving a stale selectedExpressId in place so Apply Transform/the
  // gizmo quietly kept targeting whatever individual element was last
  // clicked instead — see IfcDataPanel.tsx's own onSelectWholeModel doc
  // comment). Shared by the header checkbox and the tree's own container
  // nodes (IFCPROJECT/IfcSite/IfcBuilding/...) below, so both paths clear
  // the same way. Only clears selectedExpressId when *newly* selecting the
  // model (not already in selectedObjectIds) — toggling it back off
  // shouldn't also reach in and clear an unrelated selection. Takes the
  // specific model's own object id now that more than one can be loaded at
  // once (2026-07-09, per federated/assembly modeling).
  const selectWholeIfcModel = (id: string, additive: boolean) => {
    if (!selectedObjectIds.has(id)) onSelectExpressId(null)
    onSelectObject(id, additive)
  }

  return (
    <div className="w-72 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      <div className="flex items-center border-b border-gray-200 shrink-0">
        <button
          onClick={() => onTabChange('ifc')}
          className={`flex-1 text-xs font-bold px-3 py-2 border-b-2 ${
            activeTab === 'ifc' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          IFC Data{ifcHandles.length > 0 ? ` (${ifcHandles.length})` : ''}
        </button>
        <button
          onClick={() => onTabChange('3d')}
          className={`flex-1 text-xs font-bold px-3 py-2 border-b-2 ${
            activeTab === '3d' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          3D Data{meshImports.length > 0 ? ` (${meshImports.length})` : ''}
        </button>
        <button onClick={onToggle} title="Hide" className="px-2 text-gray-400 hover:text-gray-600 shrink-0">▸</button>
      </div>
      {activeTab === 'ifc' ? (
        <IfcDataPanel
          handles={ifcHandles}
          activeObjectId={activeObjectId}
          selectedExpressId={selectedExpressId}
          selectedExpressIds={selectedExpressIds}
          onSelect={onSelectExpressId}
          onSelectMany={onSelectMany}
          onUnload={onUnloadIfc}
          selectedObjectIds={selectedObjectIds}
          onSelectWholeModel={selectWholeIfcModel}
          unitDisplay={unitDisplay}
          onUnitDisplayChange={onUnitDisplayChange}
          activities={activities}
          links={modelElementLinks}
          animationProfiles={animationProfiles}
          onLinkElement={onLinkElement}
          onUnlinkElement={onUnlinkElement}
          onAssignProfile={onAssignProfile}
        />
      ) : (
        <MeshDataPanel
          items={meshImports}
          hiddenIds={hiddenIds}
          onToggleVisible={onToggleMeshVisible}
          onUnload={onUnloadMesh}
          selectedObjectIds={selectedObjectIds}
          onSelectObject={onSelectObject}
          activities={activities}
          links={modelElementLinks}
          animationProfiles={animationProfiles}
          onLinkElement={onLinkElement}
          onUnlinkElement={onUnlinkElement}
          onAssignProfile={onAssignProfile}
        />
      )}
    </div>
  )
}
