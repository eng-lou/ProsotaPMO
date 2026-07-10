import { useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import { ElementLinkFields } from './ElementLinkFields'
import type { AnimationProfile } from './animationProfiles'
import type { ModelElementLink, SourceKind } from './modelElementLinks'

export interface MeshImportItem {
  id: string
  name: string
}

interface Props {
  items: MeshImportItem[]
  hiddenIds: Set<string>
  onToggleVisible: (id: string) => void
  onUnload: (id: string) => void
  selectedObjectIds: Set<string>
  onSelectObject: (id: string | null, additive?: boolean) => void
  activities: Activity[]
  links: ModelElementLink[]
  animationProfiles: AnimationProfile[]
  onLinkElement: (sourceKind: SourceKind, elementRef: string, elementLabel: string, activityId: string) => void
  onUnlinkElement: (linkId: string) => void
  onAssignProfile: (linkId: string, profileId: string | null) => void
}

function Item({ item, hidden, onToggleVisible, onUnload, selected, onSelect, onToggleSelected, activities, links, animationProfiles, onLinkElement, onUnlinkElement, onAssignProfile }: {
  item: MeshImportItem; hidden: boolean; onToggleVisible: () => void; onUnload: () => void
  selected: boolean; onSelect: (additive: boolean) => void; onToggleSelected: () => void
  activities: Activity[]; links: ModelElementLink[]; animationProfiles: AnimationProfile[]
  onLinkElement: (sourceKind: SourceKind, elementRef: string, elementLabel: string, activityId: string) => void
  onUnlinkElement: (linkId: string) => void
  onAssignProfile: (linkId: string, profileId: string | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const ownLinks = links.filter(l => l.source_kind === 'mesh' && l.element_ref === item.name)
  return (
    <div>
      <div className={`flex items-center gap-1.5 px-3 py-2 ${selected ? 'bg-blue-50' : ''}`}>
        <button onClick={() => setExpanded(v => !v)} title="Activity link" className="text-gray-400 w-3 shrink-0">
          {expanded ? '▾' : '▸'}
        </button>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          title={selected ? 'Selected — click to deselect' : 'Select this object'}
        />
        <input
          type="checkbox"
          checked={!hidden}
          onChange={onToggleVisible}
          title={hidden ? 'Hidden — click to show' : 'Visible — click to hide'}
        />
        <span
          onClick={e => onSelect(e.ctrlKey || e.metaKey)}
          className={`flex-1 text-xs truncate cursor-pointer ${hidden ? 'text-gray-300' : 'text-gray-700'}`}
          title={item.name}
        >
          {item.name}
        </span>
        {ownLinks.length > 0 && <span className="text-[10px] text-gray-400 shrink-0">{ownLinks.length} linked</span>}
        <button onClick={onUnload} title="Unload" className="text-xs text-gray-400 hover:text-red-600 shrink-0">✕</button>
      </div>
      {expanded && (
        <div className="pl-7 pr-3 pb-2">
          <ElementLinkFields
            activities={activities}
            links={ownLinks}
            animationProfiles={animationProfiles}
            onLink={activityId => onLinkElement('mesh', item.name, item.name, activityId)}
            onUnlink={onUnlinkElement}
            onAssignProfile={onAssignProfile}
          />
        </div>
      )}
    </div>
  )
}

// 3D tab content of the right-side DataPanel (2026-07-11, per Maro: manage
// plain "Import 3D" objects — GLTF/OBJ/FBX, not just IFC — including
// unloading one). No IFC-style property data to show for these, so this is
// mostly the list itself: a visibility checkbox and an unload button per
// object. Per-object texture override used to expand inline here but moved
// to the "3D View Properties" panel as a contextual section for whichever
// object is currently selected (2026-07-11, per Maro — see
// TextureFields.tsx's own header) — the expand arrow now opens an Activity
// Link section instead (element_ref = the file's name, the only stable
// identifier a plain mesh import has across re-imports — see
// modelElementLinks.ts's own header). Content-only — DataPanel.tsx owns the
// outer chrome and tab bar.
export function MeshDataPanel({ items, hiddenIds, onToggleVisible, onUnload, selectedObjectIds, onSelectObject, activities, links, animationProfiles, onLinkElement, onUnlinkElement, onAssignProfile }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex-1 p-3 text-xs text-gray-400">
        Use "Import 3D" to bring in a GLTF/GLB, OBJ, or FBX model and manage it here.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
      {items.map(item => (
        <Item
          key={item.id}
          item={item}
          hidden={hiddenIds.has(item.id)}
          onToggleVisible={() => onToggleVisible(item.id)}
          onUnload={() => onUnload(item.id)}
          selected={selectedObjectIds.has(item.id)}
          onSelect={additive => onSelectObject(item.id, additive)}
          onToggleSelected={() => onSelectObject(item.id, true)}
          activities={activities}
          links={links}
          animationProfiles={animationProfiles}
          onLinkElement={onLinkElement}
          onUnlinkElement={onUnlinkElement}
          onAssignProfile={onAssignProfile}
        />
      ))}
    </div>
  )
}
